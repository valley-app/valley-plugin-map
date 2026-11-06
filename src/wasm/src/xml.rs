//! A namespace-aware XML 1.0 reader with the well-formedness rules of the frame's `DOMParser` (`application/xml`):
//! every document it rejects is one that parser reports a `parsererror` for. It keeps one compact record per element
//! in document order; text, attributes and character data are read back from the source on demand.

use std::borrow::Cow;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use crate::Fail;

pub const NONE: u32 = u32::MAX;
/// Detached from the document (unsupported KML elements): invisible to every query.
pub const REMOVED: u8 = 1;
/// Replaced by a generated element (a KML track): matched by its new name, its own subtree hidden.
pub const REPLACED: u8 = 2;
/// A KML `coordinates` element whose text the JavaScript parser normalizes before converting it.
pub const REWRITTEN: u8 = 4;
const SELF_CLOSING: u8 = 8;

const XML_NS: &str = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NS: &str = "http://www.w3.org/2000/xmlns/";
const GX_NS: &str = "http://www.google.com/kml/ext/2.2";

#[derive(Clone, Copy)]
pub struct Elem {
    /// Offset of the start tag's `<`.
    pub start: u32,
    /// Offset just past the element (its end tag, or `/>`).
    pub end: u32,
    pub parent: u32,
    /// Index after the element's last descendant.
    pub sub_end: u32,
    pub name: u16,
    pub ns: u8,
    pub flags: u8,
}

pub struct Doc<'a> {
    pub src: &'a str,
    pub elems: Vec<Elem>,
    /// Effective tag names: a name in the root's namespace loses its prefix, the KML extension namespace is written
    /// `gx:`, any other name keeps its qualified form (the JavaScript parser renames elements the same way).
    names: Vec<String>,
    name_ids: HashMap<String, u16>,
    /// Namespace URIs by id; 0 is no namespace.
    nss: Vec<String>,
    pub root_local: String,
}

type Res<T> = Result<T, Fail>;
const BAD: Fail = Fail::Invalid;

fn is_char(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\r' | '\u{20}'..='\u{d7ff}' | '\u{e000}'..='\u{fffd}' | '\u{10000}'..='\u{10ffff}')
}

fn is_name_start(c: char) -> bool {
    matches!(c, ':' | 'A'..='Z' | '_' | 'a'..='z' | '\u{c0}'..='\u{d6}' | '\u{d8}'..='\u{f6}' | '\u{f8}'..='\u{2ff}' | '\u{370}'..='\u{37d}' | '\u{37f}'..='\u{1fff}' | '\u{200c}'..='\u{200d}' | '\u{2070}'..='\u{218f}' | '\u{2c00}'..='\u{2fef}' | '\u{3001}'..='\u{d7ff}' | '\u{f900}'..='\u{fdcf}' | '\u{fdf0}'..='\u{fffd}' | '\u{10000}'..='\u{effff}')
}

fn is_name_char(c: char) -> bool {
    is_name_start(c) || matches!(c, '-' | '.' | '0'..='9' | '\u{b7}' | '\u{300}'..='\u{36f}' | '\u{203f}'..='\u{2040}')
}

const fn is_s(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

fn find(hay: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if needle.len() == 1 {
        return hay[from..].iter().position(|&b| b == needle[0]).map(|i| i + from);
    }
    hay.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|i| i + from)
}

