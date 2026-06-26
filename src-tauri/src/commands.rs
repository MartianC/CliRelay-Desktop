use crate::component_update::{
    apply_prepared_clirelay_update, apply_prepared_codeproxy_update, current_component_versions,
    current_sidecar_sha256, prepare_clirelay_update, prepare_codeproxy_update,
    ComponentUpdateError, PreparedComponentUpdate,
};
use crate::service::logs::append_desktop_log_line;
use crate::service::manager::{
    ManagerError, ServiceManager, ServiceManagerConfig, ServiceSnapshot,
};
use crate::service::ownership::ProcessOwnership;
use crate::service::state::ServiceStatus;
use crate::settings::{load_or_create_settings, save_settings, DesktopSettings, SettingsError};
use crate::settings::{
    read_management_secret_state, write_management_secret_key, DesktopLocale,
    ManagementSecretStatus, RuntimeConfigStatus,
};
use crate::update_check::{
    build_update_check_result, component_releases_api_url, fetch_github_releases,
    fetch_latest_preview, select_component_release, ComponentUpdateCandidate, CurrentVersions,
    LatestPreview, UpdateCheckResult, UpstreamComponent, UpstreamInstallScope,
};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::fmt;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub const SAFE_COMMAND_NAMES: [&str; 22] = [
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
    "get_runtime_config_status",
    "import_runtime_config",
    "initialize_default_runtime_config",
    "get_management_secret_status",
    "set_management_secret_key",
    "quit_desktop",
    "check_for_updates",
    "get_component_update_preparation",
    "prepare_upstream_component_updates",
    "apply_prepared_component_updates",
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
    Update(String),
    ComponentUpdate(String),
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
            Self::Update(message) => write!(formatter, "{message}"),
            Self::ComponentUpdate(message) => write!(formatter, "{message}"),
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

impl From<crate::update_check::UpdateCheckError> for CommandError {
    fn from(error: crate::update_check::UpdateCheckError) -> Self {
        Self::Update(error.to_string())
    }
}

impl From<ComponentUpdateError> for CommandError {
    fn from(error: ComponentUpdateError) -> Self {
        Self::ComponentUpdate(error.to_string())
    }
}

impl From<tauri::Error> for CommandError {
    fn from(error: tauri::Error) -> Self {
        Self::Window(error.to_string())
    }
}

pub type SharedDesktopCommandState = Arc<Mutex<DesktopCommandState>>;

pub type SharedComponentPreparationRuntime = Arc<Mutex<ComponentPreparationRuntime>>;

#[derive(Debug, Default)]
pub struct ComponentPreparationRuntime {
    snapshot: ComponentUpdatePreparationSnapshot,
    prepared: Option<PreparedComponentUpdate>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ComponentUpdatePreparationSnapshot {
    pub status: ComponentPreparationStatus,
    pub install_scope: UpstreamInstallScope,
    pub message: String,
    pub started_at: Option<chrono::DateTime<chrono::Utc>>,
    pub finished_at: Option<chrono::DateTime<chrono::Utc>>,
    pub error: Option<String>,
}

impl Default for ComponentUpdatePreparationSnapshot {
    fn default() -> Self {
        Self {
            status: ComponentPreparationStatus::Idle,
            install_scope: UpstreamInstallScope::None,
            message: String::new(),
            started_at: None,
            finished_at: None,
            error: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub enum ComponentPreparationStatus {
    #[default]
    Idle,
    Preparing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct ComponentApplyResult {
    pub status: ComponentApplyStatus,
    pub message: String,
    pub applied_scope: UpstreamInstallScope,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum ComponentApplyStatus {
    Applied,
    NoPreparedUpdate,
}

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
        let sidecar_executable = paths.runtime_sidecar_executable.clone();
        let (clirelay_version, code_proxy_version) = current_component_versions(&paths);
        let sidecar_sha256 = current_sidecar_sha256(&paths);
        let desktop_version = app.package_info().version.to_string();
        let manager_config = ServiceManagerConfig::new(
            paths.clone(),
            settings.clone(),
            resources.panel_dir,
            sidecar_executable,
            resources.sidecar_executable.clone(),
            desktop_version,
        );
        let mut manager_config = manager_config;
        manager_config.clirelay_version = clirelay_version;
        manager_config.code_proxy_version = code_proxy_version;
        manager_config.sidecar_sha256 = sidecar_sha256;
        let manager = ServiceManager::new(manager_config);

        Ok(Self::new(paths, settings, manager))
    }

    pub fn paths(&self) -> &crate::paths::DesktopPaths {
        &self.paths
    }

    pub fn service_snapshot(&self) -> ServiceSnapshot {
        self.manager.snapshot()
    }

    pub fn locale(&self) -> DesktopLocale {
        self.settings.locale
    }

    pub fn open_panel_on_start(&self) -> bool {
        self.settings.open_panel_on_start
    }

    pub fn start_service(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        self.manager.start_service()
    }

    pub fn stop_service(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        self.manager.stop_service()
    }

    pub fn restart_service(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        self.manager.restart_service()
    }

    pub fn current_versions(&self) -> CurrentVersions {
        let (clirelay, code_proxy) = current_component_versions(&self.paths);
        CurrentVersions {
            desktop: self.manager.desktop_version().to_string(),
            clirelay,
            code_proxy,
        }
    }

    pub fn refresh_runtime_components(&mut self) {
        let sidecar_executable = self.paths.runtime_sidecar_executable.clone();
        let (clirelay_version, code_proxy_version) = current_component_versions(&self.paths);
        let sidecar_sha256 = current_sidecar_sha256(&self.paths);
        self.manager.refresh_runtime_components(
            sidecar_executable,
            clirelay_version,
            code_proxy_version,
            sidecar_sha256,
        );
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
            sidecar_executable: resolve_sidecar_executable(&resource_dir, &manifest_dir),
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
    pub locale: Option<DesktopLocale>,
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
            locale: raw.locale,
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
    #[serde(default)]
    locale: Option<DesktopLocale>,
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

    if let Some(locale) = patch.locale {
        updated.locale = locale;
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
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    run_service_command(&app, state, DesktopCommandState::start_service)
}

#[tauri::command]
pub fn stop_service(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    run_service_command(&app, state, DesktopCommandState::stop_service)
}

#[tauri::command]
pub fn restart_service(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ServiceSnapshot, CommandError> {
    run_service_command(&app, state, DesktopCommandState::restart_service)
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
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
    patch: DesktopSettingsPatch,
) -> Result<DesktopSettings, CommandError> {
    let (updated, locale_changed) = {
        let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        let status = state.manager.snapshot().status;
        let previous_locale = state.settings.locale;
        let updated = apply_desktop_settings_patch(&state.settings, status, patch)?;
        let locale_changed = updated.locale != previous_locale;

        save_settings(&state.paths, &updated)?;
        state.manager.update_settings(updated.clone());
        state.settings = updated.clone();

        (updated, locale_changed)
    };

    if locale_changed {
        let _ = crate::tray::refresh_after_current_snapshot(&app);
        let _ = crate::windows::panel::sync_panel_language(&app, updated.locale, true);
    }

    Ok(updated)
}

#[tauri::command]
pub fn get_runtime_config_status(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<RuntimeConfigStatus, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(crate::settings::runtime_config_status(&state.paths))
}

#[tauri::command]
pub fn import_runtime_config(
    state: tauri::State<'_, SharedDesktopCommandState>,
    source_path: String,
) -> Result<RuntimeConfigStatus, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    crate::settings::import_runtime_config_file(&state.paths, PathBuf::from(source_path))?;
    Ok(crate::settings::runtime_config_status(&state.paths))
}

#[tauri::command]
pub fn initialize_default_runtime_config(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<RuntimeConfigStatus, CommandError> {
    let resources = ResourcePaths::resolve(&app)?;
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    crate::settings::initialize_default_runtime_config(
        &state.paths,
        resources.config_example,
        &state.settings,
    )?;
    Ok(crate::settings::runtime_config_status(&state.paths))
}

#[tauri::command]
pub fn get_management_secret_status(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<ManagementSecretStatus, CommandError> {
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(read_management_secret_state(&state.paths)?)
}

#[tauri::command]
pub fn set_management_secret_key(
    state: tauri::State<'_, SharedDesktopCommandState>,
    secret_key: String,
) -> Result<ManagementSecretStatus, CommandError> {
    let secret_key = validate_management_secret_key(&secret_key)?;
    let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    write_management_secret_key(&state.paths, secret_key)?;
    Ok(ManagementSecretStatus::Configured)
}

#[tauri::command]
pub fn quit_desktop(app: tauri::AppHandle) -> Result<(), CommandError> {
    crate::tray::request_desktop_exit(&app);
    Ok(())
}

pub fn validate_management_secret_key(value: &str) -> Result<&str, CommandError> {
    if value.trim().is_empty() {
        return Err(CommandError::InvalidSettingsPatch(
            "管理密钥不能为空".to_string(),
        ));
    }

    Ok(value)
}

#[tauri::command]
pub async fn check_for_updates(
    state: tauri::State<'_, SharedDesktopCommandState>,
) -> Result<UpdateCheckResult, CommandError> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || check_for_updates_blocking(&state))
        .await
        .map_err(|error| CommandError::Update(format!("更新检查后台任务失败: {error}")))?
}

fn check_for_updates_blocking(
    state: &SharedDesktopCommandState,
) -> Result<UpdateCheckResult, CommandError> {
    let current = {
        let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        state.current_versions()
    };
    let paths = {
        let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        state.paths.clone()
    };

    let (latest_preview_result, clirelay_candidate_result, codeproxy_candidate_result) =
        fetch_update_sources_concurrently(
            || fetch_latest_preview().map_err(CommandError::from),
            || fetch_component_candidate(UpstreamComponent::CliRelay),
            || fetch_component_candidate(UpstreamComponent::CodeProxy),
        );

    let latest_preview = match latest_preview_result {
        Ok(preview) => Some(preview),
        Err(error) => {
            let _ = append_desktop_log_line(&paths, &format!("Desktop 更新检查失败: {error}"));
            None
        }
    };
    let clirelay_candidate = match clirelay_candidate_result {
        Ok(candidate) => candidate,
        Err(error) => {
            let _ = append_desktop_log_line(&paths, &format!("CliRelay 更新检查失败: {error}"));
            None
        }
    };
    let codeproxy_candidate = match codeproxy_candidate_result {
        Ok(candidate) => candidate,
        Err(error) => {
            let _ = append_desktop_log_line(&paths, &format!("codeProxy 更新检查失败: {error}"));
            None
        }
    };
    let checked_at = chrono::Utc::now();
    let result = build_update_check_result(
        current,
        latest_preview,
        clirelay_candidate,
        codeproxy_candidate,
        checked_at,
    );

    {
        let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        state.settings.last_update_check_at = Some(checked_at);
        state.settings.last_update_check_result = Some(result.clone());
        save_settings(&state.paths, &state.settings)?;
    }

    Ok(result)
}

#[tauri::command]
pub fn get_component_update_preparation(
    preparation: tauri::State<'_, SharedComponentPreparationRuntime>,
) -> Result<ComponentUpdatePreparationSnapshot, CommandError> {
    let preparation = preparation
        .lock()
        .map_err(|_| CommandError::StateLockPoisoned)?;
    Ok(preparation.snapshot.clone())
}

#[tauri::command]
pub fn prepare_upstream_component_updates(
    state: tauri::State<'_, SharedDesktopCommandState>,
    preparation: tauri::State<'_, SharedComponentPreparationRuntime>,
    install_scope: UpstreamInstallScope,
) -> Result<ComponentUpdatePreparationSnapshot, CommandError> {
    if install_scope == UpstreamInstallScope::None {
        return Err(CommandError::ComponentUpdate(
            "没有可准备的上游组件更新".to_string(),
        ));
    }

    let started_at = chrono::Utc::now();
    let initial_snapshot = {
        let mut preparation = preparation
            .lock()
            .map_err(|_| CommandError::StateLockPoisoned)?;
        if preparation.snapshot.status == ComponentPreparationStatus::Preparing {
            return Ok(preparation.snapshot.clone());
        }

        preparation.prepared = None;
        preparation.snapshot = ComponentUpdatePreparationSnapshot {
            status: ComponentPreparationStatus::Preparing,
            install_scope,
            message: "正在后台准备组件更新".to_string(),
            started_at: Some(started_at),
            finished_at: None,
            error: None,
        };
        preparation.snapshot.clone()
    };

    let state = state.inner().clone();
    let preparation = preparation.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = prepare_upstream_component_updates_blocking(&state, install_scope);
        let mut preparation = match preparation.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        let finished_at = chrono::Utc::now();
        match result {
            Ok(prepared) => {
                let prepared_scope = prepared.install_scope;
                preparation.prepared = Some(prepared);
                preparation.snapshot = ComponentUpdatePreparationSnapshot {
                    status: ComponentPreparationStatus::Ready,
                    install_scope: prepared_scope,
                    message: "组件更新已准备好，点击重启完成替换".to_string(),
                    started_at: Some(started_at),
                    finished_at: Some(finished_at),
                    error: None,
                };
            }
            Err(error) => {
                preparation.prepared = None;
                preparation.snapshot = ComponentUpdatePreparationSnapshot {
                    status: ComponentPreparationStatus::Failed,
                    install_scope,
                    message: "组件更新准备失败".to_string(),
                    started_at: Some(started_at),
                    finished_at: Some(finished_at),
                    error: Some(error.to_string()),
                };
            }
        }
    });

    Ok(initial_snapshot)
}

fn prepare_upstream_component_updates_blocking(
    state: &SharedDesktopCommandState,
    install_scope: UpstreamInstallScope,
) -> Result<PreparedComponentUpdate, CommandError> {
    let paths = {
        let state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        state.paths.clone()
    };

    let clirelay_candidate = if matches!(
        install_scope,
        UpstreamInstallScope::CliRelay | UpstreamInstallScope::Both
    ) {
        fetch_component_candidate(UpstreamComponent::CliRelay)?
    } else {
        None
    };
    let codeproxy_candidate = if matches!(
        install_scope,
        UpstreamInstallScope::CodeProxy | UpstreamInstallScope::Both
    ) {
        fetch_component_candidate(UpstreamComponent::CodeProxy)?
    } else {
        None
    };

    let clirelay = match clirelay_candidate.as_ref() {
        Some(candidate) => Some(prepare_clirelay_update(&paths, candidate)?),
        None => None,
    };
    let code_proxy = match codeproxy_candidate.as_ref() {
        Some(candidate) => Some(prepare_codeproxy_update(&paths, candidate)?),
        None => None,
    };

    if clirelay.is_none() && code_proxy.is_none() {
        return Err(CommandError::ComponentUpdate(
            "没有可准备的上游组件更新".to_string(),
        ));
    }

    Ok(PreparedComponentUpdate {
        install_scope,
        clirelay,
        code_proxy,
        prepared_at: chrono::Utc::now(),
    })
}

#[tauri::command]
pub fn apply_prepared_component_updates(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
    preparation: tauri::State<'_, SharedComponentPreparationRuntime>,
) -> Result<ComponentApplyResult, CommandError> {
    let prepared = {
        let mut preparation = preparation
            .lock()
            .map_err(|_| CommandError::StateLockPoisoned)?;
        preparation.prepared.take()
    };

    let Some(prepared) = prepared else {
        return Ok(ComponentApplyResult {
            status: ComponentApplyStatus::NoPreparedUpdate,
            message: "没有已准备好的组件更新".to_string(),
            applied_scope: UpstreamInstallScope::None,
        });
    };

    let applied_scope = match apply_prepared_component_updates_blocking(&state, &prepared) {
        Ok(scope) => scope,
        Err(error) => {
            if let Ok(mut preparation) = preparation.lock() {
                preparation.prepared = Some(prepared);
            }
            return Err(error);
        }
    };

    {
        let mut preparation = preparation
            .lock()
            .map_err(|_| CommandError::StateLockPoisoned)?;
        preparation.snapshot = ComponentUpdatePreparationSnapshot::default();
        preparation.prepared = None;
    }

    app.request_restart();

    Ok(ComponentApplyResult {
        status: ComponentApplyStatus::Applied,
        message: "组件更新已应用，正在重启 Desktop".to_string(),
        applied_scope,
    })
}

fn apply_prepared_component_updates_blocking(
    state: &SharedDesktopCommandState,
    prepared: &PreparedComponentUpdate,
) -> Result<UpstreamInstallScope, CommandError> {
    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    let mut installed_clirelay = false;
    let mut installed_codeproxy = false;
    let mut stopped_for_apply = false;

    if let Some(artifact) = prepared.clirelay.as_ref() {
        let status = state.manager.status();
        match status {
            ServiceStatus::Running | ServiceStatus::Unhealthy => {
                if state.manager.ownership() != ProcessOwnership::Owned {
                    return Err(CommandError::ComponentUpdate(
                        "只允许更新 Desktop 自管 CliRelay 服务".to_string(),
                    ));
                }
                state.manager.stop_service()?;
                stopped_for_apply = true;
            }
            ServiceStatus::External | ServiceStatus::Starting | ServiceStatus::Stopping => {
                return Err(ComponentUpdateError::InvalidServiceStatus(status).into());
            }
            ServiceStatus::Stopped | ServiceStatus::Error => {}
        }

        apply_prepared_clirelay_update(&state.paths, artifact, state.manager.status())?;
        installed_clirelay = true;
        state.refresh_runtime_components();
    }

    if let Some(artifact) = prepared.code_proxy.as_ref() {
        apply_prepared_codeproxy_update(&state.paths, artifact)?;
        installed_codeproxy = true;
        state.refresh_runtime_components();
    }

    if stopped_for_apply {
        let _ = append_desktop_log_line(
            &state.paths,
            "组件更新已停止 CliRelay，Desktop 重启后由启动策略恢复服务",
        );
    }

    Ok(match (installed_clirelay, installed_codeproxy) {
        (true, true) => UpstreamInstallScope::Both,
        (true, false) => UpstreamInstallScope::CliRelay,
        (false, true) => UpstreamInstallScope::CodeProxy,
        (false, false) => UpstreamInstallScope::None,
    })
}

fn fetch_component_candidate(
    component: UpstreamComponent,
) -> Result<Option<ComponentUpdateCandidate>, CommandError> {
    let api_url = component_releases_api_url(component);
    let releases = fetch_github_releases(&api_url)?;
    Ok(select_component_release(&releases, component)?)
}

fn fetch_update_sources_concurrently<FetchPreview, FetchClirelay, FetchCodeProxy>(
    fetch_preview: FetchPreview,
    fetch_clirelay: FetchClirelay,
    fetch_codeproxy: FetchCodeProxy,
) -> (
    Result<LatestPreview, CommandError>,
    Result<Option<ComponentUpdateCandidate>, CommandError>,
    Result<Option<ComponentUpdateCandidate>, CommandError>,
)
where
    FetchPreview: FnOnce() -> Result<LatestPreview, CommandError> + Send,
    FetchClirelay: FnOnce() -> Result<Option<ComponentUpdateCandidate>, CommandError> + Send,
    FetchCodeProxy: FnOnce() -> Result<Option<ComponentUpdateCandidate>, CommandError> + Send,
{
    std::thread::scope(|scope| {
        let preview = scope.spawn(fetch_preview);
        let clirelay = scope.spawn(fetch_clirelay);
        let codeproxy = scope.spawn(fetch_codeproxy);

        (
            preview.join().unwrap_or_else(|_| {
                Err(CommandError::Update("Desktop 更新检查线程失败".to_string()))
            }),
            clirelay.join().unwrap_or_else(|_| {
                Err(CommandError::Update(
                    "CliRelay 更新检查线程失败".to_string(),
                ))
            }),
            codeproxy.join().unwrap_or_else(|_| {
                Err(CommandError::Update(
                    "codeProxy 更新检查线程失败".to_string(),
                ))
            }),
        )
    })
}

fn open_path(path: &Path) -> Result<(), CommandError> {
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|error| CommandError::Open(error.to_string()))
}

fn run_service_command(
    app: &tauri::AppHandle,
    state: tauri::State<'_, SharedDesktopCommandState>,
    action: fn(&mut DesktopCommandState) -> Result<ServiceSnapshot, ManagerError>,
) -> Result<ServiceSnapshot, CommandError> {
    let (result, snapshot) = {
        let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
        let result = action(&mut state);
        let snapshot = state.service_snapshot();

        (result, snapshot)
    };

    let _ = crate::tray::refresh_tray_menu(app, snapshot.status);
    result.map_err(CommandError::from)
}

fn first_existing_path<const N: usize>(paths: [PathBuf; N]) -> PathBuf {
    paths
        .iter()
        .find(|path| path.exists())
        .cloned()
        .unwrap_or_else(|| paths[0].clone())
}

fn resolve_sidecar_executable(resource_dir: &Path, manifest_dir: &Path) -> PathBuf {
    let macos_sidecar = resource_dir
        .parent()
        .map(|contents_dir| contents_dir.join("MacOS").join("clirelay"))
        .unwrap_or_else(|| resource_dir.join("clirelay"));

    first_existing_path([
        macos_sidecar,
        resource_dir
            .join("binaries")
            .join("clirelay-aarch64-apple-darwin"),
        resource_dir.join("clirelay-aarch64-apple-darwin"),
        manifest_dir
            .join("binaries")
            .join("clirelay-aarch64-apple-darwin"),
    ])
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
                "get_runtime_config_status",
                "import_runtime_config",
                "initialize_default_runtime_config",
                "get_management_secret_status",
                "set_management_secret_key",
                "quit_desktop",
                "check_for_updates",
                "get_component_update_preparation",
                "prepare_upstream_component_updates",
                "apply_prepared_component_updates",
            ]
        );
        assert!(!SAFE_COMMAND_NAMES.contains(&"greet"));
    }

    #[test]
    fn shared_command_state_can_be_moved_to_background_tasks() {
        fn assert_background_task_state<T: Clone + Send + Sync + 'static>() {}

        assert_background_task_state::<SharedDesktopCommandState>();
    }

    #[test]
    fn shared_preparation_runtime_can_be_moved_to_background_tasks() {
        fn assert_background_task_state<T: Clone + Send + Sync + 'static>() {}

        assert_background_task_state::<SharedComponentPreparationRuntime>();
    }

    #[test]
    fn preparation_snapshot_serializes_with_bridge_field_names() {
        let snapshot = ComponentUpdatePreparationSnapshot {
            status: ComponentPreparationStatus::Ready,
            install_scope: UpstreamInstallScope::Both,
            message: "组件更新已准备好，点击重启完成替换".to_string(),
            started_at: None,
            finished_at: None,
            error: None,
        };

        let value = serde_json::to_value(snapshot).expect("准备快照应可序列化");

        assert_eq!(value["status"], "Ready");
        assert_eq!(value["install_scope"], "Both");
        assert!(value.get("installScope").is_none());
    }

    #[test]
    fn update_source_fetches_run_concurrently() {
        let started_at = std::time::Instant::now();
        let delay = std::time::Duration::from_millis(150);

        let (desktop, clirelay, codeproxy) = fetch_update_sources_concurrently(
            || {
                std::thread::sleep(delay);
                Err(CommandError::Update("desktop unavailable".to_string()))
            },
            || {
                std::thread::sleep(delay);
                Ok(None)
            },
            || {
                std::thread::sleep(delay);
                Ok(None)
            },
        );

        assert!(
            started_at.elapsed() < std::time::Duration::from_millis(350),
            "三个源应并发执行，实际耗时 {:?}",
            started_at.elapsed()
        );
        assert!(matches!(desktop, Err(CommandError::Update(_))));
        assert_eq!(clirelay, Ok(None));
        assert_eq!(codeproxy, Ok(None));
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
    fn accepts_locale_settings_patch() {
        let settings = DesktopSettings::default();
        let patch = DesktopSettingsPatch::from_value(json!({ "locale": "en" }))
            .expect("locale patch 应被允许");

        let updated =
            apply_desktop_settings_patch(&settings, ServiceStatus::Stopped, patch).unwrap();

        assert_eq!(updated.locale, crate::settings::DesktopLocale::En);
    }

    #[test]
    fn rejects_empty_management_secret_key() {
        let error = validate_management_secret_key("  ").unwrap_err();

        assert!(matches!(
            error,
            CommandError::InvalidSettingsPatch(message) if message.contains("管理密钥不能为空")
        ));
    }

    #[test]
    fn trims_only_for_management_secret_validation() {
        assert_eq!(
            validate_management_secret_key("  abc  ").unwrap(),
            "  abc  "
        );
    }

    #[test]
    fn endpoint_urls_are_derived_from_snapshot_port() {
        let snapshot = service_snapshot(8317);

        assert_eq!(endpoint_url(&snapshot), "http://127.0.0.1:8317");
        assert_eq!(v1_endpoint_url(&snapshot), "http://127.0.0.1:8317/v1");
    }

    #[test]
    fn current_versions_uses_configured_desktop_app_version() {
        let paths = crate::paths::DesktopPaths::for_test(
            std::env::temp_dir().join("clirelay-desktop-command-version-app-data"),
            std::env::temp_dir().join("clirelay-desktop-command-version-logs"),
        );
        let settings = DesktopSettings::default();
        let manager_config = ServiceManagerConfig::new(
            paths.clone(),
            settings.clone(),
            PathBuf::from("panel"),
            paths.runtime_sidecar_executable.clone(),
            PathBuf::from("cli-proxy-api"),
            "9.9.9-preview.7",
        );

        let state = DesktopCommandState::new(paths, settings, ServiceManager::new(manager_config));

        assert_eq!(state.current_versions().desktop, "9.9.9-preview.7");
    }

    #[test]
    fn refresh_runtime_components_keeps_runtime_sidecar_path() {
        let paths = crate::paths::DesktopPaths::for_test(
            std::env::temp_dir().join(format!(
                "clirelay-desktop-refresh-runtime-app-data-{}",
                std::process::id()
            )),
            std::env::temp_dir().join(format!(
                "clirelay-desktop-refresh-runtime-logs-{}",
                std::process::id()
            )),
        );
        let settings = DesktopSettings::default();
        let manager_config = ServiceManagerConfig::new(
            paths.clone(),
            settings.clone(),
            PathBuf::from("panel"),
            paths.runtime_sidecar_executable.clone(),
            PathBuf::from("bundle-sidecar"),
            "9.9.9-preview.7",
        );
        let mut state =
            DesktopCommandState::new(paths.clone(), settings, ServiceManager::new(manager_config));

        state.refresh_runtime_components();

        assert_eq!(
            state.manager.sidecar_executable(),
            paths.runtime_sidecar_executable.as_path()
        );
    }

    #[test]
    fn sidecar_resolution_prefers_macos_external_bin_in_app_bundle() {
        let root = std::env::temp_dir().join(format!(
            "clirelay-desktop-sidecar-resolution-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        let resource_dir = root
            .join("CliRelay Desktop.app")
            .join("Contents")
            .join("Resources");
        let macos_dir = root
            .join("CliRelay Desktop.app")
            .join("Contents")
            .join("MacOS");
        let manifest_dir = root.join("src-tauri");
        std::fs::create_dir_all(&resource_dir).expect("创建 Resources 目录失败");
        std::fs::create_dir_all(&macos_dir).expect("创建 MacOS 目录失败");
        std::fs::create_dir_all(manifest_dir.join("binaries"))
            .expect("创建 manifest binaries 失败");
        std::fs::write(macos_dir.join("clirelay"), "bundle-sidecar")
            .expect("写入 app bundle sidecar 失败");
        std::fs::write(
            manifest_dir
                .join("binaries")
                .join("clirelay-aarch64-apple-darwin"),
            "dev-sidecar",
        )
        .expect("写入 dev sidecar 失败");

        let resolved = resolve_sidecar_executable(&resource_dir, &manifest_dir);

        assert_eq!(resolved, macos_dir.join("clirelay"));

        let _ = std::fs::remove_dir_all(root);
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
            code_proxy_version: "test".to_string(),
            sidecar_sha256: "test".to_string(),
        }
    }
}
