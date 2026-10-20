//! Settings that the Rust side needs (AI provider, clipboard limits). Stored as JSON in
//! the user's config folder. UI-only preferences live in the webview's localStorage.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// "none" | "gemini" | "ollama"
    pub ai_provider: String,
    pub gemini_key: String,
    pub gemini_model: String,
    pub ollama_url: String,
    pub ollama_model: String,
    /// Free text the user writes to shape how the assistant answers ("dry and funny", "reply in Spanish").
    pub ai_personality: String,
    pub clip_limit: usize,
    pub clip_paused: bool,
    pub toggle_shortcut: String,
    pub ask_shortcut: String,
    pub dictate_shortcut: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            ai_provider: "none".into(),
            gemini_key: String::new(),
            gemini_model: "gemini-2.5-flash".into(),
            ollama_url: "http://localhost:11434".into(),
            ollama_model: "gemma3".into(),
            ai_personality: String::new(),
            clip_limit: 500,
            clip_paused: false,
            toggle_shortcut: "CommandOrControl+Shift+Space".into(),
            ask_shortcut: "CommandOrControl+Shift+A".into(),
            dictate_shortcut: "CommandOrControl+Shift+D".into(),
        }
    }
}

pub struct ConfigStore {
    path: PathBuf,
    pub inner: Mutex<Config>,
}

impl ConfigStore {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("config.json");
        let inner = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        Self { path, inner: Mutex::new(inner) }
    }

    pub fn get(&self) -> Config {
        self.inner.lock().unwrap().clone()
    }

    pub fn set(&self, next: Config) -> Result<(), String> {
        let json = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&self.path, json).map_err(|e| e.to_string())?;
        restrict_permissions(&self.path);
        *self.inner.lock().unwrap() = next;
        Ok(())
    }
}

/// The file can hold an API key, so keep it readable by the current user only.
#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) {}

/// What the UI is allowed to see: the key itself never goes back to the webview.
#[derive(Serialize)]
pub struct PublicConfig {
    #[serde(flatten)]
    pub config: Config,
    pub has_gemini_key: bool,
}

impl From<Config> for PublicConfig {
    fn from(mut config: Config) -> Self {
        let has_gemini_key = !config.gemini_key.is_empty();
        config.gemini_key = String::new();
        Self { config, has_gemini_key }
    }
}
