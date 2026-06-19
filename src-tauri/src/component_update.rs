use crate::paths::DesktopPaths;
use crate::service::state::ServiceStatus;
use crate::update_check::{
    validate_component_asset_url, ComponentUpdateCandidate, UpdateCheckError, UpdateSubject,
    UpstreamComponent,
};
use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;
use std::fs;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Component, Path, PathBuf};
use tar::Archive;
use zip::ZipArchive;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentState {
    pub schema_version: u32,
    pub clirelay: Option<ComponentRecord>,
    pub code_proxy: Option<ComponentRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentRecord {
    pub version: String,
    pub asset_name: String,
    pub asset_url: Option<String>,
    pub asset_sha256: String,
    pub installed_at: DateTime<Utc>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub enum InstallStatus {
    Success,
    PartialSuccess,
    NoUpdates,
}

#[derive(Clone, Debug, Serialize)]
pub struct ComponentInstallResult {
    pub status: InstallStatus,
    pub message: String,
    pub installed_scope: crate::update_check::UpstreamInstallScope,
}

#[derive(Clone, Debug)]
pub struct PreparedComponentUpdate {
    pub install_scope: crate::update_check::UpstreamInstallScope,
    pub clirelay: Option<PreparedComponentArtifact>,
    pub code_proxy: Option<PreparedComponentArtifact>,
    pub prepared_at: DateTime<Utc>,
}

#[derive(Clone, Debug)]
pub struct PreparedComponentArtifact {
    pub candidate: ComponentUpdateCandidate,
    pub prepared_dir: PathBuf,
}

#[derive(Debug)]
pub enum ComponentUpdateError {
    InvalidDigest(String),
    InvalidArchivePath(String),
    InvalidServiceStatus(ServiceStatus),
    MissingCliRelayBinary(PathBuf),
    MissingPanelEntrypoint(PathBuf),
    Io(io::Error),
    Zip(zip::result::ZipError),
    UpdateCheck(UpdateCheckError),
    Network(String),
}

impl fmt::Display for ComponentUpdateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDigest(message) => write!(formatter, "{message}"),
            Self::InvalidArchivePath(path) => write!(formatter, "压缩包路径不安全: {path}"),
            Self::InvalidServiceStatus(status) => {
                write!(
                    formatter,
                    "当前服务状态不允许安装 CliRelay 热更: {status:?}"
                )
            }
            Self::MissingCliRelayBinary(path) => {
                write!(
                    formatter,
                    "CliRelay 解包后缺少 cli-proxy-api: {}",
                    path.display()
                )
            }
            Self::MissingPanelEntrypoint(path) => {
                write!(
                    formatter,
                    "codeProxy 解包后缺少 manage.html: {}",
                    path.display()
                )
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Zip(error) => write!(formatter, "{error}"),
            Self::UpdateCheck(error) => write!(formatter, "{error}"),
            Self::Network(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for ComponentUpdateError {}

impl From<io::Error> for ComponentUpdateError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<zip::result::ZipError> for ComponentUpdateError {
    fn from(error: zip::result::ZipError) -> Self {
        Self::Zip(error)
    }
}

impl From<UpdateCheckError> for ComponentUpdateError {
    fn from(error: UpdateCheckError) -> Self {
        Self::UpdateCheck(error)
    }
}

pub fn validate_component_digest(digest: Option<&str>) -> Result<String, UpdateCheckError> {
    let digest = digest
        .ok_or_else(|| UpdateCheckError::InvalidDigest("GitHub asset digest 缺失".to_string()))?;
    let value = digest.strip_prefix("sha256:").ok_or_else(|| {
        UpdateCheckError::InvalidDigest("GitHub asset digest 必须以 sha256: 开头".to_string())
    })?;

    if value.len() != 64 || !value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(UpdateCheckError::InvalidDigest(
            "GitHub asset digest 必须是 sha256:<64 hex>".to_string(),
        ));
    }

    Ok(value.to_ascii_lowercase())
}

pub fn safe_archive_entry_path(
    root: &Path,
    entry_name: &str,
) -> Result<PathBuf, ComponentUpdateError> {
    let entry_path = Path::new(entry_name);
    if entry_path.is_absolute() {
        return Err(ComponentUpdateError::InvalidArchivePath(
            entry_name.to_string(),
        ));
    }

    let mut output = root.to_path_buf();
    for component in entry_path.components() {
        match component {
            Component::Normal(part) => output.push(part),
            Component::CurDir => {}
            _ => {
                return Err(ComponentUpdateError::InvalidArchivePath(
                    entry_name.to_string(),
                ));
            }
        }
    }

    Ok(output)
}

pub fn can_install_clirelay_for_status(status: ServiceStatus) -> bool {
    matches!(
        status,
        ServiceStatus::Stopped
            | ServiceStatus::Running
            | ServiceStatus::Unhealthy
            | ServiceStatus::Error
    )
}

pub fn ensure_component_dirs(paths: &DesktopPaths) -> Result<(), ComponentUpdateError> {
    fs::create_dir_all(&paths.runtime_sidecar_dir)?;
    fs::create_dir_all(&paths.update_downloads_dir)?;
    fs::create_dir_all(&paths.update_staging_dir)?;
    Ok(())
}

pub fn load_component_state(paths: &DesktopPaths) -> Result<ComponentState, ComponentUpdateError> {
    if !paths.component_state_file.exists() {
        return Ok(ComponentState {
            schema_version: 1,
            clirelay: None,
            code_proxy: None,
        });
    }

    let raw = fs::read_to_string(&paths.component_state_file)?;
    serde_json::from_str(&raw).map_err(|error| {
        ComponentUpdateError::Io(io::Error::new(io::ErrorKind::InvalidData, error))
    })
}

pub fn save_component_state(
    paths: &DesktopPaths,
    state: &ComponentState,
) -> Result<(), ComponentUpdateError> {
    fs::create_dir_all(&paths.state_dir)?;
    let raw = serde_json::to_string_pretty(state).map_err(|error| {
        ComponentUpdateError::Io(io::Error::new(io::ErrorKind::InvalidData, error))
    })?;
    fs::write(&paths.component_state_file, format!("{raw}\n"))?;
    Ok(())
}

pub fn runtime_sidecar_if_valid(paths: &DesktopPaths) -> Option<PathBuf> {
    if !paths.runtime_sidecar_executable.is_file() {
        return None;
    }

    let state = load_component_state(paths).ok()?;
    state.clirelay.as_ref()?;
    Some(paths.runtime_sidecar_executable.clone())
}

pub fn current_component_versions(paths: &DesktopPaths) -> (String, String) {
    let state = load_component_state(paths).unwrap_or_default();
    let lock = bundled_upstream_lock();
    let clirelay = state
        .clirelay
        .map(|record| record.version)
        .unwrap_or_else(|| lock.clirelay.version);
    let code_proxy = state
        .code_proxy
        .map(|record| record.version)
        .unwrap_or_else(|| lock.code_proxy.version);

    (clirelay, code_proxy)
}

pub fn current_sidecar_sha256(paths: &DesktopPaths) -> String {
    let state = load_component_state(paths).unwrap_or_default();
    state
        .clirelay
        .map(|record| record.asset_sha256)
        .unwrap_or_else(|| {
            bundled_upstream_lock()
                .clirelay
                .assets
                .aarch64_apple_darwin
                .sha256
        })
}

pub fn install_clirelay_update(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
    service_status: ServiceStatus,
) -> Result<(), ComponentUpdateError> {
    if !can_install_clirelay_for_status(service_status.clone()) {
        return Err(ComponentUpdateError::InvalidServiceStatus(service_status));
    }

    let artifact = prepare_clirelay_update(paths, candidate)?;
    apply_prepared_clirelay_update(paths, &artifact, service_status)
}

pub fn prepare_clirelay_update(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
) -> Result<PreparedComponentArtifact, ComponentUpdateError> {
    if candidate.subject != UpdateSubject::CliRelay {
        return Err(ComponentUpdateError::InvalidArchivePath(
            candidate.asset_name.clone(),
        ));
    }

    validate_component_asset_url(&candidate.asset_url, UpstreamComponent::CliRelay)?;
    let archive_path = download_asset(paths, "clirelay", candidate)?;
    verify_file_sha256(&archive_path, &candidate.asset_sha256)?;

    let staging = paths
        .update_staging_dir
        .join("clirelay")
        .join(&candidate.version);
    replace_dir_with_empty(&staging)?;
    unpack_tar_gz(&archive_path, &staging)?;

    let binary = find_file_named(&staging, "cli-proxy-api")?
        .ok_or_else(|| ComponentUpdateError::MissingCliRelayBinary(staging.clone()))?;
    set_executable(&binary)?;

    let prepared_dir = staging.join("sidecar");
    replace_dir_with_empty(&prepared_dir)?;
    fs::copy(&binary, prepared_dir.join("cli-proxy-api"))?;
    set_executable(&prepared_dir.join("cli-proxy-api"))?;

    Ok(PreparedComponentArtifact {
        candidate: candidate.clone(),
        prepared_dir,
    })
}

pub fn apply_prepared_clirelay_update(
    paths: &DesktopPaths,
    artifact: &PreparedComponentArtifact,
    service_status: ServiceStatus,
) -> Result<(), ComponentUpdateError> {
    if !can_install_clirelay_for_status(service_status.clone()) {
        return Err(ComponentUpdateError::InvalidServiceStatus(service_status));
    }

    let binary = artifact.prepared_dir.join("cli-proxy-api");
    if !binary.is_file() {
        return Err(ComponentUpdateError::MissingCliRelayBinary(
            artifact.prepared_dir.clone(),
        ));
    }

    let backup = backup_existing(
        &paths.runtime_sidecar_dir,
        paths,
        "clirelay",
        &artifact.candidate.version,
    )?;
    atomic_replace_dir_with_restore(
        &artifact.prepared_dir,
        &paths.runtime_sidecar_dir,
        backup.as_deref(),
    )?;
    update_component_record(paths, &artifact.candidate)?;

    Ok(())
}

pub fn install_codeproxy_update(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
) -> Result<(), ComponentUpdateError> {
    let artifact = prepare_codeproxy_update(paths, candidate)?;
    apply_prepared_codeproxy_update(paths, &artifact)
}

pub fn prepare_codeproxy_update(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
) -> Result<PreparedComponentArtifact, ComponentUpdateError> {
    if candidate.subject != UpdateSubject::CodeProxy {
        return Err(ComponentUpdateError::InvalidArchivePath(
            candidate.asset_name.clone(),
        ));
    }

    validate_component_asset_url(&candidate.asset_url, UpstreamComponent::CodeProxy)?;
    let archive_path = download_asset(paths, "codeproxy", candidate)?;
    verify_file_sha256(&archive_path, &candidate.asset_sha256)?;

    let staging_panel = paths
        .update_staging_dir
        .join("codeproxy")
        .join(&candidate.version)
        .join("panel");
    replace_dir_with_empty(&staging_panel)?;
    unpack_zip(&archive_path, &staging_panel)?;

    let entrypoint = staging_panel.join("manage.html");
    if !entrypoint.is_file() {
        return Err(ComponentUpdateError::MissingPanelEntrypoint(entrypoint));
    }

    Ok(PreparedComponentArtifact {
        candidate: candidate.clone(),
        prepared_dir: staging_panel,
    })
}

pub fn apply_prepared_codeproxy_update(
    paths: &DesktopPaths,
    artifact: &PreparedComponentArtifact,
) -> Result<(), ComponentUpdateError> {
    let entrypoint = artifact.prepared_dir.join("manage.html");
    if !entrypoint.is_file() {
        return Err(ComponentUpdateError::MissingPanelEntrypoint(entrypoint));
    }

    let backup = backup_existing(
        &paths.panel_dir,
        paths,
        "codeproxy",
        &artifact.candidate.version,
    )?;
    atomic_replace_dir_with_restore(&artifact.prepared_dir, &paths.panel_dir, backup.as_deref())?;
    update_component_record(paths, &artifact.candidate)?;

    Ok(())
}

fn download_asset(
    paths: &DesktopPaths,
    component_dir: &str,
    candidate: &ComponentUpdateCandidate,
) -> Result<PathBuf, ComponentUpdateError> {
    let target_dir = paths
        .update_downloads_dir
        .join(component_dir)
        .join(&candidate.version);
    fs::create_dir_all(&target_dir)?;
    let download_path = target_dir.join(format!("{}.download", candidate.asset_name));

    let mut response = ureq::get(candidate.asset_url.as_str())
        .set("User-Agent", "CliRelay-Desktop")
        .call()
        .map_err(|error| ComponentUpdateError::Network(error.to_string()))?
        .into_reader();
    let mut file = File::create(&download_path)?;
    io::copy(&mut response, &mut file)?;

    Ok(download_path)
}

fn verify_file_sha256(path: &Path, expected: &str) -> Result<(), ComponentUpdateError> {
    let actual = sha256_file(path)?;
    if actual != expected.to_ascii_lowercase() {
        return Err(ComponentUpdateError::InvalidDigest(format!(
            "下载文件 SHA-256 不匹配: expected {expected}, actual {actual}"
        )));
    }

    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, ComponentUpdateError> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hex::encode(hasher.finalize()))
}

fn unpack_tar_gz(archive_path: &Path, staging: &Path) -> Result<(), ComponentUpdateError> {
    let archive_file = File::open(archive_path)?;
    let decoder = GzDecoder::new(archive_file);
    let mut archive = Archive::new(decoder);

    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;
        let path_string = path.to_string_lossy().to_string();
        let target = safe_archive_entry_path(staging, &path_string)?;
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            entry.unpack(&target)?;
        }
    }

    Ok(())
}

