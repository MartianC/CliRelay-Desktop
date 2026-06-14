use clirelay_desktop_lib::paths::DesktopPaths;
use clirelay_desktop_lib::service::health::{probe_port, PortProbe};
use clirelay_desktop_lib::service::manager::{
    ManagerError, ManagerTimeouts, ServiceManager, ServiceManagerConfig,
};
use clirelay_desktop_lib::service::ownership::ProcessOwnership;
use clirelay_desktop_lib::service::state::ServiceStatus;
use clirelay_desktop_lib::settings::DesktopSettings;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[test]
fn start_service_waits_for_delayed_panel_ready() {
    let fixture = ManagerFixture::new("delayed-ready");
    let sidecar = compile_mock_sidecar(fixture.path());
    let port = free_local_port();
    let mut manager = ServiceManager::new(fixture.manager_config(&sidecar, port, "run", 150));

    let snapshot = manager.start_service().expect("服务应启动成功");

    assert_eq!(snapshot.status, ServiceStatus::Running);
    assert_eq!(snapshot.ownership, ProcessOwnership::Owned);
    assert!(snapshot.pid.is_some());
    assert_eq!(snapshot.endpoint, format!("http://127.0.0.1:{port}"));
    assert_eq!(
        snapshot.panel_url,
        format!("http://127.0.0.1:{port}/manage")
    );
    assert!(fixture.paths.runtime_state_file.exists());
    assert!(fixture.paths.panel_dir.join("manage.html").exists());
    assert!(fixture.paths.runtime_dir.join("cwd-ok").exists());

    manager.stop_service().expect("清理测试 sidecar 失败");
}

#[test]
fn start_service_records_error_when_sidecar_exits_immediately() {
    let fixture = ManagerFixture::new("immediate-exit");
    let sidecar = compile_mock_sidecar(fixture.path());
    let port = free_local_port();
    let mut manager = ServiceManager::new(fixture.manager_config(&sidecar, port, "exit", 0));

    let error = manager.start_service().expect_err("立即退出应返回错误");
    let snapshot = manager.snapshot();

    assert!(matches!(error, ManagerError::ProcessExited(Some(23))));
    assert_eq!(snapshot.status, ServiceStatus::Error);
    assert_eq!(snapshot.last_exit_code, Some(23));
    assert!(!fixture.paths.runtime_state_file.exists());
}

#[test]
fn stop_service_terminates_sidecar_and_frees_port() {
    let fixture = ManagerFixture::new("stop-frees-port");
    let sidecar = compile_mock_sidecar(fixture.path());
    let port = free_local_port();
    let mut manager = ServiceManager::new(fixture.manager_config(&sidecar, port, "run", 0));
    manager.start_service().expect("服务应启动成功");

    let snapshot = manager.stop_service().expect("服务应停止成功");

    assert_eq!(snapshot.status, ServiceStatus::Stopped);
    assert_eq!(snapshot.pid, None);
    assert_eq!(snapshot.ownership, ProcessOwnership::Unknown);
    assert!(!fixture.paths.runtime_state_file.exists());
    assert_eq!(probe_port("127.0.0.1", port), PortProbe::Free);
}

#[test]
fn connect_external_marks_clirelay_like_port_without_taking_ownership() {
    let fixture = ManagerFixture::new("external");
    let port = spawn_external_clirelay_like_server();
    let sidecar = compile_mock_sidecar(fixture.path());
    let mut manager = ServiceManager::new(fixture.manager_config(&sidecar, port, "run", 0));

    let snapshot = manager.connect_external().expect("应连接外部服务");

    assert_eq!(snapshot.status, ServiceStatus::External);
    assert_eq!(snapshot.ownership, ProcessOwnership::External);
    assert_eq!(snapshot.pid, None);
    assert!(!fixture.paths.runtime_state_file.exists());
    assert!(matches!(
        manager.stop_service(),
        Err(ManagerError::InvalidStatus(ServiceStatus::External))
    ));
}

struct ManagerFixture {
    root: TempDir,
    paths: DesktopPaths,
    config_example: PathBuf,
    bundled_panel: PathBuf,
}

impl ManagerFixture {
    fn new(name: &str) -> Self {
        let root = TempDir::new(name);
        let paths =
            DesktopPaths::from_base_dirs(root.path().join("app-data"), root.path().join("logs"));
        let resources = root.path().join("resources");
        let bundled_panel = resources.join("panel");
        fs::create_dir_all(&bundled_panel).expect("创建测试 panel 目录失败");
        fs::write(bundled_panel.join("manage.html"), "<html>manage</html>")
            .expect("写入测试 manage.html 失败");

        let config_example = resources.join("config.example.yaml");
        fs::write(
            &config_example,
            [
                "host: \"\"",
                "port: 9000",
                "remote-management:",
                "  disable-control-panel: false",
                "auto-update:",
                "  enabled: true",
                "",
            ]
            .join("\n"),
        )
        .expect("写入测试 config.example.yaml 失败");

        Self {
            root,
            paths,
            config_example,
            bundled_panel,
        }
    }

