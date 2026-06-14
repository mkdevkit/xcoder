use crate::agent::codewhale::{
    approve_tool, base_url, create_thread, delete_thread, get_pending_approval,
    get_thread_latest_seq, is_healthy as codewhale_is_healthy, list_models, list_thread_summaries,
    load_thread_history, normalize_event as codewhale_normalize_event, patch_thread_mode,
    run_doctor, send_turn, spawn_runtime, wait_for_health, cancel_turn, CodewhaleState, RuntimeStatus,
    ThreadInfo,
};
use crate::agent::history::{HistoryMessage, PendingApproval, ThreadSummary};
use crate::agent::opencode::{
    approve_permission, base_url as opencode_base_url, cancel_generation, check_installed, create_session,
    delete_session, get_pending_permission, is_healthy as opencode_is_healthy, list_agents,
    list_provider_models, list_sessions, load_session_history, is_session_busy,
    normalize_event as opencode_normalize_event, send_prompt, update_session_title,
    spawn_runtime as spawn_opencode_runtime, wait_for_health as wait_for_opencode_health,
    OpencodeState,
};
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

#[tauri::command]
pub fn codewhale_doctor() -> Result<serde_json::Value, String> {
    run_doctor()
}

#[tauri::command]
pub fn codewhale_list_models() -> Result<Vec<crate::agent::codewhale::CodewhaleModelOption>, String> {
    list_models()
}

#[tauri::command]
pub async fn codewhale_start_runtime(
    spawn_if_missing: Option<bool>,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<RuntimeStatus, String> {
    let spawn_if_missing = spawn_if_missing.unwrap_or(true);
    let url = base_url();
    let client = reqwest::Client::new();

    let cached = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.base_url.clone(), guard.child.is_some())
    };

    if cached.0.is_some() && codewhale_is_healthy(&client, &url).await {
        return Ok(RuntimeStatus {
            running: true,
            base_url: cached.0,
            owned: cached.1,
        });
    }

    if codewhale_is_healthy(&client, &url).await {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        guard.base_url = Some(url.clone());
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
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.base_url = None;
    }

    let child = spawn_runtime()?;
    wait_for_health(&client, &url).await?;

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.child = Some(child);
        guard.base_url = Some(url.clone());
    }

    Ok(RuntimeStatus {
        running: true,
        base_url: Some(url),
        owned: true,
    })
}

#[tauri::command]
pub async fn codewhale_restart_runtime(
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<RuntimeStatus, String> {
    let url = base_url();
    let client = reqwest::Client::new();

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(mut child) = guard.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        guard.base_url = None;
    }

    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    if codewhale_is_healthy(&client, &url).await {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.base_url = Some(url.clone());
        return Ok(RuntimeStatus {
            running: true,
            base_url: Some(url),
            owned: false,
        });
    }

    let child = spawn_runtime()?;
    wait_for_health(&client, &url).await?;

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.child = Some(child);
        guard.base_url = Some(url.clone());
    }

    Ok(RuntimeStatus {
        running: true,
        base_url: Some(url),
        owned: true,
    })
}

#[tauri::command]
pub fn codewhale_stop_runtime(state: State<'_, Mutex<CodewhaleState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);

    if let Some(mut child) = guard.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    guard.base_url = None;
    Ok(())
}

