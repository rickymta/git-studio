//! What GitStudio knows about the stored GitHub / GitLab token: what sort of token it is and when
//! it expires. Only metadata leaves this module, never the token itself.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TokenKind {
    /// Personal access token (GitHub classic `ghp_`, GitLab `glpat-`).
    Pat,
    /// GitHub fine-grained personal access token (`github_pat_`).
    FineGrained,
    /// Browser sign-in / app token (`gho_`, `ghu_`, GitLab OAuth).
    Oauth,
    /// Anything else (legacy tokens without a prefix).
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    pub kind: TokenKind,
    /// RFC 3339 time the token stops working; `None` when it has no expiry (or the host does not
    /// say).
    pub expires_at: Option<String>,
}

/// Kind of a GitHub token from its prefix.
pub fn github_kind(token: &str) -> TokenKind {
    let t = token.trim();
    if t.starts_with("github_pat_") {
        TokenKind::FineGrained
    } else if t.starts_with("ghp_") {
        TokenKind::Pat
    } else if t.starts_with("gho_") || t.starts_with("ghu_") {
        TokenKind::Oauth
    } else {
        TokenKind::Unknown
    }
}

/// Kind of a GitLab token from its prefix (before asking the API).
pub fn gitlab_kind(token: &str) -> TokenKind {
    if token.trim().starts_with("glpat-") {
        TokenKind::Pat
    } else {
        TokenKind::Unknown
    }
}

fn digits(s: &str, n: usize) -> Option<u32> {
    (s.len() == n && s.bytes().all(|b| b.is_ascii_digit()))
        .then(|| s.parse().ok())
        .flatten()
}

/// `YYYY-MM-DD`, checked.
fn date(s: &str) -> Option<&str> {
    let mut p = s.split('-');
    let (y, m, d) = (p.next()?, p.next()?, p.next()?);
    if p.next().is_some() {
        return None;
    }
    digits(y, 4)?;
    let (m, d) = (digits(m, 2)?, digits(d, 2)?);
    ((1..=12).contains(&m) && (1..=31).contains(&d)).then_some(s)
}

/// `HH:MM:SS` (or `HH:MM`, given seconds `:00`), checked.
fn time(s: &str) -> Option<String> {
    let parts: Vec<&str> = s.split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [h, m] => (*h, *m, "00"),
        [h, m, s] => (*h, *m, *s),
        _ => return None,
    };
    let (hv, mv, sv) = (digits(h, 2)?, digits(m, 2)?, digits(sec, 2)?);
    (hv < 24 && mv < 60 && sv < 61).then(|| format!("{h}:{m}:{sec}"))
}

/// `UTC` / `Z` / `+0700` / `-07:00` → `Z` or `±HH:MM`.
fn zone(s: &str) -> Option<String> {
    if matches!(s, "UTC" | "GMT" | "Z") {
        return Some("Z".into());
    }
    let (sign, rest) = s.split_at_checked(1)?;
    if sign != "+" && sign != "-" {
        return None;
    }
    let rest = rest.replace(':', "");
    let (h, m) = rest.split_at_checked(2)?;
    let (hv, mv) = (digits(h, 2)?, digits(m, 2)?);
    (hv <= 14 && mv < 60).then(|| format!("{sign}{h}:{m}"))
}

/// The `github-authentication-token-expiration` response header (e.g. `2026-12-01 09:30:00 UTC`
/// or `2026-12-01 09:30:00 +0700`) as RFC 3339.
pub fn parse_github_expiration(header: &str) -> Option<String> {
    let parts: Vec<&str> = header.split_whitespace().collect();
    match parts.as_slice() {
        [d, t, z] => Some(format!("{}T{}{}", date(d)?, time(t)?, zone(z)?)),
        [d, t] => Some(format!("{}T{}Z", date(d)?, time(t)?)),
        // Already RFC 3339 (`2026-12-01T09:30:00Z`).
        [one] => {
            let (d, rest) = one.split_once('T')?;
            let cut = rest.find(['Z', '+', '-'])?;
            let (t, z) = rest.split_at(cut);
            Some(format!("{}T{}{}", date(d)?, time(t)?, zone(z)?))
        }
        _ => None,
    }
}

