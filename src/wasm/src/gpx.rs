//! GPX: togeojson's `gpx()` (tracks, then routes, then waypoints) followed by the single-point segments and routes
//! `parseMapFile` adds, with the file check applied to every drawn position.

use std::borrow::Cow;
use std::collections::HashMap;

use crate::js;
use crate::json::{EXT_NULL, EXT_NUMBER, Out, Positions, Props, Val};
use crate::xml::{Doc, NONE};
use crate::{Fail, Features, Res, get_multi, open_geometry, text_of, xml_number};

const GPXX: &str = "http://www.garmin.com/xmlschemas/GpxExtensions/v3";

fn float<'a>(value: Option<Cow<'a, str>>) -> (f64, Option<&'a str>) {
    match value {
        Some(Cow::Borrowed(text)) => js::parse_float(text),
        Some(Cow::Owned(text)) => (js::parse_float(&text).0, None),
        None => (f64::NAN, None),
    }
}

/// A position's values, each with its source text when JSON can copy it.
type Position<'a> = Vec<(f64, Option<&'a str>)>;

struct Line {
    positions: Positions,
    times: Vec<u32>,
    /// Plural extension name → one entry per point of the segment.
    ext: Vec<(String, Vec<u32>)>,
}

struct Gpx<'d, 'a> {
    doc: &'d Doc<'a>,
    /// Namespaces whose elements become properties: the Garmin extension namespace and every `xmlns:` on the root.
    ns: Vec<Option<u8>>,
    keys: HashMap<u16, String>,
}

