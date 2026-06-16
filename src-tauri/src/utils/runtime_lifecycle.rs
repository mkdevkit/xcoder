use std::collections::HashSet;
use std::process::{Child, Command};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn kill_child_tree(child: &mut Child) {
    let pid = child.id();
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = child.kill();
    }
    let _ = child.wait();
}

pub fn parse_http_host_port(url: &str) -> Option<(String, u16)> {
    let trimmed = url.trim();
    let without_scheme = trimmed
        .strip_prefix("http://")
        .or_else(|| trimmed.strip_prefix("https://"))?;
    let authority = without_scheme.split('/').next()?.trim();
    if authority.is_empty() {
        return None;
    }

    if let Some((host, port_str)) = authority.rsplit_once(':') {
        if host.starts_with('[') {
            return None;
        }
        let port = port_str.parse().ok()?;
        return Some((host.to_string(), port));
    }

    Some((authority.to_string(), 80))
}

pub fn kill_tcp_listener(url: &str) -> Result<(), String> {
    let Some((_, port)) = parse_http_host_port(url) else {
        return Err(format!("Invalid runtime URL: {url}"));
    };

    #[cfg(windows)]
    return kill_tcp_listener_windows(port);

    #[cfg(not(windows))]
    return kill_tcp_listener_unix(port);
}

#[cfg(windows)]
fn kill_tcp_listener_windows(port: u16) -> Result<(), String> {
    let output = Command::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| e.to_string())?;

    let text = String::from_utf8_lossy(&output.stdout);
    let port_token = format!(":{port}");
    let mut pids = HashSet::new();

    for line in text.lines() {
        if !line.contains("LISTENING") || !line.contains(&port_token) {
            continue;
        }
        let Some(pid_str) = line.split_whitespace().last() else {
            continue;
        };
        let Ok(pid) = pid_str.parse::<u32>() else {
            continue;
        };
        if pid > 0 {
            pids.insert(pid);
        }
    }

    for pid in pids {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    Ok(())
}

#[cfg(not(windows))]
fn kill_tcp_listener_unix(port: u16) -> Result<(), String> {
    let output = Command::new("lsof")
        .args(["-ti", &format!("tcp:{port}")])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let pid = line.trim();
        if pid.is_empty() {
            continue;
        }
        let _ = Command::new("kill")
            .args(["-TERM", pid])
            .output();
    }

    Ok(())
}
