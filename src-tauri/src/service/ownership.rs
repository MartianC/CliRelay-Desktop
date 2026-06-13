use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeState {
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub executable_path: PathBuf,
    pub executable_sha256: String,
    pub port: u16,
    pub desktop_version: String,
    pub launch_id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProcessOwnership {
    Owned,
    External,
    Stale,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProcessSnapshot {
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub executable_path: PathBuf,
    pub executable_sha256: String,
}

pub fn determine_process_ownership(
    runtime_state: &RuntimeState,
    process_snapshot: Option<&ProcessSnapshot>,
) -> ProcessOwnership {
    let Some(process_snapshot) = process_snapshot else {
        return ProcessOwnership::Stale;
    };

    if process_snapshot.pid != runtime_state.pid
        || process_snapshot.started_at != runtime_state.started_at
        || process_snapshot.executable_path != runtime_state.executable_path
        || process_snapshot.executable_sha256 != runtime_state.executable_sha256
    {
        return ProcessOwnership::External;
    }

    ProcessOwnership::Owned
}

pub fn read_runtime_state(path: impl Into<PathBuf>) -> io::Result<Option<RuntimeState>> {
    let path = path.into();

    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path)?;
    let runtime_state = serde_json::from_str::<RuntimeState>(&raw)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    Ok(Some(runtime_state))
}

pub fn write_runtime_state(
    path: impl Into<PathBuf>,
    runtime_state: &RuntimeState,
) -> io::Result<()> {
    let path = path.into();

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let raw = serde_json::to_string_pretty(runtime_state)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    fs::write(path, format!("{raw}\n"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
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
            let process_id = std::process::id();
            let path =
                std::env::temp_dir().join(format!("clirelay-desktop-{name}-{process_id}-{suffix}"));
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

    fn runtime_state() -> RuntimeState {
        RuntimeState {
            pid: 12345,
            started_at: DateTime::from_timestamp(1_700_000_000, 0).unwrap(),
            executable_path: PathBuf::from("/Applications/CliRelay Desktop.app/sidecar"),
            executable_sha256: "sidecar-sha".to_string(),
            port: 8317,
            desktop_version: "0.0.1-preview.1".to_string(),
            launch_id: Uuid::nil(),
        }
    }

    fn matching_snapshot() -> ProcessSnapshot {
        let state = runtime_state();

        ProcessSnapshot {
            pid: state.pid,
            started_at: state.started_at,
            executable_path: state.executable_path,
            executable_sha256: state.executable_sha256,
        }
    }

    #[test]
    fn pid_not_found_is_stale() {
        assert_eq!(
            determine_process_ownership(&runtime_state(), None),
            ProcessOwnership::Stale
        );
    }

    #[test]
    fn path_mismatch_is_external() {
        let mut snapshot = matching_snapshot();
        snapshot.executable_path = PathBuf::from("/usr/local/bin/cli-proxy-api");

        assert_eq!(
            determine_process_ownership(&runtime_state(), Some(&snapshot)),
            ProcessOwnership::External
        );
    }

    #[test]
    fn sha_mismatch_is_external() {
        let mut snapshot = matching_snapshot();
        snapshot.executable_sha256 = "different-sha".to_string();

        assert_eq!(
            determine_process_ownership(&runtime_state(), Some(&snapshot)),
            ProcessOwnership::External
        );
    }

    #[test]
    fn start_time_mismatch_is_external() {
        let mut snapshot = matching_snapshot();
        snapshot.started_at = DateTime::from_timestamp(1_700_000_001, 0).unwrap();

        assert_eq!(
            determine_process_ownership(&runtime_state(), Some(&snapshot)),
            ProcessOwnership::External
        );
    }

    #[test]
    fn matching_pid_start_time_path_and_sha_is_owned() {
        let snapshot = matching_snapshot();

        assert_eq!(
            determine_process_ownership(&runtime_state(), Some(&snapshot)),
            ProcessOwnership::Owned
        );
    }

    #[test]
    fn runtime_state_uses_camel_case_json_fields() {
        let raw = serde_json::to_string(&runtime_state()).expect("序列化 runtime-state 失败");

        assert!(raw.contains("startedAt"));
        assert!(raw.contains("executablePath"));
        assert!(raw.contains("executableSha256"));
        assert!(raw.contains("desktopVersion"));
        assert!(raw.contains("launchId"));
    }

    #[test]
    fn writes_and_reads_runtime_state_file() {
        let temp = TempDir::new("runtime-state");
        let file = temp.path().join("state").join("runtime-state.json");
        let state = runtime_state();

        write_runtime_state(&file, &state).expect("写入 runtime-state 失败");
        let restored = read_runtime_state(&file)
            .expect("读取 runtime-state 失败")
            .expect("runtime-state 应存在");

        assert_eq!(restored.pid, state.pid);
        assert_eq!(restored.started_at, state.started_at);
        assert_eq!(restored.executable_path, state.executable_path);
        assert_eq!(restored.executable_sha256, state.executable_sha256);
        assert_eq!(restored.launch_id, state.launch_id);
    }
}
