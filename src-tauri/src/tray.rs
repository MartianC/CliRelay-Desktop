use crate::service::state::ServiceStatus;
use crate::{
    commands::{CommandError, DesktopCommandState, SharedDesktopCommandState},
    service::manager::{ManagerError, ServiceSnapshot},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

pub const TRAY_ID: &str = "clirelay-desktop-tray";
pub const LABEL_STATUS_RUNNING: &str = "CliRelay ● 运行中";
pub const LABEL_STATUS_STOPPED: &str = "CliRelay ● 已停止";
pub const LABEL_STATUS_STARTING: &str = "CliRelay ● 启动中";
pub const LABEL_STATUS_STOPPING: &str = "CliRelay ● 停止中";
pub const LABEL_STATUS_UNHEALTHY: &str = "CliRelay ● 异常";
pub const LABEL_STATUS_EXTERNAL: &str = "CliRelay ● 外部服务";
pub const LABEL_STATUS_ERROR: &str = "CliRelay ● 错误";
pub const LABEL_OPEN_PANEL: &str = "打开管理面板";
pub const LABEL_SETTINGS: &str = "设置";
pub const LABEL_START_SERVICE: &str = "启动服务";
pub const LABEL_STOP_SERVICE: &str = "停止服务";
pub const LABEL_RESTART_SERVICE: &str = "重新启动";
pub const LABEL_OPEN_DATA_DIR: &str = "打开数据目录";
pub const LABEL_OPEN_LOG_DIR: &str = "打开日志目录";
pub const LABEL_QUIT: &str = "退出 CliRelay Desktop";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrayMenuItemId {
    StatusTitle,
    OpenPanel,
    Settings,
    StartService,
    StopService,
    RestartService,
    OpenDataDirectory,
    OpenLogDirectory,
    Quit,
}

impl TrayMenuItemId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StatusTitle => "tray_status_title",
            Self::OpenPanel => "tray_open_panel",
            Self::Settings => "tray_settings",
            Self::StartService => "tray_start_service",
            Self::StopService => "tray_stop_service",
            Self::RestartService => "tray_restart_service",
            Self::OpenDataDirectory => "tray_open_data_directory",
            Self::OpenLogDirectory => "tray_open_log_directory",
            Self::Quit => "tray_quit",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "tray_status_title" => Some(Self::StatusTitle),
            "tray_open_panel" => Some(Self::OpenPanel),
            "tray_settings" => Some(Self::Settings),
            "tray_start_service" => Some(Self::StartService),
            "tray_stop_service" => Some(Self::StopService),
            "tray_restart_service" => Some(Self::RestartService),
            "tray_open_data_directory" => Some(Self::OpenDataDirectory),
            "tray_open_log_directory" => Some(Self::OpenLogDirectory),
            "tray_quit" => Some(Self::Quit),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrayMenuItemSpec {
    pub id: TrayMenuItemId,
    pub label: &'static str,
    pub enabled: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopExitPlan {
    StopOwnedServiceBeforeExit,
    ExitImmediately,
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let status = app
        .try_state::<SharedDesktopCommandState>()
        .and_then(|state| {
            state
                .lock()
                .ok()
                .map(|state| state.service_snapshot().status)
        })
        .unwrap_or(ServiceStatus::Stopped);
    let menu = build_tray_menu(app, status)?;

    TrayIconBuilder::with_id(TRAY_ID)
        .title("CliRelay")
        .tooltip(crate::APP_DISPLAY_NAME)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event)
        .build(app)?;

    Ok(())
}

pub fn refresh_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    status: ServiceStatus,
) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    let menu = build_tray_menu(app, status)?;
    tray.set_menu(Some(menu))
}

pub fn tray_menu_items(status: ServiceStatus) -> Vec<TrayMenuItemSpec> {
    let mut items = vec![
        TrayMenuItemSpec::disabled(TrayMenuItemId::StatusTitle, status_title(&status)),
        TrayMenuItemSpec::enabled(TrayMenuItemId::OpenPanel, LABEL_OPEN_PANEL),
    ];

    items.extend(service_action_items(&status));
    items.extend([
        //TrayMenuItemSpec::enabled(TrayMenuItemId::OpenDataDirectory, LABEL_OPEN_DATA_DIR),
        //TrayMenuItemSpec::enabled(TrayMenuItemId::OpenLogDirectory, LABEL_OPEN_LOG_DIR),
        TrayMenuItemSpec::enabled(TrayMenuItemId::Settings, LABEL_SETTINGS),
        TrayMenuItemSpec::enabled(TrayMenuItemId::Quit, LABEL_QUIT),
    ]);

    items
}

