use crate::agent::history::{HistoryMessage, PendingApproval, RuntimeStatus, ThreadInfo, ThreadSummary};
use crate::agent::opencode::{
    approve_permission, base_url as opencode_base_url, cancel_generation, check_installed, create_session,
    delete_session, get_pending_permission, is_healthy as opencode_is_healthy, list_agents,
    list_provider_models, list_sessions, load_session_history, is_session_busy,
    normalize_event as opencode_normalize_event, poll_session_status, poll_turn_state,
    send_prompt, shared_http_client, update_session_title,
    spawn_runtime as spawn_opencode_runtime, wait_for_health as wait_for_opencode_health,
    OpencodeState,
};
use crate::commands::project_config::sync_project_opencode_from_config;
use crate::utils::runtime_lifecycle::{kill_child_tree, kill_tcp_listener};
use futures_util::StreamExt;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

async fn opencode_resolve_service_url(
    state: &State<'_, Mutex<OpencodeState>>,
) -> Result<String, String> {
    let cached = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard.base_url.clone()
    };
    if let Some(url) = cached {
        return Ok(url);
    }

    let url = opencode_base_url();
    let client = reqwest::Client::new();
    if !opencode_is_healthy(&client, &url).await {
        return Err("OpenCode server is not running".to_string());
    }

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.base_url.is_none() {
        guard.base_url = Some(url.clone());
    }
    Ok(url)
}

fn opencode_workspace(
    state: &State<'_, Mutex<OpencodeState>>,
    override_workspace: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(workspace) = override_workspace.filter(|value| !value.is_empty()) {
        return Ok(Some(workspace));
    }
    let guard = state.lock().map_err(|e| e.to_string())?;
    Ok(guard.workspace.clone())
}

#[tauri::command]
pub fn opencode_doctor() -> Result<serde_json::Value, String> {
    check_installed()
}

#[tauri::command]
pub async fn opencode_start_runtime(
    workspace: String,
    spawn_if_missing: Option<bool>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<RuntimeStatus, String> {
    sync_project_opencode_from_config(&workspace)?;

    let spawn_if_missing = spawn_if_missing.unwrap_or(true);
    let url = opencode_base_url();
    let client = reqwest::Client::new();

    let cached = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.base_url.clone(), guard.child.is_some())
    };

    if cached.0.is_some() && opencode_is_healthy(&client, &url).await {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.workspace = Some(workspace.clone());
        return Ok(RuntimeStatus {
            running: true,
            base_url: cached.0,
            owned: cached.1,
        });
    }

    if opencode_is_healthy(&client, &url).await {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        guard.base_url = Some(url.clone());
        guard.workspace = Some(workspace);
        return Ok(RuntimeStatus {
            running: true,
            base_url: Some(url),
            owned: false,
        });
    }

    if !spawn_if_missing {
        return Ok(RuntimeStatus {
            running: false,
            base_url: None,
            owned: false,
        });
    }

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(mut child) = guard.child.take() {
            kill_child_tree(&mut child);
        }
        guard.base_url = None;
        guard.workspace = None;
    }

    let child = spawn_opencode_runtime(&workspace)?;
    wait_for_opencode_health(&client, &url).await?;

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.child = Some(child);
        guard.base_url = Some(url.clone());
        guard.workspace = Some(workspace);
    }

    Ok(RuntimeStatus {
        running: true,
        base_url: Some(url),
        owned: true,
    })
}

#[tauri::command]
pub async fn opencode_restart_runtime(
    workspace: String,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<RuntimeStatus, String> {
    sync_project_opencode_from_config(&workspace)?;

    let url = opencode_base_url();
    let client = reqwest::Client::new();

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(mut child) = guard.child.take() {
            kill_child_tree(&mut child);
        }
        guard.base_url = None;
        guard.workspace = None;
    }

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    if opencode_is_healthy(&client, &url).await {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.base_url = Some(url.clone());
        guard.workspace = Some(workspace);
        return Ok(RuntimeStatus {
            running: true,
            base_url: Some(url),
            owned: false,
        });
    }

    let child = spawn_opencode_runtime(&workspace)?;
    wait_for_opencode_health(&client, &url).await?;

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.child = Some(child);
        guard.base_url = Some(url.clone());
        guard.workspace = Some(workspace);
    }

    Ok(RuntimeStatus {
        running: true,
        base_url: Some(url),
        owned: true,
    })
}