struct Parser<'a> {
    s: &'a [u8],
    src: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.pos).copied()
    }

    fn starts(&self, text: &[u8]) -> bool {
        self.s[self.pos..].starts_with(text)
    }

    fn skip_s(&mut self) -> bool {
        let start = self.pos;
        while self.peek().is_some_and(is_s) {
            self.pos += 1;
        }
        self.pos > start
    }

    fn char_at(&self, at: usize) -> Option<char> {
        self.src.get(at..)?.chars().next()
    }

    /// A `Name`; returns its byte range.
    fn name(&mut self) -> Res<(usize, usize)> {
        let start = self.pos;
        match self.peek() {
            Some(b) if b.is_ascii_alphabetic() || b == b'_' || b == b':' => self.pos += 1,
            Some(b) if b >= 0x80 => {
                let c = self.char_at(self.pos).ok_or(BAD)?;
                if !is_name_start(c) {
                    return Err(BAD);
                }
                self.pos += c.len_utf8();
            }
            _ => return Err(BAD),
        }
        loop {
            match self.peek() {
                Some(b) if b.is_ascii_alphanumeric() || matches!(b, b'_' | b':' | b'-' | b'.') => self.pos += 1,
                Some(b) if b >= 0x80 => {
                    let c = self.char_at(self.pos).ok_or(BAD)?;
                    if !is_name_char(c) {
                        break;
                    }
                    self.pos += c.len_utf8();
                }
                _ => break,
            }
        }
        Ok((start, self.pos))
    }

    /// Validates the characters of `from..to` (comments, processing instructions, CDATA).
    fn chars(&self, from: usize, to: usize) -> Res<()> {
        let bytes = &self.s[from..to];
        if bytes.iter().all(|&b| (0x20..0x80).contains(&b) || is_s(b)) {
            return Ok(());
        }
        if self.src[from..to].chars().all(is_char) { Ok(()) } else { Err(BAD) }
    }

    /// After `&`: a predefined entity or a character reference naming a legal character.
    fn reference(&mut self) -> Res<()> {
        let start = self.pos;
        let end = find(self.s, start, b";").ok_or(BAD)?;
        let body = &self.src[start..end];
        let ok = match body {
            "lt" | "gt" | "amp" | "quot" | "apos" => true,
            _ => char_ref(body).is_some_and(is_char),
        };
        if !ok {
            return Err(BAD);
        }
        self.pos = end + 1;
        Ok(())
    }

    fn comment(&mut self) -> Res<()> {
        self.pos += 4;
        let start = self.pos;
        // The first `--` must end the comment.
        let dash = find(self.s, start, b"--").ok_or(BAD)?;
        if self.s.get(dash + 2) != Some(&b'>') {
            return Err(BAD);
        }
        self.chars(start, dash)?;
        self.pos = dash + 3;
        Ok(())
    }

    fn pi(&mut self) -> Res<()> {
        self.pos += 2;
        let (a, b) = self.name()?;
        let target = &self.src[a..b];
        if target.contains(':') || target.eq_ignore_ascii_case("xml") {
            return Err(BAD);
        }
        if self.starts(b"?>") {
            self.pos += 2;
            return Ok(());
        }
        if !self.skip_s() {
            return Err(BAD);
        }
        let end = find(self.s, self.pos, b"?>").ok_or(BAD)?;
        self.chars(self.pos, end)?;
        self.pos = end + 2;
        Ok(())
    }

    fn quoted(&mut self) -> Res<&'a str> {
        let quote = self.peek().filter(|&q| q == b'"' || q == b'\'').ok_or(BAD)?;
        let start = self.pos + 1;
        let end = find(self.s, start, &[quote]).ok_or(BAD)?;
        self.pos = end + 1;
        Ok(&self.src[start..end])
    }

    fn eq(&mut self) -> Res<()> {
        self.skip_s();
        if self.peek() != Some(b'=') {
            return Err(BAD);
        }
        self.pos += 1;
        self.skip_s();
        Ok(())
    }

    /// `<?xml version="1.x" (encoding="…")? (standalone="yes|no")? ?>` at offset 0.
    fn declaration(&mut self) -> Res<()> {
        self.pos = 5;
        let mut seen = 0;
        for (index, key) in ["version", "encoding", "standalone"].into_iter().enumerate() {
            let save = self.pos;
            if !self.skip_s() {
                break;
            }
            if !self.starts(key.as_bytes()) {
                self.pos = save;
                if index == 0 {
                    return Err(BAD);
                }
                continue;
            }
            self.pos += key.len();
            self.eq()?;
            let value = self.quoted()?;
            let ok = match index {
                0 => value.len() > 2 && value.starts_with("1.") && value[2..].bytes().all(|b| b.is_ascii_digit()),
                1 => value.bytes().next().is_some_and(|b| b.is_ascii_alphabetic()) && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')),
                _ => value == "yes" || value == "no",
            };
            if !ok {
                return Err(BAD);
            }
            seen |= 1 << index;
        }
        if seen & 1 == 0 {
            return Err(BAD);
        }
        self.skip_s();
        if !self.starts(b"?>") {
            return Err(BAD);
        }
        self.pos += 2;
        Ok(())
    }

    /// Character data up to the next `<`: legal characters, references, no `]]>`.
    fn text(&mut self) -> Res<()> {
        let s = self.s;
        let mut i = self.pos;
        while i < s.len() {
            let b = s[i];
            match b {
                b'<' => break,
                b'&' => {
                    self.pos = i + 1;
                    self.reference()?;
                    i = self.pos;
                    continue;
                }
                b']' => {
                    if s[i..].starts_with(b"]]>") {
                        return Err(BAD);
                    }
                }
                0x00..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f => return Err(BAD),
                0xef
                    if s.get(i + 1) == Some(&0xbf) && matches!(s.get(i + 2), Some(0xbe | 0xbf)) => {
                        return Err(BAD);
                    }
                _ => {}
            }
            i += 1;
        }
        self.pos = i;
        Ok(())
    }

    /// An attribute value between quotes: legal characters, references, no `<`.
    fn attr_value(&mut self) -> Res<(usize, usize)> {
        let quote = self.peek().filter(|&q| q == b'"' || q == b'\'').ok_or(BAD)?;
        let start = self.pos + 1;
        let mut i = start;
        loop {
            let b = *self.s.get(i).ok_or(BAD)?;
            match b {
                _ if b == quote => break,
                b'<' => return Err(BAD),
                b'&' => {
                    self.pos = i + 1;
                    self.reference()?;
                    i = self.pos;
                    continue;
                }
                0x00..=0x08 | 0x0b | 0x0c | 0x0e..=0x1f => return Err(BAD),
                0xef
                    if self.s.get(i + 1) == Some(&0xbf) && matches!(self.s.get(i + 2), Some(0xbe | 0xbf)) => {
                        return Err(BAD);
                    }
                _ => {}
            }
            i += 1;
        }
        self.pos = i + 1;
        Ok((start, i))
    }
}