/// `expires_at` of GitLab's `GET /personal_access_tokens/self` (`2026-12-01`, or `null` for a
/// token without expiry). GitLab tokens stop working at midnight UTC on that date.
pub fn parse_gitlab_expires_at(v: &serde_json::Value) -> Option<String> {
    let s = v.get("expires_at")?.as_str()?;
    // Some GitLab versions send a full timestamp; keep only the date.
    let d = s.get(..10)?;
    Some(format!("{}T00:00:00Z", date(d)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn github_header_utc() {
        assert_eq!(
            parse_github_expiration("2026-12-01 09:30:00 UTC").as_deref(),
            Some("2026-12-01T09:30:00Z")
        );
    }

    #[test]
    fn github_header_offsets() {
        assert_eq!(
            parse_github_expiration("2026-12-01 09:30:00 +0700").as_deref(),
            Some("2026-12-01T09:30:00+07:00")
        );
        assert_eq!(
            parse_github_expiration("  2026-03-07 21:21:12 -07:00 ").as_deref(),
            Some("2026-03-07T21:21:12-07:00")
        );
        assert_eq!(
            parse_github_expiration("2026-03-07 21:21").as_deref(),
            Some("2026-03-07T21:21:00Z")
        );
    }

    #[test]
    fn github_header_rfc3339() {
        assert_eq!(
            parse_github_expiration("2026-12-01T09:30:00Z").as_deref(),
            Some("2026-12-01T09:30:00Z")
        );
        assert_eq!(
            parse_github_expiration("2026-12-01T09:30:00+05:30").as_deref(),
            Some("2026-12-01T09:30:00+05:30")
        );
    }

    #[test]
    fn github_header_garbage() {
        for bad in [
            "",
            "never",
            "2026-13-01 09:30:00 UTC",
            "2026-12-01 25:30:00 UTC",
            "2026-12-01 09:30:00 PST",
            "26-12-01 09:30:00 UTC",
            "2026-12-01 09:30:00 +7",
            "2026-12-01 09:30:00 UTC extra",
        ] {
            assert_eq!(parse_github_expiration(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn gitlab_expires_at() {
        assert_eq!(
            parse_gitlab_expires_at(&json!({ "expires_at": "2026-12-01" })).as_deref(),
            Some("2026-12-01T00:00:00Z")
        );
        assert_eq!(
            parse_gitlab_expires_at(&json!({ "expires_at": "2026-12-01T00:00:00.000Z" }))
                .as_deref(),
            Some("2026-12-01T00:00:00Z")
        );
        assert_eq!(
            parse_gitlab_expires_at(&json!({ "expires_at": null })),
            None
        );
        assert_eq!(parse_gitlab_expires_at(&json!({})), None);
        assert_eq!(
            parse_gitlab_expires_at(&json!({ "expires_at": "soon" })),
            None
        );
    }

    #[test]
    fn kinds_from_prefix() {
        assert_eq!(github_kind("ghp_abc"), TokenKind::Pat);
        assert_eq!(github_kind("github_pat_abc"), TokenKind::FineGrained);
        assert_eq!(github_kind("gho_abc"), TokenKind::Oauth);
        assert_eq!(github_kind("ghu_abc"), TokenKind::Oauth);
        assert_eq!(github_kind("0123456789abcdef"), TokenKind::Unknown);
        assert_eq!(gitlab_kind("glpat-abc"), TokenKind::Pat);
        assert_eq!(gitlab_kind("oauth-ish"), TokenKind::Unknown);
    }

    #[test]
    fn serializes_camel_case() {
        let info = TokenInfo {
            kind: TokenKind::FineGrained,
            expires_at: Some("2026-12-01T00:00:00Z".into()),
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            json!({ "kind": "fineGrained", "expiresAt": "2026-12-01T00:00:00Z" })
        );
    }
}