fn unpack_zip(archive_path: &Path, staging: &Path) -> Result<(), ComponentUpdateError> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file)?;

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let target = safe_archive_entry_path(staging, entry.name())?;
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output = File::create(&target)?;
            io::copy(&mut entry, &mut output)?;
        }
    }

    Ok(())
}

fn find_file_named(root: &Path, name: &str) -> Result<Option<PathBuf>, ComponentUpdateError> {
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file_named(&path, name)? {
                return Ok(Some(found));
            }
        } else if path.file_name().and_then(|value| value.to_str()) == Some(name) {
            return Ok(Some(path));
        }
    }

    Ok(None)
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), ComponentUpdateError> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), ComponentUpdateError> {
    Ok(())
}

fn replace_dir_with_empty(path: &Path) -> Result<(), ComponentUpdateError> {
    if path.exists() {
        fs::remove_dir_all(path)?;
    }
    fs::create_dir_all(path)?;
    Ok(())
}

fn backup_existing(
    path: &Path,
    paths: &DesktopPaths,
    component_dir: &str,
    version: &str,
) -> Result<Option<PathBuf>, ComponentUpdateError> {
    if !path.exists() {
        return Ok(None);
    }

    let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
    let backup_dir = paths
        .backups_dir
        .join(component_dir)
        .join(format!("{}-{timestamp}", version.trim_start_matches('v')));
    if let Some(parent) = backup_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(path, &backup_dir)?;
    Ok(Some(backup_dir))
}

