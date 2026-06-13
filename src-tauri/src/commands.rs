use crate::service::manager::{
    ManagerError, ServiceManager, ServiceManagerConfig, ServiceSnapshot,
};
use crate::service::state::ServiceStatus;
use crate::settings::{load_or_create_settings, save_settings, DesktopSettings, SettingsError};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

pub const SAFE_COMMAND_NAMES: [&str; 13] = [
    "get_service_snapshot",
    "start_service",
    "stop_service",
    "restart_service",
    "open_panel",
    "open_settings",
    "open_log_directory",
    "open_data_directory",
    "copy_endpoint",
    "copy_v1_endpoint",
    "get_desktop_settings",
    "update_desktop_settings",
    "check_for_updates",
];

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "code", content = "details")]
pub enum CommandError {
    NotInitialized,
    StateLockPoisoned,
    PanelNotReady(ServiceStatus),
    ForbiddenSettingsField(String),
    InvalidSettingsPatch(String),
    InvalidPort(u16),
    PortChangeRequiresStopped,
    Io(String),
    Settings(String),
    Manager(String),
    Path(String),
    Window(String),
    Open(String),
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotInitialized => write!(formatter, "Desktop command state 尚未初始化"),
            Self::StateLockPoisoned => write!(formatter, "Desktop command state 锁已损坏"),
            Self::PanelNotReady(status) => {
                write!(formatter, "Panel 尚未 ready，当前服务状态: {status:?}")
            }
            Self::ForbiddenSettingsField(field) => write!(formatter, "不允许修改设置字段: {field}"),
            Self::InvalidSettingsPatch(message) => write!(formatter, "设置 patch 无效: {message}"),
            Self::InvalidPort(port) => write!(formatter, "端口必须在 1024-65535 范围内: {port}"),
            Self::PortChangeRequiresStopped => write!(formatter, "修改端口前必须先停止服务"),
            Self::Io(message) => write!(formatter, "{message}"),
            Self::Settings(message) => write!(formatter, "{message}"),
            Self::Manager(message) => write!(formatter, "{message}"),
            Self::Path(message) => write!(formatter, "{message}"),
            Self::Window(message) => write!(formatter, "{message}"),
            Self::Open(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for CommandError {}

impl From<io::Error> for CommandError {
    fn from(error: io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

impl From<SettingsError> for CommandError {
    fn from(error: SettingsError) -> Self {
        Self::Settings(error.to_string())
    }
}

impl From<ManagerError> for CommandError {
    fn from(error: ManagerError) -> Self {
        Self::Manager(error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::Window(error.to_string())
    }
}

pub type SharedDesktopCommandState = Mutex<DesktopCommandState>;

pub struct DesktopCommandState {
    paths: crate::paths::DesktopPaths,
    settings: DesktopSettings,
    manager: ServiceManager,
}

impl DesktopCommandState {
    pub fn new(
        paths: crate::paths::DesktopPaths,
        settings: DesktopSettings,
        manager: ServiceManager,
    ) -> Self {
        Self {
            paths,
            settings,
            manager,
        }
    }

    pub fn from_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self, CommandError> {
        let home_dir = app
            .path()
            .home_dir()
            .map_err(|error| CommandError::Path(error.to_string()))?;
        let paths = crate::paths::DesktopPaths::from_home_dir(home_dir);
        let settings = load_or_create_settings(&paths)?;
        let resources = ResourcePaths::resolve(app)?;
        let manager_config = ServiceManagerConfig::new(
            paths.clone(),
            settings.clone(),
            resources.config_example,
            resources.panel_dir,
            resources.sidecar_executable,
        );
        let manager = ServiceManager::new(manager_config);

        Ok(Self::new(paths, settings, manager))
    }

    pub fn paths(&self) -> &crate::paths::DesktopPaths {
        &self.paths
    }

    pub fn service_snapshot(&self) -> ServiceSnapshot {
        self.manager.snapshot()
    }
}

struct ResourcePaths {
    config_example: PathBuf,
    panel_dir: PathBuf,
    sidecar_executable: PathBuf,
}

impl ResourcePaths {
    fn resolve<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<Self, CommandError> {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|error| CommandError::Path(error.to_string()))?;

        Ok(Self {
            config_example: first_existing_path([
                resource_dir.join("resources").join("config.example.yaml"),
                manifest_dir.join("resources").join("config.example.yaml"),
            ]),
            panel_dir: first_existing_path([
                resource_dir.join("resources").join("panel"),
                manifest_dir.join("resources").join("panel"),
            ]),
            sidecar_executable: first_existing_path([
                resource_dir
                    .join("binaries")
                    .join("clirelay-aarch64-apple-darwin"),
                resource_dir.join("clirelay-aarch64-apple-darwin"),
                manifest_dir
                    .join("binaries")
                    .join("clirelay-aarch64-apple-darwin"),
            ]),
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DesktopSettingsPatch {
    pub auto_start_app: Option<bool>,
    pub auto_start_service: Option<bool>,
    pub open_panel_on_start: Option<bool>,
    pub port: Option<u16>,
    pub auto_check_new_versions: Option<bool>,
}

impl DesktopSettingsPatch {
    pub fn from_value(value: Value) -> Result<Self, CommandError> {
        let raw = serde_json::from_value::<RawDesktopSettingsPatch>(value)
            .map_err(|error| CommandError::InvalidSettingsPatch(error.to_string()))?;

        if let Some(field) = raw.extra.keys().next() {
            return Err(CommandError::ForbiddenSettingsField(field.clone()));
        }

        Ok(Self {
            auto_start_app: raw.auto_start_app,
            auto_start_service: raw.auto_start_service,
            open_panel_on_start: raw.open_panel_on_start,
            port: raw.port,
            auto_check_new_versions: raw.auto_check_new_versions,
        })
    }
}

impl<'de> Deserialize<'de> for DesktopSettingsPatch {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = Value::deserialize(deserializer)?;
        Self::from_value(value).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Deserialize)]
struct RawDesktopSettingsPatch {
    #[serde(default)]
    auto_start_app: Option<bool>,
    #[serde(default)]
    auto_start_service: Option<bool>,
    #[serde(default)]
    open_panel_on_start: Option<bool>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    auto_check_new_versions: Option<bool>,
    #[serde(flatten)]
    extra: BTreeMap<String, Value>,
}

pub fn apply_desktop_settings_patch(
    current: &DesktopSettings,
    service_status: ServiceStatus,
    patch: DesktopSettingsPatch,
) -> Result<DesktopSettings, CommandError> {
    let mut updated = current.clone();

    if let Some(auto_start_app) = patch.auto_start_app {
        updated.auto_start_app = auto_start_app;
    }

    if let Some(auto_start_service) = patch.auto_start_service {
        updated.auto_start_service = auto_start_service;
    }

    if let Some(open_panel_on_start) = patch.open_panel_on_start {
        updated.open_panel_on_start = open_panel_on_start;
    }

    if let Some(auto_check_new_versions) = patch.auto_check_new_versions {
        updated.auto_check_new_versions = auto_check_new_versions;
    }

    if let Some(port) = patch.port {
        if service_status != ServiceStatus::Stopped {
            return Err(CommandError::PortChangeRequiresStopped);
        }

        DesktopSettings::validate_port(port).map_err(|_| CommandError::InvalidPort(port))?;
        updated.port = port;
    }

    Ok(updated)
}

pub fn endpoint_url(snapshot: &ServiceSnapshot) -> String {
    format!("http://127.0.0.1:{}", snapshot.port)
}

pub fn v1_endpoint_url(snapshot: &ServiceSnapshot) -> String {
    format!("{}/v1", endpoint_url(snapshot))
}

#[tauri::command]
pub fn get_service_snapshot(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(state.manager.snapshot())
}

#[tauri::command]
pub fn start_service(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    state.manager.start_service().map_err(CommandError::from)
}

#[tauri::command]
pub fn stop_service(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    state.manager.stop_service().map_err(CommandError::from)
}

#[tauri::command]
pub fn restart_service(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    state.manager.restart_service().map_err(CommandError::from)
}

#[tauri::command]
pub fn open_panel(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<String, CommandError> {
    let snapshot = {
        let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        state.manager.snapshot()
    };

    if snapshot.status != ServiceStatus::Running {
        return Err(CommandError::PanelNotReady(snapshot.status));
    }

    crate::windows::panel::show_panel_window(&app, snapshot.port)?;

    Ok(snapshot.panel_url)
}

#[tauri::command]
pub fn open_settings(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::windows::settings::show_settings_window(&app)?;
    Ok(())
}

#[tauri::command]
pub fn open_log_directory(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<(), CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    open_path(&state.paths.log_dir)
}

#[tauri::command]
pub fn open_data_directory(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<(), CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    open_path(&state.paths.app_data_dir)
}

#[tauri::command]
pub fn copy_endpoint(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<String, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(endpoint_url(&state.manager.snapshot()))
}

#[tauri::command]
pub fn copy_v1_endpoint(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<String, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(v1_endpoint_url(&state.manager.snapshot()))
}

#[tauri::command]
pub fn get_desktop_settings(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<DesktopSettings, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(state.settings.clone())
}

#[tauri::command]
pub fn update_desktop_settings(
    state: tauri::State<'_, SharedDesktopCommandState>,
    patch: DesktopSettingsPatch,
) -> Result<DesktopSettings, CommandError> {
    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    let status = state.manager.snapshot().status;
    let updated = apply_desktop_settings_patch(&state.settings, status, patch)?;

    save_settings(&state.paths, &updated)?;
    state.manager.update_settings(updated.clone());
    state.settings = updated.clone();

    Ok(updated)
}

#[tauri::command]
pub fn check_for_updates() -> Result<(), CommandError> {
    Err(CommandError::NotInitialized)
}

fn open_path(path: &Path) -> Result<(), CommandError> {
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|error| CommandError::Open(error.to_string()))
}

fn first_existing_path<const N: usize>(paths: [PathBuf; N]) -> PathBuf {
    paths
        .iter()
        .find(|path| path.exists())
        .cloned()
        .unwrap_or_else(|| paths[0].clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::manager::ServiceSnapshot;
    use crate::service::ownership::ProcessOwnership;
    use crate::service::state::ServiceStatus;
    use crate::settings::DesktopSettings;
    use serde_json::json;

    #[test]
    fn command_names_match_safe_whitelist() {
        assert_eq!(
            SAFE_COMMAND_NAMES,
            [
                "get_service_snapshot",
                "start_service",
                "stop_service",
                "restart_service",
                "open_panel",
                "open_settings",
                "open_log_directory",
                "open_data_directory",
                "copy_endpoint",
                "copy_v1_endpoint",
                "get_desktop_settings",
                "update_desktop_settings",
                "check_for_updates",
            ]
        );
        assert!(!SAFE_COMMAND_NAMES.contains(&"greet"));
    }

    #[test]
    fn rejects_port_patch_while_service_is_running() {
        let settings = DesktopSettings::default();
        let patch =
            DesktopSettingsPatch::from_value(json!({ "port": 8318 })).expect("patch 解析应成功");

        let error =
            apply_desktop_settings_patch(&settings, ServiceStatus::Running, patch).unwrap_err();

        assert!(matches!(error, CommandError::PortChangeRequiresStopped));
    }

    #[test]
    fn accepts_port_patch_when_service_is_stopped() {
        let settings = DesktopSettings::default();
        let patch =
            DesktopSettingsPatch::from_value(json!({ "port": 8318 })).expect("patch 解析应成功");

        let updated =
            apply_desktop_settings_patch(&settings, ServiceStatus::Stopped, patch).unwrap();

        assert_eq!(updated.port, 8318);
    }

    #[test]
    fn rejects_forbidden_settings_fields() {
        let error = DesktopSettingsPatch::from_value(json!({ "first_run_completed": true }))
            .expect_err("非白名单字段应被拒绝");

        assert!(matches!(
            error,
            CommandError::ForbiddenSettingsField(field) if field == "first_run_completed"
        ));
    }

    #[test]
    fn endpoint_urls_are_derived_from_snapshot_port() {
        let snapshot = service_snapshot(8317);

        assert_eq!(endpoint_url(&snapshot), "http://127.0.0.1:8317");
        assert_eq!(v1_endpoint_url(&snapshot), "http://127.0.0.1:8317/v1");
    }

    fn service_snapshot(port: u16) -> ServiceSnapshot {
        let endpoint = format!("http://127.0.0.1:{port}");

        ServiceSnapshot {
            status: ServiceStatus::Stopped,
            pid: None,
            port,
            endpoint: endpoint.clone(),
            panel_url: format!("{endpoint}/manage"),
            started_at: None,
            last_exit_code: None,
            last_error: None,
            ownership: ProcessOwnership::Unknown,
            clirelay_version: "test".to_string(),
            sidecar_sha256: "test".to_string(),
        }
    }
}
