//! Finds installed apps on Windows (Start Menu shortcuts), macOS (.app bundles) and
//! Linux (.desktop entries) for the Apps tab.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct App {
    pub name: String,
    pub path: String,
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>, want: &dyn Fn(&Path) -> bool) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if want(&path) {
            out.push(path);
        } else if depth > 0 && path.is_dir() {
            walk(&path, depth - 1, out, want);
        }
    }
}

/// Parse the parts of a .desktop file we need. Returns None for hidden or non-app entries.
pub fn parse_desktop(contents: &str) -> Option<String> {
    let mut in_entry = false;
    let mut name = None;
    let mut kind = None;
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_entry = line == "[Desktop Entry]";
            continue;
        }
        if !in_entry {
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            match key.trim() {
                "Name" if name.is_none() => name = Some(value.trim().to_string()),
                "Type" => kind = Some(value.trim().to_string()),
                "NoDisplay" | "Hidden" if value.trim().eq_ignore_ascii_case("true") => return None,
                _ => {}
            }
        }
    }
    if kind.as_deref() != Some("Application") {
        return None;
    }
    name.filter(|n| !n.is_empty())
}

#[tauri::command]
pub fn apps_list() -> Vec<App> {
    let mut found: Vec<App> = Vec::new();

    if cfg!(target_os = "windows") {
        let mut roots = vec![];
        if let Ok(p) = std::env::var("ProgramData") {
            roots.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Ok(p) = std::env::var("APPDATA") {
            roots.push(PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        for root in roots {
            let mut files = vec![];
            walk(&root, 3, &mut files, &|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lnk")));
            for f in files {
                let name = f.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let lower = name.to_lowercase();
                if lower.contains("uninstall") || lower.contains("readme") || lower.ends_with(" help") {
                    continue;
                }
                found.push(App { name, path: f.to_string_lossy().into_owned() });
            }
        }
    } else if cfg!(target_os = "macos") {
        let mut roots = vec![PathBuf::from("/Applications"), PathBuf::from("/System/Applications")];
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Applications"));
        }
        for root in roots {
            let mut bundles = vec![];
            walk(&root, 1, &mut bundles, &|p| p.extension().is_some_and(|e| e == "app"));
            for b in bundles {
                let name = b.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                found.push(App { name, path: b.to_string_lossy().into_owned() });
            }
        }
    } else {
        let mut roots = vec![
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
            PathBuf::from("/var/lib/flatpak/exports/share/applications"),
            PathBuf::from("/var/lib/snapd/desktop/applications"),
        ];
        if let Some(data) = dirs::data_dir() {
            roots.push(data.join("applications"));
            roots.push(data.join("flatpak/exports/share/applications"));
        }
        for root in roots {
            let mut files = vec![];
            walk(&root, 1, &mut files, &|p| p.extension().is_some_and(|e| e == "desktop"));
            for f in files {
                if let Some(name) = fs::read_to_string(&f).ok().as_deref().and_then(parse_desktop) {
                    found.push(App { name, path: f.to_string_lossy().into_owned() });
                }
            }
        }
    }

    // One entry per name (user installs override system ones because they come later).
    let mut by_name: HashMap<String, App> = HashMap::new();
    for app in found {
        by_name.insert(app.name.to_lowercase(), app);
    }
    let mut apps: Vec<App> = by_name.into_values().collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

/// Launch an app found by apps_list. Only paths that apps_list would return are accepted.
#[tauri::command]
pub fn app_launch(path: String) -> Result<(), String> {
    if !apps_list().iter().any(|a| a.path == path) {
        return Err("Unknown app".into());
    }
    #[cfg(target_os = "linux")]
    {
        let id = Path::new(&path).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        // gtk-launch and gio understand .desktop files, including field codes and terminals.
        if std::process::Command::new("gtk-launch").arg(&id).spawn().is_ok() {
            return Ok(());
        }
        return std::process::Command::new("gio").args(["launch", &path]).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(target_os = "macos")]
    {
        return std::process::Command::new("open").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        return std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string());
    }
    #[allow(unreachable_code)]
    Err("Unsupported platform".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_visible_apps_only() {
        let app = "[Desktop Entry]\nType=Application\nName=Firefox\nName[de]=Feuerfuchs\nExec=firefox %u\n";
        assert_eq!(parse_desktop(app).as_deref(), Some("Firefox"));
        let hidden = "[Desktop Entry]\nType=Application\nName=Helper\nNoDisplay=true\n";
        assert_eq!(parse_desktop(hidden), None);
        let link = "[Desktop Entry]\nType=Link\nName=Docs\n";
        assert_eq!(parse_desktop(link), None);
        let action = "[Desktop Entry]\nType=Application\nName=Files\n[Desktop Action new]\nName=New Window\n";
        assert_eq!(parse_desktop(action).as_deref(), Some("Files"));
    }
}