fn atomic_replace_dir_with_restore(
    source: &Path,
    target: &Path,
    backup: Option<&Path>,
) -> Result<(), ComponentUpdateError> {
    if target.exists() {
        fs::remove_dir_all(target)?;
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(error) => {
            if let Some(backup) = backup {
                let _ = fs::rename(backup, target);
            }
            Err(ComponentUpdateError::Io(error))
        }
    }
}

fn update_component_record(
    paths: &DesktopPaths,
    candidate: &ComponentUpdateCandidate,
) -> Result<(), ComponentUpdateError> {
    let mut state = load_component_state(paths)?;
    state.schema_version = 1;
    let record = ComponentRecord {
        version: candidate.version.clone(),
        asset_name: candidate.asset_name.clone(),
        asset_url: Some(candidate.asset_url.to_string()),
        asset_sha256: candidate.asset_sha256.clone(),
        installed_at: Utc::now(),
    };

    match candidate.subject {
        UpdateSubject::CliRelay => state.clirelay = Some(record),
        UpdateSubject::CodeProxy => state.code_proxy = Some(record),
        UpdateSubject::Desktop => {}
    }

    save_component_state(paths, &state)
}

#[derive(Deserialize)]
struct UpstreamLock {
    clirelay: LockedCliRelay,
    #[serde(rename = "codeProxy")]
    code_proxy: LockedCodeProxy,
}

#[derive(Deserialize)]
struct LockedCliRelay {
    version: String,
    assets: LockedCliRelayAssets,
}

#[derive(Deserialize)]
struct LockedCliRelayAssets {
    #[serde(rename = "aarch64-apple-darwin")]
    aarch64_apple_darwin: LockedAsset,
}

#[derive(Deserialize)]
struct LockedCodeProxy {
    version: String,
}

#[derive(Deserialize)]
struct LockedAsset {
    sha256: String,
}

fn bundled_upstream_lock() -> UpstreamLock {
    serde_json::from_str(include_str!("../../upstream-lock.json"))
        .expect("upstream-lock.json 必须是合法 JSON")
}
