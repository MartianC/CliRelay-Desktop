use crate::service::state::ServiceEvent;
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::Duration;

pub const HTTP_READY_TIMEOUT: Duration = Duration::from_secs(20);
pub const PANEL_READY_TIMEOUT: Duration = Duration::from_secs(40);
pub const SINGLE_REQUEST_TIMEOUT: Duration = Duration::from_secs(1);
pub const RUNNING_HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(5);
pub const CONSECUTIVE_FAILURE_THRESHOLD: u8 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HealthStatus {
    TcpClosed,
    HttpReachable,
    ManageReady,
    ManageTimeout,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortProbe {
    Free,
    OccupiedCliRelayLike,
    OccupiedUnknown,
}

#[derive(Clone, Debug, Default)]
pub struct HealthFailureTracker {
    consecutive_failures: u8,
}

impl HealthFailureTracker {
    pub fn record(&mut self, status: HealthStatus) -> Option<ServiceEvent> {
        if status.is_failure() {
            self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        } else {
            self.consecutive_failures = 0;
        }

        if self.consecutive_failures == CONSECUTIVE_FAILURE_THRESHOLD {
            Some(ServiceEvent::HealthFailedThreeTimes)
        } else {
            None
        }
    }
}

impl HealthStatus {
    fn is_failure(self) -> bool {
        matches!(self, Self::TcpClosed | Self::ManageTimeout)
    }
}

pub fn probe_port(host: &str, port: u16) -> PortProbe {
    match check_panel_ready_with_error(host, port) {
        Ok(HealthStatus::ManageReady) => PortProbe::OccupiedCliRelayLike,
        Ok(_) => PortProbe::OccupiedUnknown,
        Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => PortProbe::Free,
        Err(error) if error.kind() == io::ErrorKind::TimedOut => PortProbe::OccupiedUnknown,
        Err(_) => PortProbe::Free,
    }
}

pub fn check_panel_ready(host: &str, port: u16) -> HealthStatus {
    match check_panel_ready_with_error(host, port) {
        Ok(status) => status,
        Err(_) => HealthStatus::ManageTimeout,
    }
}

fn check_panel_ready_with_error(host: &str, port: u16) -> io::Result<HealthStatus> {
    let manage = http_get(host, port, "/manage")?;

    if manage.is_html_ok() {
        return Ok(HealthStatus::ManageReady);
    }

    if manage.is_redirect_to("/manage/login") {
        let login = http_get(host, port, "/manage/login")?;

        if login.is_html_ok() {
            return Ok(HealthStatus::ManageReady);
        }
    }

    let Ok(login) = http_get(host, port, "/manage/login") else {
        return Ok(HealthStatus::ManageTimeout);
    };

    if login.is_html_ok() {
        return Ok(HealthStatus::ManageReady);
    }

    Ok(HealthStatus::ManageTimeout)
}

pub fn check_http_reachable(host: &str, port: u16) -> HealthStatus {
    let Some(addr) = resolve_socket_addr(host, port) else {
        return HealthStatus::TcpClosed;
    };

    if TcpStream::connect_timeout(&addr, SINGLE_REQUEST_TIMEOUT).is_err() {
        return HealthStatus::TcpClosed;
    }

    if http_get(host, port, "/").is_ok() {
        HealthStatus::HttpReachable
    } else {
        HealthStatus::ManageTimeout
    }
}

fn resolve_socket_addr(host: &str, port: u16) -> Option<SocketAddr> {
    (host, port).to_socket_addrs().ok()?.next()
}

fn http_get(host: &str, port: u16, path: &str) -> io::Result<HttpResponse> {
    let addr = resolve_socket_addr(host, port)
        .ok_or_else(|| io::Error::new(io::ErrorKind::AddrNotAvailable, "无法解析地址"))?;
    let mut stream = TcpStream::connect_timeout(&addr, SINGLE_REQUEST_TIMEOUT)?;
    stream.set_read_timeout(Some(SINGLE_REQUEST_TIMEOUT))?;
    stream.set_write_timeout(Some(SINGLE_REQUEST_TIMEOUT))?;

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\nAccept: text/html,*/*\r\n\r\n"
    );
    stream.write_all(request.as_bytes())?;

    let mut raw = String::new();
    stream.read_to_string(&mut raw)?;
    HttpResponse::parse(&raw)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "HTTP 响应不可解析"))
}

#[derive(Clone, Debug)]
struct HttpResponse {
    status_code: u16,
    headers: HashMap<String, String>,
}

impl HttpResponse {
    fn parse(raw: &str) -> Option<Self> {
        let (head, _body) = raw.split_once("\r\n\r\n")?;
        let mut lines = head.lines();
        let status_line = lines.next()?;
        let status_code = status_line.split_whitespace().nth(1)?.parse().ok()?;
        let mut headers = HashMap::new();

        for line in lines {
            let Some((name, value)) = line.split_once(':') else {
                continue;
            };
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }

        Some(Self {
            status_code,
            headers,
        })
    }

    fn is_html_ok(&self) -> bool {
        self.status_code == 200
            && self
                .headers
                .get("content-type")
                .is_some_and(|content_type| content_type.to_ascii_lowercase().contains("text/html"))
    }

    fn is_redirect_to(&self, expected_location: &str) -> bool {
        matches!(self.status_code, 301 | 302)
            && self
                .headers
                .get("location")
                .is_some_and(|location| location == expected_location)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::state::ServiceEvent;
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::thread;

    fn free_local_port() -> u16 {
        TcpListener::bind(("127.0.0.1", 0))
            .expect("绑定临时端口失败")
            .local_addr()
            .expect("读取临时端口失败")
            .port()
    }

    fn spawn_http_server<F>(handler: F) -> SocketAddr
    where
        F: Fn(String) -> String + Send + 'static,
    {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("绑定测试 HTTP 服务失败");
        let addr = listener.local_addr().expect("读取测试 HTTP 地址失败");

        thread::spawn(move || {
            for stream in listener.incoming().take(4) {
                let mut stream = stream.expect("接受测试连接失败");
                let mut buffer = [0_u8; 2048];
                let bytes_read = stream.read(&mut buffer).expect("读取测试请求失败");
                let request = String::from_utf8_lossy(&buffer[..bytes_read]).to_string();
                let response = handler(request);
                stream
                    .write_all(response.as_bytes())
                    .expect("写入测试响应失败");
            }
        });

        addr
    }

    fn html_response(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        )
    }

    #[test]
    fn free_port_returns_free() {
        let port = free_local_port();

        assert_eq!(probe_port("127.0.0.1", port), PortProbe::Free);
    }

    #[test]
    fn unknown_http_service_returns_occupied_unknown() {
        let addr = spawn_http_server(|_| {
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}"
                .to_string()
        });

        assert_eq!(
            probe_port("127.0.0.1", addr.port()),
            PortProbe::OccupiedUnknown
        );
    }

    #[test]
    fn manage_html_returns_clirelay_like() {
        let addr = spawn_http_server(|request| {
            assert!(request.starts_with("GET /manage "));
            html_response("<html>manage</html>")
        });

        assert_eq!(
            probe_port("127.0.0.1", addr.port()),
            PortProbe::OccupiedCliRelayLike
        );
    }

    #[test]
    fn manage_redirect_to_login_is_panel_ready() {
        let addr = spawn_http_server(|request| {
            if request.starts_with("GET /manage ") {
                "HTTP/1.1 302 Found\r\nLocation: /manage/login\r\nContent-Length: 0\r\n\r\n"
                    .to_string()
            } else {
                assert!(request.starts_with("GET /manage/login "));
                html_response("<html>login</html>")
            }
        });

        assert_eq!(
            check_panel_ready("127.0.0.1", addr.port()),
            HealthStatus::ManageReady
        );
    }

    #[test]
    fn manage_login_html_is_panel_ready() {
        let addr = spawn_http_server(|request| {
            if request.starts_with("GET /manage ") {
                "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: 0\r\n\r\n"
                    .to_string()
            } else {
                assert!(request.starts_with("GET /manage/login "));
                html_response("<html>login</html>")
            }
        });

        assert_eq!(
            check_panel_ready("127.0.0.1", addr.port()),
            HealthStatus::ManageReady
        );
    }

    #[test]
    fn three_consecutive_health_failures_emit_unhealthy_event() {
        let mut tracker = HealthFailureTracker::default();

        assert_eq!(tracker.record(HealthStatus::TcpClosed), None);
        assert_eq!(tracker.record(HealthStatus::ManageTimeout), None);
        assert_eq!(
            tracker.record(HealthStatus::TcpClosed),
            Some(ServiceEvent::HealthFailedThreeTimes)
        );
    }
}