fn char_ref(body: &str) -> Option<char> {
    let value = if let Some(hex) = body.strip_prefix("#x") {
        if hex.is_empty() || hex.len() > 8 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        u32::from_str_radix(hex, 16).ok()?
    } else {
        let dec = body.strip_prefix('#')?;
        if dec.is_empty() || dec.len() > 10 || !dec.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        dec.parse::<u32>().ok()?
    };
    char::from_u32(value)
}

/// The namespace URI check of the frame's parser (an RFC 3986 URI reference): characters outside the URI set, a
/// malformed `%` escape or a second `#` are errors; brackets and a colon in a relative first segment, whose reading
/// depends on the full grammar, are left to the JavaScript parser.
fn check_uri(uri: &str) -> Res<()> {
    let b = uri.as_bytes();
    let mut hashes = 0;
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'!' | b'$' | b'&' | b'\'' | b'(' | b')' | b'*' | b'+' | b',' | b';' | b'=' | b':' | b'/' | b'?' | b'@' => {}
            b'#' => hashes += 1,
            b'%' if b.get(i + 1).is_some_and(u8::is_ascii_hexdigit) && b.get(i + 2).is_some_and(u8::is_ascii_hexdigit) => {}
            b'[' | b']' => return Err(Fail::Fallback),
            _ => return Err(BAD),
        }
    }
    if hashes > 1 {
        return Err(BAD);
    }
    // A port that is not all digits is an error in the full grammar; leave every authority with a non-numeric port to it.
    let rest = uri.split_once("://").map_or(uri.strip_prefix("//"), |(_, rest)| Some(rest));
    if let Some(rest) = rest {
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        let host = authority.rsplit_once('@').map_or(authority, |(_, host)| host);
        if host.split_once(':').is_some_and(|(_, port)| !port.bytes().all(|c| c.is_ascii_digit())) {
            return Err(Fail::Fallback);
        }
    }
    let head = uri.split(['/', '?', '#']).next().unwrap_or("");
    if let Some((scheme, _)) = head.split_once(':')
        && (!scheme.bytes().next().is_some_and(|c| c.is_ascii_alphabetic()) || !scheme.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'+' | b'-' | b'.'))) {
            return Err(Fail::Fallback);
        }
    Ok(())
}

/// A QName: at most one colon, with a non-empty prefix and a local part that starts like a name.
fn qname_parts(name: &str) -> Res<(Option<&str>, &str)> {
    match name.split_once(':') {
        None => Ok((None, name)),
        Some((prefix, local)) => {
            if prefix.is_empty() || local.is_empty() || local.contains(':') || !local.chars().next().is_some_and(is_name_start) {
                return Err(BAD);
            }
            Ok((Some(prefix), local))
        }
    }
}

