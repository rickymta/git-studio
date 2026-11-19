//! "Help" form: sends a support request as an email through FormSubmit (formsubmit.co), a
//! form-to-email relay that needs no account or API key. The request goes from Rust, so the
//! packaged app works without a mail client and without widening the webview CSP.
//!
//! The first message to a new address makes FormSubmit send that address a one-time
//! "Activate form" email; messages sent before activation are held until it is confirmed.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::error::{Error, Result};

/// Where support requests are delivered.
pub const SUPPORT_EMAIL: &str = "rickymta@gmail.com";
const ENDPOINT: &str = "https://formsubmit.co/ajax/";

pub const MAX_NAME: usize = 100;
pub const MAX_SUBJECT: usize = 200;
pub const MAX_MESSAGE: usize = 10_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportRequest {
    pub name: String,
    pub email: String,
    /// `bug` | `feature` | `question` | `other`.
    pub topic: String,
    pub subject: String,
    pub message: String,
    /// Attach the app version and OS to the email.
    #[serde(default)]
    pub include_system: bool,
    #[serde(default)]
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub os: String,
    pub arch: String,
}

pub fn system_info() -> SystemInfo {
    SystemInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

fn topic_label(topic: &str) -> Option<&'static str> {
    Some(match topic {
        "bug" => "Bug report",
        "feature" => "Feature request",
        "question" => "Question",
        "other" => "Other",
        _ => return None,
    })
}

/// Loose `local@domain.tld` check, mirrored by the form in the UI.
pub fn valid_email(s: &str) -> bool {
    let s = s.trim();
    let Some((local, domain)) = s.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !s.chars().any(char::is_whitespace)
        && !domain.contains('@')
        && domain
            .rsplit_once('.')
            .is_some_and(|(host, tld)| !host.is_empty() && !tld.is_empty())
}

impl SupportRequest {
    pub fn validate(&self) -> Result<()> {
        let required = [
            ("name", &self.name),
            ("email", &self.email),
            ("subject", &self.subject),
            ("message", &self.message),
        ];
        if let Some((field, _)) = required.iter().find(|(_, v)| v.trim().is_empty()) {
            return Err(Error::Invalid(format!("The {field} field is required.")));
        }
        if !valid_email(&self.email) {
            return Err(Error::Invalid("The email address is not valid.".into()));
        }
        if topic_label(&self.topic).is_none() {
            return Err(Error::Invalid(format!("Unknown topic `{}`.", self.topic)));
        }
        let too_long = |v: &str, max: usize| v.trim().chars().count() > max;
        if too_long(&self.name, MAX_NAME)
            || too_long(&self.subject, MAX_SUBJECT)
            || too_long(&self.message, MAX_MESSAGE)
        {
            return Err(Error::Invalid("A field is too long.".into()));
        }
        Ok(())
    }

    /// FormSubmit fields. Keys starting with `_` configure the email; the rest become its rows.
    pub fn payload(&self, system: &SystemInfo) -> Value {
        let topic = topic_label(&self.topic).unwrap_or("Other");
        let mut m = Map::new();
        m.insert("Name".into(), json!(self.name.trim()));
        m.insert("Email".into(), json!(self.email.trim()));
        m.insert("Topic".into(), json!(topic));
        m.insert("Subject".into(), json!(self.subject.trim()));
        m.insert("Message".into(), json!(self.message.trim()));
        if self.include_system {
            let version = self.app_version.as_deref().unwrap_or("unknown");
            m.insert("App version".into(), json!(version));
            m.insert(
                "OS".into(),
                json!(format!("{} ({})", system.os, system.arch)),
            );
        }
        m.insert(
            "_subject".into(),
            json!(format!("[GitStudio] {topic}: {}", self.subject.trim())),
        );
        m.insert("_replyto".into(), json!(self.email.trim()));
        m.insert("_template".into(), json!("table"));
        m.insert("_captcha".into(), json!("false"));
        Value::Object(m)
    }
}

