//! Clipboard history: text and images, kept on this computer only.
//! A background thread polls the clipboard twice a second and records anything new.

use crate::config::ConfigStore;
use arboard::{Clipboard, ImageData};
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const MAX_TEXT: usize = 200_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Clip {
    pub id: String,
    /// "text" | "image"
    pub kind: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    pub created: u64,
    #[serde(default)]
    pub pinned: bool,
}

pub struct ClipState {
    pub dir: PathBuf,
    pub items: Mutex<Vec<Clip>>,
    /// Hash of the last thing seen, so our own copies and repeats are ignored.
    pub last: Mutex<String>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn hash(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().take(12).map(|b| format!("{b:02x}")).collect()
}

/// Insert a clip at the top, dedupe by id, then trim unpinned items over the limit.
pub fn insert(items: &mut Vec<Clip>, clip: Clip, limit: usize) -> Vec<Clip> {
    let pinned = items.iter().find(|c| c.id == clip.id).map(|c| c.pinned).unwrap_or(false);
    items.retain(|c| c.id != clip.id);
    items.insert(0, Clip { pinned, ..clip });
    let mut removed = Vec::new();
    let mut unpinned = 0;
    items.retain(|c| {
        if c.pinned {
            return true;
        }
        unpinned += 1;
        if unpinned > limit {
            removed.push(c.clone());
            false
        } else {
            true
        }
    });
    removed
}

impl ClipState {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(dir.join("images"));
        let items: Vec<Clip> = fs::read_to_string(dir.join("history.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let last = items.first().map(|c| c.id.clone()).unwrap_or_default();
        Self { dir, items: Mutex::new(items), last: Mutex::new(last) }
    }

    fn save(&self, items: &[Clip]) {
        if let Ok(json) = serde_json::to_string(items) {
            let tmp = self.dir.join("history.json.tmp");
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(tmp, self.dir.join("history.json"));
            }
        }
    }

    fn image_path(&self, id: &str) -> PathBuf {
        self.dir.join("images").join(format!("{id}.png"))
    }

    fn thumb_path(&self, id: &str) -> PathBuf {
        self.dir.join("images").join(format!("{id}.thumb.png"))
    }

    fn remove_files(&self, clips: &[Clip]) {
        for c in clips.iter().filter(|c| c.kind == "image") {
            let _ = fs::remove_file(self.image_path(&c.id));
            let _ = fs::remove_file(self.thumb_path(&c.id));
        }
    }

    fn record(&self, app: &AppHandle, clip: Clip, limit: usize) {
        let mut items = self.items.lock().unwrap();
        let removed = insert(&mut items, clip.clone(), limit);
        self.remove_files(&removed);
        self.save(&items);
        drop(items);
        let _ = app.emit("atoll://clip", &clip);
    }
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let mut out = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).ok()?;
    Some(out)
}

fn thumbnail(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    let img = image::RgbaImage::from_raw(width, height, rgba.to_vec())?;
    let scale = (240.0 / width.max(height) as f32).min(1.0);
    let small = image::imageops::thumbnail(&img, ((width as f32 * scale) as u32).max(1), ((height as f32 * scale) as u32).max(1));
    let mut out = Vec::new();
    small.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png).ok()?;
    Some(out)
}

pub fn start_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let mut clipboard = None;
        loop {
            std::thread::sleep(Duration::from_millis(500));
            let config = app.state::<ConfigStore>().get();
            if config.clip_paused {
                continue;
            }
            if clipboard.is_none() {
                clipboard = Clipboard::new().ok();
            }
            let Some(cb) = clipboard.as_mut() else { continue };
            let state = app.state::<Arc<ClipState>>();

            if let Ok(text) = cb.get_text() {
                if text.trim().is_empty() {
                    continue;
                }
                let id = hash(text.as_bytes());
                if *state.last.lock().unwrap() == id {
                    continue;
                }
                *state.last.lock().unwrap() = id.clone();
                let text: String = text.chars().take(MAX_TEXT).collect();
                state.record(&app, Clip { id, kind: "text".into(), text, width: 0, height: 0, created: now(), pinned: false }, config.clip_limit);
            } else if let Ok(img) = cb.get_image() {
                let id = hash(&img.bytes);
                if *state.last.lock().unwrap() == id {
                    continue;
                }
                *state.last.lock().unwrap() = id.clone();
                let (w, h) = (img.width as u32, img.height as u32);
                if let (Some(full), Some(thumb)) = (encode_png(w, h, &img.bytes), thumbnail(w, h, &img.bytes)) {
                    let _ = fs::write(state.image_path(&id), full);
                    let _ = fs::write(state.thumb_path(&id), thumb);
                    state.record(&app, Clip { id, kind: "image".into(), text: String::new(), width: w, height: h, created: now(), pinned: false }, config.clip_limit);
                }
            }
        }
    });
}

