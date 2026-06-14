use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

static TERMINAL_SEQ: AtomicU64 = AtomicU64::new(1);

pub struct TerminalState {
    sessions: HashMap<String, TerminalSession>,
}

struct TerminalSession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Clone, Serialize)]
pub struct TerminalOutputEvent {
    pub id: String,
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct TerminalExitEvent {
    pub id: String,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

#[tauri::command]
pub fn terminal_spawn(
    cwd: Option<String>,
    app: AppHandle,
    state: State<'_, Mutex<TerminalState>>,
) -> Result<String, String> {
    let id = format!("term_{}", TERMINAL_SEQ.fetch_add(1, Ordering::Relaxed));

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = shell_command();
    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);

    let master: Box<dyn MasterPty + Send> = pair.master;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    let master = Arc::new(Mutex::new(master));
    let writer = Arc::new(Mutex::new(writer));
    let app_handle = app.clone();
    let terminal_id = id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = app_handle.emit(
                        "terminal-output",
                        TerminalOutputEvent {
                            id: terminal_id.clone(),
                            data: chunk,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let _ = app_handle.emit(
            "terminal-exit",
            TerminalExitEvent {
                id: terminal_id.clone(),
            },
        );
    });

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.sessions.insert(
        id.clone(),
        TerminalSession {
            master,
            writer,
            _child: child,
        },
    );

    Ok(id)
}

#[tauri::command]
pub fn terminal_write(
    id: String,
    data: String,
    state: State<'_, Mutex<TerminalState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let session = guard
        .sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;

    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: State<'_, Mutex<TerminalState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    let session = guard
        .sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal not found: {id}"))?;

    let master = session.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn terminal_close(id: String, state: State<'_, Mutex<TerminalState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.sessions.remove(&id);
    Ok(())
}

fn shell_command() -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.args(["-NoLogo", "-NoExit"]);
        cmd
    }
    #[cfg(not(windows))]
    {
        let mut cmd = CommandBuilder::new("bash");
        cmd.args(["-l"]);
        cmd
    }
}