#[tauri::command]
pub async fn opencode_stop_runtime(state: State<'_, Mutex<OpencodeState>>) -> Result<(), String> {
    let target_url = {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        let target_url = guard
            .base_url
            .clone()
            .unwrap_or_else(opencode_base_url);
        if let Some(mut child) = guard.child.take() {
            kill_child_tree(&mut child);
        }
        guard.base_url = None;
        guard.workspace = None;
        target_url
    };

    let client = reqwest::Client::new();
    if opencode_is_healthy(&client, &target_url).await {
        kill_tcp_listener(&target_url)?;
        for _ in 0..15 {
            if !opencode_is_healthy(&client, &target_url).await {
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }
        return Err("OpenCode 进程仍在运行，无法停止".to_string());
    }

    Ok(())
}

#[tauri::command]
pub async fn opencode_runtime_status(
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<RuntimeStatus, String> {
    let cached = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.base_url.clone(), guard.child.is_some())
    };
    let Some(url) = cached.0 else {
        return Ok(RuntimeStatus {
            running: false,
            base_url: None,
            owned: false,
        });
    };

    let client = reqwest::Client::new();
    if !opencode_is_healthy(&client, &url).await {
        return Ok(RuntimeStatus {
            running: false,
            base_url: None,
            owned: false,
        });
    }

    Ok(RuntimeStatus {
        running: true,
        base_url: Some(url),
        owned: cached.1,
    })
}

#[tauri::command]
pub async fn opencode_list_agents(
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<Vec<String>, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "OpenCode server is not running".to_string())?
    };

    let client = reqwest::Client::new();
    list_agents(&client, &url).await
}

#[tauri::command]
pub async fn opencode_list_provider_models(
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<crate::agent::opencode::OpencodeProviderCatalog, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "OpenCode server is not running".to_string())?
    };

    let client = reqwest::Client::new();
    list_provider_models(&client, &url).await
}

#[tauri::command]
pub async fn opencode_create_thread(
    workspace: String,
    mode: String,
    title: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<ThreadInfo, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "OpenCode server is not running".to_string())?
    };

    let client = reqwest::Client::new();
    let session_title = title
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "New session".to_string());
    create_session(&client, &url, &workspace, &mode, &session_title).await
}

#[tauri::command]
pub async fn opencode_update_session_title(
    session_id: String,
    title: String,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<(), String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "OpenCode server is not running".to_string())?
    };

    let client = reqwest::Client::new();
    update_session_title(&client, &url, &session_id, &title).await
}

