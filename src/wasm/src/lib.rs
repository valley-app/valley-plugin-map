//! Map's file reader: GPX and KML text to the GeoJSON FeatureCollection, bounds and unsupported flag that
//! `parseMapFile` returns, in one pass over the bytes instead of a DOM, a namespace rewrite and a DOM walk.
//!
//! `map_file_parse(ptr, len) -> u64` takes `[format, ...utf8]` (format 0 = GPX, 1 = KML) and returns a response frame:
//! `[0, flags, count: u32, (ptr: u32, len: u32, capacity: u32) × count]`, the JSON in chunks the host decodes in order
//! and releases with `valley_free(ptr, capacity)` (flags bit 0: the JSON holds `"\u0000NaN"`-style sentinels for
//! non-finite numbers),
//! `[1, ..."invalid"]` for a file the JavaScript parser rejects too, or `[1, ..."fallback"]` for input this reader
//! leaves to the JavaScript parser (constructs whose JavaScript reading depends on prototype lookups or a detached
//! DOM, and documents above the module's memory).

mod gpx;
mod js;
mod json;
mod kml;
mod xml;

use std::borrow::Cow;

use json::{Bounds, Out, Props, Val};
use valley_plugin_abi::{ABI_VERSION, Status, encode_response, pack_region};
use xml::Doc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fail {
    /// The JavaScript parser throws `file.invalid` for this file.
    Invalid,
    /// Leave this file to the JavaScript parser.
    Fallback,
}

pub type Res<T> = Result<T, Fail>;

/// The `features` array, written in order, and the bounds of every drawn position.
pub struct Features {
    pub out: Out,
    count: usize,
    pub bounds: Bounds,
}

impl Features {
    /// Opens a feature: the caller writes its geometry object into `out`, then calls `finish`.
    pub fn begin(&mut self) {
        if self.count > 0 {
            self.out.buf.push(b',');
        }
        self.count += 1;
        self.out.raw("{\"type\":\"Feature\",\"geometry\":");
    }

    pub fn finish(&mut self, properties: &Out, id: Option<&str>) {
        self.out.raw(",\"properties\":");
        self.out.buf.extend_from_slice(properties.buf.as_slice());
        self.out.nonfinite |= properties.nonfinite;
        if let Some(id) = id {
            self.out.raw(",\"id\":");
            self.out.str(id);
        }
        self.out.buf.push(b'}');
    }

    /// `finish`, writing the properties straight into the output.
    pub fn finish_props(&mut self, doc: &Doc, props: &Props) -> Res<()> {
        self.out.raw(",\"properties\":");
        self.out.props(doc, props)?;
        self.out.buf.push(b'}');
        Ok(())
    }

    pub fn push(&mut self, geometry: &Out, properties: &Out, id: Option<&str>) {
        self.begin();
        self.out.buf.extend_from_slice(geometry.buf.as_slice());
        self.out.nonfinite |= geometry.nonfinite;
        self.finish(properties, id);
    }
}

/// Writes `{"type":kind,"coordinates":` into `out`; the caller writes the coordinates and the closing `}`.
pub fn open_geometry(out: &mut Out, kind: &str) {
    out.raw("{\"type\":\"");
    out.raw(kind);
    out.raw("\",\"coordinates\":");
}

pub fn properties(doc: &Doc, props: &Props) -> Res<Out> {
    let mut out = Out::default();
    out.props(doc, props)?;
    Ok(out)
}

/// togeojson's `getMulti`: each tag's first descendant, when its text is not empty.
pub fn get_multi(doc: &Doc, e: u32, tags: &[&str]) -> Res<Props> {
    let mut props = Props::default();
    for &tag in tags {
        if let Some(found) = doc.first(e, doc.id(tag)) {
            let text = doc.text(found)?;
            if !text.is_empty() {
                props.set(tag, Val::Str(text.into_owned()))?;
            }
        }
    }
    Ok(props)
}

/// The text of the first `tag` descendant, `""` without one (togeojson's `nodeVal(get1(…))`).
pub fn text_of<'a>(doc: &Doc<'a>, e: u32, tag: &str) -> Res<Cow<'a, str>> {
    match doc.first(e, doc.id(tag)) {
        Some(found) => doc.text(found),
        None => Ok(Cow::Borrowed("")),
    }
}

