//! The JavaScript string and number conversions the JavaScript parser applies (`String.prototype.trim`, `\s`,
//! `Number()`, `Number.parseFloat`, `Number.parseInt(_, 16)`, `Math.min`/`Math.max`), so both parsers read a file's
//! text into the same values.

use crate::Fail;

/// `\s` in a JavaScript regular expression, and what `trim` removes.
pub fn is_space(c: char) -> bool {
    if c < '\u{80}' {
        return matches!(c, '\t'..='\r' | ' ');
    }
    matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

const fn ascii_word(b: Option<&u8>) -> bool {
    matches!(b, Some(&c) if c > b' ' && c < 0x80)
}

pub fn trim(s: &str) -> &str {
    let b = s.as_bytes();
    if ascii_word(b.first()) && ascii_word(b.last()) {
        return s;
    }
    s.trim_matches(is_space)
}

pub fn trim_start(s: &str) -> &str {
    if ascii_word(s.as_bytes().first()) {
        return s;
    }
    s.trim_start_matches(is_space)
}

/// Length of the longest `StrDecimalLiteral` prefix (sign, `Infinity`, digits, fraction, exponent), 0 when none.
fn decimal_prefix(s: &[u8]) -> usize {
    let mut i = 0;
    if matches!(s.first(), Some(b'+' | b'-')) {
        i = 1;
    }
    if s[i..].starts_with(b"Infinity") {
        return i + 8;
    }
    let digits = |from: usize| s[from..].iter().take_while(|b| b.is_ascii_digit()).count();
    let int = digits(i);
    let mut end = i + int;
    let mut frac = 0;
    if s.get(end) == Some(&b'.') {
        frac = digits(end + 1);
        if int > 0 || frac > 0 {
            end += 1 + frac;
        }
    }
    if int == 0 && frac == 0 {
        return 0;
    }
    if matches!(s.get(end), Some(b'e' | b'E')) {
        let mut e = end + 1;
        if matches!(s.get(e), Some(b'+' | b'-')) {
            e += 1;
        }
        let exp = digits(e);
        if exp > 0 {
            end = e + exp;
        }
    }
    end
}

fn decimal_value(token: &str) -> f64 {
    let unsigned = token.trim_start_matches(['+', '-']);
    if unsigned == "Infinity" {
        return if token.starts_with('-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    token.parse::<f64>().unwrap_or(f64::NAN)
}

/// True when JSON.parse reads `token` as the same number JavaScript read it as (a JSON number literal).
pub fn json_number(token: &str) -> bool {
    let b = token.as_bytes();
    let mut i = usize::from(b.first() == Some(&b'-'));
    match b.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            while b.get(i).is_some_and(u8::is_ascii_digit) {
                i += 1;
            }
        }
        _ => return false,
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        if !b.get(i).is_some_and(u8::is_ascii_digit) {
            return false;
        }
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if !b.get(i).is_some_and(u8::is_ascii_digit) {
            return false;
        }
        while b.get(i).is_some_and(u8::is_ascii_digit) {
            i += 1;
        }
    }
    i == b.len()
}

/// `Number.parseFloat(s)`, with the decimal text it read when that text can be copied into JSON unchanged.
pub fn parse_float(s: &str) -> (f64, Option<&str>) {
    let s = trim_start(s);
    let len = decimal_prefix(s.as_bytes());
    if len == 0 {
        return (f64::NAN, None);
    }
    let token = &s[..len];
    (decimal_value(token), json_number(token).then_some(token))
}

/// `Number(s)`. A hexadecimal, octal or binary literal above 2^53 is left to the JavaScript parser.
pub fn to_number(s: &str) -> Result<(f64, Option<&str>), Fail> {
    let s = trim(s);
    if s.is_empty() {
        return Ok((0.0, None));
    }
    let b = s.as_bytes();
    if b.len() > 2 && b[0] == b'0' {
        let radix = match b[1] {
            b'x' | b'X' => 16,
            b'o' | b'O' => 8,
            b'b' | b'B' => 2,
            _ => 0,
        };
        if radix != 0 {
            let mut value = 0.0_f64;
            for &c in &b[2..] {
                let Some(d) = char::from(c).to_digit(radix) else { return Ok((f64::NAN, None)) };
                value = value * f64::from(radix) + f64::from(d);
            }
            if value > 9_007_199_254_740_992.0 {
                return Err(Fail::Fallback);
            }
            return Ok((value, None));
        }
    }
    let len = decimal_prefix(b);
    if len != b.len() {
        return Ok((f64::NAN, None));
    }
    Ok((decimal_value(s), json_number(s).then_some(s)))
}

/// `Number.parseInt(s, 16)`.
pub fn parse_int16(s: &str) -> f64 {
    let s = trim_start(s);
    let (negative, s) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let s = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
    let digits: Vec<u32> = s.chars().map_while(|c| c.to_digit(16)).collect();
    if digits.is_empty() {
        return f64::NAN;
    }
    let value = digits.iter().fold(0.0_f64, |acc, &d| acc * 16.0 + f64::from(d));
    if negative { -value } else { value }
}

pub fn min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else if b < a {
        b
    } else if a.is_sign_negative() {
        a
    } else {
        b
    }
}

pub fn max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else if b > a {
        b
    } else if a.is_sign_positive() {
        a
    } else {
        b
    }
}

pub fn valid_lng_lat(lng: f64, lat: f64) -> bool {
    lng.is_finite() && lat.is_finite() && (-180.0..=180.0).contains(&lng) && (-90.0..=90.0).contains(&lat)
}

/// Names `Object.prototype` answers for: JavaScript reads these keys through the prototype, so files using them
/// as schema, style or property keys are left to the JavaScript parser.
pub fn prototype_key(key: &str) -> bool {
    matches!(key, "__proto__" | "constructor" | "hasOwnProperty" | "isPrototypeOf" | "propertyIsEnumerable" | "toLocaleString" | "toString" | "valueOf" | "__defineGetter__" | "__defineSetter__" | "__lookupGetter__" | "__lookupSetter__")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_follow_javascript() {
        assert_eq!(parse_float("  47.5abc").0, 47.5);
        assert_eq!(parse_float("1e").1, Some("1"));
        assert_eq!(parse_float(".5").0, 0.5);
        assert!(parse_float(".5").1.is_none());
        assert!(parse_float("abc").0.is_nan());
        assert_eq!(parse_float("-Infinity").0, f64::NEG_INFINITY);
        assert_eq!(to_number(" 0x10 ").unwrap().0, 16.0);
        assert!(to_number("12px").unwrap().0.is_nan());
        assert_eq!(to_number("").unwrap().0, 0.0);
        assert!(to_number("-0").unwrap().0.is_sign_negative());
        assert_eq!(parse_int16("ff"), 255.0);
        assert!(parse_int16("0x").is_nan());
        assert!(min(0.0, -0.0).is_sign_negative());
        assert!(max(-0.0, 0.0).is_sign_positive());
    }
}