/// Decoded character data: references expanded, line ends normalized; `attribute` also turns whitespace into spaces.
fn decode_into(raw: &str, attribute: bool, out: &mut String) {
    let mut rest = raw;
    while let Some(i) = rest.find(['&', '\r', '\n', '\t']) {
        out.push_str(&rest[..i]);
        let b = rest.as_bytes()[i];
        rest = &rest[i + 1..];
        match b {
            b'&' => {
                let end = rest.find(';').unwrap_or(rest.len());
                let body = &rest[..end];
                rest = rest.get(end + 1..).unwrap_or("");
                out.push(match body {
                    "lt" => '<',
                    "gt" => '>',
                    "amp" => '&',
                    "quot" => '"',
                    "apos" => '\'',
                    _ => char_ref(body).unwrap_or('\u{fffd}'),
                });
            }
            b'\r' => {
                rest = rest.strip_prefix('\n').unwrap_or(rest);
                out.push(if attribute { ' ' } else { '\n' });
            }
            _ => out.push(if attribute { ' ' } else { char::from(b) }),
        }
    }
    out.push_str(rest);
}

fn decode(raw: &str, attribute: bool) -> Cow<'_, str> {
    let special = |b: &u8| matches!(b, b'&' | b'\r') || (attribute && matches!(b, b'\n' | b'\t'));
    if !raw.as_bytes().iter().any(special) {
        return Cow::Borrowed(raw);
    }
    let mut out = String::with_capacity(raw.len());
    decode_into(raw, attribute, &mut out);
    Cow::Owned(out)
}

/// CDATA data: no references, line ends normalized.
fn cdata(raw: &str) -> String {
    raw.replace("\r\n", "\n").replace('\r', "\n")
}

/// FNV-1a for the short tag names of the element-name cache.
#[derive(Default)]
struct Fnv(u64);

impl Hasher for Fnv {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        let mut hash = if self.0 == 0 { 0xcbf2_9ce4_8422_2325 } else { self.0 };
        for &b in bytes {
            hash = (hash ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
        }
        self.0 = hash;
    }
}

struct Open {
    elem: u32,
    qname: (usize, usize),
    bindings: usize,
}

