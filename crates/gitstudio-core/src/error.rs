use serde::Serialize;

/// Every failure the UI can see. Serialized as `{ kind, message }`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// `git` exited with an error; the message is its stderr.
    #[error("{0}")]
    Git(String),
    /// The `git` executable could not be started.
    #[error("Git is not installed or not on PATH: {0}")]
    GitMissing(String),
    /// GitHub API returned an error or could not be reached.
    #[error("{0}")]
    GitHub(String),
    /// The caller sent arguments that make no sense.
    #[error("{0}")]
    Invalid(String),
    /// The OS credential store failed.
    #[error("The OS credential store is unavailable: {0}")]
    Keyring(String),
    #[error("{0}")]
    Io(#[from] std::io::Error),
}

impl Error {
    fn kind(&self) -> &'static str {
        match self {
            Error::Git(_) => "git",
            Error::GitMissing(_) => "git_missing",
            Error::GitHub(_) => "github",
            Error::Invalid(_) => "invalid",
            Error::Keyring(_) => "keyring",
            Error::Io(_) => "io",
        }
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("Error", 2)?;
        st.serialize_field("kind", self.kind())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<serde_json::Error> for Error {
    fn from(e: serde_json::Error) -> Self {
        Error::Invalid(e.to_string())
    }
}

impl From<reqwest::Error> for Error {
    fn from(e: reqwest::Error) -> Self {
        Error::GitHub(format!("Could not reach GitHub: {e}"))
    }
}

pub type Result<T> = std::result::Result<T, Error>;
