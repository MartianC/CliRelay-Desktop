use chrono::{DateTime, NaiveDateTime, Utc};
#[cfg(target_os = "macos")]
use std::ffi::OsString;
use std::io;
#[cfg(target_os = "macos")]
use std::os::unix::ffi::OsStringExt;
use std::path::PathBuf;
use std::process::Command;

pub fn process_started_at(pid: u32) -> io::Result<DateTime<Utc>> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "lstart="])
        .output()?;

    if !output.status.success() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("进程不存在: {pid}"),
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("进程不存在: {pid}"),
        ));
    }

    let started_at = NaiveDateTime::parse_from_str(&raw, "%a %b %e %T %Y")
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    Ok(DateTime::from_naive_utc_and_offset(started_at, Utc))
}

#[cfg(target_os = "macos")]
pub fn process_executable_path(pid: u32) -> io::Result<PathBuf> {
    let mut buffer = Vec::<u8>::with_capacity(libc::PROC_PIDPATHINFO_MAXSIZE as usize);
    let bytes_written = unsafe {
        libc::proc_pidpath(
            pid as libc::c_int,
            buffer.as_mut_ptr() as *mut libc::c_void,
            libc::PROC_PIDPATHINFO_MAXSIZE as u32,
        )
    };

    if bytes_written <= 0 {
        return Err(io::Error::last_os_error());
    }

    unsafe {
        buffer.set_len(bytes_written as usize);
    }

    Ok(PathBuf::from(OsString::from_vec(buffer)))
}

#[cfg(not(target_os = "macos"))]
pub fn process_executable_path(_pid: u32) -> io::Result<PathBuf> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "process_executable_path 仅支持 macOS",
    ))
}

pub fn terminate_pid(pid: u32) -> io::Result<()> {
    signal_pid(pid, libc::SIGTERM)
}

pub fn kill_pid(pid: u32) -> io::Result<()> {
    signal_pid(pid, libc::SIGKILL)
}

fn signal_pid(pid: u32, signal: libc::c_int) -> io::Result<()> {
    let result = unsafe { libc::kill(pid as libc::pid_t, signal) };

    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}
