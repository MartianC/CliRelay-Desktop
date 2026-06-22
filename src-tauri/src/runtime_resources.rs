use crate::paths::DesktopPaths;
use crate::settings::DesktopSettings;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct RuntimeResourceSources {
    pub panel_dir: PathBuf,
    pub sidecar_executable: PathBuf,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RuntimeRepairReport {
    pub sidecar_rebuilt: bool,
    pub panel_rebuilt: bool,
    pub config_rebuilt: bool,
}

#[derive(Debug)]
pub enum RuntimeResourceError {
    MissingBundledSidecar(PathBuf),
    MissingRuntimeConfig(PathBuf),
    Io(std::io::Error),
    Settings(crate::settings::SettingsError),
}

impl std::fmt::Display for RuntimeResourceError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingBundledSidecar(path) => {
                write!(
                    formatter,
                    "app bundle 中缺少 CliRelay sidecar: {}",
                    path.display()
                )
            }
            Self::MissingRuntimeConfig(path) => {
                write!(formatter, "CliRelay config 文件不存在: {}", path.display())
            }
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Settings(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for RuntimeResourceError {}

impl From<std::io::Error> for RuntimeResourceError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<crate::settings::SettingsError> for RuntimeResourceError {
    fn from(error: crate::settings::SettingsError) -> Self {
        Self::Settings(error)
    }
}

pub fn ensure_runtime_resources(
    paths: &DesktopPaths,
    _settings: &DesktopSettings,
    sources: &RuntimeResourceSources,
) -> Result<RuntimeRepairReport, RuntimeResourceError> {
    crate::settings::ensure_desktop_dirs(paths)?;

    let sidecar_rebuilt = ensure_runtime_sidecar(paths, &sources.sidecar_executable)?;
    let panel_rebuilt = crate::settings::ensure_panel_resources(paths, &sources.panel_dir)?;
    let config_rebuilt = false;

    Ok(RuntimeRepairReport {
        sidecar_rebuilt,
        panel_rebuilt,
        config_rebuilt,
    })
}

pub fn ensure_runtime_config_present(paths: &DesktopPaths) -> Result<(), RuntimeResourceError> {
    if paths.config_file.is_file() {
        return Ok(());
    }

    Err(RuntimeResourceError::MissingRuntimeConfig(
        paths.config_file.clone(),
    ))
}

fn ensure_runtime_sidecar(
    paths: &DesktopPaths,
    bundled_sidecar: &Path,
) -> Result<bool, RuntimeResourceError> {
    if paths.runtime_sidecar_executable.is_file() {
        return Ok(false);
    }

    if !bundled_sidecar.is_file() {
        return Err(RuntimeResourceError::MissingBundledSidecar(
            bundled_sidecar.to_path_buf(),
        ));
    }

    if paths.runtime_sidecar_dir.exists() {
        std::fs::remove_dir_all(&paths.runtime_sidecar_dir)?;
    }
    std::fs::create_dir_all(&paths.runtime_sidecar_dir)?;
    std::fs::copy(bundled_sidecar, &paths.runtime_sidecar_executable)?;
    set_executable(&paths.runtime_sidecar_executable)?;

    Ok(true)
}

#[cfg(unix)]
fn set_executable(path: &Path) -> Result<(), RuntimeResourceError> {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = std::fs::metadata(path)?.permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(path, permissions)?;
    Ok(())
}

#[cfg(not(unix))]
fn set_executable(_path: &Path) -> Result<(), RuntimeResourceError> {
    Ok(())
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
            let path = std::env::temp_dir().join(format!(
                "clirelay-desktop-runtime-resources-{name}-{}-{suffix}",
                std::process::id()
            ));
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

    fn fixture(name: &str) -> (TempDir, DesktopPaths, RuntimeResourceSources) {
        let root = TempDir::new(name);
        let paths = DesktopPaths::for_test(root.path().join("app-data"), root.path().join("logs"));
        let bundle = root.path().join("bundle");
        let bundle_panel = bundle.join("panel");
        fs::create_dir_all(bundle_panel.join("assets")).expect("创建 bundle panel 失败");
        fs::write(
            bundle_panel.join("manage.html"),
            "<html><head><title>Code Proxy Admin Dashboard</title></head></html>",
        )
        .expect("写入 bundle panel 失败");
        fs::write(
            bundle_panel.join("assets").join("panel.js"),
            "console.log('bundle');",
        )
        .expect("写入 bundle panel asset 失败");

        let bundle_sidecar = bundle.join("clirelay-aarch64-apple-darwin");
        fs::write(&bundle_sidecar, "bundle-sidecar").expect("写入 bundle sidecar 失败");
        let sources = RuntimeResourceSources {
            panel_dir: bundle_panel,
            sidecar_executable: bundle_sidecar,
        };

        (root, paths, sources)
    }

    #[test]
    fn rebuilds_missing_sidecar_from_bundle() {
        let (_root, paths, sources) = fixture("missing-sidecar");
        let settings = DesktopSettings::default().with_port(8317).unwrap();

        let report = ensure_runtime_resources(&paths, &settings, &sources)
            .expect("修复 runtime resources 应成功");

        assert!(report.sidecar_rebuilt);
        assert_eq!(
            fs::read_to_string(&paths.runtime_sidecar_executable)
                .expect("读取 runtime sidecar 失败"),
            "bundle-sidecar"
        );
    }

    #[test]
    fn rebuilds_missing_panel_from_bundle() {
        let (_root, paths, sources) = fixture("missing-panel");
        let settings = DesktopSettings::default().with_port(8317).unwrap();

        let report = ensure_runtime_resources(&paths, &settings, &sources)
            .expect("修复 runtime resources 应成功");

        assert!(report.panel_rebuilt);
        assert!(paths.panel_dir.join("manage.html").is_file());
        assert!(paths.panel_dir.join("assets").join("panel.js").is_file());
        let html = fs::read_to_string(paths.panel_dir.join("manage.html"))
            .expect("读取 panel 失败");
        assert!(html.contains("Code Proxy Admin Dashboard"));
    }

    #[test]
    fn leaves_missing_config_for_startup_import_gate() {
        let (_root, paths, sources) = fixture("missing-config");
        let settings = DesktopSettings::default().with_port(8456).unwrap();

        let report = ensure_runtime_resources(&paths, &settings, &sources)
            .expect("修复 runtime resources 应成功");

        assert!(!report.config_rebuilt);
        assert!(!paths.config_file.exists());
    }

    #[test]
    fn preserves_existing_config_when_rebuilding_other_runtime_resources() {
        let (_root, paths, sources) = fixture("preserve-config");
        fs::create_dir_all(&paths.runtime_dir).expect("创建 runtime 目录失败");
        fs::write(
            &paths.config_file,
            [
                "host: \"127.0.0.1\"",
                "port: 8317",
                "api-keys:",
                "  - user-custom-key",
                "",
            ]
            .join("\n"),
        )
        .expect("写入已有 config 失败");
        let settings = DesktopSettings::default().with_port(8456).unwrap();

        let report = ensure_runtime_resources(&paths, &settings, &sources)
            .expect("修复 runtime resources 应成功");

        assert!(report.sidecar_rebuilt);
        assert!(report.panel_rebuilt);
        assert!(!report.config_rebuilt);
        let config = fs::read_to_string(&paths.config_file).expect("读取 runtime config 失败");
        assert!(config.contains("user-custom-key"));
        assert!(config.contains("port: 8317"));
    }
}
