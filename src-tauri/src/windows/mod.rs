pub mod main;
pub mod panel;
pub mod settings;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::commands::SharedDesktopCommandState;
use crate::paths::DesktopPaths;
use crate::service::state::ServiceStatus;

pub type SharedDesktopWindowState = Mutex<DesktopWindowState>;

pub const STATUS_WINDOW_LABEL: &str = "status";

pub struct DesktopWindowState {
    paths: DesktopPaths,
    last_user_surface: LastUserSurface,
}

impl DesktopWindowState {
    pub fn new(paths: DesktopPaths) -> Self {
        Self {
            paths,
            last_user_surface: LastUserSurface::Status,
        }
    }

    pub fn paths(&self) -> &DesktopPaths {
        &self.paths
    }

    pub fn last_user_surface(&self) -> LastUserSurface {
        self.last_user_surface
    }

    pub fn record_last_user_surface(&mut self, surface: LastUserSurface) {
        self.last_user_surface = surface;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowSizeSpec {
    pub width: u32,
    pub height: u32,
    pub min_width: u32,
    pub min_height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowSpec {
    pub label: &'static str,
    pub title: &'static str,
    pub size: WindowSizeSpec,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LastUserSurface {
    Status,
    Panel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RestoreTarget {
    Status,
    Panel,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SavedWindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MonitorWorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

pub fn restore_target(status: ServiceStatus, last_surface: LastUserSurface) -> RestoreTarget {
    match (status, last_surface) {
        (ServiceStatus::Running, LastUserSurface::Panel) => RestoreTarget::Panel,
        _ => RestoreTarget::Status,
    }
}

pub fn restore_target_after_dock_click(
    status: ServiceStatus,
    last_surface: LastUserSurface,
    open_panel_on_start: bool,
) -> RestoreTarget {
    if status == ServiceStatus::Running && !open_panel_on_start {
        return RestoreTarget::Panel;
    }

    restore_target(status, last_surface)
}

pub fn saved_bounds_fit_current_monitors(
    bounds: SavedWindowBounds,
    work_areas: &[MonitorWorkArea],
) -> bool {
    work_areas
        .iter()
        .any(|area| area.contains_point(bounds.x, bounds.y))
}

impl MonitorWorkArea {
    fn contains_point(&self, x: i32, y: i32) -> bool {
        let right = self.x.saturating_add_unsigned(self.width);
        let bottom = self.y.saturating_add_unsigned(self.height);

        x >= self.x && x < right && y >= self.y && y < bottom
    }
}

pub fn handle_window_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if window.label() == main::MAIN_WINDOW_LABEL {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                return;
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                if let Some(state) = window.try_state::<SharedDesktopWindowState>() {
                    if let Ok(state) = state.lock() {
                        let _ = main::save_main_window_bounds(window, state.paths());
                    }
                }
            }
            _ => {}
        }
    }

    if let tauri::WindowEvent::Focused(true) = event {
        record_last_surface_for_label(window, window.label());
    }
}

pub fn handle_run_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            if code.is_none() {
                api.prevent_exit();
                crate::tray::request_desktop_exit(app);
            }
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => {
            let _ = restore_after_dock_click(app);
        }
        _ => {}
    }
}

pub fn restore_after_dock_click<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let last_surface = app
        .try_state::<SharedDesktopWindowState>()
        .and_then(|state| state.lock().ok().map(|state| state.last_user_surface()))
        .unwrap_or(LastUserSurface::Status);

    let command_state = app
        .try_state::<SharedDesktopCommandState>()
        .and_then(|state| {
            state
                .lock()
                .ok()
                .map(|state| (state.service_snapshot(), state.open_panel_on_start()))
        });

    let Some((snapshot, open_panel_on_start)) = command_state else {
        return main::show_status_window(app);
    };

    match restore_target_after_dock_click(
        snapshot.status.clone(),
        last_surface,
        open_panel_on_start,
    ) {
        RestoreTarget::Panel => panel::show_panel_window(app, snapshot.port),
        RestoreTarget::Status => main::show_status_window(app),
    }
}

fn record_last_surface_for_label<R: tauri::Runtime>(window: &tauri::Window<R>, label: &str) {
    let Some(surface) = surface_for_label(label) else {
        return;
    };
    let Some(state) = window.try_state::<SharedDesktopWindowState>() else {
        return;
    };
    let Ok(mut state) = state.lock() else {
        return;
    };

    state.record_last_user_surface(surface);
}

