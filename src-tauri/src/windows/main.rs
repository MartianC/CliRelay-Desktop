use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use tauri::Manager;

use crate::paths::DesktopPaths;

use super::{
    saved_bounds_fit_current_monitors, MonitorWorkArea, SavedWindowBounds, WindowSizeSpec,
    WindowSpec,
};

pub const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_STATE_FILE_NAME: &str = "desktop-window-state.json";

pub fn main_window_spec() -> WindowSpec {
    WindowSpec {
        label: MAIN_WINDOW_LABEL,
        title: "CliRelay Desktop",
        size: WindowSizeSpec {
            width: 1200,
            height: 800,
            min_width: 900,
            min_height: 600,
        },
    }
}

pub fn configure_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    paths: &DesktopPaths,
) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    let spec = main_window_spec();
    window.set_min_size(Some(tauri::LogicalSize::new(
        spec.size.min_width as f64,
        spec.size.min_height as f64,
    )))?;

    let Some(bounds) = load_main_window_bounds(paths) else {
        return window.center();
    };

    let work_areas = window
        .available_monitors()?
        .iter()
        .map(monitor_work_area)
        .collect::<Vec<_>>();

    if saved_bounds_fit_current_monitors(bounds, &work_areas) {
        window.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))?;
        window.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))?;
        Ok(())
    } else {
        window.center()
    }
}

pub fn show_status_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    window.show()?;
    window.set_focus()
}

pub fn save_main_window_bounds<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    paths: &DesktopPaths,
) -> io::Result<()> {
    let position = window
        .outer_position()
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    let size = window
        .outer_size()
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;

    save_window_state(
        paths,
        WindowStateFile {
            main: Some(SavedWindowBounds {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }),
        },
    )
}

fn load_main_window_bounds(paths: &DesktopPaths) -> Option<SavedWindowBounds> {
    let raw = fs::read_to_string(window_state_path(paths)).ok()?;
    let state = serde_json::from_str::<WindowStateFile>(&raw).ok()?;
    state.main
}

fn save_window_state(paths: &DesktopPaths, state: WindowStateFile) -> io::Result<()> {
    fs::create_dir_all(&paths.state_dir)?;
    let raw = serde_json::to_string_pretty(&state)
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    fs::write(window_state_path(paths), format!("{raw}\n"))
}

fn window_state_path(paths: &DesktopPaths) -> PathBuf {
    paths.state_dir.join(WINDOW_STATE_FILE_NAME)
}

fn monitor_work_area(monitor: &tauri::window::Monitor) -> MonitorWorkArea {
    let work_area = monitor.work_area();

    MonitorWorkArea {
        x: work_area.position.x,
        y: work_area.position.y,
        width: work_area.size.width,
        height: work_area.size.height,
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct WindowStateFile {
    #[serde(default)]
    main: Option<SavedWindowBounds>,
}
