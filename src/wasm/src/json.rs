//! JSON output with the property values JavaScript would hold: insertion-ordered keys that keep their first position,
//! texts read lazily from the document, and non-finite numbers as sentinel strings the caller revives.

use std::io::Write;

use crate::Fail;
use crate::js;
use crate::xml::Doc;

/// An `Ext` entry with no value at that point.
pub const EXT_NULL: u32 = u32::MAX;
/// An `Ext` entry whose element text reads as a number (`parseFloat`); without it the text itself.
pub const EXT_NUMBER: u32 = 0x8000_0000;

#[derive(Clone)]
pub enum Val {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    /// The `textContent` of an element, trimmed when the flag is set.
    Text(u32, bool),
    Arr(Vec<Val>),
    Obj(Props),
    /// Per-point extension values (`EXT_NULL`, `EXT_NUMBER | element`, or an element whose text is the value).
    Ext(Vec<u32>),
    /// Texts of these elements.
    Times(Vec<u32>),
    /// `new Array(n).fill(null)`.
    Nulls(usize),
}

#[derive(Clone, Default)]
pub struct Props(pub Vec<(String, Val)>);

impl Props {
    /// `object[key] = value`; `__proto__` is a prototype assignment in JavaScript, left to the JavaScript parser.
    pub fn set(&mut self, key: &str, value: Val) -> Result<(), Fail> {
        if key == "__proto__" {
            return Err(Fail::Fallback);
        }
        match self.0.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key.to_owned(), value)),
        }
        Ok(())
    }

    pub fn get(&self, key: &str) -> Option<&Val> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn get_mut(&mut self, key: &str) -> Option<&mut Val> {
        self.0.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// `Object.assign(this, other)`.
    pub fn merge(&mut self, other: Props) -> Result<(), Fail> {
        for (key, value) in other.0 {
            self.set(&key, value)?;
        }
        Ok(())
    }
}

/// Output bytes: one growing vector, or fixed-size chunks that are never copied (the feature list of a large file
/// would otherwise need twice its size in the module's memory while the vector grows).
pub struct Buf {
    chunks: Vec<Vec<u8>>,
    /// Chunk size; 0 for a single vector.
    chunk: usize,
}

impl Default for Buf {
    fn default() -> Buf {
        Buf { chunks: vec![Vec::new()], chunk: 0 }
    }
}

impl Buf {
    fn last(&mut self) -> &mut Vec<u8> {
        if self.chunk != 0 && self.chunks.last().is_some_and(|c| c.len() == self.chunk) {
            self.chunks.push(Vec::with_capacity(self.chunk));
        }
        self.chunks.last_mut().unwrap_or_else(|| unreachable!())
    }

    pub fn push(&mut self, byte: u8) {
        self.last().push(byte);
    }

    pub fn extend_from_slice(&mut self, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            let chunk = self.chunk;
            let last = self.last();
            let take = if chunk == 0 { bytes.len() } else { (chunk - last.len()).min(bytes.len()) };
            last.extend_from_slice(&bytes[..take]);
            bytes = &bytes[take..];
        }
    }

    pub fn len(&self) -> usize {
        self.chunks.iter().map(Vec::len).sum()
    }

    /// A single-vector buffer's bytes.
    pub fn as_slice(&self) -> &[u8] {
        debug_assert!(self.chunk == 0);
        &self.chunks[0]
    }

    pub fn truncate(&mut self, len: usize) {
        debug_assert!(self.chunk == 0);
        self.chunks[0].truncate(len);
    }

    pub fn into_chunks(self) -> Vec<Vec<u8>> {
        self.chunks
    }
}

impl Write for Buf {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Default)]
pub struct Out {
    pub buf: Buf,
    /// A NaN or infinity was written as a sentinel string.
    pub nonfinite: bool,
}

impl Out {
    pub fn with_capacity(capacity: usize) -> Out {
        Out { buf: Buf { chunks: vec![Vec::with_capacity(capacity)], chunk: 0 }, nonfinite: false }
    }

    pub fn chunked(chunk: usize) -> Out {
        Out { buf: Buf { chunks: vec![Vec::with_capacity(chunk)], chunk }, nonfinite: false }
    }

    pub fn raw(&mut self, text: &str) {
        self.buf.extend_from_slice(text.as_bytes());
    }

    pub fn str(&mut self, text: &str) {
        self.buf.push(b'"');
        let bytes = text.as_bytes();
        let mut from = 0;
        for (i, &b) in bytes.iter().enumerate() {
            let escape: &[u8] = match b {
                b'"' => b"\\\"",
                b'\\' => b"\\\\",
                b'\n' => b"\\n",
                b'\r' => b"\\r",
                b'\t' => b"\\t",
                0..=0x1f => b"",
                _ => continue,
            };
            self.buf.extend_from_slice(&bytes[from..i]);
            if escape.is_empty() {
                let _ = write!(self.buf, "\\u{b:04x}");
            } else {
                self.buf.extend_from_slice(escape);
            }
            from = i + 1;
        }
        self.buf.extend_from_slice(&bytes[from..]);
        self.buf.push(b'"');
    }