impl<'a> Gpx<'_, 'a> {
    fn id(&self, name: &str) -> Option<u16> {
        self.doc.id(name)
    }

    /// togeojson's `coordPair`: `[lon, lat, ele?]` by `parseFloat`, or none when lon or lat is not a number.
    fn coord_pair(&self, e: u32) -> Res<Option<Position<'a>>> {
        let (lon, lat) = self.doc.attr_pair(e, "lon", "lat");
        let (lon, lat) = (float(lon), float(lat));
        if lon.0.is_nan() || lat.0.is_nan() {
            return Ok(None);
        }
        let mut values = vec![lon, lat];
        if let Some(ele) = self.doc.first(e, self.id("ele")) {
            let ele = float(Some(self.doc.text(ele)?));
            if !ele.0.is_nan() {
                values.push(ele);
            }
        }
        Ok(Some(values))
    }

    /// togeojson's `getExtensions`: element children of `extensions`, Garmin's TrackPointExtension flattened.
    fn extensions(&self, e: u32, depth: usize, out: &mut Vec<(String, u32)>) -> Res<()> {
        if depth > 32 {
            return Err(Fail::Fallback);
        }
        for child in self.doc.children(e) {
            let name = match self.doc.name(child) {
                "heart" | "gpxtpx:hr" | "hr" => "heart",
                other => other,
            };
            if name == "gpxtpx:TrackPointExtension" {
                self.extensions(child, depth + 1, out)?;
                continue;
            }
            if child >= EXT_NUMBER {
                return Err(Fail::Fallback);
            }
            let numeric = !js::parse_float(&self.doc.text(child)?).0.is_nan();
            out.push((name.to_owned(), if numeric { EXT_NUMBER | child } else { child }));
        }
        Ok(())
    }

    /// The points of a segment or route togeojson keeps: two or more. Every point passed the `Number()` check, so
    /// `parseFloat` reads a number from each lon and lat too.
    fn kept(&self, e: u32, point: &str) -> Option<Vec<u32>> {
        let points: Vec<u32> = self.doc.named(e, self.id(point)).collect();
        (points.len() >= 2).then_some(points)
    }

    /// togeojson's `getPoints` for a kept segment: positions written into `out`, times and extension values collected.
    fn points(&self, points: &[u32], with_ext: bool, out: &mut Out) -> Res<Line> {
        let mut line = Line { positions: Positions::default(), times: Vec::new(), ext: Vec::new() };
        let (time, extensions) = (self.id("time"), self.id("extensions"));
        let mut values = Vec::new();
        out.buf.push(b'[');
        for (index, &p) in points.iter().enumerate() {
            let Some(pair) = self.coord_pair(p)? else { return Err(Fail::Fallback) };
            line.positions.push(out, &pair);
            if let Some(t) = self.doc.first(p, time)
                && !self.doc.text(t)?.is_empty() {
                    line.times.push(t);
                }
            if !with_ext {
                continue;
            }
            let Some(ext) = self.doc.first(p, extensions) else { continue };
            values.clear();
            self.extensions(ext, 0, &mut values)?;
            for (name, entry) in values.drain(..) {
                let plural = if name == "heart" { name } else { format!("{}s", name.replacen("gpxtpx:", "", 1)) };
                let slot = match line.ext.iter().position(|(n, _)| *n == plural) {
                    Some(slot) => slot,
                    None => {
                        line.ext.push((plural, vec![EXT_NULL; points.len()]));
                        line.ext.len() - 1
                    }
                };
                line.ext[slot].1[index] = entry;
            }
        }
        out.buf.push(b']');
        if line.positions.bad {
            return Err(Fail::Invalid);
        }
        Ok(line)
    }

    fn key(&mut self, e: u32) -> String {
        let name = self.doc.elems[e as usize].name;
        let doc = self.doc;
        self.keys.entry(name).or_insert_with(|| doc.name(e).replacen(':', "_", 1)).clone()
    }

    /// togeojson's `extractProperties`.
    fn properties(&mut self, e: u32) -> Res<Props> {
        let mut props = get_multi(self.doc, e, &["name", "cmt", "desc", "type", "time", "keywords"])?;
        for ns in self.ns.clone().into_iter().flatten() {
            for child in self.doc.descendants(e) {
                if self.doc.elems[child as usize].ns == ns {
                    let key = self.key(child);
                    props.set(&key, Val::Text(child, true))?;
                }
            }
        }
        let links: Vec<u32> = self.doc.named(e, self.id("link")).collect();
        if !links.is_empty() {
            let mut list = Vec::with_capacity(links.len());
            for link in links {
                let mut item = Props::default();
                item.set("href", self.doc.attr(link, "href").map_or(Val::Null, |href| Val::Str(href.into_owned())))?;
                item.merge(get_multi(self.doc, link, &["text", "type"])?)?;
                list.push(Val::Obj(item));
            }
            props.set("links", Val::Arr(list))?;
        }
        Ok(props)
    }

    /// togeojson's `getLineStyle` of the first `extensions` descendant.
    fn line_style(&self, e: u32) -> Res<Props> {
        let mut props = Props::default();
        let Some(extensions) = self.doc.first(e, self.id("extensions")) else { return Ok(props) };
        let Some(line) = self.doc.first(extensions, self.id("line")) else { return Ok(props) };
        let color = text_of(self.doc, line, "color")?;
        if !color.is_empty() {
            props.set("stroke", Val::Str(format!("#{color}")))?;
        }
        let opacity = js::parse_float(&text_of(self.doc, line, "opacity")?).0;
        if !opacity.is_nan() && opacity != 0.0 {
            props.set("stroke-opacity", Val::Num(opacity))?;
        }
        let width = js::parse_float(&text_of(self.doc, line, "width")?).0;
        if !width.is_nan() && width != 0.0 {
            props.set("stroke-width", Val::Num((width * 96.0) / 25.4))?;
        }
        Ok(props)
    }

    fn track(&mut self, e: u32, features: &mut Features) -> Res<()> {
        let segments: Vec<u32> = self.doc.named(e, self.id("trkseg")).collect();
        let kept: Vec<Vec<u32>> = segments.into_iter().filter_map(|segment| self.kept(segment, "trkpt")).collect();
        if kept.is_empty() {
            return Ok(());
        }
        let multi = kept.len() > 1;
        features.begin();
        open_geometry(&mut features.out, if multi { "MultiLineString" } else { "LineString" });
        if multi {
            features.out.buf.push(b'[');
        }
        let mut lines = Vec::with_capacity(kept.len());
        for (index, points) in kept.iter().enumerate() {
            if index > 0 {
                features.out.buf.push(b',');
            }
            let line = self.points(points, true, &mut features.out)?;
            features.bounds.merge(line.positions.bounds);
            lines.push(line);
        }
        features.out.raw(if multi { "]}" } else { "}" });
        let mut props = Props::default();
        props.set("_gpxType", Val::Str("trk".into()))?;
        props.merge(self.properties(e)?)?;
        props.merge(self.line_style(e)?)?;
        let times: Vec<Val> = lines.iter_mut().filter(|line| !line.times.is_empty()).map(|line| Val::Times(std::mem::take(&mut line.times))).collect();
        if !times.is_empty() {
            let mut coordinate = Props::default();
            let mut times = times;
            coordinate.set("times", if multi { Val::Arr(times) } else { times.swap_remove(0) })?;
            props.set("coordinateProperties", Val::Obj(coordinate))?;
        }
        let counts: Vec<usize> = lines.iter().map(|line| line.positions.count).collect();
        let mut created: Vec<String> = Vec::new();
        for (index, line) in lines.iter_mut().enumerate() {
            if props.get("coordinateProperties").is_none() {
                props.set("coordinateProperties", Val::Obj(Props::default()))?;
            }
            let Some(Val::Obj(coordinate)) = props.get_mut("coordinateProperties") else { return Err(Fail::Fallback) };
            for (name, entries) in std::mem::take(&mut line.ext) {
                if !multi {
                    coordinate.set(&name, Val::Ext(entries))?;
                    continue;
                }
                if coordinate.get(&name).is_none() {
                    coordinate.set(&name, Val::Arr(counts.iter().map(|&n| Val::Nulls(n)).collect()))?;
                    created.push(name.clone());
                } else if !created.contains(&name) {
                    return Err(Fail::Fallback);
                }
                if let Some(Val::Arr(list)) = coordinate.get_mut(&name) {
                    list[index] = Val::Ext(entries);
                }
            }
        }
        features.finish_props(self.doc, &props)
    }

    fn route(&mut self, e: u32, features: &mut Features) -> Res<()> {
        let Some(points) = self.kept(e, "rtept") else { return Ok(()) };
        features.begin();
        open_geometry(&mut features.out, "LineString");
        let line = self.points(&points, false, &mut features.out)?;
        features.out.buf.push(b'}');
        features.bounds.merge(line.positions.bounds);
        let mut props = Props::default();
        props.set("_gpxType", Val::Str("rte".into()))?;
        props.merge(self.properties(e)?)?;
        props.merge(self.line_style(e)?)?;
        features.finish_props(self.doc, &props)
    }

    fn waypoint(&mut self, e: u32, features: &mut Features) -> Res<()> {
        let mut props = self.properties(e)?;
        props.merge(get_multi(self.doc, e, &["sym"])?)?;
        let Some(pair) = self.coord_pair(e)? else { return Ok(()) };
        point(self.doc, &pair, &props, features)
    }

    /// The segments and routes of exactly one point, which `parseMapFile` draws as points.
    fn single(&mut self, container: &str, point_name: &str, kind: &str, features: &mut Features) -> Res<()> {
        let containers: Vec<u32> = self.doc.named(NONE, self.id(container)).collect();
        for e in containers {
            let mut points = self.doc.named(e, self.id(point_name));
            let (Some(p), None) = (points.next(), points.next()) else { continue };
            let lon = self.doc.attr(p, "lon");
            let lat = self.doc.attr(p, "lat");
            let raw = |value: &Option<Cow<'a, str>>| match value {
                Some(Cow::Borrowed(text)) => js::to_number(text).ok().and_then(|(_, raw)| raw),
                _ => None,
            };
            let mut values = vec![(xml_number(lon.as_deref())?, raw(&lon)), (xml_number(lat.as_deref())?, raw(&lat))];
            if let Some(ele) = self.doc.first(p, self.id("ele")) {
                let text = self.doc.text(ele)?;
                if !text.is_empty() {
                    let value = xml_number(Some(&text))?;
                    values.push((value, match &text {
                        Cow::Borrowed(text) => js::to_number(text).ok().and_then(|(_, raw)| raw),
                        Cow::Owned(_) => None,
                    }));
                }
            }
            let owner = if container == "trkseg" { self.doc.elems[e as usize].parent } else { e };
            let name = if owner == NONE { Cow::Borrowed("") } else { text_of(self.doc, owner, "name")? };
            let mut props = Props::default();
            props.set("name", Val::Str(name.into_owned()))?;
            props.set("time", Val::Str(text_of(self.doc, p, "time")?.into_owned()))?;
            props.set("_gpxType", Val::Str(kind.into()))?;
            point(self.doc, &values, &props, features)?;
        }
        Ok(())
    }
}

