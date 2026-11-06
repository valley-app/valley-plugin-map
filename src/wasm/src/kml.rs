//! KML: the document checks and rewrites `parseMapFile` applies (unsupported elements dropped, coordinates checked
//! and normalized, `gx:Track` turned into points or lines with their times), togeojson's `kml()` placemarks with
//! styles, schema-typed extended data and time spans, and the file check on every drawn position.

use std::borrow::Cow;
use std::collections::HashMap;

use crate::js;
use crate::json::{Out, Positions, Props, Val};
use crate::xml::{self, Doc, NONE, REMOVED, REPLACED, REWRITTEN};
use crate::{Fail, Features, Res, get_multi, open_geometry, properties, text_of, xml_number};

const UNSUPPORTED: [&str; 5] = ["NetworkLink", "GroundOverlay", "ScreenOverlay", "PhotoOverlay", "Model"];

#[derive(Clone, Copy)]
enum Convert {
    Text,
    Number,
    Bool,
}

/// togeojson's `coord1` of one whitespace-free token: `token.split(',').map(parseFloat)`, NaN dropped, three at most.
fn coord1_token<'s>(token: &'s str, values: &mut Vec<(f64, Option<&'s str>)>) {
    values.clear();
    for part in token.split(',') {
        let (value, raw) = js::parse_float(part);
        if !value.is_nan() {
            values.push((value, raw));
            if values.len() == 3 {
                break;
            }
        }
    }
}

fn tokens(text: &str) -> impl Iterator<Item = &str> {
    js::trim(text).split(js::is_space).filter(|t| !t.is_empty())
}

/// Where a placemark's drawn geometries go: each becomes a feature with the placemark's properties and id.
struct Emit<'f> {
    features: &'f mut Features,
    props: &'f Out,
    id: Option<&'f str>,
}

impl Emit<'_> {
    /// One feature whose geometry `body` writes in place; `Invalid` when a drawn position fails the file check.
    fn draw(&mut self, kind: &str, wrap: bool, body: impl FnOnce(&mut Positions, &mut Out) -> Res<()>) -> Res<()> {
        let features = &mut *self.features;
        features.begin();
        open_geometry(&mut features.out, kind);
        if wrap {
            features.out.buf.push(b'[');
        }
        let mut positions = Positions::default();
        body(&mut positions, &mut features.out)?;
        features.out.raw(if wrap { "]}" } else { "}" });
        if positions.bad {
            return Err(Fail::Invalid);
        }
        features.bounds.merge(positions.bounds);
        features.finish(self.props, self.id);
        Ok(())
    }
}

fn normalize_id(id: &str) -> String {
    if id.starts_with('#') { id.to_owned() } else { format!("#{id}") }
}

struct Kml<'d, 'a> {
    doc: &'d Doc<'a>,
    styles: HashMap<String, Props>,
    schema: HashMap<String, Convert>,
}