impl<'a> Doc<'a> {
    /// Parses `src`; `Fail::Invalid` for anything the frame's parser reports as an error and for a DOCTYPE.
    pub fn parse(src: &'a str) -> Res<Doc<'a>> {
        let s = src.as_bytes();
        let mut p = Parser { s, src, pos: 0 };
        let estimate = s.iter().filter(|&&b| b == b'<').count() / 2 + 16;
        let mut doc = Doc { src, elems: Vec::with_capacity(estimate), names: Vec::new(), name_ids: HashMap::new(), nss: vec![String::new()], root_local: String::new() };
        let mut cache: HashMap<&'a [u8], Vec<(u8, u16)>, BuildHasherDefault<Fnv>> = HashMap::default();
        // (prefix, ns id); an empty prefix is the default namespace, ns 0 none.
        let mut bindings: Vec<(&'a str, u8)> = Vec::new();
        let mut stack: Vec<Open> = Vec::new();
        let mut attrs: Vec<(usize, usize, usize, usize)> = Vec::new();
        let mut standard: u8 = 0;
        let xml_ns = doc.intern_ns(XML_NS)?;
        let gx_ns = doc.intern_ns(GX_NS)?;

        if p.starts(b"<?xml") && s.get(5).is_some_and(|&b| is_s(b) || b == b'?') {
            p.declaration()?;
        }
        let mut root_done = false;
        loop {
            if stack.is_empty() {
                p.skip_s();
                let Some(b) = p.peek() else { break };
                if b != b'<' {
                    return Err(BAD);
                }
                if p.starts(b"<!--") {
                    p.comment()?;
                    continue;
                }
                if p.starts(b"<?") {
                    p.pi()?;
                    continue;
                }
                if p.starts(b"<!") || root_done {
                    // A DOCTYPE (always rejected by the caller) or content after the root element.
                    return Err(BAD);
                }
            } else {
                p.text()?;
                if p.peek().is_none() {
                    return Err(BAD);
                }
                if p.starts(b"<!--") {
                    p.comment()?;
                    continue;
                }
                if p.starts(b"<![CDATA[") {
                    let start = p.pos + 9;
                    let end = find(s, start, b"]]>").ok_or(BAD)?;
                    p.chars(start, end)?;
                    p.pos = end + 3;
                    continue;
                }
                if p.starts(b"<?") {
                    p.pi()?;
                    continue;
                }
                if p.starts(b"<!") {
                    return Err(BAD);
                }
                if p.starts(b"</") {
                    p.pos += 2;
                    let (a, b) = p.name()?;
                    p.skip_s();
                    if p.peek() != Some(b'>') {
                        return Err(BAD);
                    }
                    p.pos += 1;
                    let open = stack.pop().ok_or(BAD)?;
                    if s[a..b] != s[open.qname.0..open.qname.1] {
                        return Err(BAD);
                    }
                    bindings.truncate(open.bindings);
                    let index = doc.elems.len() as u32;
                    let elem = &mut doc.elems[open.elem as usize];
                    elem.end = p.pos as u32;
                    elem.sub_end = index;
                    if stack.is_empty() {
                        root_done = true;
                    }
                    continue;
                }
            }

            // A start tag.
            let start = p.pos;
            p.pos += 1;
            let qname = p.name()?;
            attrs.clear();
            let close;
            loop {
                let spaced = p.skip_s();
                match p.peek() {
                    Some(b'>') => {
                        p.pos += 1;
                        close = false;
                        break;
                    }
                    Some(b'/') => {
                        if s.get(p.pos + 1) != Some(&b'>') {
                            return Err(BAD);
                        }
                        p.pos += 2;
                        close = true;
                        break;
                    }
                    Some(_) if spaced => {
                        let name = p.name()?;
                        p.eq()?;
                        let value = p.attr_value()?;
                        attrs.push((name.0, name.1, value.0, value.1));
                    }
                    _ => return Err(BAD),
                }
            }

            let bound = bindings.len();
            for &(a, b, va, vb) in &attrs {
                let name = &src[a..b];
                let (prefix, local) = qname_parts(name)?;
                let declared = match (prefix, local) {
                    (None, "xmlns") => Some(""),
                    (Some("xmlns"), local) => Some(local),
                    _ => None,
                };
                let Some(declared) = declared else { continue };
                let uri = decode(&src[va..vb], true);
                if declared == "xmlns" || uri == XMLNS_NS || (declared == "xml") != (uri == XML_NS) {
                    return Err(BAD);
                }
                if uri.is_empty() && !declared.is_empty() {
                    return Err(BAD);
                }
                check_uri(&uri)?;
                let id = if uri.is_empty() { 0 } else { doc.intern_ns(&uri)? };
                bindings.push((declared, id));
            }
            let resolve = |prefix: &str| -> Res<u8> {
                if prefix == "xml" {
                    return Ok(xml_ns);
                }
                bindings.iter().rev().find(|(p, _)| *p == prefix).map(|&(_, id)| id).ok_or(BAD)
            };
            let elem_name = &src[qname.0..qname.1];
            let (prefix, local) = qname_parts(elem_name)?;
            let ns = match prefix {
                Some(prefix) => {
                    let id = resolve(prefix)?;
                    if id == 0 {
                        return Err(BAD);
                    }
                    id
                }
                None => bindings.iter().rev().find(|(p, _)| p.is_empty()).map_or(0, |&(_, id)| id),
            };
            if elem_name == "parsererror" {
                return Err(BAD);
            }
            for (index, &(a, b, _, _)) in attrs.iter().enumerate() {
                let name = &s[a..b];
                if attrs[..index].iter().any(|&(c, d, _, _)| &s[c..d] == name) {
                    return Err(BAD);
                }
                let (prefix, local) = qname_parts(&src[a..b])?;
                if let Some(prefix) = prefix.filter(|&p| p != "xmlns") {
                    let id = resolve(prefix)?;
                    if id == 0 {
                        return Err(BAD);
                    }
                    for &(c, d, _, _) in &attrs[..index] {
                        if let (Some(other), other_local) = qname_parts(&src[c..d])?
                            && other != "xmlns" && other_local == local && resolve(other)? == id {
                                return Err(BAD);
                            }
                    }
                }
            }

            let index = doc.elems.len() as u32;
            if index == 0 {
                standard = ns;
                doc.root_local = local.to_owned();
            }
            let key = &s[qname.0..qname.1];
            let name = match cache.get(key).and_then(|ids| ids.iter().find(|(n, _)| *n == ns)) {
                Some(&(_, id)) => id,
                None => {
                    let effective = if ns == standard {
                        Cow::Borrowed(local)
                    } else if ns == gx_ns {
                        Cow::Owned(format!("gx:{local}"))
                    } else {
                        Cow::Borrowed(elem_name)
                    };
                    let id = doc.intern_name(&effective)?;
                    cache.entry(key).or_default().push((ns, id));
                    id
                }
            };
            let parent = stack.last().map_or(NONE, |open| open.elem);
            doc.elems.push(Elem { start: start as u32, end: p.pos as u32, parent, sub_end: index + 1, name, ns, flags: if close { SELF_CLOSING } else { 0 } });
            if close {
                bindings.truncate(bound);
                if stack.is_empty() {
                    root_done = true;
                }
            } else {
                stack.push(Open { elem: index, qname, bindings: bound });
            }
        }
        if !root_done || !stack.is_empty() {
            return Err(BAD);
        }
        Ok(doc)
    }

    fn intern_ns(&mut self, uri: &str) -> Res<u8> {
        if let Some(id) = self.nss.iter().position(|n| n == uri) {
            return Ok(id as u8);
        }
        if self.nss.len() > 250 {
            return Err(Fail::Fallback);
        }
        self.nss.push(uri.to_owned());
        Ok((self.nss.len() - 1) as u8)
    }

    fn intern_name(&mut self, name: &str) -> Res<u16> {
        if let Some(&id) = self.name_ids.get(name) {
            return Ok(id);
        }
        if self.names.len() >= usize::from(u16::MAX) {
            return Err(Fail::Fallback);
        }
        let id = self.names.len() as u16;
        self.names.push(name.to_owned());
        self.name_ids.insert(name.to_owned(), id);
        Ok(id)
    }

    /// The id of an effective tag name, when any element has it.
    pub fn id(&self, name: &str) -> Option<u16> {
        self.name_ids.get(name).copied()
    }

    /// The id of a namespace URI, when any element or declaration uses it.
    pub fn ns_id(&self, uri: &str) -> Option<u8> {
        self.nss.iter().position(|n| n == uri).filter(|&i| i > 0).map(|i| i as u8)
    }

    pub fn name(&self, e: u32) -> &str {
        &self.names[usize::from(self.elems[e as usize].name)]
    }

    pub fn local(&self, e: u32) -> &str {
        let name = self.name(e);
        name.split_once(':').map_or(name, |(_, local)| local)
    }

    pub fn is(&self, e: u32, id: Option<u16>) -> bool {
        id.is_some_and(|id| self.elems[e as usize].name == id)
    }

    pub fn rename(&mut self, e: u32, name: &str) -> Res<()> {
        let id = self.intern_name(name)?;
        self.elems[e as usize].name = id;
        Ok(())
    }

    /// Visible descendants of `e` (every element for `NONE`) in document order.
    pub fn descendants(&self, e: u32) -> Descendants<'_, 'a> {
        let (at, end) = if e == NONE { (0, self.elems.len() as u32) } else { (e + 1, self.elems[e as usize].sub_end) };
        Descendants { doc: self, at, end }
    }

    pub fn named(&self, e: u32, id: Option<u16>) -> impl Iterator<Item = u32> + '_ {
        self.descendants(e).filter(move |&d| self.is(d, id))
    }

    pub fn first(&self, e: u32, id: Option<u16>) -> Option<u32> {
        id?;
        self.named(e, id).next()
    }

    /// Visible element children of `e`.
    pub fn children(&self, e: u32) -> Children<'_, 'a> {
        let elem = self.elems[e as usize];
        Children { doc: self, at: e + 1, end: elem.sub_end }
    }

    /// Offset just past the start tag of `e`.
    fn start_tag_end(&self, e: u32) -> usize {
        let s = self.src.as_bytes();
        let mut i = self.elems[e as usize].start as usize + 1;
        let mut quote = 0;
        loop {
            let b = s[i];
            if quote != 0 {
                if b == quote {
                    quote = 0;
                }
            } else if b == b'"' || b == b'\'' {
                quote = b;
            } else if b == b'>' {
                return i + 1;
            }
            i += 1;
        }
    }

    /// Qualified names and raw values of the attributes of `e`, in source order.
    fn raw_attrs(&self, e: u32) -> RawAttrs<'a> {
        let s = self.src.as_bytes();
        let mut at = self.elems[e as usize].start as usize + 1;
        while !is_s(s[at]) && s[at] != b'>' && s[at] != b'/' {
            at += 1;
        }
        RawAttrs { src: self.src, at }
    }

