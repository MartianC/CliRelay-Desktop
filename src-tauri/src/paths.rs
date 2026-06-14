use std::path::{Path, PathBuf};

pub const APP_DIR_NAME: &str = "CliRelay Desktop";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopPaths {
    pub app_data_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub runtime_sidecar_dir: PathBuf,
    pub runtime_sidecar_executable: PathBuf,
    pub state_dir: PathBuf,
    pub update_downloads_dir: PathBuf,
    pub update_staging_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub log_dir: PathBuf,
    pub desktop_log: PathBuf,
    pub clirelay_log: PathBuf,
    pub settings_file: PathBuf,
    pub runtime_state_file: PathBuf,
    pub component_state_file: PathBuf,
    pub config_file: PathBuf,
    pub panel_dir: PathBuf,
}

impl DesktopPaths {
    pub fn from_home_dir(home_dir: impl AsRef<Path>) -> Self {
        let home_dir = home_dir.as_ref();
        let app_data_dir = home_dir
            .join("Library")
            .join("Application Support")
            .join(APP_DIR_NAME);
        let log_dir = home_dir.join("Library").join("Logs").join(APP_DIR_NAME);

        Self::from_base_dirs(app_data_dir, log_dir)
    }

    pub fn from_base_dirs(app_data_dir: impl Into<PathBuf>, log_dir: impl Into<PathBuf>) -> Self {
        let app_data_dir = app_data_dir.into();
        let log_dir = log_dir.into();
        let runtime_dir = app_data_dir.join("runtime");
        let runtime_sidecar_dir = runtime_dir.join("sidecar");
        let state_dir = app_data_dir.join("state");
        let backups_dir = app_data_dir.join("backups");

        Self {
            app_data_dir,
            runtime_dir: runtime_dir.clone(),
            runtime_sidecar_dir: runtime_sidecar_dir.clone(),
            runtime_sidecar_executable: runtime_sidecar_dir.join("cli-proxy-api"),
            state_dir: state_dir.clone(),
            update_downloads_dir: state_dir.join("downloads"),
            update_staging_dir: state_dir.join("update-staging"),
            backups_dir,
            log_dir: log_dir.clone(),
            desktop_log: log_dir.join("desktop.log"),
            clirelay_log: log_dir.join("clirelay.log"),
            settings_file: state_dir.join("desktop-settings.json"),
            runtime_state_file: state_dir.join("runtime-state.json"),
            component_state_file: state_dir.join("component-state.json"),
            config_file: runtime_dir.join("config.yaml"),
            panel_dir: runtime_dir.join("panel"),
        }
    }

    #[cfg(test)]
    pub fn for_test(app_data_dir: impl Into<PathBuf>, log_dir: impl Into<PathBuf>) -> Self {
        Self::from_base_dirs(app_data_dir, log_dir)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_expected_macos_runtime_and_log_paths() {
        let home = Path::new("/Users/tester");
        let paths = DesktopPaths::from_home_dir(home);

        assert_eq!(
            paths.runtime_dir,
            PathBuf::from("/Users/tester/Library/Application Support/CliRelay Desktop/runtime")
        );
        assert_eq!(
            paths.state_dir,
            PathBuf::from("/Users/tester/Library/Application Support/CliRelay Desktop/state")
        );
        assert_eq!(
            paths.log_dir,
            PathBuf::from("/Users/tester/Library/Logs/CliRelay Desktop")
        );
        assert_eq!(
            paths.panel_dir,
            PathBuf::from(
                "/Users/tester/Library/Application Support/CliRelay Desktop/runtime/panel"
            )
        );
        assert_eq!(
            paths.runtime_sidecar_executable,
            PathBuf::from(
                "/Users/tester/Library/Application Support/CliRelay Desktop/runtime/sidecar/cli-proxy-api"
            )
        );
        assert_eq!(
            paths.update_downloads_dir,
            PathBuf::from(
                "/Users/tester/Library/Application Support/CliRelay Desktop/state/downloads"
            )
        );
        assert_eq!(
            paths.update_staging_dir,
            PathBuf::from(
                "/Users/tester/Library/Application Support/CliRelay Desktop/state/update-staging"
            )
        );
    }

    #[test]
    fn keeps_state_files_out_of_runtime_directory() {
        let paths = DesktopPaths::from_home_dir(Path::new("/Users/tester"));

        assert_ne!(
            paths.runtime_state_file.parent(),
            Some(paths.runtime_dir.as_path())
        );
        assert_eq!(
            paths.runtime_state_file.parent(),
            Some(paths.state_dir.as_path())
        );
        assert_eq!(
            paths.component_state_file.parent(),
            Some(paths.state_dir.as_path())
        );
        assert_eq!(
            paths.config_file.parent(),
            Some(paths.runtime_dir.as_path())
        );
    }
}