impl<'a> Kml<'_, 'a> {
    fn id(&self, name: &str) -> Option<u16> {
        self.doc.id(name)
    }

    /// The comma-rewritten text of the `coordinates` element togeojson reads for `e` (its tuples are the rewritten
    /// element's). Files where that element belongs to a nested element are left to the JavaScript parser.
    fn coordinates(&self, e: u32) -> Res<Cow<'a, str>> {
        match self.doc.first(e, self.id("coordinates")) {
            Some(c) if self.doc.elems[c as usize].parent == e => Ok(match self.doc.original_text(c)? {
                Cow::Borrowed(text) => xml::collapsed(text),
                Cow::Owned(text) => Cow::Owned(xml::collapsed(&text).into_owned()),
            }),
            Some(_) => Err(Fail::Fallback),
            None => Ok(Cow::Borrowed("")),
        }
    }

    /// Writes togeojson's `coord(text)`: every token with two or more numbers.
    fn write_coord(text: &str, positions: &mut Positions, out: &mut Out) {
        let mut values = Vec::with_capacity(3);
        for token in tokens(text) {
            coord1_token(token, &mut values);
            if values.len() >= 2 {
                positions.push(out, &values);
            }
        }
    }

    /// Writes the positions of a replaced track: each `gx:coord`'s `Number()` values, three at most (what `coord1`
    /// reads back from the generated coordinates).
    fn write_track(&self, track: u32, limit: usize, positions: &mut Positions, out: &mut Out) -> Res<()> {
        let mut values = Vec::with_capacity(3);
        for c in self.doc.named(track, self.id("gx:coord")).take(limit) {
            let text = self.doc.text(c)?;
            values.clear();
            match &text {
                Cow::Borrowed(text) => {
                    for part in tokens(text).take(3) {
                        values.push(js::to_number(part)?);
                    }
                    positions.push(out, &values);
                }
                Cow::Owned(text) => {
                    for part in tokens(text).take(3) {
                        values.push((js::to_number(part)?.0, None));
                    }
                    positions.push(out, &values);
                }
            }
        }
        Ok(())
    }

    /// togeojson's `getGeometry` over the direct children, with the file check on each drawn position. Without `emit`
    /// it only collects the track times (the placemark's properties need them before its geometries are written).
    fn geometry(&self, e: u32, depth: usize, emit: &mut Option<Emit<'_>>, times: &mut Vec<Vec<u32>>) -> Res<()> {
        if depth > 32 {
            return Err(Fail::Fallback);
        }
        for child in self.doc.children(e) {
            let replaced = self.doc.elems[child as usize].flags & REPLACED != 0;
            match self.doc.name(child) {
                "MultiGeometry" | "MultiTrack" | "gx:MultiTrack" => self.geometry(child, depth + 1, emit, times)?,
                "Point" | "LinearRing" | "LineString" | "Polygon" if emit.is_none() => {}
                "Point" if replaced => emit.as_mut().map_or(Ok(()), |emit| emit.draw("Point", false, |positions, out| self.write_track(child, 1, positions, out)))?,
                "LinearRing" | "LineString" if replaced => emit.as_mut().map_or(Ok(()), |emit| emit.draw("LineString", true, |positions, out| self.write_track(child, usize::MAX, positions, out)))?,
                "Point" => {
                    let text = self.coordinates(child)?;
                    let compact: Cow<'_, str> = if text.contains(js::is_space) { Cow::Owned(text.chars().filter(|&c| !js::is_space(c)).collect()) } else { Cow::Borrowed(&text) };
                    let mut values = Vec::with_capacity(3);
                    coord1_token(&compact, &mut values);
                    if let Some(emit) = emit.as_mut().filter(|_| values.len() >= 2) {
                        emit.draw("Point", false, |positions, out| {
                            positions.push(out, &values);
                            Ok(())
                        })?;
                    }
                }
                "LinearRing" | "LineString" => {
                    let text = self.coordinates(child)?;
                    let mut values = Vec::with_capacity(3);
                    let drawn = tokens(&text).filter(|token| { coord1_token(token, &mut values); values.len() >= 2 }).take(2).count();
                    if let Some(emit) = emit.as_mut().filter(|_| drawn >= 2) {
                        emit.draw("LineString", true, |positions, out| {
                            Self::write_coord(&text, positions, out);
                            Ok(())
                        })?;
                    }
                }
                "Polygon" => {
                    let mut out = Out::default();
                    open_geometry(&mut out, "Polygon");
                    out.buf.push(b'[');
                    let mut bounds = crate::json::Bounds::default();
                    let mut rings = 0;
                    for ring in self.doc.named(child, self.id("LinearRing")).collect::<Vec<_>>() {
                        let mark = out.buf.len();
                        if rings > 0 {
                            out.buf.push(b',');
                        }
                        out.buf.push(b'[');
                        let mut positions = Positions::default();
                        Self::write_coord(&self.coordinates(ring)?, &mut positions, &mut out);
                        positions.close(&mut out);
                        out.buf.push(b']');
                        if positions.count < 4 {
                            out.buf.truncate(mark);
                            continue;
                        }
                        if positions.bad {
                            return Err(Fail::Invalid);
                        }
                        rings += 1;
                        bounds.merge(positions.bounds);
                    }
                    out.raw("]}");
                    if let Some(emit) = emit.as_mut().filter(|_| rings > 0) {
                        emit.features.bounds.merge(bounds);
                        emit.features.push(&out, emit.props, emit.id);
                    }
                }
                "Track" | "gx:Track" => {
                    let mut elems: Vec<u32> = self.doc.named(child, self.id("coord")).collect();
                    if elems.is_empty() {
                        elems = self.doc.descendants(child).filter(|&d| self.doc.local(d) == "coord").collect();
                    }
                    if elems.is_empty() {
                        continue;
                    }
                    let line = elems.len() > 2;
                    let drawn = if line { &elems[..] } else { &elems[..1] };
                    if let Some(emit) = emit.as_mut() {
                        emit.draw(if line { "LineString" } else { "Point" }, line, |positions, out| {
                            let mut values = Vec::new();
                            for &c in drawn {
                                let text = self.doc.text(c)?;
                                values.clear();
                                values.extend(text.split(' ').map(|part| (js::parse_float(part).0, None)));
                                positions.push(out, &values);
                            }
                            Ok(())
                        })?;
                    }
                    let when: Vec<u32> = self.doc.named(child, self.id("when")).collect();
                    if !when.is_empty() {
                        times.push(when);
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn color(&self, e: u32, prefix: &str, props: &mut Props) -> Res<()> {
        let Some(color) = self.doc.first(e, self.id("color")) else { return Ok(()) };
        let text = self.doc.text(color)?;
        if !text.is_ascii() {
            return Err(Fail::Fallback);
        }
        let value = text.strip_prefix('#').unwrap_or(&text);
        let key = if prefix == "stroke" || prefix == "fill" { prefix.to_owned() } else { format!("{prefix}-color") };
        if value.len() == 6 || value.len() == 3 {
            props.set(&key, Val::Str(format!("#{value}")))?;
        } else if value.len() == 8 {
            props.set(&format!("{prefix}-opacity"), Val::Num(js::parse_int16(&value[..2]) / 255.0))?;
            props.set(&key, Val::Str(format!("#{}{}{}", &value[6..8], &value[4..6], &value[2..4])))?;
        }
        Ok(())
    }

    fn numeric(&self, e: u32, source: &str, target: &str, props: &mut Props) -> Res<()> {
        let value = js::parse_float(&text_of(self.doc, e, source)?).0;
        if !value.is_nan() {
            props.set(target, Val::Num(value))?;
        }
        Ok(())
    }

    /// togeojson's `extractStyle`.
    fn style(&self, e: u32) -> Res<Props> {
        let mut props = Props::default();
        if let Some(poly) = self.doc.first(e, self.id("PolyStyle")) {
            self.color(poly, "fill", &mut props)?;
            if text_of(self.doc, poly, "fill")? == "0" {
                props.set("fill-opacity", Val::Num(0.0))?;
            }
            if text_of(self.doc, poly, "outline")? == "0" {
                props.set("stroke-opacity", Val::Num(0.0))?;
            }
        }
        if let Some(line) = self.doc.first(e, self.id("LineStyle")) {
            self.color(line, "stroke", &mut props)?;
            self.numeric(line, "width", "stroke-width", &mut props)?;
        }
        if let Some(label) = self.doc.first(e, self.id("LabelStyle")) {
            self.color(label, "label", &mut props)?;
            self.numeric(label, "scale", "label-scale", &mut props)?;
        }
        if let Some(icon) = self.doc.first(e, self.id("IconStyle")) {
            self.color(icon, "icon", &mut props)?;
            self.numeric(icon, "scale", "icon-scale", &mut props)?;
            self.numeric(icon, "heading", "icon-heading", &mut props)?;
            if let Some(hotspot) = self.doc.first(icon, self.id("hotSpot")) {
                let attr = |name: &str| self.doc.attr(hotspot, name).map(|v| v.into_owned()).unwrap_or_default();
                let (x, y) = (js::parse_float(&attr("x")).0, js::parse_float(&attr("y")).0);
                if !x.is_nan() && !y.is_nan() {
                    props.set("icon-offset", Val::Arr(vec![Val::Num(x), Val::Num(y)]))?;
                    props.set("icon-offset-units", Val::Arr(vec![Val::Str(attr("xunits")), Val::Str(attr("yunits"))]))?;
                }
            }
            if let Some(image) = self.doc.first(icon, self.id("Icon")) {
                let href = text_of(self.doc, image, "href")?;
                if !href.is_empty() {
                    props.set("icon", Val::Str(href.into_owned()))?;
                }
            }
        }
        Ok(props)
    }

    fn style_id(&self, style: u32) -> String {
        let mut id = self.doc.attr(style, "id").map(|v| v.into_owned()).unwrap_or_default();
        let parent = self.doc.elems[style as usize].parent;
        if id.is_empty() && parent != NONE && self.doc.local(parent) == "CascadingStyle" {
            id = self.doc.attr(parent, "kml:id").filter(|v| !v.is_empty()).or_else(|| self.doc.attr(parent, "id")).map(|v| v.into_owned()).unwrap_or_default();
        }
        normalize_id(&id)
    }

    fn extended_data(&self, e: u32) -> Res<Props> {
        let mut props = Props::default();
        let Some(data) = self.doc.first(e, self.id("ExtendedData")) else { return Ok(props) };
        for item in self.doc.named(data, self.id("Data")) {
            let key = self.doc.attr(item, "name").map(|v| v.into_owned()).unwrap_or_default();
            props.set(&key, Val::Str(text_of(self.doc, item, "value")?.into_owned()))?;
        }
        for item in self.doc.named(data, self.id("SimpleData")) {
            let key = self.doc.attr(item, "name").map(|v| v.into_owned()).unwrap_or_default();
            let convert = match self.schema.get(&key) {
                Some(&convert) => convert,
                None if js::prototype_key(&key) => return Err(Fail::Fallback),
                None => Convert::Text,
            };
            let text = self.doc.text(item)?;
            props.set(&key, match convert {
                Convert::Text => Val::Str(text.into_owned()),
                Convert::Number => Val::Num(js::to_number(&text)?.0),
                Convert::Bool => Val::Bool(!text.is_empty()),
            })?;
        }
        Ok(props)
    }

    fn placemark(&self, e: u32, track_times: Option<&Vec<Vec<u32>>>, features: &mut Features) -> Res<()> {
        let mut times = Vec::new();
        self.geometry(e, 0, &mut None, &mut times)?;
        let mut props = get_multi(self.doc, e, &["name", "address", "visibility", "open", "phoneNumber", "description"])?;
        if let Some(description) = self.doc.first(e, self.id("description"))
            && let Some(html) = self.doc.first_cdata_child(description) {
                props.set("description", Val::Str(html))?;
            }
        let url = text_of(self.doc, e, "styleUrl")?;
        if !url.is_empty() {
            let url = normalize_id(&url);
            props.set("styleUrl", Val::Str(url.clone()))?;
            if let Some(style) = self.styles.get(&url) {
                props.merge(style.clone())?;
            }
        }
        props.merge(self.style(e)?)?;
        props.merge(self.extended_data(e)?)?;
        if let Some(span) = self.doc.first(e, self.id("TimeSpan")) {
            let mut value = Props::default();
            value.set("begin", Val::Str(text_of(self.doc, span, "begin")?.into_owned()))?;
            value.set("end", Val::Str(text_of(self.doc, span, "end")?.into_owned()))?;
            props.set("timespan", Val::Obj(value))?;
        }
        if let Some(stamp) = self.doc.first(e, self.id("TimeStamp")) {
            props.set("timestamp", Val::Str(text_of(self.doc, stamp, "when")?.into_owned()))?;
        }
        if !times.is_empty() {
            let mut coordinate = Props::default();
            let mut all: Vec<Val> = times.into_iter().map(Val::Times).collect();
            coordinate.set("times", if all.len() == 1 { all.swap_remove(0) } else { Val::Arr(all) })?;
            props.set("coordinateProperties", Val::Obj(coordinate))?;
        }
        if let Some(visibility) = props.get("visibility") {
            let visible = !matches!(visibility, Val::Str(v) if v == "0");
            props.set("visibility", Val::Bool(visible))?;
        }
        if let Some(track) = track_times.filter(|t| t.iter().any(|values| !values.is_empty())) {
            let mut all: Vec<Val> = track.iter().cloned().map(Val::Times).collect();
            props.set("coordTimes", if all.len() == 1 { all.swap_remove(0) } else { Val::Arr(all) })?;
        }
        let id = self.doc.attr(e, "id").filter(|id| !id.is_empty());
        let props = properties(self.doc, &props)?;
        let mut emit = Some(Emit { features, props: &props, id: id.as_deref() });
        self.geometry(e, 0, &mut emit, &mut Vec::new())

    }
}

fn position(values: &[f64]) -> Res<()> {
    if values.len() < 2 || values.iter().any(|v| !v.is_finite()) || !js::valid_lng_lat(values[0], values[1]) {
        return Err(Fail::Invalid);
    }
    Ok(())
}

fn ancestor(doc: &Doc, e: u32, test: impl Fn(u32) -> bool) -> u32 {
    let mut at = doc.elems[e as usize].parent;
    while at != NONE && !test(at) {
        at = doc.elems[at as usize].parent;
    }
    at
}

/// Returns whether unsupported elements were dropped.
pub fn convert(doc: &mut Doc, features: &mut Features) -> Res<bool> {
    let mut unsupported = false;
    let mut i = 0;
    while i < doc.elems.len() {
        if UNSUPPORTED.contains(&doc.name(i as u32)) {
            doc.elems[i].flags |= REMOVED;
            unsupported = true;
            i = doc.elems[i].sub_end as usize;
        } else {
            i += 1;
        }
    }

    let coordinates: Vec<u32> = doc.named(NONE, doc.id("coordinates")).collect();
    for &c in &coordinates {
        if doc.first(c, doc.id("coordinates")).is_some() {
            return Err(Fail::Fallback);
        }
        let text = doc.original_text(c)?;
        let collapsed = xml::collapsed(&text);
        let mut count = 0;
        let mut values = Vec::with_capacity(3);
        for tuple in xml::coordinate_tuples(&collapsed) {
            values.clear();
            for part in tuple.split(',') {
                values.push(xml_number(Some(part))?);
            }
            position(&values)?;
            count += 1;
        }
        let parent = doc.elems[c as usize].parent;
        let kind = if parent == NONE { "" } else { doc.local(parent) };
        if (kind == "Point" && count != 1) || (kind == "LineString" && count < 2) || (kind == "LinearRing" && count < 3) {
            return Err(Fail::Invalid);
        }
    }
    for &c in &coordinates {
        doc.elems[c as usize].flags |= REWRITTEN;
    }
    for name in ["Point", "LineString", "LinearRing"] {
        for e in doc.named(NONE, doc.id(name)) {
            if doc.first(e, doc.id("coordinates")).is_none() {
                return Err(Fail::Invalid);
            }
        }
    }
    for e in doc.named(NONE, doc.id("Polygon")) {
        if doc.named(e, doc.id("outerBoundaryIs")).count() != 1 {
            return Err(Fail::Invalid);
        }
        for boundary in doc.children(e) {
            if matches!(doc.local(boundary), "outerBoundaryIs" | "innerBoundaryIs") && doc.named(boundary, doc.id("LinearRing")).count() != 1 {
                return Err(Fail::Invalid);
            }
        }
    }

    let tracks: Vec<u32> = doc.named(NONE, doc.id("gx:Track")).collect();
    let mut track_times: HashMap<u32, Vec<Vec<u32>>> = HashMap::new();
    let mut points = Vec::new();
    for &track in &tracks {
        let gx = doc.id("gx:Track");
        if ancestor(doc, track, |a| doc.is(a, gx)) != NONE {
            return Err(Fail::Fallback);
        }
        let mut count = 0;
        for c in doc.named(track, doc.id("gx:coord")) {
            let text = doc.text(c)?;
            let trimmed = js::trim(&text);
            let parts: Vec<&str> = if trimmed.is_empty() { vec![""] } else { trimmed.split(js::is_space).filter(|p| !p.is_empty()).collect() };
            let values = parts.iter().map(|part| xml_number(Some(part))).collect::<Res<Vec<_>>>()?;
            position(&values)?;
            count += 1;
        }
        if count == 0 {
            return Err(Fail::Invalid);
        }
        let placemark = ancestor(doc, track, |a| doc.local(a) == "Placemark");
        if placemark != NONE {
            track_times.entry(placemark).or_default().push(doc.named(track, doc.id("when")).collect());
        }
        points.push(count == 1);
    }
    for (&track, &point) in tracks.iter().zip(&points) {
        doc.rename(track, if point { "Point" } else { "LineString" })?;
        doc.elems[track as usize].flags |= REPLACED;
    }

    let doc: &Doc = doc;
    let mut kml = Kml { doc, styles: HashMap::new(), schema: HashMap::new() };
    for style in doc.named(NONE, doc.id("Style")) {
        let id = kml.style_id(style);
        let props = kml.style(style)?;
        kml.styles.insert(id, props);
    }
    for map in doc.named(NONE, doc.id("StyleMap")) {
        let id = normalize_id(&doc.attr(map, "id").map(|v| v.into_owned()).unwrap_or_default());
        let url = text_of(doc, map, "styleUrl")?;
        if !url.is_empty()
            && let Some(style) = kml.styles.get(&normalize_id(&url)).cloned() {
                kml.styles.insert(id, style);
            }
    }
    for field in doc.named(NONE, doc.id("SimpleField")) {
        let name = doc.attr(field, "name").map(|v| v.into_owned()).unwrap_or_default();
        let kind = doc.attr(field, "type").map(|v| v.into_owned()).unwrap_or_default();
        if js::prototype_key(&name) || js::prototype_key(&kind) {
            return Err(Fail::Fallback);
        }
        let convert = match kind.as_str() {
            "int" | "uint" | "short" | "ushort" | "float" | "double" => Convert::Number,
            "bool" => Convert::Bool,
            _ => Convert::Text,
        };
        kml.schema.insert(name, convert);
    }
    for placemark in doc.named(NONE, doc.id("Placemark")).collect::<Vec<_>>() {
        kml.placemark(placemark, track_times.get(&placemark), features)?;
    }
    Ok(unsupported)
}