#[tauri::command]
pub fn clips_list(state: tauri::State<Arc<ClipState>>) -> Vec<Clip> {
    state.items.lock().unwrap().clone()
}

#[tauri::command]
pub fn clip_thumb(state: tauri::State<Arc<ClipState>>, id: String) -> Option<String> {
    if !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let bytes = fs::read(state.thumb_path(&id)).ok()?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Put a history item back on the clipboard.
pub fn put(state: &ClipState, id: &str) -> Result<(), String> {
    let clip = state.items.lock().unwrap().iter().find(|c| c.id == id).cloned().ok_or("Not found")?;
    let mut cb = Clipboard::new().map_err(|e| e.to_string())?;
    *state.last.lock().unwrap() = clip.id.clone();
    if clip.kind == "text" {
        cb.set_text(clip.text).map_err(|e| e.to_string())
    } else {
        let img = image::open(state.image_path(&clip.id)).map_err(|e| e.to_string())?.to_rgba8();
        let (w, h) = img.dimensions();
        cb.set_image(ImageData { width: w as usize, height: h as usize, bytes: Cow::Owned(img.into_raw()) })
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn clip_copy(state: tauri::State<Arc<ClipState>>, id: String) -> Result<(), String> {
    put(&state, &id)
}

#[tauri::command]
pub fn clip_pin(state: tauri::State<Arc<ClipState>>, id: String, pinned: bool) {
    let mut items = state.items.lock().unwrap();
    if let Some(c) = items.iter_mut().find(|c| c.id == id) {
        c.pinned = pinned;
    }
    state.save(&items);
}

#[tauri::command]
pub fn clip_delete(state: tauri::State<Arc<ClipState>>, id: String) {
    let mut items = state.items.lock().unwrap();
    let removed: Vec<Clip> = items.iter().filter(|c| c.id == id).cloned().collect();
    items.retain(|c| c.id != id);
    state.remove_files(&removed);
    state.save(&items);
}

/// Clears everything except pinned items.
#[tauri::command]
pub fn clip_clear(state: tauri::State<Arc<ClipState>>) {
    let mut items = state.items.lock().unwrap();
    let removed: Vec<Clip> = items.iter().filter(|c| !c.pinned).cloned().collect();
    items.retain(|c| c.pinned);
    state.remove_files(&removed);
    state.save(&items);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(id: &str) -> Clip {
        Clip { id: id.into(), kind: "text".into(), text: id.into(), width: 0, height: 0, created: 0, pinned: false }
    }

    #[test]
    fn newest_first_and_deduped() {
        let mut items = vec![clip("a"), clip("b")];
        insert(&mut items, clip("b"), 10);
        assert_eq!(items.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["b", "a"]);
    }

    #[test]
    fn limit_keeps_pinned_items() {
        let mut items = vec![];
        let mut p = clip("pinned");
        p.pinned = true;
        items.push(p);
        for id in ["1", "2", "3"] {
            insert(&mut items, clip(id), 2);
        }
        let ids: Vec<_> = items.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["3", "2", "pinned"]);
    }

    #[test]
    fn re_copying_a_pinned_item_keeps_it_pinned() {
        let mut p = clip("x");
        p.pinned = true;
        let mut items = vec![clip("y"), p];
        insert(&mut items, clip("x"), 5);
        assert!(items[0].pinned);
    }

    #[test]
    fn hash_is_stable_hex() {
        assert_eq!(hash(b"hello"), hash(b"hello"));
        assert_eq!(hash(b"hello").len(), 24);
        assert!(hash(b"hello").chars().all(|c| c.is_ascii_hexdigit()));
    }
}
