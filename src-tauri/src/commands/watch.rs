use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

pub struct WatchState {
    watcher: Option<RecommendedWatcher>,
}

impl Default for WatchState {
    fn default() -> Self {
        Self { watcher: None }
    }
}

#[derive(Clone, Serialize)]
pub struct WorkspaceChangeEvent {
    pub paths: Vec<String>,
    pub kind: String,
}

#[tauri::command]
pub fn start_workspace_watch(
    path: String,
    app: AppHandle,
    state: State<'_, Mutex<WatchState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.watcher = None;

    let watch_path = path.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| match result {
            Ok(event) => {
                if should_emit(&event.kind) {
                    let payload = WorkspaceChangeEvent {
                        paths: event
                            .paths
                            .iter()
                            .map(|p| p.to_string_lossy().to_string())
                            .collect(),
                        kind: format!("{:?}", event.kind),
                    };
                    let _ = app.emit("workspace-changed", payload);
                }
            }
            Err(error) => {
                let _ = app.emit("workspace-watch-error", error.to_string());
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&watch_path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    guard.watcher = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn stop_workspace_watch(state: State<'_, Mutex<WatchState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.watcher = None;
    Ok(())
}

fn should_emit(kind: &EventKind) -> bool {
    !matches!(
        kind,
        EventKind::Access(_) | EventKind::Any | EventKind::Other
    )
}
