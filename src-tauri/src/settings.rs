use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::paths::DesktopPaths;
use crate::update_check::UpdateCheckResult;

pub const SETTINGS_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_SERVICE_PORT: u16 = 8317;
pub const MIN_SERVICE_PORT: u16 = 1024;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum DesktopLocale {
    #[default]
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}

impl DesktopLocale {
    pub const fn as_panel_language(self) -> &'static str {
        match self {
            Self::ZhCn => "zh-CN",
            Self::En => "en",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ManagementSecretStatus {
    Configured,
    Missing,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DesktopSettings {
    #[serde(alias = "schemaVersion")]
    pub schema_version: u32,
    #[serde(alias = "firstRunCompleted")]
    pub first_run_completed: bool,
    #[serde(alias = "autoStartApp")]
    pub auto_start_app: bool,
    #[serde(alias = "autoStartService")]
    pub auto_start_service: bool,
    #[serde(alias = "openPanelOnStart")]
    pub open_panel_on_start: bool,
    pub port: u16,
    #[serde(alias = "autoCheckNewVersions")]
    pub auto_check_new_versions: bool,
    #[serde(alias = "lastUpdateCheckAt")]
    pub last_update_check_at: Option<DateTime<Utc>>,
    #[serde(default, alias = "lastUpdateCheckResult")]
    pub last_update_check_result: Option<UpdateCheckResult>,
    #[serde(default)]
    pub locale: DesktopLocale,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema_version: SETTINGS_SCHEMA_VERSION,
            first_run_completed: false,
            auto_start_app: false,
            auto_start_service: false,
            open_panel_on_start: true,
            port: DEFAULT_SERVICE_PORT,
            auto_check_new_versions: false,
            last_update_check_at: None,
            last_update_check_result: None,
            locale: DesktopLocale::ZhCn,
        }
    }
}

impl DesktopSettings {
    pub fn validate_port(port: u16) -> Result<(), SettingsError> {
        if port < MIN_SERVICE_PORT {
            return Err(SettingsError::InvalidPort(port));
        }

        Ok(())
    }

