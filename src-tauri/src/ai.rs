//! Optional AI. Off by default. Uses either your own Google Gemini API key (free tier works)
//! or a local Ollama model, so it can run fully offline. Nothing is sent unless you ask.

use crate::config::{Config, ConfigStore};
use base64::Engine;
use serde_json::{json, Value};
use std::io::Cursor;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// A screenshot taken the moment the Ask shortcut is pressed (before the panel opens).
pub struct ScreenCache(pub Mutex<Option<(Instant, String)>>);

pub fn capture_screen() -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or(monitors.first())
        .ok_or("No screen found")?;
    let img = monitor.capture_image().map_err(|e| e.to_string())?;
    let (w, h) = img.dimensions();
    let scale = (1600.0 / w.max(h) as f32).min(1.0);
    let img = image::imageops::resize(&img, ((w as f32 * scale) as u32).max(1), ((h as f32 * scale) as u32).max(1), image::imageops::FilterType::Triangle);
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(png))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(90)).build().map_err(|e| e.to_string())
}

async fn gemini(config: &Config, parts: Vec<Value>) -> Result<String, String> {
    if config.gemini_key.is_empty() {
        return Err("Add your Gemini API key in Atoll settings (it's free at aistudio.google.com).".into());
    }
    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent", config.gemini_model);
    let res = client()?
        .post(url)
        .header("x-goog-api-key", &config.gemini_key)
        .json(&json!({ "contents": [{ "role": "user", "parts": parts }] }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let msg = body["error"]["message"].as_str().unwrap_or("request failed");
        return Err(format!("Gemini: {msg}"));
    }
    Ok(extract_gemini_text(&body))
}

pub fn extract_gemini_text(body: &Value) -> String {
    body["candidates"][0]["content"]["parts"]
        .as_array()
        .map(|parts| parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join(""))
        .unwrap_or_default()
        .trim()
        .to_string()
}

async fn ollama(config: &Config, prompt: &str, image: Option<&str>) -> Result<String, String> {
    let mut message = json!({ "role": "user", "content": prompt });
    if let Some(img) = image {
        message["images"] = json!([img]);
    }
    let url = format!("{}/api/chat", config.ollama_url.trim_end_matches('/'));
    let res = client()?
        .post(url)
        .json(&json!({ "model": config.ollama_model, "messages": [message], "stream": false }))
        .send()
        .await
        .map_err(|_| "Can't reach Ollama. Is it running? (ollama.com)".to_string())?;
    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    if let Some(err) = body["error"].as_str() {
        return Err(format!("Ollama: {err}"));
    }
    Ok(body["message"]["content"].as_str().unwrap_or_default().trim().to_string())
}

const SYSTEM: &str = "You are Atoll, a calm desktop assistant. Answer briefly and plainly (under 120 words unless asked). If a screenshot is attached, it shows the user's screen.";

/// The base instructions plus the personality the user chose in settings, if any.
pub fn system_prompt(config: &Config) -> String {
    let personality = config.ai_personality.trim();
    if personality.is_empty() {
        SYSTEM.to_string()
    } else {
        let personality: String = personality.chars().take(500).collect();
        format!("{SYSTEM}\nThe user chose this personality and style for you, so follow it: {personality}")
    }
}

#[tauri::command]
pub async fn ai_ask(
    config: tauri::State<'_, ConfigStore>,
    screen: tauri::State<'_, ScreenCache>,
    prompt: String,
    with_screen: bool,
) -> Result<String, String> {
    let config = config.get();
    let image = if with_screen {
        let cached = screen.0.lock().unwrap().take();
        match cached {
            Some((at, img)) if at.elapsed() < Duration::from_secs(120) => Some(img),
            _ => Some(capture_screen()?),
        }
    } else {
        None
    };
    let full = format!("{}\n\n{prompt}", system_prompt(&config));
    match config.ai_provider.as_str() {
        "gemini" => {
            let mut parts = vec![json!({ "text": full })];
            if let Some(img) = &image {
                parts.push(json!({ "inline_data": { "mime_type": "image/png", "data": img } }));
            }
            gemini(&config, parts).await
        }
        "ollama" => ollama(&config, &full, image.as_deref()).await,
        _ => Err("AI is off. Turn it on in settings: Gemini (your free key) or Ollama (local).".into()),
    }
}

const DICTATE: &str = "Transcribe this recording into the clean text the speaker meant to write. Remove filler words and false starts, apply their spoken corrections (\"no, ten\" means use ten), add punctuation. Reply with only the final text.";

/// Speech to clean text. Gemini only (Ollama models don't take audio).
#[tauri::command]
pub async fn ai_transcribe(config: tauri::State<'_, ConfigStore>, audio_base64: String, mime: String) -> Result<String, String> {
    let config = config.get();
    if config.ai_provider != "gemini" {
        return Err("Dictation needs the Gemini option in settings.".into());
    }
    let mime = if mime.starts_with("audio/") { mime.split(';').next().unwrap_or("audio/webm").to_string() } else { "audio/webm".into() };
    gemini(&config, vec![json!({ "text": DICTATE }), json!({ "inline_data": { "mime_type": mime, "data": audio_base64 } })]).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_gemini_parts() {
        let body = json!({ "candidates": [{ "content": { "parts": [{ "text": "Hello " }, { "text": "world " }] } }] });
        assert_eq!(extract_gemini_text(&body), "Hello world");
        assert_eq!(extract_gemini_text(&json!({})), "");
    }

    #[test]
    fn adds_personality_only_when_set() {
        let mut config = Config::default();
        assert_eq!(system_prompt(&config), SYSTEM);
        config.ai_personality = "  dry and funny ".into();
        let p = system_prompt(&config);
        assert!(p.starts_with(SYSTEM) && p.ends_with("dry and funny"));
        config.ai_personality = "x".repeat(2000);
        assert!(system_prompt(&config).len() < SYSTEM.len() + 600);
    }
}