    /// `getAttribute(qname)`: the decoded, whitespace-normalized value.
    pub fn attr(&self, e: u32, qname: &str) -> Option<Cow<'a, str>> {
        self.raw_attrs(e).find(|(name, _)| *name == qname).map(|(_, value)| decode(value, true))
    }

    /// Two attributes in one scan of the start tag.
    pub fn attr_pair(&self, e: u32, first: &str, second: &str) -> (Option<Cow<'a, str>>, Option<Cow<'a, str>>) {
        let (mut a, mut b) = (None, None);
        for (name, value) in self.raw_attrs(e) {
            if a.is_none() && name == first {
                a = Some(decode(value, true));
            } else if b.is_none() && name == second {
                b = Some(decode(value, true));
            }
        }
        (a, b)
    }

    /// Qualified names and decoded values of the attributes of `e`, in source order.
    pub fn attrs(&self, e: u32) -> Vec<(&'a str, Cow<'a, str>)> {
        self.raw_attrs(e).map(|(name, value)| (name, decode(value, true))).collect()
    }

    /// `textContent` of `e`.
    pub fn text(&self, e: u32) -> Res<Cow<'a, str>> {
        let elem = self.elems[e as usize];
        if elem.flags & REPLACED != 0 {
            return Err(Fail::Fallback);
        }
        if elem.flags & REWRITTEN != 0 {
            return Ok(Cow::Owned(rewritten(&self.original_text(e)?)));
        }
        self.original_text(e)
    }

    /// `textContent` of `e` as written, before any KML rewrite of `e` itself.
    pub fn original_text(&self, e: u32) -> Res<Cow<'a, str>> {
        let elem = self.elems[e as usize];
        if elem.flags & SELF_CLOSING != 0 {
            return Ok(Cow::Borrowed(""));
        }
        let s = self.src.as_bytes();
        let content = self.start_tag_end(e);
        // Without child elements, a first `</` is the element's own end tag: everything before it is plain text.
        if elem.sub_end == e + 1
            && let Some(lt) = find(s, content, b"<")
                && s[lt + 1] == b'/' {
                    return Ok(decode(&self.src[content..lt], false));
                }
        let mut out = String::new();
        self.append_text(e, content, &mut out)?;
        Ok(Cow::Owned(out))
    }

    fn append_text(&self, e: u32, content: usize, out: &mut String) -> Res<()> {
        let s = self.src.as_bytes();
        let end = self.elems[e as usize].end as usize;
        let mut pos = content;
        let mut next = e + 1;
        while pos < end {
            if s[pos] != b'<' {
                let stop = find(s, pos, b"<").unwrap_or(end).min(end);
                out.push_str(&decode(&self.src[pos..stop], false));
                pos = stop;
                continue;
            }
            match s[pos + 1] {
                b'/' => pos = find(s, pos, b">").ok_or(BAD)? + 1,
                b'?' => pos = find(s, pos, b"?>").ok_or(BAD)? + 2,
                b'!' if s[pos..].starts_with(b"<!--") => pos = find(s, pos + 4, b"-->").ok_or(BAD)? + 3,
                b'!' => {
                    let start = pos + 9;
                    let stop = find(s, start, b"]]>").ok_or(BAD)?;
                    out.push_str(&cdata(&self.src[start..stop]));
                    pos = stop + 3;
                }
                _ => {
                    let child = self.elems[next as usize];
                    if child.flags & REMOVED != 0 {
                        pos = child.end as usize;
                        next = child.sub_end;
                    } else if child.flags & REPLACED != 0 {
                        return Err(Fail::Fallback);
                    } else if child.flags & REWRITTEN != 0 {
                        out.push_str(&self.text(next)?);
                        pos = child.end as usize;
                        next = child.sub_end;
                    } else {
                        pos = self.start_tag_end(next);
                        next += 1;
                    }
                }
            }
        }
        Ok(())
    }

    /// The data of the first CDATA section that is a direct child of `e`.
    pub fn first_cdata_child(&self, e: u32) -> Option<String> {
        let elem = self.elems[e as usize];
        if elem.flags & SELF_CLOSING != 0 {
            return None;
        }
        let s = self.src.as_bytes();
        let end = elem.end as usize;
        let mut pos = self.start_tag_end(e);
        let mut next = e + 1;
        while pos < end {
            let lt = find(s, pos, b"<")?;
            if lt >= end {
                return None;
            }
            pos = lt;
            match s[pos + 1] {
                b'/' => pos = find(s, pos, b">")? + 1,
                b'?' => pos = find(s, pos, b"?>")? + 2,
                b'!' if s[pos..].starts_with(b"<!--") => pos = find(s, pos + 4, b"-->")? + 3,
                b'!' => {
                    let start = pos + 9;
                    let stop = find(s, start, b"]]>")?;
                    return Some(cdata(&self.src[start..stop]));
                }
                _ => {
                    let child = self.elems[next as usize];
                    pos = child.end as usize;
                    next = child.sub_end;
                }
            }
        }
        None
    }
}

