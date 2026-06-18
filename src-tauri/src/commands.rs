use crate::component_update::{
    current_component_versions, current_sidecar_sha256, install_clirelay_update,
    install_codeproxy_update, runtime_sidecar_if_valid, ComponentInstallResult,
    ComponentUpdateError, InstallStatus,
};
use crate::service::logs::append_desktop_log_line;
use crate::service::manager::{
    ManagerError, ServiceManager, ServiceManagerConfig, ServiceSnapshot,
};
use crate::service::ownership::ProcessOwnership;
use crate::service::state::ServiceStatus;
use crate::settings::{load_or_create_settings, save_settings, DesktopSettings, SettingsError};
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

pub const SAFE_COMMAND_NAMES: [&str; 14] = [
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
    "install_upstream_component_updates",
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

pub struct DesktopCommandState {
    paths: crate::paths::DesktopPaths,
    settings: DesktopSettings,
    manager: ServiceManager,
    bundled_sidecar_executable: PathBuf,
}

impl DesktopCommandState {
    pub fn new(
        paths: crate::paths::DesktopPaths,
        settings: DesktopSettings,
        manager: ServiceManager,
        bundled_sidecar_executable: PathBuf,
    ) -> Self {
        Self {
            paths,
            settings,
            manager,
            bundled_sidecar_executable,
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
        let sidecar_executable = runtime_sidecar_if_valid(&paths)
            .unwrap_or_else(|| resources.sidecar_executable.clone());
        let (clirelay_version, code_proxy_version) = current_component_versions(&paths);
        let sidecar_sha256 = current_sidecar_sha256(&paths);
        let desktop_version = app.package_info().version.to_string();
        let manager_config = ServiceManagerConfig::new(
            paths.clone(),
            settings.clone(),
            resources.config_example,
            resources.panel_dir,
            sidecar_executable,
            desktop_version,
        );
        let mut manager_config = manager_config;
        manager_config.clirelay_version = clirelay_version;
        manager_config.code_proxy_version = code_proxy_version;
        manager_config.sidecar_sha256 = sidecar_sha256;
        let manager = ServiceManager::new(manager_config);

        Ok(Self::new(
            paths,
            settings,
            manager,
            resources.sidecar_executable,
        ))
    }

    pub fn paths(&self) -> &crate::paths::DesktopPaths {
        &self.paths
    }

    pub fn service_snapshot(&self) -> ServiceSnapshot {
        self.manager.snapshot()
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
        let sidecar_executable = runtime_sidecar_if_valid(&self.paths)
            .unwrap_or_else(|| self.bundled_sidecar_executable.clone());
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
pub fn install_upstream_component_updates(
    state: tauri::State<'_, SharedDesktopCommandState>,
    install_scope: UpstreamInstallScope,
    restart_after_install: bool,
) -> Result<ComponentInstallResult, CommandError> {
    if install_scope == UpstreamInstallScope::None {
        return Ok(ComponentInstallResult {
            status: InstallStatus::NoUpdates,
            message: "没有可安装的上游组件更新".to_string(),
            installed_scope: UpstreamInstallScope::None,
        });
    }

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

    let mut state = state.lock().map_err(|_| CommandError::StateLockPoisoned)?;
    let mut installed_clirelay = false;
    let mut installed_codeproxy = false;
    let mut stopped_for_install = false;

    if let Some(candidate) = clirelay_candidate.as_ref() {
        let status = state.manager.status();
        match status {
            ServiceStatus::Running | ServiceStatus::Unhealthy => {
                if state.manager.ownership() != ProcessOwnership::Owned {
                    return Err(CommandError::ComponentUpdate(
                        "只允许更新 Desktop 自管 CliRelay 服务".to_string(),
                    ));
                }
                if !restart_after_install {
                    return Err(CommandError::ComponentUpdate(
                        "更新运行中的 CliRelay 需要确认停止并重启服务".to_string(),
                    ));
                }
                state.manager.stop_service()?;
                stopped_for_install = true;
            }
            ServiceStatus::External | ServiceStatus::Starting | ServiceStatus::Stopping => {
                return Err(ComponentUpdateError::InvalidServiceStatus(status).into());
            }
            ServiceStatus::Stopped | ServiceStatus::Error => {}
        }

        install_clirelay_update(&state.paths, candidate, state.manager.status())?;
        installed_clirelay = true;
        state.refresh_runtime_components();
    }

    if let Some(candidate) = codeproxy_candidate.as_ref() {
        install_codeproxy_update(&state.paths, candidate)?;
        installed_codeproxy = true;
        state.refresh_runtime_components();
    }

    if stopped_for_install && restart_after_install {
        state.manager.start_service()?;
    }

    let installed_scope = match (installed_clirelay, installed_codeproxy) {
        (true, true) => UpstreamInstallScope::Both,
        (true, false) => UpstreamInstallScope::CliRelay,
        (false, true) => UpstreamInstallScope::CodeProxy,
        (false, false) => UpstreamInstallScope::None,
    };

    Ok(ComponentInstallResult {
        status: if installed_scope == install_scope {
            InstallStatus::Success
        } else {
            InstallStatus::PartialSuccess
        },
        message: "已更新上游组件".to_string(),
        installed_scope,
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
                "install_upstream_component_updates",
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
            PathBuf::from("config.example.yaml"),
            PathBuf::from("panel"),
            PathBuf::from("cli-proxy-api"),
            "9.9.9-preview.7",
        );

        let state = DesktopCommandState::new(
            paths,
            settings,
            ServiceManager::new(manager_config),
            PathBuf::from("cli-proxy-api"),
        );

        assert_eq!(state.current_versions().desktop, "9.9.9-preview.7");
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