    /// A number; `raw` is its source text when that text is a JSON number literal.
    pub fn num(&mut self, value: f64, raw: Option<&str>) {
        if !value.is_finite() {
            self.nonfinite = true;
            self.raw(if value.is_nan() { "\"\\u0000NaN\"" } else if value > 0.0 { "\"\\u0000Infinity\"" } else { "\"\\u0000-Infinity\"" });
        } else if let Some(raw) = raw {
            self.raw(raw);
        } else {
            let _ = write!(self.buf, "{value:?}");
        }
    }

    pub fn val(&mut self, doc: &Doc, value: &Val) -> Result<(), Fail> {
        match value {
            Val::Null => self.raw("null"),
            Val::Bool(b) => self.raw(if *b { "true" } else { "false" }),
            Val::Num(n) => self.num(*n, None),
            Val::Str(s) => self.str(s),
            Val::Text(e, trim) => {
                let text = doc.text(*e)?;
                self.str(if *trim { js::trim(&text) } else { &text });
            }
            Val::Arr(items) => {
                self.buf.push(b'[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        self.buf.push(b',');
                    }
                    self.val(doc, item)?;
                }
                self.buf.push(b']');
            }
            Val::Obj(props) => self.props(doc, props)?,
            Val::Ext(entries) => {
                self.buf.push(b'[');
                for (i, &entry) in entries.iter().enumerate() {
                    if i > 0 {
                        self.buf.push(b',');
                    }
                    if entry == EXT_NULL {
                        self.raw("null");
                    } else if entry & EXT_NUMBER != 0 {
                        let text = doc.text(entry & !EXT_NUMBER)?;
                        let (value, raw) = js::parse_float(&text);
                        self.num(value, raw);
                    } else {
                        self.str(&doc.text(entry)?);
                    }
                }
                self.buf.push(b']');
            }
            Val::Times(elems) => {
                self.buf.push(b'[');
                for (i, &e) in elems.iter().enumerate() {
                    if i > 0 {
                        self.buf.push(b',');
                    }
                    self.str(&doc.text(e)?);
                }
                self.buf.push(b']');
            }
            Val::Nulls(n) => {
                self.buf.push(b'[');
                for i in 0..*n {
                    self.raw(if i == 0 { "null" } else { ",null" });
                }
                self.buf.push(b']');
            }
        }
        Ok(())
    }

    pub fn props(&mut self, doc: &Doc, props: &Props) -> Result<(), Fail> {
        self.buf.push(b'{');
        for (i, (key, value)) in props.0.iter().enumerate() {
            if i > 0 {
                self.buf.push(b',');
            }
            self.str(key);
            self.buf.push(b':');
            self.val(doc, value)?;
        }
        self.buf.push(b'}');
        Ok(())
    }
}

/// `[[minLng, minLat], [maxLng, maxLat]]` over every drawn position, with `Math.min`/`Math.max` semantics.
#[derive(Clone, Copy, Default)]
pub struct Bounds(pub Option<[f64; 4]>);

impl Bounds {
    pub fn add(&mut self, lng: f64, lat: f64) {
        self.0 = Some(match self.0 {
            None => [lng, lat, lng, lat],
            Some([a, b, c, d]) => [js::min(a, lng), js::min(b, lat), js::max(c, lng), js::max(d, lat)],
        });
    }

    pub fn merge(&mut self, other: Bounds) {
        if let Some([a, b, c, d]) = other.0 {
            self.add(a, b);
            self.add(c, d);
        }
    }
}

/// The positions of one line or ring, written into the caller's output as `[x,y],[x,y]`, validated like the
/// JavaScript parser's file check: two or more finite values, a valid longitude and latitude.
#[derive(Default)]
pub struct Positions {
    pub count: usize,
    pub bounds: Bounds,
    /// A position failed the check; it matters only when the line is drawn.
    pub bad: bool,
    first: Vec<f64>,
    last: Vec<f64>,
}

impl Positions {
    pub fn push(&mut self, out: &mut Out, values: &[(f64, Option<&str>)]) {
        if values.len() < 2 || values.iter().any(|(v, _)| !v.is_finite()) || !js::valid_lng_lat(values[0].0, values[1].0) {
            self.bad = true;
        } else {
            self.bounds.add(values[0].0, values[1].0);
        }
        if self.count > 0 {
            out.buf.push(b',');
        } else {
            self.first = values.iter().map(|(v, _)| *v).collect();
        }
        self.last.clear();
        self.last.extend(values.iter().map(|(v, _)| *v));
        out.buf.push(b'[');
        for (i, (value, raw)) in values.iter().enumerate() {
            if i > 0 {
                out.buf.push(b',');
            }
            out.num(*value, *raw);
        }
        out.buf.push(b']');
        self.count += 1;
    }

    /// togeojson's `fixRing`: closes the ring with a copy of its first position unless the last one equals it.
    pub fn close(&mut self, out: &mut Out) {
        if self.count == 0 || (self.first.len() == self.last.len() && self.first.iter().zip(&self.last).all(|(a, b)| a == b)) {
            return;
        }
        let values: Vec<(f64, Option<&str>)> = self.first.iter().map(|&v| (v, None)).collect();
        self.push(out, &values);
    }
}