/// The KML rewrite of a `coordinates` text, `text.trim().replace(/\s*,\s*/g, ',').split(/\s+/)`.
pub fn coordinate_tuples(text: &str) -> impl Iterator<Item = &str> {
    let trimmed = crate::js::trim(text);
    let empty = trimmed.is_empty();
    trimmed.split(crate::js::is_space).filter(move |t| empty || !t.is_empty())
}

/// `coordinate_tuples` after the comma rewrite: whitespace around commas joins the tuple it separates.
pub fn collapsed(text: &str) -> Cow<'_, str> {
    let trimmed = crate::js::trim(text);
    let b = trimmed.as_bytes();
    let spaced = |i: usize| b.get(i).is_some_and(|&c| c <= b' ' || c >= 0x80);
    if !b.iter().enumerate().any(|(i, &c)| c == b',' && (spaced(i + 1) || (i > 0 && spaced(i - 1)))) {
        return Cow::Borrowed(trimmed);
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = trimmed.chars().peekable();
    while let Some(c) = chars.next() {
        if c == ',' {
            while out.ends_with(crate::js::is_space) {
                out.pop();
            }
            out.push(',');
            while chars.peek().is_some_and(|&n| crate::js::is_space(n)) {
                chars.next();
            }
        } else {
            out.push(c);
        }
    }
    Cow::Owned(out)
}