/// FormSubmit answers `{ "success": "true" | "false", "message": "..." }` (sometimes booleans).
fn check_response(status: u16, body: &str) -> Result<()> {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let ok = match v.get("success") {
        Some(Value::Bool(b)) => *b,
        Some(Value::String(s)) => s.eq_ignore_ascii_case("true"),
        _ => false,
    };
    if (200..300).contains(&status) && ok {
        return Ok(());
    }
    let msg = v
        .get("message")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("HTTP {status}"));
    Err(Error::Network(format!(
        "The support form was not sent: {msg}"
    )))
}

pub async fn send(req: &SupportRequest) -> Result<()> {
    req.validate()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("GitStudio/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| Error::Network(e.to_string()))?;
    let res = client
        .post(format!("{ENDPOINT}{SUPPORT_EMAIL}"))
        .header("Accept", "application/json")
        .json(&req.payload(&system_info()))
        .send()
        .await
        .map_err(|e| Error::Network(format!("Could not reach the support service: {e}")))?;
    let status = res.status().as_u16();
    let body = res
        .text()
        .await
        .map_err(|e| Error::Network(format!("Could not read the support service reply: {e}")))?;
    check_response(status, &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> SupportRequest {
        SupportRequest {
            name: " An ".into(),
            email: "an@example.com".into(),
            topic: "bug".into(),
            subject: "Crash".into(),
            message: "It crashed.".into(),
            include_system: true,
            app_version: Some("0.1.2".into()),
        }
    }

    #[test]
    fn email_format() {
        for ok in ["a@b.co", "first.last+tag@sub.example.org"] {
            assert!(valid_email(ok), "{ok}");
        }
        for bad in [
            "", "a", "a@", "@b.co", "a@b", "a@.co", "a@b.", "a b@c.co", "a@b@c.co",
        ] {
            assert!(!valid_email(bad), "{bad}");
        }
    }

    #[test]
    fn validate_required_topic_and_length() {
        assert!(req().validate().is_ok());
        assert!(
            SupportRequest {
                subject: "  ".into(),
                ..req()
            }
            .validate()
            .is_err()
        );
        assert!(
            SupportRequest {
                email: "nope".into(),
                ..req()
            }
            .validate()
            .is_err()
        );
        assert!(
            SupportRequest {
                topic: "spam".into(),
                ..req()
            }
            .validate()
            .is_err()
        );
        let long = "x".repeat(MAX_MESSAGE + 1);
        assert!(
            SupportRequest {
                message: long,
                ..req()
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn payload_fields() {
        let sys = SystemInfo {
            os: "windows".into(),
            arch: "x86_64".into(),
        };
        let p = req().payload(&sys);
        assert_eq!(p["Name"], "An");
        assert_eq!(p["Topic"], "Bug report");
        assert_eq!(p["_subject"], "[GitStudio] Bug report: Crash");
        assert_eq!(p["_replyto"], "an@example.com");
        assert_eq!(p["App version"], "0.1.2");
        assert_eq!(p["OS"], "windows (x86_64)");

        let p = SupportRequest {
            include_system: false,
            ..req()
        }
        .payload(&sys);
        assert!(p.get("OS").is_none() && p.get("App version").is_none());
    }

    #[test]
    fn response_parsing() {
        assert!(check_response(200, r#"{"success":"true","message":"sent"}"#).is_ok());
        assert!(check_response(200, r#"{"success":true}"#).is_ok());
        let e = check_response(200, r#"{"success":"false","message":"needs Activation"}"#);
        assert!(e.unwrap_err().to_string().contains("needs Activation"));
        assert!(check_response(500, r#"{"success":"true"}"#).is_err());
        assert!(
            check_response(200, "<html>")
                .unwrap_err()
                .to_string()
                .contains("HTTP 200")
        );
    }
}