    pub fn with_port(mut self, port: u16) -> Result<Self, SettingsError> {
        Self::validate_port(port)?;
        self.port = port;
        Ok(self)
    }
}

#[derive(Debug)]
pub enum SettingsError {
    InvalidPort(u16),
    MissingTopLevelPort,
    MissingAutoUpdateEnabled,
    MissingPanelEntrypoint(PathBuf),
    Io(io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for SettingsError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPort(port) => write!(formatter, "端口必须在 1024-65535 范围内: {port}"),
            Self::MissingTopLevelPort => write!(formatter, "config.example.yaml 中未找到顶层 port"),
            Self::MissingAutoUpdateEnabled => {
                write!(
                    formatter,
                    "config.example.yaml 中未找到 auto-update.enabled"
                )
            }
            Self::MissingPanelEntrypoint(path) => {
                write!(formatter, "panel 入口文件不存在: {}", path.display())
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Json(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for SettingsError {}

impl From<io::Error> for SettingsError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for SettingsError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

pub fn ensure_desktop_dirs(paths: &DesktopPaths) -> Result<(), SettingsError> {
    fs::create_dir_all(&paths.runtime_dir)?;
    fs::create_dir_all(&paths.runtime_sidecar_dir)?;
    fs::create_dir_all(&paths.state_dir)?;
    fs::create_dir_all(&paths.update_downloads_dir)?;
    fs::create_dir_all(&paths.update_staging_dir)?;
    fs::create_dir_all(&paths.backups_dir)?;
    fs::create_dir_all(&paths.log_dir)?;

    Ok(())
}

pub fn load_or_create_settings(paths: &DesktopPaths) -> Result<DesktopSettings, SettingsError> {
    ensure_desktop_dirs(paths)?;

    if paths.settings_file.exists() {
        let raw = fs::read_to_string(&paths.settings_file)?;
        let settings = serde_json::from_str::<DesktopSettings>(&raw)?;
        DesktopSettings::validate_port(settings.port)?;
        return Ok(settings);
    }

    let settings = DesktopSettings::default();
    save_settings(paths, &settings)?;

    Ok(settings)
}

pub fn save_settings(
    paths: &DesktopPaths,
    settings: &DesktopSettings,
) -> Result<(), SettingsError> {
    DesktopSettings::validate_port(settings.port)?;
    fs::create_dir_all(&paths.state_dir)?;
    let raw = serde_json::to_string_pretty(settings)?;
    fs::write(&paths.settings_file, format!("{raw}\n"))?;

    Ok(())
}

pub fn ensure_runtime_config(
    paths: &DesktopPaths,
    bundled_config_example: impl AsRef<Path>,
    settings: &DesktopSettings,
) -> Result<bool, SettingsError> {
    DesktopSettings::validate_port(settings.port)?;
    fs::create_dir_all(&paths.runtime_dir)?;

    if paths.config_file.exists() {
        return Ok(false);
    }

    let source = fs::read_to_string(bundled_config_example)?;
    let config = render_runtime_config(&source, settings.port)?;
    fs::write(&paths.config_file, config)?;

    Ok(true)
}

pub fn render_runtime_config(source: &str, port: u16) -> Result<String, SettingsError> {
    DesktopSettings::validate_port(port)?;

    let mut found_port = false;
    let mut found_auto_update_enabled = false;
    let mut in_auto_update = false;
    let mut auto_update_indent = 0usize;
    let mut output = Vec::new();

    for line in source.lines() {
        let indent = leading_whitespace_len(line);
        let trimmed = line.trim();

        if in_auto_update && !trimmed.is_empty() && indent <= auto_update_indent {
            in_auto_update = false;
        }

        if indent == 0 && trimmed == "auto-update:" {
            in_auto_update = true;
            auto_update_indent = indent;
            output.push(line.to_string());
            continue;
        }

        if indent == 0 && trimmed.starts_with("port:") {
            found_port = true;
            output.push(format!("port: {port}"));
            continue;
        }

        if in_auto_update && trimmed.starts_with("enabled:") {
            found_auto_update_enabled = true;
            output.push(format!("{}enabled: false", " ".repeat(indent)));
            continue;
        }

        output.push(line.to_string());
    }

    if !found_port {
        return Err(SettingsError::MissingTopLevelPort);
    }

    if !found_auto_update_enabled {
        return Err(SettingsError::MissingAutoUpdateEnabled);
    }

    let mut rendered = output.join("\n");

    if source.ends_with('\n') {
        rendered.push('\n');
    }

    Ok(rendered)
}

pub fn management_secret_state_from_config(
    config: &str,
) -> Result<ManagementSecretStatus, SettingsError> {
    let Some(value) = find_remote_management_scalar(config, "secret-key") else {
        return Ok(ManagementSecretStatus::Missing);
    };

    if value.trim_matches('"').trim_matches('\'').trim().is_empty() {
        Ok(ManagementSecretStatus::Missing)
    } else {
        Ok(ManagementSecretStatus::Configured)
    }
}

pub fn render_config_with_management_secret(
    config: &str,
    secret_key: &str,
) -> Result<String, SettingsError> {
    let secret_value = serde_json::to_string(secret_key)?;
    Ok(render_remote_management_scalar(
        config,
        "secret-key",
        &secret_value,
    ))
}

pub fn read_management_secret_state(
    paths: &DesktopPaths,
) -> Result<ManagementSecretStatus, SettingsError> {
    let config = fs::read_to_string(&paths.config_file)?;
    management_secret_state_from_config(&config)
}

pub fn write_management_secret_key(
    paths: &DesktopPaths,
    secret_key: &str,
) -> Result<(), SettingsError> {
    let config = fs::read_to_string(&paths.config_file)?;
    let updated = render_config_with_management_secret(&config, secret_key)?;
    fs::write(&paths.config_file, updated)?;
    Ok(())
}

pub fn ensure_panel_resources(
    paths: &DesktopPaths,
    bundled_panel_dir: impl AsRef<Path>,
) -> Result<bool, SettingsError> {
    if paths.panel_dir.join("manage.html").is_file() {
        return Ok(false);
    }

    copy_panel_resources(paths, bundled_panel_dir)?;
    Ok(true)
}

pub fn copy_panel_resources(
    paths: &DesktopPaths,
    bundled_panel_dir: impl AsRef<Path>,
) -> Result<(), SettingsError> {
    let bundled_panel_dir = bundled_panel_dir.as_ref();
    let source_entrypoint = bundled_panel_dir.join("manage.html");

    if !source_entrypoint.is_file() {
        return Err(SettingsError::MissingPanelEntrypoint(source_entrypoint));
    }

    if paths.panel_dir.exists() {
        fs::remove_dir_all(&paths.panel_dir)?;
    }

    copy_dir_recursive(bundled_panel_dir, &paths.panel_dir)?;

    let runtime_entrypoint = paths.panel_dir.join("manage.html");
    if !runtime_entrypoint.is_file() {
        return Err(SettingsError::MissingPanelEntrypoint(runtime_entrypoint));
    }

    Ok(())
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), SettingsError> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn leading_whitespace_len(line: &str) -> usize {
    line.chars()
        .take_while(|character| character.is_whitespace())
        .count()
}

fn find_remote_management_scalar(config: &str, key: &str) -> Option<String> {
    let lines = config.lines().collect::<Vec<_>>();
    let section_start = find_top_level_remote_management_section(&lines)?;
    let section_end = remote_management_section_end(&lines, section_start);
    let child_indent = remote_management_child_indent(&lines, section_start, section_end);
    let key_prefix = format!("{key}:");

    lines[section_start + 1..section_end]
        .iter()
        .find_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty()
                || leading_whitespace_len(line) != child_indent
                || !trimmed.starts_with(&key_prefix)
            {
                return None;
            }

            Some(trimmed[key_prefix.len()..].trim().to_string())
        })
}

fn render_remote_management_scalar(config: &str, key: &str, value: &str) -> String {
    let mut lines = config.lines().map(ToString::to_string).collect::<Vec<_>>();
    let new_line = |indent: usize| format!("{}{}: {}", " ".repeat(indent), key, value);

    if let Some(section_start) = find_top_level_remote_management_section(
        &lines.iter().map(String::as_str).collect::<Vec<_>>(),
    ) {
        let borrowed = lines.iter().map(String::as_str).collect::<Vec<_>>();
        let section_end = remote_management_section_end(&borrowed, section_start);
        let child_indent = remote_management_child_indent(&borrowed, section_start, section_end);
        let key_prefix = format!("{key}:");

        if let Some(existing_index) = borrowed[section_start + 1..section_end]
            .iter()
            .position(|line| {
                let trimmed = line.trim();
                !trimmed.is_empty()
                    && leading_whitespace_len(line) == child_indent
                    && trimmed.starts_with(&key_prefix)
            })
            .map(|index| section_start + 1 + index)
        {
            lines[existing_index] = new_line(child_indent);
        } else {
            lines.insert(section_start + 1, new_line(child_indent));
        }
    } else {
        lines.push("remote-management:".to_string());
        lines.push(new_line(2));
    }

    let mut rendered = lines.join("\n");
    if config.ends_with('\n') {
        rendered.push('\n');
    }
    rendered
}

fn find_top_level_remote_management_section(lines: &[&str]) -> Option<usize> {
    lines
        .iter()
        .position(|line| leading_whitespace_len(line) == 0 && line.trim() == "remote-management:")
}

fn remote_management_section_end(lines: &[&str], section_start: usize) -> usize {
    lines[section_start + 1..]
        .iter()
        .position(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && leading_whitespace_len(line) == 0
        })
        .map(|index| section_start + 1 + index)
        .unwrap_or(lines.len())
}

fn remote_management_child_indent(
    lines: &[&str],
    section_start: usize,
    section_end: usize,
) -> usize {
    lines[section_start + 1..section_end]
        .iter()
        .find_map(|line| {
            let trimmed = line.trim();
            let indent = leading_whitespace_len(line);
            if trimmed.is_empty() || indent == 0 {
                None
            } else {
                Some(indent)
            }
        })
        .unwrap_or(2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("系统时间早于 UNIX_EPOCH")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("clirelay-desktop-{name}-{suffix}"));
            fs::create_dir_all(&path).expect("创建临时目录失败");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn temp_dir(name: &str) -> TempDir {
        TempDir::new(name)
    }

    #[test]
    fn default_settings_serializes_schema_version_one() {
        let settings = DesktopSettings::default();
        let serialized = serde_json::to_value(&settings).expect("序列化默认设置失败");

        assert_eq!(serialized["schema_version"], 1);
    }

    #[test]
    fn default_settings_use_chinese_locale() {
        let settings = DesktopSettings::default();

        assert_eq!(settings.locale, DesktopLocale::ZhCn);
    }

    #[test]
    fn loads_existing_camel_case_settings_file() {
        let root = temp_dir("camel-case-settings");
        let paths = DesktopPaths::for_test(root.path().join("app-data"), root.path().join("logs"));
        fs::create_dir_all(&paths.state_dir).expect("创建 state 目录失败");
        fs::write(
            &paths.settings_file,
            [
                "{",
                "  \"schemaVersion\": 1,",
                "  \"firstRunCompleted\": false,",
                "  \"autoStartApp\": false,",
                "  \"autoStartService\": false,",
                "  \"openPanelOnStart\": false,",
                "  \"port\": 8318,",
                "  \"autoCheckNewVersions\": false,",
                "  \"lastUpdateCheckAt\": null",
                "}",
            ]
            .join("\n"),
        )
        .expect("写入 camelCase settings 失败");

        let settings = load_or_create_settings(&paths).expect("读取 camelCase settings 应成功");

        assert_eq!(settings.schema_version, SETTINGS_SCHEMA_VERSION);
        assert_eq!(settings.port, 8318);
        assert!(!settings.open_panel_on_start);
    }

    #[test]
    fn rejects_ports_below_1024() {
        assert!(DesktopSettings::default().with_port(1023).is_err());
    }

    #[test]
    fn accepts_lowest_user_port() {
        assert_eq!(
            DesktopSettings::default().with_port(1024).unwrap().port,
            1024
        );
    }

    #[test]
    fn accepts_highest_port() {
        assert_eq!(
            DesktopSettings::default().with_port(65535).unwrap().port,
            65535
        );
    }

    #[test]
    fn writes_config_with_desktop_port_and_auto_update_disabled() {
        let root = temp_dir("config");
        let paths = DesktopPaths::for_test(root.path().join("app-data"), root.path().join("logs"));
        let source = root.path().join("config.example.yaml");
        fs::write(
            &source,
            [
                "host: \"\"",
                "port: 9000",
                "remote-management:",
                "  disable-control-panel: false",
                "  panel-github-repository: \"https://github.com/kittors/codeProxy\"",
                "auto-update:",
                "  enabled: true",
                "  channel: main",
                "",
            ]
            .join("\n"),
        )
        .expect("写入源配置失败");

        let settings = DesktopSettings::default().with_port(8317).unwrap();
        ensure_runtime_config(&paths, &source, &settings).expect("生成 runtime config 失败");

        let config = fs::read_to_string(paths.config_file).expect("读取 runtime config 失败");
        assert!(config.contains("port: 8317"));
        assert!(config.contains("auto-update:\n  enabled: false"));
        assert!(config.contains("remote-management:\n  disable-control-panel: false"));
        assert!(
            config.contains("panel-github-repository: \"https://github.com/kittors/codeProxy\"")
        );
        assert!(!paths.runtime_dir.join("auths").exists());
    }

    #[test]
    fn detects_missing_management_secret_key_variants() {
        for config in [
            "remote-management:\n  secret-key: \"\"\n",
            "remote-management:\n  secret-key:\n",
            "remote-management:\n  allow-remote: false\n",
            "port: 8317\n",
        ] {
            assert_eq!(
                management_secret_state_from_config(config).unwrap(),
                ManagementSecretStatus::Missing
            );
        }
    }

    #[test]
    fn detects_configured_management_secret_key() {
        let config = "remote-management:\n  secret-key: \"abc: 123\"\n";

        assert_eq!(
            management_secret_state_from_config(config).unwrap(),
            ManagementSecretStatus::Configured
        );
    }

    #[test]
    fn replaces_existing_management_secret_key() {
        let config = [
            "port: 8317",
            "remote-management:",
            "  allow-remote: false",
            "  secret-key: \"\"",
            "  disable-control-panel: false",
            "",
        ]
        .join("\n");

        let updated = render_config_with_management_secret(&config, "abc: 123").unwrap();

        assert!(updated.contains("secret-key: \"abc: 123\""));
        assert!(updated.contains("disable-control-panel: false"));
    }

    #[test]
    fn inserts_management_secret_key_when_field_is_missing() {
        let config = [
            "port: 8317",
            "remote-management:",
            "  allow-remote: false",
            "  disable-control-panel: false",
            "",
        ]
        .join("\n");

        let updated = render_config_with_management_secret(&config, "abc#123").unwrap();

        assert!(updated.contains("remote-management:\n  secret-key: \"abc#123\"\n"));
        assert!(updated.contains("  disable-control-panel: false"));
    }

    #[test]
    fn appends_remote_management_section_when_missing() {
        let config = "port: 8317\n";

        let updated = render_config_with_management_secret(config, "abc").unwrap();

        assert!(updated.ends_with("remote-management:\n  secret-key: \"abc\"\n"));
    }

    #[test]
    fn copies_panel_resources_to_runtime_panel_dir() {
        let root = temp_dir("panel");
        let paths = DesktopPaths::for_test(root.path().join("app-data"), root.path().join("logs"));
        let source = root.path().join("panel-source");
        fs::create_dir_all(source.join("assets")).expect("创建 panel 源目录失败");
        fs::write(source.join("manage.html"), "<html></html>").expect("写入 manage.html 失败");
        fs::write(source.join("assets").join("panel.js"), "console.log('ok');")
            .expect("写入 panel asset 失败");

        copy_panel_resources(&paths, &source).expect("复制 panel 资源失败");

        assert!(paths.panel_dir.join("manage.html").exists());
        assert!(paths.panel_dir.join("assets").join("panel.js").exists());
    }

    #[test]
    fn rejects_panel_copy_without_entrypoint() {
        let root = temp_dir("missing-panel");
        let paths = DesktopPaths::for_test(root.path().join("app-data"), root.path().join("logs"));
        let source = root.path().join("panel-source");
        fs::create_dir_all(&source).expect("创建 panel 源目录失败");

        let error = copy_panel_resources(&paths, &source).expect_err("缺少入口应失败");

        assert!(format!("{error}").contains("manage.html"));
    }
}
