mod ai;
mod apps;
mod clipboard;
mod config;
mod stats;
mod system;
mod window;

use config::{Config, ConfigStore, PublicConfig};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[tauri::command]
fn config_get(store: tauri::State<ConfigStore>) -> PublicConfig {
    store.get().into()
}

/// Save settings from the UI. An empty gemini_key keeps the stored one unless clear_key is set.
#[tauri::command]
fn config_set(app: AppHandle, store: tauri::State<ConfigStore>, mut next: Config, clear_key: bool) -> Result<PublicConfig, String> {
    let current = store.get();
    if next.gemini_key.trim().is_empty() && !clear_key {
        next.gemini_key = current.gemini_key.clone();
    }
    next.gemini_key = next.gemini_key.trim().to_string();
    next.clip_limit = next.clip_limit.clamp(20, 5000);
    store.set(next.clone())?;
    if (current.toggle_shortcut, current.ask_shortcut, current.dictate_shortcut)
        != (next.toggle_shortcut.clone(), next.ask_shortcut.clone(), next.dictate_shortcut.clone())
    {
        register_shortcuts(&app, &next)?;
    }
    Ok(next.into())
}

#[tauri::command]
async fn clip_paste(app: AppHandle, id: String) -> Result<(), String> {
    {
        let state = app.state::<Arc<clipboard::ClipState>>();
        clipboard::put(&state, &id)?;
    }
    system::paste_into_previous_app(&app).await
}

/// Paste dictated text into the app you were using, then restore what was on the clipboard.
#[tauri::command]
async fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let previous = cb.get_text().ok();
    {
        let state = app.state::<Arc<clipboard::ClipState>>();
        *state.last.lock().unwrap() = clipboard::hash(text.as_bytes());
    }
    cb.set_text(text).map_err(|e| e.to_string())?;
    let result = system::paste_into_previous_app(&app).await;
    tokio::time::sleep(std::time::Duration::from_millis(400)).await;
    if let Some(prev) = previous {
        let state = app.state::<Arc<clipboard::ClipState>>();
        *state.last.lock().unwrap() = clipboard::hash(prev.as_bytes());
        let _ = cb.set_text(prev);
    }
    result
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

fn register_shortcuts(app: &AppHandle, config: &Config) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut problems = vec![];
    for (accel, what) in [
        (&config.toggle_shortcut, "toggle"),
        (&config.ask_shortcut, "ask"),
        (&config.dictate_shortcut, "dictate"),
    ] {
        if accel.trim().is_empty() {
            continue;
        }
        match accel.parse::<Shortcut>() {
            Ok(s) => {
                if gs.register(s).is_err() {
                    problems.push(format!("{accel} is used by another app"));
                }
                app.state::<ShortcutMap>().0.lock().unwrap().push((s.id(), what));
            }
            Err(_) => problems.push(format!("{accel} isn't a valid shortcut")),
        }
    }
    if problems.is_empty() { Ok(()) } else { Err(problems.join("; ")) }
}

struct ShortcutMap(Mutex<Vec<(u32, &'static str)>>);

fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, state: ShortcutState) {
    let what = app.state::<ShortcutMap>().0.lock().unwrap().iter().rev().find(|(id, _)| *id == shortcut.id()).map(|(_, w)| *w);
    match (what, state) {
        (Some("toggle"), ShortcutState::Pressed) => {
            let _ = app.emit("atoll://toggle", ());
        }
        (Some("ask"), ShortcutState::Pressed) => {
            // Grab the screen before the panel opens, so the answer is about what you were looking at.
            let app = app.clone();
            std::thread::spawn(move || {
                if app.state::<ConfigStore>().get().ai_provider != "none" {
                    if let Ok(img) = ai::capture_screen() {
                        *app.state::<ai::ScreenCache>().0.lock().unwrap() = Some((Instant::now(), img));
                    }
                }
                let _ = app.emit("atoll://ask", ());
            });
        }
        (Some("dictate"), s) => {
            let _ = app.emit("atoll://dictate", if s == ShortcutState::Pressed { "down" } else { "up" });
        }
        _ => {}
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = app.emit("atoll://toggle", ());
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| on_shortcut(app, shortcut, event.state))
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            app.manage(ConfigStore::load(config_dir));
            app.manage(Arc::new(clipboard::ClipState::load(data_dir.join("clipboard"))));
            app.manage(stats::StatsState::new());
            app.manage(system::SystemState { awake: Mutex::new(None), wallpaper_dir: data_dir.join("wallpapers") });
            app.manage(ai::ScreenCache(Mutex::new(None)));
            app.manage(ShortcutMap(Mutex::new(vec![])));

            let handle = app.handle().clone();
            if let Err(e) = register_shortcuts(&handle, &handle.state::<ConfigStore>().get()) {
                eprintln!("shortcuts: {e}");
            }
            clipboard::start_watcher(handle.clone());

            let open = MenuItem::with_id(app, "open", "Open Atoll", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Atoll", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::with_id("atoll")
                .icon(app.default_window_icon().cloned().ok_or("missing icon")?)
                .tooltip("Atoll")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        let _ = app.emit("atoll://toggle", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            window::collapse(&handle);
            if let Some(win) = handle.get_webview_window("island") {
                win.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            config_get,
            config_set,
            clip_paste,
            paste_text,
            quit,
            window::set_mode,
            stats::stats,
            stats::speed_test,
            clipboard::clips_list,
            clipboard::clip_thumb,
            clipboard::clip_copy,
            clipboard::clip_pin,
            clipboard::clip_delete,
            clipboard::clip_clear,
            apps::apps_list,
            apps::app_launch,
            system::media,
            system::keep_awake,
            system::power,
            system::set_wallpaper_png,
            system::set_wallpaper_file,
            system::current_wallpaper,
            ai::ai_ask,
            ai::ai_transcribe,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Atoll");
}