pub fn desktop_exit_plan(status: ServiceStatus) -> DesktopExitPlan {
    match status {
        ServiceStatus::Running | ServiceStatus::Unhealthy => {
            DesktopExitPlan::StopOwnedServiceBeforeExit
        }
        ServiceStatus::Stopped
        | ServiceStatus::Starting
        | ServiceStatus::Stopping
        | ServiceStatus::External
        | ServiceStatus::Error => DesktopExitPlan::ExitImmediately,
    }
}

pub fn request_desktop_exit<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = try_request_desktop_exit(app) {
        eprintln!("退出 CliRelay Desktop 失败: {error}");
        let _ = crate::windows::main::show_status_window(app);
    }
}

fn try_request_desktop_exit<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    let status = current_service_snapshot(app)?.status;

    if desktop_exit_plan(status) == DesktopExitPlan::StopOwnedServiceBeforeExit {
        run_service_action(app, DesktopCommandState::stop_service)?;
    }

    app.exit(0);
    Ok(())
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    status: ServiceStatus,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    for item in tray_menu_items(status) {
        menu.append(&MenuItem::with_id(
            app,
            item.id.as_str(),
            item.label,
            item.enabled,
            None::<&str>,
        )?)?;
    }

    Ok(menu)
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let Some(item_id) = TrayMenuItemId::from_str(event.id().as_ref()) else {
        return;
    };

    if let Err(error) = handle_menu_action(app, item_id) {
        eprintln!("菜单动作执行失败: {error}");
        let _ = refresh_after_current_snapshot(app);
        let _ = crate::windows::main::show_status_window(app);
    }
}

fn handle_menu_action<R: Runtime>(
    app: &AppHandle<R>,
    item_id: TrayMenuItemId,
) -> Result<(), CommandError> {
    match item_id {
        TrayMenuItemId::StatusTitle => Ok(()),
        TrayMenuItemId::OpenPanel => open_panel_from_tray(app),
        TrayMenuItemId::Settings => {
            crate::windows::settings::show_settings_window(app).map_err(CommandError::from)
        }
        TrayMenuItemId::StartService => run_service_action(app, DesktopCommandState::start_service),
        TrayMenuItemId::StopService => run_service_action(app, DesktopCommandState::stop_service),
        TrayMenuItemId::RestartService => {
            run_service_action(app, DesktopCommandState::restart_service)
        }
        TrayMenuItemId::OpenDataDirectory => open_desktop_path(app, DesktopPathTarget::Data),
        TrayMenuItemId::OpenLogDirectory => open_desktop_path(app, DesktopPathTarget::Log),
        TrayMenuItemId::Quit => {
            request_desktop_exit(app);
            Ok(())
        }
    }
}

fn open_panel_from_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    let snapshot = current_service_snapshot(app)?;

    if snapshot.status == ServiceStatus::Running {
        crate::windows::panel::show_panel_window(app, snapshot.port)?;
    } else {
        crate::windows::main::show_status_window(app)?;
    }

    Ok(())
}

fn current_service_snapshot<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ServiceSnapshot, CommandError> {
    let state = app
        .try_state::<SharedDesktopCommandState>()
        .ok_or(CommandError::NotInitialized)?;
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;

    Ok(state.service_snapshot())
}

fn run_service_action<R: Runtime>(
    app: &AppHandle<R>,
    action: fn(&mut DesktopCommandState) -> Result<ServiceSnapshot, ManagerError>,
) -> Result<(), CommandError> {
    let (result, snapshot) = {
        let state = app
            .try_state::<SharedDesktopCommandState>()
            .ok_or(CommandError::NotInitialized)?;
        let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        let result = action(&mut state);
        let snapshot = state.service_snapshot();

        (result, snapshot)
    };

    let _ = refresh_tray_menu(app, snapshot.status);
    result.map(|_| ()).map_err(CommandError::from)
}

fn refresh_after_current_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    let snapshot = current_service_snapshot(app)?;
    refresh_tray_menu(app, snapshot.status).map_err(CommandError::from)
}

enum DesktopPathTarget {
    Data,
    Log,
}

fn open_desktop_path<R: Runtime>(
    app: &AppHandle<R>,
    target: DesktopPathTarget,
) -> Result<(), CommandError> {
    let path = {
        let state = app
            .try_state::<SharedDesktopCommandState>()
            .ok_or(CommandError::NotInitialized)?;
        let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;

        match target {
            DesktopPathTarget::Data => state.paths().app_data_dir.clone(),
            DesktopPathTarget::Log => state.paths().log_dir.clone(),
        }
    };

    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|error| CommandError::Open(error.to_string()))
}