    fn path(&self) -> &Path {
        self.root.path()
    }

    fn manager_config(
        &self,
        sidecar: &Path,
        port: u16,
        mode: &str,
        ready_delay_ms: u64,
    ) -> ServiceManagerConfig {
        let mut config = ServiceManagerConfig::new(
            self.paths.clone(),
            DesktopSettings::default().with_port(port).unwrap(),
            self.config_example.clone(),
            self.bundled_panel.clone(),
            sidecar.to_path_buf(),
        );
        config.clirelay_version = "mock-sidecar".to_string();
        config.code_proxy_version = "mock-panel".to_string();
        config.sidecar_sha256 = "mock-sha256".to_string();
        config.desktop_version = "0.1.0-test".to_string();
        config.timeouts = ManagerTimeouts {
            http_ready: Duration::from_secs(3),
            panel_ready: Duration::from_secs(3),
            stop_grace: Duration::from_millis(500),
            kill_grace: Duration::from_millis(500),
            poll_interval: Duration::from_millis(25),
        };
        config
            .sidecar_env
            .push(("CLIRELAY_MOCK_MODE".to_string(), mode.to_string()));
        config.sidecar_env.push((
            "CLIRELAY_MOCK_READY_DELAY_MS".to_string(),
            ready_delay_ms.to_string(),
        ));
        config
    }
}

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
        let path = std::env::temp_dir().join(format!(
            "clirelay-desktop-service-manager-{name}-{process_id}-{suffix}"
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

fn free_local_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("绑定临时端口失败")
        .local_addr()
        .expect("读取临时端口失败")
        .port()
}

fn compile_mock_sidecar(root: &Path) -> PathBuf {
    let source = root.join("mock_sidecar.rs");
    let binary = root.join("mock_sidecar");
    fs::write(&source, MOCK_SIDECAR_SOURCE).expect("写入 mock sidecar 源码失败");

    let status = Command::new("rustc")
        .arg(&source)
        .arg("-o")
        .arg(&binary)
        .status()
        .expect("启动 rustc 失败");
    assert!(status.success(), "编译 mock sidecar 失败");

    binary
}

fn spawn_external_clirelay_like_server() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("绑定外部测试服务失败");
    let port = listener
        .local_addr()
        .expect("读取外部测试服务端口失败")
        .port();

    thread::spawn(move || {
        for stream in listener.incoming().take(4) {
            let mut stream = stream.expect("接受外部测试连接失败");
            let mut buffer = [0_u8; 2048];
            let bytes_read = stream.read(&mut buffer).expect("读取外部测试请求失败");
            let request = String::from_utf8_lossy(&buffer[..bytes_read]);
            let response = if request.starts_with("GET /manage ") {
                "HTTP/1.1 302 Found\r\nLocation: /manage/login\r\nContent-Length: 0\r\n\r\n"
                    .to_string()
            } else {
                "<html>login</html>".to_html_response()
            };
            stream
                .write_all(response.as_bytes())
                .expect("写入外部测试响应失败");
        }
    });

    port
}

trait HtmlResponse {
    fn to_html_response(&self) -> String;
}

impl HtmlResponse for str {
    fn to_html_response(&self) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
            self.len(),
            self
        )
    }
}

const MOCK_SIDECAR_SOURCE: &str = r#"
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

fn main() {
    let mode = env::var("CLIRELAY_MOCK_MODE").unwrap_or_else(|_| "run".to_string());
    if mode == "exit" {
        eprintln!("mock sidecar exits immediately");
        std::process::exit(23);
    }

    let delay = env::var("CLIRELAY_MOCK_READY_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    thread::sleep(Duration::from_millis(delay));

    let cwd = env::current_dir().expect("读取 cwd 失败");
    fs::write(cwd.join("cwd-ok"), "ok").expect("写入 cwd 标记失败");
    let port = read_port(&cwd.join("config.yaml"));
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("绑定 mock sidecar 端口失败");

    for stream in listener.incoming() {
        let mut stream = stream.expect("接受 mock 请求失败");
        let mut buffer = [0_u8; 2048];
        let bytes_read = stream.read(&mut buffer).expect("读取 mock 请求失败");
        let request = String::from_utf8_lossy(&buffer[..bytes_read]);
        let response = if request.starts_with("GET /manage ") {
            "HTTP/1.1 302 Found\r\nLocation: /manage/login\r\nContent-Length: 0\r\n\r\n".to_string()
        } else if request.starts_with("GET /manage/login ") {
            html_response("<html>login</html>")
        } else {
            "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\n\r\nok".to_string()
        };
        stream.write_all(response.as_bytes()).expect("写入 mock 响应失败");
    }
}

fn read_port(path: &std::path::Path) -> u16 {
    let raw = fs::read_to_string(path).expect("读取 config.yaml 失败");
    raw.lines()
        .find_map(|line| {
            let line = line.trim();
            line.strip_prefix("port:")
                .and_then(|value| value.trim().parse::<u16>().ok())
        })
        .expect("config.yaml 缺少 port")
}

fn html_response(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
}
"#;
