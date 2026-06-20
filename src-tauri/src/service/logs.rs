use crate::paths::DesktopPaths;
use std::fs;
use std::fs::OpenOptions;
use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_LOG_BYTES: u64 = 10 * 1024 * 1024;
pub const MAX_ROTATED_FILES: usize = 5;

pub fn rotate_log_if_needed(log_path: impl AsRef<Path>) -> io::Result<bool> {
    let log_path = log_path.as_ref();

    if !log_path.exists() || fs::metadata(log_path)?.len() <= MAX_LOG_BYTES {
        return Ok(false);
    }

    let oldest = rotated_log_path(log_path, MAX_ROTATED_FILES);
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }

    for index in (1..MAX_ROTATED_FILES).rev() {
        let source = rotated_log_path(log_path, index);
        if source.exists() {
            fs::rename(source, rotated_log_path(log_path, index + 1))?;
        }
    }

    fs::rename(log_path, rotated_log_path(log_path, 1))?;

    Ok(true)
}

pub fn redact_log_line(input: &str) -> String {
    let rules = [
        RedactionRule::new("Authorization:", "Authorization: [REDACTED]"),
        RedactionRule::new("authorization:", "authorization: [REDACTED]"),
        RedactionRule::new("api_key=", "api_key=[REDACTED]"),
        RedactionRule::new("api-key:", "api-key: [REDACTED]"),
        RedactionRule::new("cookie:", "cookie: [REDACTED]"),
        RedactionRule::new("oauth_token=", "oauth_token=[REDACTED]"),
        RedactionRule::new("secret-key:", "secret-key: [REDACTED]"),
    ];

    let mut redacted = input.to_string();

    for rule in rules {
        redacted = redact_after_marker(&redacted, rule.marker, rule.replacement);
    }

    redacted
}

pub fn append_desktop_log_line(paths: &DesktopPaths, line: &str) -> io::Result<()> {
    append_log_line(&paths.desktop_log, &redact_log_line(line))
}

pub fn append_clirelay_output_line(paths: &DesktopPaths, line: &str) -> io::Result<()> {
    append_log_line(&paths.clirelay_log, line)
}

pub fn ui_readable_log_files(paths: &DesktopPaths) -> Vec<PathBuf> {
    vec![paths.desktop_log.clone()]
}

fn append_log_line(log_path: &Path, line: &str) -> io::Result<()> {
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }

    rotate_log_if_needed(log_path)?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    writeln!(file, "{line}")?;

    Ok(())
}

fn rotated_log_path(log_path: &Path, index: usize) -> PathBuf {
    PathBuf::from(format!("{}.{}", log_path.display(), index))
}

fn redact_after_marker(input: &str, marker: &str, replacement: &str) -> String {
    let Some(start) = input.find(marker) else {
        return input.to_string();
    };

    format!("{}{}", &input[..start], replacement)
}

struct RedactionRule {
    marker: &'static str,
    replacement: &'static str,
}

impl RedactionRule {
    const fn new(marker: &'static str, replacement: &'static str) -> Self {
        Self {
            marker,
            replacement,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
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

    #[test]
    fn rotates_log_when_file_exceeds_max_size() {
        let temp = TempDir::new("rotate-over-limit");
        let log = temp.path().join("desktop.log");
        File::create(&log)
            .expect("创建日志失败")
            .set_len(MAX_LOG_BYTES + 1)
            .expect("设置日志大小失败");

        assert!(rotate_log_if_needed(&log).expect("轮转日志失败"));
        assert!(!log.exists());
        assert_eq!(
            fs::metadata(temp.path().join("desktop.log.1"))
                .expect("读取轮转日志元数据失败")
                .len(),
            MAX_LOG_BYTES + 1
        );
    }

    #[test]
    fn keeps_only_five_rotated_logs() {
        let temp = TempDir::new("rotate-keep-five");
        let log = temp.path().join("clirelay.log");
        File::create(&log)
            .expect("创建日志失败")
            .set_len(MAX_LOG_BYTES + 1)
            .expect("设置日志大小失败");

        for index in 1..=MAX_ROTATED_FILES {
            fs::write(
                temp.path().join(format!("clirelay.log.{index}")),
                format!("old {index}"),
            )
            .expect("写入旧轮转日志失败");
        }

        assert!(rotate_log_if_needed(&log).expect("轮转日志失败"));
        assert!(temp.path().join("clirelay.log.1").exists());
        assert!(temp.path().join("clirelay.log.5").exists());
        assert!(!temp.path().join("clirelay.log.6").exists());
        assert_eq!(
            fs::read_to_string(temp.path().join("clirelay.log.5")).expect("读取第五个轮转日志失败"),
            "old 4"
        );
    }

    #[test]
    fn redacts_authorization_headers_in_desktop_logs() {
        assert_eq!(
            redact_log_line("Authorization: Bearer abc"),
            "Authorization: [REDACTED]"
        );
        assert_eq!(
            redact_log_line("authorization: token"),
            "authorization: [REDACTED]"
        );
    }

    #[test]
    fn redacts_cookie_and_token_like_values_in_desktop_logs() {
        assert_eq!(redact_log_line("api_key=abc"), "api_key=[REDACTED]");
        assert_eq!(redact_log_line("api-key: abc"), "api-key: [REDACTED]");
        assert_eq!(redact_log_line("cookie: abc"), "cookie: [REDACTED]");
        assert_eq!(redact_log_line("oauth_token=abc"), "oauth_token=[REDACTED]");
    }

    #[test]
    fn redacts_management_secret_key() {
        assert_eq!(redact_log_line("secret-key: abc"), "secret-key: [REDACTED]");
    }

    #[test]
    fn exposes_only_desktop_log_to_ui() {
        let paths = DesktopPaths::for_test("/tmp/app-data", "/tmp/logs");

        let ui_logs = ui_readable_log_files(&paths);

        assert_eq!(ui_logs, vec![paths.desktop_log]);
        assert!(!ui_logs.contains(&paths.clirelay_log));
    }

    #[test]
    fn writes_redacted_desktop_log_lines() {
        let temp = TempDir::new("desktop-write");
        let paths = DesktopPaths::for_test(temp.path().join("app-data"), temp.path().join("logs"));

        append_desktop_log_line(&paths, "Authorization: Bearer abc")
            .expect("写入 Desktop 日志失败");

        assert_eq!(
            fs::read_to_string(paths.desktop_log).expect("读取 Desktop 日志失败"),
            "Authorization: [REDACTED]\n"
        );
    }

    #[test]
    fn captures_clirelay_stdout_stderr_without_redaction() {
        let temp = TempDir::new("clirelay-write");
        let paths = DesktopPaths::for_test(temp.path().join("app-data"), temp.path().join("logs"));

        append_clirelay_output_line(&paths, "Authorization: Bearer abc")
            .expect("写入 CliRelay 日志失败");

        assert_eq!(
            fs::read_to_string(&paths.clirelay_log).expect("读取 CliRelay 日志失败"),
            "Authorization: Bearer abc\n"
        );
        assert!(!ui_readable_log_files(&paths).contains(&paths.clirelay_log));
    }
}
