//! Text encodings: detect, decode and re-encode files so viewing or editing never changes bytes
//! the user did not touch (encoding, byte-order mark and line endings are kept).

use encoding_rs::{Encoding, UTF_8, UTF_16BE, UTF_16LE};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Files larger than this are shown read-only.
pub const MAX_EDIT: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextFormat {
    /// WHATWG label, e.g. `UTF-8`, `UTF-16LE`, `windows-1258`, `Shift_JIS`.
    pub encoding: String,
    pub bom: bool,
    /// `lf`, `crlf` or `mixed` (mixed is saved as-is per line).
    pub eol: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedText {
    pub text: String,
    pub format: TextFormat,
    pub binary: bool,
    /// Decoding replaced invalid bytes; saving would change them.
    pub lossy: bool,
    pub size: usize,
}

/// Encodings offered in "Reopen with encoding".
pub const COMMON: &[&str] = &[
    "UTF-8",
    "UTF-16LE",
    "UTF-16BE",
    "windows-1252",
    "windows-1258",
    "ISO-8859-1",
    "Shift_JIS",
    "EUC-JP",
    "GBK",
    "Big5",
    "EUC-KR",
    "windows-1251",
    "KOI8-R",
];

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

/// Guess the encoding: BOM, then valid UTF-8, then a statistical guess (chardetng).
pub fn detect(bytes: &[u8]) -> (&'static Encoding, bool) {
    if let Some((enc, _)) = Encoding::for_bom(bytes) {
        return (enc, true);
    }
    // UTF-16 without BOM: lots of NULs in alternate positions.
    if bytes.len() >= 4 {
        let sample = &bytes[..bytes.len().min(4000)];
        let even_nul = sample.iter().step_by(2).filter(|&&b| b == 0).count();
        let odd_nul = sample
            .iter()
            .skip(1)
            .step_by(2)
            .filter(|&&b| b == 0)
            .count();
        let half = sample.len() / 2;
        if odd_nul > half * 6 / 10 && even_nul < half / 10 {
            return (UTF_16LE, false);
        }
        if even_nul > half * 6 / 10 && odd_nul < half / 10 {
            return (UTF_16BE, false);
        }
    }
    if std::str::from_utf8(bytes).is_ok() {
        return (UTF_8, false);
    }
    let mut det = chardetng::EncodingDetector::new();
    det.feed(bytes, true);
    (det.guess(None, true), false)
}

fn eol_of(text: &str) -> &'static str {
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count() - crlf;
    match (crlf, lf) {
        (0, _) => "lf",
        (_, 0) => "crlf",
        _ => "mixed",
    }
}

/// Decode `bytes`, detecting the encoding unless `label` forces one.
pub fn decode(bytes: &[u8], label: Option<&str>) -> Result<DecodedText> {
    let (enc, bom) = match label {
        Some(l) => {
            let enc = Encoding::for_label(l.as_bytes())
                .ok_or_else(|| Error::Invalid(format!("Unknown encoding {l}")))?;
            (enc, Encoding::for_bom(bytes).is_some_and(|(e, _)| e == enc))
        }
        None => detect(bytes),
    };
    let is_utf16 = enc == UTF_16LE || enc == UTF_16BE;
    let binary = !is_utf16 && looks_binary(bytes);
    let (cow, _, had_errors) = enc.decode(bytes); // strips a matching BOM
    let text = cow.into_owned();
    let eol = eol_of(&text).to_string();
    Ok(DecodedText {
        // The editor works with "\n"; line endings are restored on save.
        text: if eol == "crlf" {
            text.replace("\r\n", "\n")
        } else {
            text
        },
        format: TextFormat {
            encoding: enc.name().to_string(),
            bom,
            eol,
        },
        binary,
        lossy: had_errors,
        size: bytes.len(),
    })
}

/// Encode `text` (with "\n" line endings unless `eol` is `mixed`) back to bytes.
/// Decode git output (diffs, blame) in the file's encoding, keeping line endings untouched.
pub fn decode_raw(bytes: &[u8], label: Option<&str>) -> String {
    let enc = label
        .and_then(|l| Encoding::for_label(l.as_bytes()))
        .unwrap_or(UTF_8);
    enc.decode_without_bom_handling(bytes).0.into_owned()
}

/// Encode a patch built from decoded diff text back into the file's encoding (no BOM, line
/// endings as given). UTF-16 files are diffed as binary by git, so they never get here.
pub fn encode_raw(text: &str, label: Option<&str>) -> Vec<u8> {
    match label.and_then(|l| Encoding::for_label(l.as_bytes())) {
        Some(enc) if enc != UTF_8 && enc != UTF_16LE && enc != UTF_16BE => {
            enc.encode(text).0.into_owned()
        }
        _ => text.as_bytes().to_vec(),
    }
}

pub fn encode(text: &str, format: &TextFormat) -> Result<Vec<u8>> {
    let enc = Encoding::for_label(format.encoding.as_bytes())
        .ok_or_else(|| Error::Invalid(format!("Unknown encoding {}", format.encoding)))?;
    let text = if format.eol == "crlf" {
        text.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        text.to_string()
    };
    let mut out = Vec::with_capacity(text.len() + 4);
    if enc == UTF_16LE || enc == UTF_16BE {
        let le = enc == UTF_16LE;
        if format.bom {
            out.extend(if le { [0xFF, 0xFE] } else { [0xFE, 0xFF] });
        }
        for u in text.encode_utf16() {
            out.extend(if le { u.to_le_bytes() } else { u.to_be_bytes() });
        }
        return Ok(out);
    }
    if format.bom && enc == UTF_8 {
        out.extend([0xEF, 0xBB, 0xBF]);
    }
    let (bytes, _, unmappable) = enc.encode(&text);
    if unmappable {
        return Err(Error::Invalid(format!(
            "Some characters cannot be saved in {}. Choose UTF-8 or remove them.",
            format.encoding
        )));
    }
    out.extend_from_slice(&bytes);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn round_trip(bytes: &[u8]) {
        let d = decode(bytes, None).unwrap();
        assert_eq!(encode(&d.text, &d.format).unwrap(), bytes, "{:?}", d.format);
    }

    #[test]
    fn keeps_bytes_for_common_encodings() {
        round_trip("xin chào\r\nthế giới\r\n".as_bytes());
        round_trip(b"\xEF\xBB\xBFwith bom\n");
        let mut le = vec![0xFF, 0xFE];
        for u in "Tiếng Việt\r\n".encode_utf16() {
            le.extend(u.to_le_bytes());
        }
        round_trip(&le);
        // windows-1252 "café"
        let d = decode(b"caf\xE9 au lait, cr\xE8me br\xFBl\xE9e\n", None).unwrap();
        assert_eq!(d.text, "café au lait, crème brûlée\n");
        assert_eq!(
            encode(&d.text, &d.format).unwrap(),
            b"caf\xE9 au lait, cr\xE8me br\xFBl\xE9e\n"
        );
    }

    #[test]
    fn mixed_line_endings_are_preserved() {
        round_trip(b"a\r\nb\nc\r\n");
    }

    #[test]
    fn unmappable_characters_are_refused() {
        let f = TextFormat {
            encoding: "windows-1252".into(),
            bom: false,
            eol: "lf".into(),
        };
        assert!(encode("tiếng việt", &f).is_err());
    }
}
