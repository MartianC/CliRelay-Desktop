use crate::paths::DesktopPaths;
use crate::platform::macos;
use crate::service::health::{
    check_http_reachable, check_panel_ready, probe_port, HealthStatus, PortProbe,
    HTTP_READY_TIMEOUT, PANEL_READY_TIMEOUT,
};
use crate::service::logs::append_clirelay_output_line;
use crate::service::ownership::{write_runtime_state, ProcessOwnership, RuntimeState};
use crate::service::state::{transition, ServiceEvent, ServiceStatus, StateTransitionError};
use crate::settings::{
    ensure_desktop_dirs, ensure_panel_resources, ensure_runtime_config, DesktopSettings,
    SettingsError,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::fmt;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
pub struct ServiceSnapshot {
    pub status: ServiceStatus,
    pub pid: Option<u32>,
    pub port: u16,
    pub endpoint: String,
    pub panel_url: String,
    pub started_at: Option<DateTime<Utc>>,
    pub last_exit_code: Option<i32>,
    pub last_error: Option<String>,
    pub ownership: ProcessOwnership,
    pub clirelay_version: String,
    pub sidecar_sha256: String,
}

#[derive(Clone, Debug)]
pub struct ServiceManagerConfig {
    pub paths: DesktopPaths,
    pub settings: DesktopSettings,
    pub bundled_config_example: PathBuf,
    pub bundled_panel_dir: PathBuf,
    pub sidecar_executable: PathBuf,
    pub host: String,
    pub desktop_version: String,
    pub clirelay_version: String,
    pub sidecar_sha256: String,
    pub timeouts: ManagerTimeouts,
    pub sidecar_env: Vec<(String, String)>,
}

impl ServiceManagerConfig {
    pub fn new(
        paths: DesktopPaths,
        settings: DesktopSettings,
        bundled_config_example: PathBuf,
        bundled_panel_dir: PathBuf,
        sidecar_executable: PathBuf,
    ) -> Self {
        Self {
            paths,
            settings,
            bundled_config_example,
            bundled_panel_dir,
            sidecar_executable,
            host: "127.0.0.1".to_string(),
            desktop_version: env!("CARGO_PKG_VERSION").to_string(),
            clirelay_version: "unknown".to_string(),
            sidecar_sha256: "unknown".to_string(),
            timeouts: ManagerTimeouts::default(),
            sidecar_env: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct ManagerTimeouts {
    pub http_ready: Duration,
    pub panel_ready: Duration,
    pub stop_grace: Duration,
    pub kill_grace: Duration,
    pub poll_interval: Duration,
}

impl Default for ManagerTimeouts {
    fn default() -> Self {
        Self {
            http_ready: HTTP_READY_TIMEOUT,
            panel_ready: PANEL_READY_TIMEOUT,
            stop_grace: Duration::from_secs(5),
            kill_grace: Duration::from_secs(2),
            poll_interval: Duration::from_millis(100),
        }
    }
}

#[derive(Debug)]
pub enum ManagerError {
    InvalidStatus(ServiceStatus),
    InvalidOwnership(ProcessOwnership),
    PortNotCliRelayLike,
    PortOccupiedCliRelayLike,
    PortOccupiedUnknown,
    ProcessExited(Option<i32>),
    Timeout(&'static str),
    Io(io::Error),
    Settings(SettingsError),
    State(StateTransitionError),
}

impl fmt::Display for ManagerError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidStatus(status) => {
                write!(formatter, "当前状态不允许执行该操作: {status:?}")
            }
            Self::InvalidOwnership(ownership) => {
                write!(formatter, "当前进程归属不允许执行该操作: {ownership:?}")
            }
            Self::PortNotCliRelayLike => write!(formatter, "端口上没有可连接的 CliRelay 类服务"),
            Self::PortOccupiedCliRelayLike => write!(formatter, "端口已被 CliRelay 类服务占用"),
            Self::PortOccupiedUnknown => write!(formatter, "端口已被未知服务占用"),
            Self::ProcessExited(code) => write!(formatter, "Sidecar 已退出，退出码: {code:?}"),
            Self::Timeout(stage) => write!(formatter, "等待 {stage} 超时"),
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Settings(error) => write!(formatter, "{error}"),
            Self::State(error) => write!(
                formatter,
                "非法状态转换: {:?} + {:?}",
                error.status, error.event
            ),
        }
    }
}

impl std::error::Error for ManagerError {}

impl From<io::Error> for ManagerError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<SettingsError> for ManagerError {
    fn from(error: SettingsError) -> Self {
        Self::Settings(error)
    }
}

impl From<StateTransitionError> for ManagerError {
    fn from(error: StateTransitionError) -> Self {
        Self::State(error)
    }
}

pub struct ServiceManager {
    config: ServiceManagerConfig,
    status: ServiceStatus,
    child: Option<Child>,
    pid: Option<u32>,
    started_at: Option<DateTime<Utc>>,
    last_exit_code: Option<i32>,
    last_error: Option<String>,
    ownership: ProcessOwnership,
}

impl ServiceManager {
    pub fn new(config: ServiceManagerConfig) -> Self {
        Self {
            config,
            status: ServiceStatus::Stopped,
            child: None,
            pid: None,
            started_at: None,
            last_exit_code: None,
            last_error: None,
            ownership: ProcessOwnership::Unknown,
        }
    }

    pub fn snapshot(&self) -> ServiceSnapshot {
        let endpoint = format!("http://{}:{}", self.config.host, self.config.settings.port);

        ServiceSnapshot {
            status: self.status.clone(),
            pid: self.pid,
            port: self.config.settings.port,
            panel_url: format!("{endpoint}/manage"),
            endpoint,
            started_at: self.started_at,
            last_exit_code: self.last_exit_code,
            last_error: self.last_error.clone(),
            ownership: self.ownership.clone(),
            clirelay_version: self.config.clirelay_version.clone(),
            sidecar_sha256: self.config.sidecar_sha256.clone(),
        }
    }

    pub fn update_settings(&mut self, settings: DesktopSettings) {
        self.config.settings = settings;
    }

    pub fn start_service(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        if !matches!(self.status, ServiceStatus::Stopped | ServiceStatus::Error) {
            return Err(ManagerError::InvalidStatus(self.status.clone()));
        }

        let start_event = if self.status == ServiceStatus::Error {
            ServiceEvent::RestartRequested
        } else {
            ServiceEvent::StartRequested
        };
        self.apply_event(start_event)?;
        self.last_error = None;
        self.last_exit_code = None;

        if let Err(error) = self.prepare_runtime() {
            return Err(self.fail_start(error.into(), ServiceEvent::Timeout));
        }

        match probe_port(&self.config.host, self.config.settings.port) {
            PortProbe::Free => {}
            PortProbe::OccupiedCliRelayLike => {
                return Err(self.fail_start(
                    ManagerError::PortOccupiedCliRelayLike,
                    ServiceEvent::Timeout,
                ));
            }
            PortProbe::OccupiedUnknown => {
                return Err(
                    self.fail_start(ManagerError::PortOccupiedUnknown, ServiceEvent::Timeout)
                );
            }
        }

        if let Err(error) = self.spawn_sidecar() {
            return Err(self.fail_start(error, ServiceEvent::ProcessExited));
        }

        if let Err(error) = self.wait_for_http_ready() {
            let event = start_failure_event(&error);
            return Err(self.fail_start(error, event));
        }

        if let Err(error) = self.wait_for_panel_ready() {
            let event = start_failure_event(&error);
            return Err(self.fail_start(error, event));
        }

        self.apply_event(ServiceEvent::Ready)?;
        self.ownership = ProcessOwnership::Owned;

        Ok(self.snapshot())
    }

    pub fn stop_service(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        if !matches!(
            self.status,
            ServiceStatus::Running | ServiceStatus::Unhealthy
        ) {
            return Err(ManagerError::InvalidStatus(self.status.clone()));
        }

        if self.ownership != ProcessOwnership::Owned {
            return Err(ManagerError::InvalidOwnership(self.ownership.clone()));
        }

        let stop_event = if self.status == ServiceStatus::Unhealthy {
            ServiceEvent::RestartRequested
        } else {
            ServiceEvent::StopRequested
        };
        self.apply_event(stop_event)?;

        if let Some(pid) = self.pid {
            let _ = macos::terminate_pid(pid);
            if !self.wait_for_child_exit(self.config.timeouts.stop_grace)? {
                let _ = macos::kill_pid(pid);
                if !self.wait_for_child_exit(self.config.timeouts.kill_grace)? {
                    return Err(self.fail_stop_timeout());
                }
            }
        }

        self.remove_runtime_state()?;
        self.clear_owned_process();
        self.apply_event(ServiceEvent::StopCompleted)?;

        Ok(self.snapshot())
    }

    pub fn restart_service(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        match self.status {
            ServiceStatus::Running | ServiceStatus::Unhealthy => {
                self.stop_service()?;
                self.start_service()
            }
            ServiceStatus::Error => self.start_service(),
            _ => Err(ManagerError::InvalidStatus(self.status.clone())),
        }
    }

    pub fn connect_external(&mut self) -> Result<ServiceSnapshot, ManagerError> {
        if !matches!(self.status, ServiceStatus::Stopped | ServiceStatus::Error) {
            return Err(ManagerError::InvalidStatus(self.status.clone()));
        }

        let start_event = if self.status == ServiceStatus::Error {
            ServiceEvent::RestartRequested
        } else {
            ServiceEvent::StartRequested
        };
        self.apply_event(start_event)?;

        match probe_port(&self.config.host, self.config.settings.port) {
            PortProbe::OccupiedCliRelayLike => {
                self.apply_event(ServiceEvent::PortOccupiedExternalConfirmed)?;
                self.pid = None;
                self.started_at = None;
                self.last_error = None;
                self.ownership = ProcessOwnership::External;
                Ok(self.snapshot())
            }
            PortProbe::Free => {
                Err(self.fail_start(ManagerError::PortNotCliRelayLike, ServiceEvent::Timeout))
            }
            PortProbe::OccupiedUnknown => {
                Err(self.fail_start(ManagerError::PortOccupiedUnknown, ServiceEvent::Timeout))
            }
        }
    }

    fn prepare_runtime(&self) -> Result<(), SettingsError> {
        ensure_desktop_dirs(&self.config.paths)?;
        ensure_runtime_config(
            &self.config.paths,
            &self.config.bundled_config_example,
            &self.config.settings,
        )?;
        ensure_panel_resources(&self.config.paths, &self.config.bundled_panel_dir)?;

        Ok(())
    }

    fn spawn_sidecar(&mut self) -> Result<(), ManagerError> {
        let mut command = Command::new(&self.config.sidecar_executable);
        command
            .current_dir(&self.config.paths.runtime_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in &self.config.sidecar_env {
            command.env(key, value);
        }

        let mut child = command.spawn()?;
        let pid = child.id();
        let started_at = macos::process_started_at(pid)
            .unwrap_or_else(|_| DateTime::<Utc>::from(SystemTime::now()));
        let executable_path = self
            .config
            .sidecar_executable
            .canonicalize()
            .unwrap_or_else(|_| self.config.sidecar_executable.clone());

        if let Some(stdout) = child.stdout.take() {
            spawn_log_pipe(stdout, self.config.paths.clone());
        }

        if let Some(stderr) = child.stderr.take() {
            spawn_log_pipe(stderr, self.config.paths.clone());
        }

        let runtime_state = RuntimeState {
            pid,
            started_at,
            executable_path,
            executable_sha256: self.config.sidecar_sha256.clone(),
            port: self.config.settings.port,
            desktop_version: self.config.desktop_version.clone(),
            launch_id: Uuid::new_v4(),
        };
        write_runtime_state(&self.config.paths.runtime_state_file, &runtime_state)?;

        self.pid = Some(pid);
        self.started_at = Some(started_at);
        self.child = Some(child);
        self.ownership = ProcessOwnership::Owned;

        Ok(())
    }

    fn wait_for_http_ready(&mut self) -> Result<(), ManagerError> {
        let host = self.config.host.clone();
        let port = self.config.settings.port;

        self.wait_for("HTTP ready", self.config.timeouts.http_ready, || {
            matches!(
                check_http_reachable(&host, port),
                HealthStatus::HttpReachable | HealthStatus::ManageReady
            )
        })
    }

    fn wait_for_panel_ready(&mut self) -> Result<(), ManagerError> {
        let host = self.config.host.clone();
        let port = self.config.settings.port;

        self.wait_for("Panel ready", self.config.timeouts.panel_ready, || {
            check_panel_ready(&host, port) == HealthStatus::ManageReady
        })
    }

    fn wait_for(
        &mut self,
        stage: &'static str,
        timeout: Duration,
        mut is_ready: impl FnMut() -> bool,
    ) -> Result<(), ManagerError> {
        let deadline = Instant::now() + timeout;

        loop {
            if let Some(exit_code) = self.collect_child_exit()? {
                return Err(ManagerError::ProcessExited(exit_code));
            }

            if is_ready() {
                return Ok(());
            }

            if Instant::now() >= deadline {
                return Err(ManagerError::Timeout(stage));
            }

            thread::sleep(self.config.timeouts.poll_interval);
        }
    }

    fn wait_for_child_exit(&mut self, timeout: Duration) -> Result<bool, ManagerError> {
        let deadline = Instant::now() + timeout;

        loop {
            if self.child.is_none() {
                return Ok(true);
            }

            if self.collect_child_exit()?.is_some() {
                return Ok(true);
            }

            if Instant::now() >= deadline {
                return Ok(false);
            }

            thread::sleep(self.config.timeouts.poll_interval);
        }
    }

    fn collect_child_exit(&mut self) -> Result<Option<Option<i32>>, ManagerError> {
        let exit_status = if let Some(child) = self.child.as_mut() {
            child.try_wait()?
        } else {
            None
        };

        let Some(exit_status) = exit_status else {
            return Ok(None);
        };

        self.child = None;
        self.last_exit_code = exit_status.code();

        Ok(Some(exit_status.code()))
    }

    fn fail_start(&mut self, error: ManagerError, event: ServiceEvent) -> ManagerError {
        let message = error.to_string();
        let _ = self.apply_event(event);
        self.last_error = Some(message);
        self.clear_owned_process();
        let _ = self.remove_runtime_state();
        error
    }

    fn fail_stop_timeout(&mut self) -> ManagerError {
        let error = ManagerError::Timeout("停止 Sidecar");
        self.last_error = Some(error.to_string());
        let _ = self.apply_event(ServiceEvent::Timeout);
        error
    }

    fn clear_owned_process(&mut self) {
        self.child = None;
        self.pid = None;
        self.started_at = None;
        self.ownership = ProcessOwnership::Unknown;
    }

    fn remove_runtime_state(&self) -> io::Result<()> {
        match fs::remove_file(&self.config.paths.runtime_state_file) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn apply_event(&mut self, event: ServiceEvent) -> Result<(), ManagerError> {
        self.status = transition(self.status.clone(), event)?;
        Ok(())
    }
}

impl Drop for ServiceManager {
    fn drop(&mut self) {
        if matches!(
            self.status,
            ServiceStatus::Running | ServiceStatus::Unhealthy
        ) && self.ownership == ProcessOwnership::Owned
        {
            let _ = self.stop_service();
        }
    }
}

fn start_failure_event(error: &ManagerError) -> ServiceEvent {
    match error {
        ManagerError::ProcessExited(_) => ServiceEvent::ProcessExited,
        _ => ServiceEvent::Timeout,
    }
}

fn spawn_log_pipe(reader: impl Read + Send + 'static, paths: DesktopPaths) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            let Ok(line) = line else {
                break;
            };
            let _ = append_clirelay_output_line(&paths, &line);
        }
    });
}
