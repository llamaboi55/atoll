//! Island window geometry: a small pill when collapsed, a wide panel when open,
//! always centered at the top of the screen it's on.

use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

pub const COLLAPSED: (f64, f64) = (300.0, 60.0);
pub const EXPANDED: (f64, f64) = (880.0, 500.0);
const TOP_GAP: f64 = 6.0;

fn place(win: &WebviewWindow, size: (f64, f64)) {
    let monitor = win.current_monitor().ok().flatten().or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let x = area.position.x as f64 / scale + (area.size.width as f64 / scale - size.0) / 2.0;
    let y = area.position.y as f64 / scale + TOP_GAP;
    let _ = win.set_size(LogicalSize::new(size.0, size.1));
    let _ = win.set_position(LogicalPosition::new(x, y));
}

pub fn collapse(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("island") {
        place(&win, COLLAPSED);
    }
}

pub fn expand(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("island") {
        place(&win, EXPANDED);
        let _ = win.set_focus();
    }
}

#[tauri::command]
pub fn set_mode(app: AppHandle, expanded: bool) {
    if expanded {
        expand(&app)
    } else {
        collapse(&app)
    }
}