impl TrayMenuItemSpec {
    const fn enabled(id: TrayMenuItemId, label: &'static str) -> Self {
        Self {
            id,
            label,
            enabled: true,
        }
    }

    const fn disabled(id: TrayMenuItemId, label: &'static str) -> Self {
        Self {
            id,
            label,
            enabled: false,
        }
    }
}

fn status_title(status: &ServiceStatus) -> &'static str {
    match status {
        ServiceStatus::Stopped => LABEL_STATUS_STOPPED,
        ServiceStatus::Starting => LABEL_STATUS_STARTING,
        ServiceStatus::Running => LABEL_STATUS_RUNNING,
        ServiceStatus::Stopping => LABEL_STATUS_STOPPING,
        ServiceStatus::Unhealthy => LABEL_STATUS_UNHEALTHY,
        ServiceStatus::External => LABEL_STATUS_EXTERNAL,
        ServiceStatus::Error => LABEL_STATUS_ERROR,
    }
}

fn service_action_items(status: &ServiceStatus) -> Vec<TrayMenuItemSpec> {
    match status {
        ServiceStatus::Stopped => {
            vec![TrayMenuItemSpec::enabled(
                TrayMenuItemId::StartService,
                LABEL_START_SERVICE,
            )]
        }
        ServiceStatus::Running | ServiceStatus::Unhealthy => vec![
            TrayMenuItemSpec::enabled(TrayMenuItemId::StopService, LABEL_STOP_SERVICE),
            TrayMenuItemSpec::enabled(TrayMenuItemId::RestartService, LABEL_RESTART_SERVICE),
        ],
        ServiceStatus::Error => vec![
            TrayMenuItemSpec::enabled(TrayMenuItemId::StartService, LABEL_START_SERVICE),
            TrayMenuItemSpec::enabled(TrayMenuItemId::RestartService, LABEL_RESTART_SERVICE),
        ],
        ServiceStatus::Starting | ServiceStatus::Stopping | ServiceStatus::External => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::state::ServiceStatus::*;

    #[test]
    fn running_menu_matches_documented_order_without_removed_items() {
        assert_eq!(
            labels_for(Running),
            vec![
                LABEL_STATUS_RUNNING,
                LABEL_OPEN_PANEL,
                LABEL_SETTINGS,
                LABEL_STOP_SERVICE,
                LABEL_RESTART_SERVICE,
                LABEL_OPEN_DATA_DIR,
                LABEL_OPEN_LOG_DIR,
                LABEL_QUIT,
            ]
        );
    }

    #[test]
    fn service_actions_are_visible_only_for_applicable_statuses() {
        let cases: [(ServiceStatus, &[&str]); 7] = [
            (Stopped, &[LABEL_START_SERVICE]),
            (Starting, &[]),
            (Running, &[LABEL_STOP_SERVICE, LABEL_RESTART_SERVICE]),
            (Unhealthy, &[LABEL_STOP_SERVICE, LABEL_RESTART_SERVICE]),
            (Error, &[LABEL_START_SERVICE, LABEL_RESTART_SERVICE]),
            (Stopping, &[]),
            (External, &[]),
        ];

        for (status, expected) in cases {
            assert_eq!(service_action_labels_for(status), expected);
        }
    }

    #[test]
    fn menu_never_contains_removed_status_or_copy_items() {
        let labels = labels_for(Running);

        for removed_label in ["显示状态", "复制 API Base URL", "复制 OpenAI /v1 URL"] {
            assert!(
                !labels.contains(&removed_label),
                "菜单中不应再出现 {removed_label}"
            );
        }
    }

    #[test]
    fn exit_plan_stops_only_owned_service_statuses() {
        for status in [Running, Unhealthy] {
            assert_eq!(
                desktop_exit_plan(status),
                DesktopExitPlan::StopOwnedServiceBeforeExit
            );
        }

        for status in [Stopped, Starting, Stopping, Error, External] {
            assert_eq!(desktop_exit_plan(status), DesktopExitPlan::ExitImmediately);
        }
    }

    fn labels_for(status: ServiceStatus) -> Vec<&'static str> {
        tray_menu_items(status)
            .into_iter()
            .map(|item| item.label)
            .collect()
    }

    fn service_action_labels_for(status: ServiceStatus) -> Vec<&'static str> {
        tray_menu_items(status)
            .into_iter()
            .filter(|item| {
                matches!(
                    item.id,
                    TrayMenuItemId::StartService
                        | TrayMenuItemId::StopService
                        | TrayMenuItemId::RestartService
                )
            })
            .map(|item| item.label)
            .collect()
    }
}