fn rewritten(text: &str) -> String {
    coordinate_tuples(&collapsed(text)).collect::<Vec<_>>().join(" ")
}

struct RawAttrs<'a> {
    src: &'a str,
    at: usize,
}

impl<'a> Iterator for RawAttrs<'a> {
    type Item = (&'a str, &'a str);
    fn next(&mut self) -> Option<Self::Item> {
        let s = self.src.as_bytes();
        let mut i = self.at;
        while is_s(s[i]) {
            i += 1;
        }
        if s[i] == b'>' || s[i] == b'/' {
            self.at = i;
            return None;
        }
        let start = i;
        while !is_s(s[i]) && s[i] != b'=' {
            i += 1;
        }
        let name = &self.src[start..i];
        while s[i] != b'"' && s[i] != b'\'' {
            i += 1;
        }
        let quote = s[i];
        let value = i + 1;
        i = value;
        while s[i] != quote {
            i += 1;
        }
        self.at = i + 1;
        Some((name, &self.src[value..i]))
    }
}

pub struct Descendants<'d, 'a> {
    doc: &'d Doc<'a>,
    at: u32,
    end: u32,
}

impl Iterator for Descendants<'_, '_> {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        while self.at < self.end {
            let index = self.at;
            let elem = self.doc.elems[index as usize];
            if elem.flags & REMOVED != 0 {
                self.at = elem.sub_end;
                continue;
            }
            self.at = if elem.flags & REPLACED != 0 { elem.sub_end } else { index + 1 };
            return Some(index);
        }
        None
    }
}

pub struct Children<'d, 'a> {
    doc: &'d Doc<'a>,
    at: u32,
    end: u32,
}

impl Iterator for Children<'_, '_> {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        while self.at < self.end {
            let index = self.at;
            let elem = self.doc.elems[index as usize];
            self.at = elem.sub_end;
            if elem.flags & REMOVED == 0 {
                return Some(index);
            }
        }
        None
    }
}