fn point(doc: &Doc, values: &[(f64, Option<&str>)], props: &Props, features: &mut Features) -> Res<()> {
    let mut positions = Positions::default();
    features.begin();
    open_geometry(&mut features.out, "Point");
    positions.push(&mut features.out, values);
    features.out.buf.push(b'}');
    if positions.bad {
        return Err(Fail::Invalid);
    }
    features.bounds.merge(positions.bounds);
    features.finish_props(doc, props)
}

pub fn convert(doc: &Doc, features: &mut Features) -> Res<()> {
    for name in ["wpt", "rtept", "trkpt"] {
        for e in doc.named(NONE, doc.id(name)) {
            let (lon, lat) = doc.attr_pair(e, "lon", "lat");
            let (lon, lat) = (xml_number(lon.as_deref())?, xml_number(lat.as_deref())?);
            if !js::valid_lng_lat(lon, lat) {
                return Err(Fail::Invalid);
            }
        }
    }
    let mut ns = vec![doc.ns_id(GPXX)];
    if let Some(root) = doc.first(NONE, doc.id("gpx")) {
        for (name, value) in doc.attrs(root) {
            if name.starts_with("xmlns:") && value != GPXX {
                ns.push(doc.ns_id(&value));
            }
        }
    }
    let mut gpx = Gpx { doc, ns, keys: HashMap::new() };
    for e in doc.named(NONE, doc.id("trk")).collect::<Vec<_>>() {
        gpx.track(e, features)?;
    }
    for e in doc.named(NONE, doc.id("rte")).collect::<Vec<_>>() {
        gpx.route(e, features)?;
    }
    for e in doc.named(NONE, doc.id("wpt")).collect::<Vec<_>>() {
        gpx.waypoint(e, features)?;
    }
    gpx.single("trkseg", "trkpt", "trk", features)?;
    gpx.single("rte", "rtept", "rte", features)?;
    Ok(())
}