#[tauri::command]
pub async fn codewhale_runtime_status(
    state: State<'_, Mutex<CodewhaleState>>,
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
    if !codewhale_is_healthy(&client, &url).await {
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
pub async fn codewhale_create_thread(
    workspace: String,
    mode: String,
    model: String,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<ThreadInfo, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    create_thread(&client, &url, &workspace, &mode, &model).await
}

#[tauri::command]
pub async fn codewhale_send_turn(
    thread_id: String,
    message: String,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<serde_json::Value, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    send_turn(&client, &url, &thread_id, &message).await
}

#[tauri::command]
pub async fn codewhale_cancel_turn(
    thread_id: String,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<(), String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    cancel_turn(&client, &url, &thread_id).await
}

#[tauri::command]
pub async fn codewhale_set_thread_mode(
    thread_id: String,
    mode: String,
    model: Option<String>,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<(), String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    patch_thread_mode(
        &client,
        &url,
        &thread_id,
        &mode,
        model.as_deref(),
    )
    .await
}

#[tauri::command]
pub async fn codewhale_approve(
    approval_id: String,
    allow: bool,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<(), String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    approve_tool(&client, &url, &approval_id, allow).await
}

#[tauri::command]
pub async fn codewhale_subscribe_events(
    thread_id: String,
    app: AppHandle,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<(), String> {
    let (url, listening) = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        let url = guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        guard.listening.store(true, std::sync::atomic::Ordering::SeqCst);
        (url, guard.listening.clone())
    };

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        let since_seq = get_thread_latest_seq(&client, &url, &thread_id)
            .await
            .unwrap_or(0);
        let events_url = format!("{url}/v1/threads/{thread_id}/events?since_seq={since_seq}");

        let response = match client.get(&events_url).send().await {
            Ok(r) => r,
            Err(e) => {
                let _ = app.emit(
                    "agent-error",
                    serde_json::json!({
                        "providerId": "codewhale",
                        "message": format!("SSE connect failed: {e}"),
                    }),
                );
                return;
            }
        };

        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while listening.load(std::sync::atomic::Ordering::SeqCst) {
            match stream.next().await {
                Some(Ok(chunk)) => {
                    buffer.push_str(&String::from_utf8_lossy(&chunk));

                    while let Some(pos) = buffer.find("\n\n") {
                        let block = buffer[..pos].to_string();
                        buffer = buffer[pos + 2..].to_string();

                        for line in block.lines() {
                            if let Some(data) = line.strip_prefix("data: ") {
                                if data.trim() == "[DONE]" {
                                    continue;
                                }
                                if let Ok(event) = serde_json::from_str::<serde_json::Value>(data) {
                                    if let Some(normalized) =
                                        codewhale_normalize_event(&event, &thread_id)
                                    {
                                        let payload = serde_json::json!({
                                            "providerId": "codewhale",
                                            "event": normalized,
                                        });
                                        let _ = app.emit("agent-event", payload);
                                    }
                                }
                            }
                        }
                    }
                }
                Some(Err(e)) => {
                    let _ = app.emit(
                        "agent-error",
                        serde_json::json!({
                            "providerId": "codewhale",
                            "message": format!("SSE stream error: {e}"),
                        }),
                    );
                    break;
                }
                None => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn codewhale_get_pending_approval(
    thread_id: String,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<Option<PendingApproval>, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    get_pending_approval(&client, &url, &thread_id).await
}

#[tauri::command]
pub async fn codewhale_list_threads(
    workspace: String,
    limit: Option<u32>,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<Vec<ThreadSummary>, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    list_thread_summaries(&client, &url, &workspace, limit.unwrap_or(50)).await
}

#[tauri::command]
pub async fn codewhale_load_thread_history(
    thread_id: String,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<Vec<HistoryMessage>, String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    load_thread_history(&client, &url, &thread_id).await
}

#[tauri::command]
pub async fn codewhale_delete_thread(
    thread_id: String,
    state: State<'_, Mutex<CodewhaleState>>,
) -> Result<(), String> {
    let url = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        guard
            .base_url
            .clone()
            .ok_or_else(|| "CodeWhale runtime is not running".to_string())?
    };

    let client = reqwest::Client::new();
    delete_thread(&client, &url, &thread_id).await
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
    let spawn_if_missing = spawn_if_missing.unwrap_or(true);
    let url = opencode_base_url();
    let client = reqwest::Client::new();

    let cached = {
        let guard = state.lock().map_err(|e| e.to_string())?;
        (guard.base_url.clone(), guard.child.is_some())
    };

    if cached.0.is_some() && opencode_is_healthy(&client, &url).await {
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
            let _ = child.kill();
            let _ = child.wait();
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
    let url = opencode_base_url();
    let client = reqwest::Client::new();

    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);
        if let Some(mut child) = guard.child.take() {
            let _ = child.kill();
            let _ = child.wait();
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
pub fn opencode_stop_runtime(state: State<'_, Mutex<OpencodeState>>) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.listening.store(false, std::sync::atomic::Ordering::SeqCst);

    if let Some(mut child) = guard.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    guard.base_url = None;
    guard.workspace = None;
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
    create_session(&client, &url, &workspace, &mode).await
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
    send_prompt(
        &client,
        &url,
        &thread_id,
        &mode,
        model.as_deref(),
        &message,
    )
    .await
}

#[tauri::command]
pub async fn opencode_cancel_turn(
    session_id: String,
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
    cancel_generation(&client, &url, &session_id).await
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

                match stream.next().await {
                    Some(Ok(chunk)) => {
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
                    Some(Err(error)) => {
                        let _ = app.emit(
                            "agent-error",
                            serde_json::json!({
                                "providerId": "opencode",
                                "message": format!("SSE stream error: {error}"),
                            }),
                        );
                        break;
                    }
                    None => break,
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
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<Option<PendingApproval>, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let client = reqwest::Client::new();
    get_pending_permission(&client, &url, &session_id).await
}

#[tauri::command]
pub async fn opencode_load_session_history(
    session_id: String,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<Vec<HistoryMessage>, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let client = reqwest::Client::new();
    load_session_history(&client, &url, &session_id).await
}

#[tauri::command]
pub async fn opencode_is_session_busy(
    session_id: String,
    state: State<'_, Mutex<OpencodeState>>,
) -> Result<bool, String> {
    let url = opencode_resolve_service_url(&state).await?;
    let client = reqwest::Client::new();
    is_session_busy(&client, &url, &session_id).await
}

#[tauri::command]
pub async fn opencode_delete_session(
    session_id: String,
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
    delete_session(&client, &url, &session_id).await
}