fn surface_for_label(label: &str) -> Option<LastUserSurface> {
    match label {
        main::MAIN_WINDOW_LABEL | STATUS_WINDOW_LABEL => Some(LastUserSurface::Status),
        panel::PANEL_WINDOW_LABEL => Some(LastUserSurface::Panel),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::state::ServiceStatus;

    #[test]
    fn main_window_uses_documented_size_limits() {
        let spec = main::main_window_spec();

        assert_eq!(spec.label, "main");
        assert_eq!(spec.title, "CliRelay Desktop");
        assert_eq!(spec.size.width, 1200);
        assert_eq!(spec.size.height, 800);
        assert_eq!(spec.size.min_width, 900);
        assert_eq!(spec.size.min_height, 600);
    }

    #[test]
    fn settings_window_is_single_instance_size() {
        let spec = settings::settings_window_spec();

        assert_eq!(spec.label, "settings");
        assert_eq!(spec.title, "CliRelay Desktop Settings");
        assert_eq!(spec.size.width, 900);
        assert_eq!(spec.size.height, 600);
        assert_eq!(spec.size.min_width, 900);
        assert_eq!(spec.size.min_height, 600);
    }

    #[test]
    fn panel_url_points_to_local_manage_route() {
        assert_eq!(panel::panel_url(8317), "http://127.0.0.1:8317/manage");
    }

    #[test]
    fn panel_window_uses_app_display_title() {
        assert_eq!(panel::panel_window_title(), "CliRelay Desktop");
    }

    #[test]
    fn panel_navigation_allows_only_current_local_panel_origin() {
        let cases = [
            (
                "http://127.0.0.1:8317/manage",
                panel::PanelNavigationDecision::Allow,
            ),
            (
                "http://localhost:8317/models",
                panel::PanelNavigationDecision::Allow,
            ),
            (
                "https://example.com/docs",
                panel::PanelNavigationDecision::OpenExternal,
            ),
            (
                "file:///tmp/panel.html",
                panel::PanelNavigationDecision::Block,
            ),
            (
                "http://example.com/manage",
                panel::PanelNavigationDecision::Block,
            ),
            (
                "http://127.0.0.1:5174/manage",
                panel::PanelNavigationDecision::Block,
            ),
            (
                "http://localhost:9999/manage",
                panel::PanelNavigationDecision::Block,
            ),
        ];

        for (raw_url, expected) in cases {
            let url = tauri::Url::parse(raw_url).expect("测试 URL 应合法");
            assert_eq!(panel::decide_panel_navigation(8317, &url), expected);
        }
    }

    #[test]
    fn dock_restore_prefers_panel_only_when_service_is_running_and_panel_was_last() {
        assert_eq!(
            restore_target(ServiceStatus::Running, LastUserSurface::Panel),
            RestoreTarget::Panel
        );
        assert_eq!(
            restore_target(ServiceStatus::Running, LastUserSurface::Status),
            RestoreTarget::Status
        );

        for status in [
            ServiceStatus::Starting,
            ServiceStatus::Stopping,
            ServiceStatus::Unhealthy,
            ServiceStatus::External,
            ServiceStatus::Error,
            ServiceStatus::Stopped,
        ] {
            assert_eq!(
                restore_target(status, LastUserSurface::Panel),
                RestoreTarget::Status
            );
        }
    }

    #[test]
    fn dock_restore_opens_panel_after_silent_start_when_service_is_running() {
        assert_eq!(
            restore_target_after_dock_click(ServiceStatus::Running, LastUserSurface::Status, false),
            RestoreTarget::Panel
        );
    }

    #[test]
    fn saved_bounds_are_valid_only_when_origin_is_on_current_monitor() {
        let work_areas = [
            MonitorWorkArea {
                x: 0,
                y: 0,
                width: 1440,
                height: 900,
            },
            MonitorWorkArea {
                x: -1440,
                y: 0,
                width: 1440,
                height: 900,
            },
        ];

        assert!(saved_bounds_fit_current_monitors(
            SavedWindowBounds {
                x: 100,
                y: 100,
                width: 1200,
                height: 800,
            },
            &work_areas,
        ));
        assert!(saved_bounds_fit_current_monitors(
            SavedWindowBounds {
                x: -1200,
                y: 100,
                width: 1200,
                height: 800,
            },
            &work_areas,
        ));
        assert!(!saved_bounds_fit_current_monitors(
            SavedWindowBounds {
                x: 2000,
                y: 100,
                width: 1200,
                height: 800,
            },
            &work_areas,
        ));
    }
}
