//! Media keys, keep-awake, power actions, wallpaper and "paste into the app you were using".

use base64::Engine;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub struct SystemState {
    pub awake: Mutex<Option<keepawake::KeepAwake>>,
    pub wallpaper_dir: PathBuf,
}

fn tap(key: Key) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.key(key, Direction::Click).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn media(action: String) -> Result<(), String> {
    let key = match action.as_str() {
        "play" => Key::MediaPlayPause,
        "next" => Key::MediaNextTrack,
        "prev" => Key::MediaPrevTrack,
        "vol-up" => Key::VolumeUp,
        "vol-down" => Key::VolumeDown,
        "mute" => Key::VolumeMute,
        _ => return Err("Unknown media action".into()),
    };
    tap(key)
}

#[tauri::command]
pub fn keep_awake(state: tauri::State<SystemState>, on: bool) -> Result<bool, String> {
    let mut guard = state.awake.lock().unwrap();
    if on {
        let handle = keepawake::Builder::default()
            .display(true)
            .idle(true)
            .reason("Keep awake is on in Atoll")
            .app_name("Atoll")
            .app_reverse_domain("io.github.llamaboi55.atoll")
            .create()
            .map_err(|e| e.to_string())?;
        *guard = Some(handle);
    } else {
        *guard = None; // dropping the handle releases the inhibitor
    }
    Ok(guard.is_some())
}

fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    let mut c = Command::new(cmd);
    c.args(args);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c.spawn().map(|_| ()).map_err(|e| format!("{cmd}: {e}"))
}

#[tauri::command]
pub fn power(action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return match action.as_str() {
        "lock" => run("rundll32.exe", &["user32.dll,LockWorkStation"]),
        "sleep" => run("rundll32.exe", &["powrprof.dll,SetSuspendState", "0,1,0"]),
        "restart" => run("shutdown", &["/r", "/t", "0"]),
        "shutdown" => run("shutdown", &["/s", "/t", "0"]),
        _ => Err("Unknown action".into()),
    };
    #[cfg(target_os = "macos")]
    return match action.as_str() {
        "lock" => run("pmset", &["displaysleepnow"]),
        "sleep" => run("pmset", &["sleepnow"]),
        "restart" => run("osascript", &["-e", "tell application \"System Events\" to restart"]),
        "shutdown" => run("osascript", &["-e", "tell application \"System Events\" to shut down"]),
        _ => Err("Unknown action".into()),
    };
    #[cfg(target_os = "linux")]
    return match action.as_str() {
        "lock" => run("loginctl", &["lock-session"]),
        "sleep" => run("systemctl", &["suspend"]),
        "restart" => run("systemctl", &["reboot"]),
        "shutdown" => run("systemctl", &["poweroff"]),
        _ => Err("Unknown action".into()),
    };
    #[allow(unreachable_code)]
    Err("Unsupported platform".into())
}

/// Save a PNG rendered by the UI (one of Atoll's landscapes) and make it the desktop wallpaper.
#[tauri::command]
pub fn set_wallpaper_png(state: tauri::State<SystemState>, name: String, png_base64: String) -> Result<String, String> {
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(40).collect();
    let bytes = base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|e| e.to_string())?;
    if !bytes.starts_with(b"\x89PNG") {
        return Err("Not a PNG".into());
    }
    fs::create_dir_all(&state.wallpaper_dir).map_err(|e| e.to_string())?;
    let path = state.wallpaper_dir.join(format!("{safe}.png"));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let p = path.to_string_lossy().into_owned();
    wallpaper::set_from_path(&p).map_err(|e| e.to_string())?;
    Ok(p)
}

#[tauri::command]
pub fn set_wallpaper_file(path: String) -> Result<(), String> {
    let lower = path.to_lowercase();
    if ![".png", ".jpg", ".jpeg", ".bmp", ".webp"].iter().any(|ext| lower.ends_with(ext)) {
        return Err("Pick a PNG, JPG, BMP or WebP image".into());
    }
    wallpaper::set_from_path(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn current_wallpaper() -> Option<String> {
    wallpaper::get().ok()
}

/// Hide the island so focus returns to the app underneath, press paste, then come back.
pub async fn paste_into_previous_app(app: &AppHandle) -> Result<(), String> {
    let win = app.get_webview_window("island").ok_or("no window")?;
    win.hide().map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(180)).await;
    let modifier = if cfg!(target_os = "macos") { Key::Meta } else { Key::Control };
    let result = (|| {
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        enigo.key(modifier, Direction::Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
        enigo.key(modifier, Direction::Release).map_err(|e| e.to_string())
    })();
    tokio::time::sleep(Duration::from_millis(120)).await;
    crate::window::collapse(app);
    let _ = win.show();
    result
}