#[tauri::command]
pub async fn opencode_send_turn(
    thread_id: String,
    message: String,
    mode: String,
    model: Option<String>,
    workspace: Option<String>,
    message_id: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<(), String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = reqwest::Client::new();
    send_prompt(
        &client,
        &url,
        &thread_id,
        &mode,
        model.as_deref(),
        &message,
        workspace.as_deref(),
        message_id.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn opencode_cancel_turn(
    session_id: String,
    workspace: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<(), String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = reqwest::Client::new();
    cancel_generation(&client, &url, &session_id, workspace.as_deref()).await
}

#[tauri::command]
pub async fn opencode_set_thread_mode(
    _thread_id: String,
    _mode: String,
    _model: Option<String>,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn opencode_approve(
    thread_id: String,
    approval_id: String,
    allow: bool,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<(), String> {
    let (url, workspace) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (
            guard
                .base_url
                .clone()
                .ok_or_else(|| "OpenCode server is not running".to_string())?,
            guard.workspace.clone(),
        )
    };

    let client = reqwest::Client::new();
    approve_permission(
        &client,
        &url,
        &thread_id,
        &approval_id,
        allow,
        workspace.as_deref(),
    )
    .await
}

fn parse_opencode_sse_payload(line: &str) -> Option<&str> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with(':') {
        return None;
    }
    if let Some(data) = trimmed.strip_prefix("data:") {
        let payload = data.trim();
        if payload.is_empty() || payload == "[DONE]" {
            return None;
        }
        return Some(payload);
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Some(trimmed);
    }
    None
}

#[tauri::command]
pub async fn opencode_subscribe_events(
    thread_id: String,
    app: AppHandle,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<(), String> {
    let (url, listening, subscribed_session_id, sse_task_active, sse_reconnect) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        let url = guard
            .base_url
            .clone()
            .unwrap_or_else(opencode_base_url);
        *guard
            .subscribed_session_id
            .lock()
            .map_err(|e| e.to_string())? = Some(thread_id);
        guard.listening.store(true, std::sync::atomic::Ordering::SeqCst);
        guard
            .sse_reconnect
            .store(true, std::sync::atomic::Ordering::SeqCst);
        (
            url,
            guard.listening.clone(),
            guard.subscribed_session_id.clone(),
            guard.sse_task_active.clone(),
            guard.sse_reconnect.clone(),
        )
    };

    if sse_task_active.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }

    sse_task_active.store(true, std::sync::atomic::Ordering::SeqCst);

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let events_url = format!("{url}/event");

        while listening.load(std::sync::atomic::Ordering::SeqCst) {
            let response = match client.get(&events_url).send().await {
                Ok(response) => response,
                Err(error) => {
                    let _ = app.emit(
                        "agent-error",
                        serde_json::json!({
                            "providerId": "opencode",
                            "message": format!("SSE connect failed: {error}"),
                        }),
                    );
                    tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                    continue;
                }
            };

            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            loop {
                if !listening.load(std::sync::atomic::Ordering::SeqCst) {
                    break;
                }
                if sse_reconnect.swap(false, std::sync::atomic::Ordering::SeqCst) {
                    break;
                }

                match tokio::time::timeout(
                    std::time::Duration::from_millis(400),
                    stream.next(),
                )
                .await
                {
                    Ok(Some(Ok(chunk))) => {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));

                        while let Some(pos) = buffer.find("\n\n") {
                            let block = buffer[..pos].to_string();
                            buffer = buffer[pos + 2..].to_string();

                            let session_id = subscribed_session_id
                                .lock()
                                .ok()
                                .and_then(|guard| guard.clone())
                                .unwrap_or_default();

                            if session_id.is_empty() {
                                continue;
                            }

                            for line in block.lines() {
                                let Some(data) = parse_opencode_sse_payload(line) else {
                                    continue;
                                };
                                if let Ok(event) =
                                    serde_json::from_str::<serde_json::Value>(data)
                                {
                                    if let Some(normalized) =
                                        opencode_normalize_event(&event, &session_id)
                                    {
                                        let payload = serde_json::json!({
                                            "providerId": "opencode",
                                            "event": normalized,
                                        });
                                        let _ = app.emit("agent-event", payload);
                                    }
                                }
                            }
                        }
                    }
                    Ok(Some(Err(error))) => {
                        let _ = app.emit(
                            "agent-error",
                            serde_json::json!({
                                "providerId": "opencode",
                                "message": format!("SSE stream error: {error}"),
                            }),
                        );
                        break;
                    }
                    Ok(None) => break,
                    Err(_) => continue,
                }
            }

            if listening.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
            }
        }

        sse_task_active.store(false, std::sync::atomic::Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
pub async fn opencode_list_sessions(
    workspace: String,
    limit: Option<u32>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<Vec<ThreadSummary>, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "OpenCode server is not running".to_string())?
    };

    let client = reqwest::Client::new();
    list_sessions(&client, &url, &workspace, limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn opencode_get_pending_approval(
    session_id: String,
    workspace: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<Option<PendingApproval>, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = reqwest::Client::new();
    get_pending_permission(&client, &url, &session_id, workspace.as_deref()).await
}

#[tauri::command]
pub async fn opencode_load_session_history(
    session_id: String,
    workspace: Option<String>,
    limit: Option<u32>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<Vec<HistoryMessage>, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = reqwest::Client::new();
    load_session_history(
        &client,
        &url,
        &session_id,
        workspace.as_deref(),
        limit,
    )
    .await
}

#[tauri::command]
pub async fn opencode_poll_turn(
    session_id: String,
    workspace: Option<String>,
    limit: Option<u32>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<crate::agent::opencode::OpencodeTurnPoll, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = shared_http_client(&state)?;
    poll_turn_state(
        &client,
        &url,
        &session_id,
        workspace.as_deref(),
        limit,
    )
    .await
}

#[tauri::command]
pub async fn opencode_poll_status(
    session_id: String,
    workspace: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<crate::agent::opencode::OpencodeSessionStatusPoll, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = shared_http_client(&state)?;
    poll_session_status(
        &client,
        &url,
        &session_id,
        workspace.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn opencode_is_session_busy(
    session_id: String,
    workspace: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<bool, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = reqwest::Client::new();
    is_session_busy(&client, &url, &session_id, workspace.as_deref()).await
}

#[tauri::command]
pub async fn opencode_delete_session(
    session_id: String,
    workspace: Option<String>,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<(), String> {
    let url = opencode_resolve_service_url(&state).await?;
    let workspace = opencode_workspace(&state, workspace)?;
    let client = reqwest::Client::new();
    delete_session(&client, &url, &session_id, workspace.as_deref()).await
}
