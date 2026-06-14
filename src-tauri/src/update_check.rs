use chrono::{DateTime, Utc};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::fmt;
use url::Url;

pub const LATEST_PREVIEW_URL: &str =
    "https://martianc.github.io/CliRelay-Desktop/latest-preview.json";
pub const CLIRELAY_RELEASES_API: &str = "https://api.github.com/repos/kittors/CliRelay/releases";
pub const CODEPROXY_RELEASES_API: &str = "https://api.github.com/repos/kittors/codeProxy/releases";

pub const ALLOWED_RELEASE_HOST: &str = "github.com";
pub const ALLOWED_RELEASE_PATH_PREFIX: &str = "/MartianC/CliRelay-Desktop/releases/";
pub const ALLOWED_RELEASE_DOWNLOAD_PATH_PREFIX: &str =
    "/MartianC/CliRelay-Desktop/releases/download/";
pub const ALLOWED_PAGES_HOST: &str = "martianc.github.io";
pub const ALLOWED_PAGES_PATH: &str = "/CliRelay-Desktop/latest-preview.json";
pub const ALLOWED_CLIRELAY_ASSET_PREFIX: &str = "/kittors/CliRelay/releases/download/";
pub const ALLOWED_CODEPROXY_ASSET_PREFIX: &str = "/kittors/codeProxy/releases/download/";
pub const CLIRELAY_ASSET_PREFIX: &str = "CliRelay_";
pub const CLIRELAY_ASSET_SUFFIX: &str = "_darwin_arm64.tar.gz";
pub const CODEPROXY_ASSET_NAME: &str = "panel-dist.zip";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatestPreview {
    pub channel: String,
    pub version: String,
    pub released_at: DateTime<Utc>,
    pub minimum_macos: String,
    pub clirelay_version: String,
    pub code_proxy_version: String,
    pub release_notes_summary: Vec<String>,
    pub release_url: Url,
    pub download_url: Url,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GithubRelease {
    pub tag_name: String,
    pub prerelease: bool,
    pub draft: bool,
    pub published_at: DateTime<Utc>,
    pub html_url: Url,
    pub body: Option<String>,
    pub assets: Vec<GithubReleaseAsset>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct GithubReleaseAsset {
    pub name: String,
    pub browser_download_url: Url,
    pub digest: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum UpdateSubject {
    Desktop,
    CliRelay,
    #[serde(rename = "codeProxy")]
    CodeProxy,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum UpdateStatus {
    Unavailable,
    UpToDate,
    UpdateAvailable,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum DesktopUpdateAction {
    OpenRelease,
    None,
}

impl fmt::Display for DesktopUpdateAction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::OpenRelease => write!(formatter, "OpenRelease"),
            Self::None => write!(formatter, "None"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum UpstreamUpdateAction {
    Check,
    InstallInDesktop,
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum UpstreamInstallScope {
    None,
    CliRelay,
    #[serde(rename = "codeProxy")]
    CodeProxy,
    Both,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UpstreamComponent {
    CliRelay,
    CodeProxy,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CurrentVersions {
    pub desktop: String,
    pub clirelay: String,
    pub code_proxy: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ComponentUpdateCandidate {
    pub subject: UpdateSubject,
    pub version: String,
    pub release_url: Url,
    pub asset_name: String,
    pub asset_url: Url,
    pub asset_sha256: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct DesktopUpdateItem {
    pub subject: UpdateSubject,
    pub status: UpdateStatus,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub message: String,
    pub release_url: Option<String>,
    pub action: DesktopUpdateAction,
    pub release_notes_summary: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ComponentUpdateItem {
    pub subject: UpdateSubject,
    pub status: UpdateStatus,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub message: String,
    pub release_url: Option<String>,
    pub asset_name: Option<String>,
    pub asset_sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpstreamUpdateBlock {
    pub status: UpdateStatus,
    pub message: String,
    pub clirelay: ComponentUpdateItem,
    pub code_proxy: ComponentUpdateItem,
    pub install_scope: UpstreamInstallScope,
    pub action: UpstreamUpdateAction,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdateCheckResult {
    pub status: UpdateStatus,
    pub message: String,
    pub checked_at: DateTime<Utc>,
    pub desktop: DesktopUpdateItem,
    pub upstream: UpstreamUpdateBlock,
}

#[derive(Debug)]
pub enum UpdateCheckError {
    InvalidVersion(String),
    InvalidPreview(String),
    InvalidUrl(String),
    InvalidDigest(String),
    Network(String),
}

impl fmt::Display for UpdateCheckError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidVersion(message) => write!(formatter, "{message}"),
            Self::InvalidPreview(message) => write!(formatter, "{message}"),
            Self::InvalidUrl(message) => write!(formatter, "{message}"),
            Self::InvalidDigest(message) => write!(formatter, "{message}"),
            Self::Network(message) => write!(formatter, "{message}"),
        }
    }
}

impl std::error::Error for UpdateCheckError {}

pub fn is_newer_preview_version(current: &str, latest: &str) -> Result<bool, UpdateCheckError> {
    let current = parse_semver(current)?;
    let latest = parse_semver(latest)?;

    if latest.pre.is_empty() {
        return Err(UpdateCheckError::InvalidPreview(
            "Preview 通道要求 latest version 是 prerelease".to_string(),
        ));
    }

    Ok(latest > current)
}

pub fn validate_desktop_preview(preview: &LatestPreview) -> Result<(), UpdateCheckError> {
    if preview.channel != "preview" {
        return Err(UpdateCheckError::InvalidPreview(
            "latest-preview.json channel 必须是 preview".to_string(),
        ));
    }

    let version = parse_semver(&preview.version)?;
    if version.pre.is_empty() {
        return Err(UpdateCheckError::InvalidPreview(
            "latest-preview.json version 必须是 prerelease".to_string(),
        ));
    }

    validate_desktop_release_url(&preview.release_url)?;
    validate_desktop_download_url(&preview.download_url)?;
    validate_hex_sha256(&preview.sha256)?;

    Ok(())
}

pub fn validate_desktop_release_url(url: &Url) -> Result<(), UpdateCheckError> {
    validate_url_path(url, ALLOWED_RELEASE_HOST, ALLOWED_RELEASE_PATH_PREFIX).map_err(|_| {
        UpdateCheckError::InvalidUrl(
            "Desktop release_url 必须指向 github.com/MartianC/CliRelay-Desktop/releases"
                .to_string(),
        )
    })
}

pub fn validate_desktop_download_url(url: &Url) -> Result<(), UpdateCheckError> {
    validate_url_path(
        url,
        ALLOWED_RELEASE_HOST,
        ALLOWED_RELEASE_DOWNLOAD_PATH_PREFIX,
    )
    .map_err(|_| {
        UpdateCheckError::InvalidUrl(
            "Desktop download_url 必须指向 github.com/MartianC/CliRelay-Desktop/releases/download"
                .to_string(),
        )
    })
}

pub fn validate_component_asset_url(
    url: &Url,
    component: UpstreamComponent,
) -> Result<(), UpdateCheckError> {
    let expected = match component {
        UpstreamComponent::CliRelay => ALLOWED_CLIRELAY_ASSET_PREFIX,
        UpstreamComponent::CodeProxy => ALLOWED_CODEPROXY_ASSET_PREFIX,
    };

    validate_url_path(url, ALLOWED_RELEASE_HOST, expected).map_err(|_| {
        UpdateCheckError::InvalidUrl(format!(
            "上游 asset URL 必须指向 github.com{}",
            expected.trim_end_matches('/')
        ))
    })
}

pub fn select_component_release(
    releases: &[GithubRelease],
    component: UpstreamComponent,
) -> Result<Option<ComponentUpdateCandidate>, UpdateCheckError> {
    let mut selected: Option<(&GithubRelease, Version, &GithubReleaseAsset)> = None;

    for release in releases.iter().filter(|release| !release.draft) {
        let version = parse_semver(&release.tag_name)?;
        let Some(asset) = release
            .assets
            .iter()
            .find(|asset| is_allowed_asset_name(&asset.name, component))
        else {
            continue;
        };

        validate_component_asset_url(&asset.browser_download_url, component)?;
        let _ = crate::component_update::validate_component_digest(asset.digest.as_deref())?;

        match &selected {
            Some((_, selected_version, _)) if selected_version >= &version => {}
            _ => selected = Some((release, version, asset)),
        }
    }

    selected
        .map(|(release, _version, asset)| {
            Ok(ComponentUpdateCandidate {
                subject: match component {
                    UpstreamComponent::CliRelay => UpdateSubject::CliRelay,
                    UpstreamComponent::CodeProxy => UpdateSubject::CodeProxy,
                },
                version: release.tag_name.clone(),
                release_url: release.html_url.clone(),
                asset_name: asset.name.clone(),
                asset_url: asset.browser_download_url.clone(),
                asset_sha256: crate::component_update::validate_component_digest(
                    asset.digest.as_deref(),
                )?,
            })
        })
        .transpose()
}

pub fn build_update_check_result(
    current: CurrentVersions,
    latest_preview: Option<LatestPreview>,
    clirelay_candidate: Option<ComponentUpdateCandidate>,
    codeproxy_candidate: Option<ComponentUpdateCandidate>,
    checked_at: DateTime<Utc>,
) -> UpdateCheckResult {
    let desktop = match latest_preview {
        Some(preview) => match validate_desktop_preview(&preview)
            .and_then(|_| is_newer_preview_version(&current.desktop, &preview.version))
        {
            Ok(true) => DesktopUpdateItem {
                subject: UpdateSubject::Desktop,
                status: UpdateStatus::UpdateAvailable,
                current_version: current.desktop.clone(),
                latest_version: Some(preview.version),
                message: "发现 Desktop Preview 更新".to_string(),
                release_url: Some(preview.release_url.to_string()),
                action: DesktopUpdateAction::OpenRelease,
                release_notes_summary: preview.release_notes_summary,
            },
            Ok(false) => DesktopUpdateItem {
                subject: UpdateSubject::Desktop,
                status: UpdateStatus::UpToDate,
                current_version: current.desktop.clone(),
                latest_version: Some(preview.version),
                message: "Desktop Preview 已是最新".to_string(),
                release_url: Some(preview.release_url.to_string()),
                action: DesktopUpdateAction::None,
                release_notes_summary: preview.release_notes_summary,
            },
            Err(error) => desktop_error_item(current.desktop.clone(), error.to_string()),
        },
        None => DesktopUpdateItem {
            subject: UpdateSubject::Desktop,
            status: UpdateStatus::Unavailable,
            current_version: current.desktop.clone(),
            latest_version: None,
            message: "Desktop Preview 更新源不可用".to_string(),
            release_url: None,
            action: DesktopUpdateAction::None,
            release_notes_summary: Vec::new(),
        },
    };

    let clirelay = component_item(
        UpdateSubject::CliRelay,
        current.clirelay,
        clirelay_candidate,
    );
    let code_proxy = component_item(
        UpdateSubject::CodeProxy,
        current.code_proxy,
        codeproxy_candidate,
    );

    let install_scope = match (
        clirelay.status == UpdateStatus::UpdateAvailable,
        code_proxy.status == UpdateStatus::UpdateAvailable,
    ) {
        (true, true) => UpstreamInstallScope::Both,
        (true, false) => UpstreamInstallScope::CliRelay,
        (false, true) => UpstreamInstallScope::CodeProxy,
        (false, false) => UpstreamInstallScope::None,
    };
    let upstream_status = if install_scope == UpstreamInstallScope::None {
        if clirelay.status == UpdateStatus::Error || code_proxy.status == UpdateStatus::Error {
            UpdateStatus::Error
        } else if clirelay.status == UpdateStatus::Unavailable
            || code_proxy.status == UpdateStatus::Unavailable
        {
            UpdateStatus::Unavailable
        } else {
            UpdateStatus::UpToDate
        }
    } else {
        UpdateStatus::UpdateAvailable
    };
    let upstream_action = if install_scope == UpstreamInstallScope::None {
        UpstreamUpdateAction::Check
    } else {
        UpstreamUpdateAction::InstallInDesktop
    };

    let upstream = UpstreamUpdateBlock {
        status: upstream_status,
        message: upstream_message(install_scope, upstream_status),
        clirelay,
        code_proxy,
        install_scope,
        action: upstream_action,
    };

    let status = if desktop.status == UpdateStatus::UpdateAvailable
        || upstream.status == UpdateStatus::UpdateAvailable
    {
        UpdateStatus::UpdateAvailable
    } else if desktop.status == UpdateStatus::Error || upstream.status == UpdateStatus::Error {
        UpdateStatus::Error
    } else if desktop.status == UpdateStatus::Unavailable
        || upstream.status == UpdateStatus::Unavailable
    {
        UpdateStatus::Unavailable
    } else {
        UpdateStatus::UpToDate
    };

    UpdateCheckResult {
        status,
        message: match status {
            UpdateStatus::UpdateAvailable => "发现可用更新".to_string(),
            UpdateStatus::UpToDate => "已是最新".to_string(),
            UpdateStatus::Unavailable => "更新源不可用".to_string(),
            UpdateStatus::Error => "部分更新检查失败".to_string(),
        },
        checked_at,
        desktop,
        upstream,
    }
}

pub fn fetch_latest_preview() -> Result<LatestPreview, UpdateCheckError> {
    let url = Url::parse(LATEST_PREVIEW_URL).map_err(|error| {
        UpdateCheckError::InvalidUrl(format!("latest-preview URL 无效: {error}"))
    })?;
    validate_url_path(&url, ALLOWED_PAGES_HOST, ALLOWED_PAGES_PATH)?;

    ureq::get(LATEST_PREVIEW_URL)
        .set("User-Agent", "CliRelay-Desktop")
        .call()
        .map_err(|error| UpdateCheckError::Network(error.to_string()))?
        .into_json::<LatestPreview>()
        .map_err(|error| UpdateCheckError::Network(error.to_string()))
}

pub fn fetch_github_releases(url: &str) -> Result<Vec<GithubRelease>, UpdateCheckError> {
    ureq::get(url)
        .set("User-Agent", "CliRelay-Desktop")
        .call()
        .map_err(|error| UpdateCheckError::Network(error.to_string()))?
        .into_json::<Vec<GithubRelease>>()
        .map_err(|error| UpdateCheckError::Network(error.to_string()))
}

pub fn parse_semver(value: &str) -> Result<Version, UpdateCheckError> {
    Version::parse(value.trim_start_matches('v')).map_err(|error| {
        UpdateCheckError::InvalidVersion(format!("版本号不是合法 SemVer: {value}: {error}"))
    })
}

fn component_item(
    subject: UpdateSubject,
    current_version: String,
    candidate: Option<ComponentUpdateCandidate>,
) -> ComponentUpdateItem {
    match candidate {
        Some(candidate) => {
            let has_update = parse_semver(&candidate.version)
                .and_then(|latest| parse_semver(&current_version).map(|current| latest > current))
                .unwrap_or(false);

            ComponentUpdateItem {
                subject,
                status: if has_update {
                    UpdateStatus::UpdateAvailable
                } else {
                    UpdateStatus::UpToDate
                },
                current_version,
                latest_version: Some(candidate.version),
                message: if has_update {
                    format!("{} 可更新", subject_label(subject))
                } else {
                    format!("{} 已是最新", subject_label(subject))
                },
                release_url: Some(candidate.release_url.to_string()),
                asset_name: Some(candidate.asset_name),
                asset_sha256: Some(candidate.asset_sha256),
            }
        }
        None => ComponentUpdateItem {
            subject,
            status: UpdateStatus::Unavailable,
            current_version,
            latest_version: None,
            message: format!("{} 更新源不可用", subject_label(subject)),
            release_url: None,
            asset_name: None,
            asset_sha256: None,
        },
    }
}

fn desktop_error_item(current_version: String, message: String) -> DesktopUpdateItem {
    DesktopUpdateItem {
        subject: UpdateSubject::Desktop,
        status: UpdateStatus::Error,
        current_version,
        latest_version: None,
        message,
        release_url: None,
        action: DesktopUpdateAction::None,
        release_notes_summary: Vec::new(),
    }
}

fn upstream_message(install_scope: UpstreamInstallScope, status: UpdateStatus) -> String {
    match (install_scope, status) {
        (UpstreamInstallScope::Both, _) => "CliRelay 和 codeProxy 有更新".to_string(),
        (UpstreamInstallScope::CliRelay, _) => "CliRelay 有更新".to_string(),
        (UpstreamInstallScope::CodeProxy, _) => "codeProxy 有更新".to_string(),
        (UpstreamInstallScope::None, UpdateStatus::Error) => "部分上游组件检查失败".to_string(),
        _ => "上游组件已是最新".to_string(),
    }
}

fn subject_label(subject: UpdateSubject) -> &'static str {
    match subject {
        UpdateSubject::Desktop => "Desktop",
        UpdateSubject::CliRelay => "CliRelay",
        UpdateSubject::CodeProxy => "codeProxy",
    }
}

fn validate_url_path(
    url: &Url,
    expected_host: &str,
    expected_path_prefix: &str,
) -> Result<(), UpdateCheckError> {
    if url.scheme() != "https" {
        return Err(UpdateCheckError::InvalidUrl(
            "URL 必须使用 https".to_string(),
        ));
    }

    if url.host_str() != Some(expected_host) {
        return Err(UpdateCheckError::InvalidUrl(format!(
            "URL host 必须是 {expected_host}"
        )));
    }

    if expected_path_prefix.ends_with('/') {
        if !url.path().starts_with(expected_path_prefix) {
            return Err(UpdateCheckError::InvalidUrl(format!(
                "URL path 必须以 {expected_path_prefix} 开头"
            )));
        }
    } else if url.path() != expected_path_prefix {
        return Err(UpdateCheckError::InvalidUrl(format!(
            "URL path 必须是 {expected_path_prefix}"
        )));
    }

    Ok(())
}

fn validate_hex_sha256(value: &str) -> Result<(), UpdateCheckError> {
    if value.len() != 64 || !value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(UpdateCheckError::InvalidDigest(
            "SHA-256 必须是 64 位十六进制字符串".to_string(),
        ));
    }

    Ok(())
}

fn is_allowed_asset_name(name: &str, component: UpstreamComponent) -> bool {
    match component {
        UpstreamComponent::CliRelay => {
            name.starts_with(CLIRELAY_ASSET_PREFIX) && name.ends_with(CLIRELAY_ASSET_SUFFIX)
        }
        UpstreamComponent::CodeProxy => name == CODEPROXY_ASSET_NAME,
    }
}
