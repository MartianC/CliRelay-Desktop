use crate::service::state::ServiceStatus;
use crate::settings::DesktopLocale;
use crate::{
    commands::{CommandError, DesktopCommandState, SharedDesktopCommandState},
    service::manager::{ManagerError, ServiceSnapshot},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

pub const TRAY_ID: &str = "clirelay-desktop-tray";
const TRAY_ICON: Image<'_> = tauri::include_image!("./icons/tray-template.png");
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
pub const LABEL_STATUS_RUNNING_EN: &str = "CliRelay ● Running";
pub const LABEL_STATUS_STOPPED_EN: &str = "CliRelay ● Stopped";
pub const LABEL_STATUS_STARTING_EN: &str = "CliRelay ● Starting";
pub const LABEL_STATUS_STOPPING_EN: &str = "CliRelay ● Stopping";
pub const LABEL_STATUS_UNHEALTHY_EN: &str = "CliRelay ● Unhealthy";
pub const LABEL_STATUS_EXTERNAL_EN: &str = "CliRelay ● External service";
pub const LABEL_STATUS_ERROR_EN: &str = "CliRelay ● Error";
pub const LABEL_OPEN_PANEL_EN: &str = "Open management panel";
pub const LABEL_SETTINGS_EN: &str = "Settings";
pub const LABEL_START_SERVICE_EN: &str = "Start service";
pub const LABEL_STOP_SERVICE_EN: &str = "Stop service";
pub const LABEL_RESTART_SERVICE_EN: &str = "Restart";
pub const LABEL_OPEN_DATA_DIR_EN: &str = "Open data directory";
pub const LABEL_OPEN_LOG_DIR_EN: &str = "Open log directory";
pub const LABEL_QUIT_EN: &str = "Quit CliRelay Desktop";

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
        .icon(TRAY_ICON)
        .icon_as_template(true)
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

pub fn tray_menu_items(status: ServiceStatus, locale: DesktopLocale) -> Vec<TrayMenuItemSpec> {
    let mut items = vec![
        TrayMenuItemSpec::disabled(TrayMenuItemId::StatusTitle, status_title(&status, locale)),
        TrayMenuItemSpec::enabled(TrayMenuItemId::OpenPanel, open_panel_label(locale)),
    ];

    items.extend(service_action_items(&status, locale));
    items.extend([
        //TrayMenuItemSpec::enabled(TrayMenuItemId::OpenDataDirectory, LABEL_OPEN_DATA_DIR),
        //TrayMenuItemSpec::enabled(TrayMenuItemId::OpenLogDirectory, LABEL_OPEN_LOG_DIR),
        TrayMenuItemSpec::enabled(TrayMenuItemId::Settings, settings_label(locale)),
        TrayMenuItemSpec::enabled(TrayMenuItemId::Quit, quit_label(locale)),
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
    let locale = current_locale(app);

    for item in tray_menu_items(status, locale) {
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

pub fn refresh_after_current_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<(), CommandError> {
    let snapshot = current_service_snapshot(app)?;
    refresh_tray_menu(app, snapshot.status).map_err(CommandError::from)
}

fn current_locale<R: Runtime>(app: &AppHandle<R>) -> DesktopLocale {
    app.try_state::<SharedDesktopCommandState>()
        .and_then(|state| state.lock().ok().map(|state| state.locale()))
        .unwrap_or_default()
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

fn status_title(status: &ServiceStatus, locale: DesktopLocale) -> &'static str {
    match (status, locale) {
        (ServiceStatus::Stopped, DesktopLocale::ZhCn) => LABEL_STATUS_STOPPED,
        (ServiceStatus::Starting, DesktopLocale::ZhCn) => LABEL_STATUS_STARTING,
        (ServiceStatus::Running, DesktopLocale::ZhCn) => LABEL_STATUS_RUNNING,
        (ServiceStatus::Stopping, DesktopLocale::ZhCn) => LABEL_STATUS_STOPPING,
        (ServiceStatus::Unhealthy, DesktopLocale::ZhCn) => LABEL_STATUS_UNHEALTHY,
        (ServiceStatus::External, DesktopLocale::ZhCn) => LABEL_STATUS_EXTERNAL,
        (ServiceStatus::Error, DesktopLocale::ZhCn) => LABEL_STATUS_ERROR,
        (ServiceStatus::Stopped, DesktopLocale::En) => LABEL_STATUS_STOPPED_EN,
        (ServiceStatus::Starting, DesktopLocale::En) => LABEL_STATUS_STARTING_EN,
        (ServiceStatus::Running, DesktopLocale::En) => LABEL_STATUS_RUNNING_EN,
        (ServiceStatus::Stopping, DesktopLocale::En) => LABEL_STATUS_STOPPING_EN,
        (ServiceStatus::Unhealthy, DesktopLocale::En) => LABEL_STATUS_UNHEALTHY_EN,
        (ServiceStatus::External, DesktopLocale::En) => LABEL_STATUS_EXTERNAL_EN,
        (ServiceStatus::Error, DesktopLocale::En) => LABEL_STATUS_ERROR_EN,
    }
}

fn service_action_items(status: &ServiceStatus, locale: DesktopLocale) -> Vec<TrayMenuItemSpec> {
    match status {
        ServiceStatus::Stopped => {
            vec![TrayMenuItemSpec::enabled(
                TrayMenuItemId::StartService,
                start_service_label(locale),
            )]
        }
        ServiceStatus::Running | ServiceStatus::Unhealthy => vec![
            TrayMenuItemSpec::enabled(TrayMenuItemId::StopService, stop_service_label(locale)),
            TrayMenuItemSpec::enabled(
                TrayMenuItemId::RestartService,
                restart_service_label(locale),
            ),
        ],
        ServiceStatus::Error => vec![
            TrayMenuItemSpec::enabled(TrayMenuItemId::StartService, start_service_label(locale)),
            TrayMenuItemSpec::enabled(
                TrayMenuItemId::RestartService,
                restart_service_label(locale),
            ),
        ],
        ServiceStatus::Starting | ServiceStatus::Stopping | ServiceStatus::External => Vec::new(),
    }
}

fn open_panel_label(locale: DesktopLocale) -> &'static str {
    match locale {
        DesktopLocale::ZhCn => LABEL_OPEN_PANEL,
        DesktopLocale::En => LABEL_OPEN_PANEL_EN,
    }
}

fn settings_label(locale: DesktopLocale) -> &'static str {
    match locale {
        DesktopLocale::ZhCn => LABEL_SETTINGS,
        DesktopLocale::En => LABEL_SETTINGS_EN,
    }
}

fn start_service_label(locale: DesktopLocale) -> &'static str {
    match locale {
        DesktopLocale::ZhCn => LABEL_START_SERVICE,
        DesktopLocale::En => LABEL_START_SERVICE_EN,
    }
}

fn stop_service_label(locale: DesktopLocale) -> &'static str {
    match locale {
        DesktopLocale::ZhCn => LABEL_STOP_SERVICE,
        DesktopLocale::En => LABEL_STOP_SERVICE_EN,
    }
}

fn restart_service_label(locale: DesktopLocale) -> &'static str {
    match locale {
        DesktopLocale::ZhCn => LABEL_RESTART_SERVICE,
        DesktopLocale::En => LABEL_RESTART_SERVICE_EN,
    }
}

fn quit_label(locale: DesktopLocale) -> &'static str {
    match locale {
        DesktopLocale::ZhCn => LABEL_QUIT,
        DesktopLocale::En => LABEL_QUIT_EN,
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
                LABEL_STOP_SERVICE,
                LABEL_RESTART_SERVICE,
                LABEL_SETTINGS,
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

    #[test]
    fn tray_labels_follow_english_locale() {
        let labels = tray_menu_items(Running, crate::settings::DesktopLocale::En)
            .into_iter()
            .map(|item| item.label)
            .collect::<Vec<_>>();

        assert!(labels.contains(&"Open management panel"));
        assert!(labels.contains(&"Settings"));
        assert!(labels.contains(&"Quit CliRelay Desktop"));
    }

    fn labels_for(status: ServiceStatus) -> Vec<&'static str> {
        tray_menu_items(status, crate::settings::DesktopLocale::ZhCn)
            .into_iter()
            .map(|item| item.label)
            .collect()
    }

    fn service_action_labels_for(status: ServiceStatus) -> Vec<&'static str> {
        tray_menu_items(status, crate::settings::DesktopLocale::ZhCn)
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