/// `xmlNumber`: a present, non-blank value that `Number()` reads as finite.
pub fn xml_number(value: Option<&str>) -> Res<f64> {
    let value = value.ok_or(Fail::Invalid)?;
    if js::trim(value).is_empty() {
        return Err(Fail::Invalid);
    }
    let (number, _) = js::to_number(value)?;
    if number.is_finite() { Ok(number) } else { Err(Fail::Invalid) }
}

/// Output chunk size: large enough that a file needs few, small enough that the last one wastes little memory.
const CHUNK: usize = 1 << 20;

/// The JSON of one file, in chunks, and whether it holds non-finite sentinels.
pub fn parse(format: u8, text: &str) -> Res<(Vec<Vec<u8>>, bool)> {
    let mut doc = Doc::parse(text)?;
    let expected = if format == 0 { "gpx" } else { "kml" };
    if doc.root_local != expected {
        return Err(Fail::Invalid);
    }
    let mut features = Features { out: Out::chunked(CHUNK), count: 0, bounds: Bounds::default() };
    features.out.raw("{\"collection\":{\"type\":\"FeatureCollection\",\"features\":[");
    let unsupported = if format == 0 {
        gpx::convert(&doc, &mut features)?;
        false
    } else {
        kml::convert(&mut doc, &mut features)?
    };
    let mut out = features.out;
    out.raw("]},\"bounds\":");
    match features.bounds.0 {
        None => out.raw("null"),
        Some([a, b, c, d]) => {
            out.raw("[[");
            out.num(a, None);
            out.buf.push(b',');
            out.num(b, None);
            out.raw("],[");
            out.num(c, None);
            out.buf.push(b',');
            out.num(d, None);
            out.raw("]]");
        }
    }
    out.raw(if unsupported { ",\"unsupported\":true}" } else { ",\"unsupported\":false}" });
    Ok((out.buf.into_chunks(), out.nonfinite))
}

fn leak(bytes: Vec<u8>) -> u64 {
    let boxed = bytes.into_boxed_slice();
    let len = u32::try_from(boxed.len()).unwrap_or(0);
    let ptr = Box::into_raw(boxed).cast::<u8>() as usize;
    pack_region(u32::try_from(ptr).unwrap_or(0), len)
}

/// Parses one GPX or KML file (see the module documentation for the frames).
#[unsafe(no_mangle)]
pub extern "C" fn map_file_parse(ptr: u32, len: u32) -> u64 {
    if ptr == 0 || len == 0 {
        return leak(encode_response(Status::Error, b"fallback"));
    }
    // SAFETY: the host wrote `len` bytes at `ptr`, a region it obtained from `valley_alloc`, and frees it after the call.
    let input = unsafe { std::slice::from_raw_parts(ptr as usize as *const u8, len as usize) };
    let Ok(text) = std::str::from_utf8(&input[1..]) else { return leak(encode_response(Status::Error, b"fallback")) };
    match parse(input[0], text) {
        Ok((chunks, nonfinite)) => {
            let mut table = Vec::with_capacity(6 + chunks.len() * 12);
            table.extend_from_slice(&[0, u8::from(nonfinite)]);
            table.extend_from_slice(&u32::try_from(chunks.len()).unwrap_or(0).to_le_bytes());
            for chunk in chunks {
                let mut chunk = std::mem::ManuallyDrop::new(chunk);
                for value in [chunk.as_mut_ptr() as usize, chunk.len(), chunk.capacity()] {
                    table.extend_from_slice(&u32::try_from(value).unwrap_or(0).to_le_bytes());
                }
            }
            leak(table)
        }
        Err(Fail::Invalid) => leak(encode_response(Status::Error, b"invalid")),
        Err(Fail::Fallback) => leak(encode_response(Status::Error, b"fallback")),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn valley_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn valley_alloc(len: u32) -> u32 {
    let ptr = Box::into_raw(vec![0_u8; len as usize].into_boxed_slice()).cast::<u8>() as usize;
    u32::try_from(ptr).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn valley_free(ptr: u32, len: u32) {
    if ptr == 0 {
        return;
    }
    // SAFETY: `ptr`/`len` describe a boxed slice this module leaked from `valley_alloc` or a response frame; the host
    // frees each region exactly once.
    drop(unsafe { Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr as usize as *mut u8, len as usize)) });
}

/// The frame-dispatched entry: the reader is called through `map_file_parse`, so every method is unknown.
#[unsafe(no_mangle)]
pub extern "C" fn valley_call(_ptr: u32, _len: u32) -> u64 {
    leak(encode_response(Status::Error, b"map file reader has no framed methods; call map_file_parse"))
}
