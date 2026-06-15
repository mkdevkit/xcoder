use crate::agent::history::{HistoryMessage, PendingApproval, ThreadSummary};
use crate::config::{load_app_config, ProviderConfig};
use crate::utils::command::{build_command, resolve_executable};
use serde::{Deserialize, Serialize};
use std::process::{Child, Output, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub struct CodewhaleState {
    pub base_url: Option<String>,
    pub child: Option<Child>,
    pub listening: Arc<AtomicBool>,
    pub subscribed_thread_id: Arc<Mutex<Option<String>>>,
    pub sse_task_active: Arc<AtomicBool>,
    pub sse_reconnect: Arc<AtomicBool>,
}

impl Default for CodewhaleState {
    fn default() -> Self {
        Self {
            base_url: None,
            child: None,
            listening: Arc::new(AtomicBool::new(false)),
            subscribed_thread_id: Arc::new(Mutex::new(None)),
            sse_task_active: Arc::new(AtomicBool::new(false)),
            sse_reconnect: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeStatus {
    pub running: bool,
    pub base_url: Option<String>,
    #[serde(default)]
    pub owned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadInfo {
    pub id: String,
    pub mode: Option<String>,
    pub model: Option<String>,
    pub workspace: Option<String>,
}

fn provider_config() -> Result<ProviderConfig, String> {
    let config = load_app_config()?;
    config
        .providers
        .into_iter()
        .find(|p| p.id == "codewhale")
        .ok_or_else(|| "CodeWhale provider is not configured".to_string())
}

fn resolve_codewhale_command() -> Result<std::path::PathBuf, String> {
    let provider = provider_config()?;
    resolve_executable(&provider.command)
}

pub fn base_url() -> String {
    "http://127.0.0.1:7878".to_string()
}

pub async fn is_healthy(client: &reqwest::Client, url: &str) -> bool {
    client
        .get(format!("{url}/health"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

pub async fn wait_for_health(client: &reqwest::Client, url: &str) -> Result<(), String> {
    for _ in 0..30 {
        if client
            .get(format!("{url}/health"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    Err("CodeWhale runtime failed to start".to_string())
}

pub fn spawn_runtime() -> Result<Child, String> {
    let program = resolve_codewhale_command()?;
    let child = build_command(
        &program,
        &[
            "serve",
            "--http",
            "--host",
            "127.0.0.1",
            "--port",
            "7878",
            "--insecure",
        ],
    )
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| {
        format!(
            "Failed to start codewhale at {}: {e}",
            program.display()
        )
    })?;

    Ok(child)
}

pub fn run_doctor() -> Result<serde_json::Value, String> {
    let program = resolve_codewhale_command()?;
    let output = run_command(&program, &["doctor", "--json"])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("codewhale doctor failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Invalid doctor JSON: {e}"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodewhaleModelOption {
    pub model_id: String,
    pub provider: String,
    pub label: String,
    pub value: String,
}

fn parse_model_line(line: &str) -> Option<CodewhaleModelOption> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let open_paren = line.rfind(" (")?;
    let model_id = line[..open_paren].trim();
    let provider = line[open_paren + 2..].strip_suffix(')')?.trim();
    if model_id.is_empty() || provider.is_empty() {
        return None;
    }

    Some(CodewhaleModelOption {
        model_id: model_id.to_string(),
        provider: provider.to_string(),
        label: line.to_string(),
        value: model_id.to_string(),
    })
}

pub fn list_models() -> Result<Vec<CodewhaleModelOption>, String> {
    let program = resolve_codewhale_command()?;
    let output = run_command(&program, &["model", "list"])?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("codewhale model list failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut options = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for line in stdout.lines() {
        let Some(option) = parse_model_line(line) else {
            continue;
        };
        if seen.insert(option.value.clone()) {
            options.push(option);
        }
    }

    if options.is_empty() {
        return Err("codewhale model list returned no models".to_string());
    }

    Ok(options)
}

fn run_command(program: &std::path::Path, args: &[&str]) -> Result<Output, String> {
    build_command(program, args)
        .output()
        .map_err(|e| format!("Failed to run {}: {e}", program.display()))
}

pub async fn create_thread(
    client: &reqwest::Client,
    url: &str,
    workspace: &str,
    mode: &str,
    model: &str,
) -> Result<ThreadInfo, String> {
    let body = serde_json::json!({
        "workspace": workspace,
        "mode": mode,
        "model": model,
    });

    let response = client
        .post(format!("{url}/v1/threads"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Create thread failed: {text}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(ThreadInfo {
        id: json["id"].as_str().unwrap_or_default().to_string(),
        mode: json["mode"].as_str().map(|s| s.to_string()),
        model: json["model"].as_str().map(|s| s.to_string()),
        workspace: json["workspace"].as_str().map(|s| s.to_string()),
    })
}

pub async fn send_turn(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
    message: &str,
) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({
        "prompt": message,
    });

    let response = client
        .post(format!("{url}/v1/threads/{thread_id}/turns"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Send turn failed: {text}"));
    }

    response.json().await.map_err(|e| e.to_string())
}

async fn fetch_thread_json(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<serde_json::Value, String> {
    let response = client
        .get(format!("{url}/v1/threads/{thread_id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Load thread failed: {text}"));
    }

    response.json().await.map_err(|e| e.to_string())
}

fn history_messages_from_thread_json(json: &serde_json::Value) -> Vec<HistoryMessage> {
    let items = json["items"].as_array().cloned().unwrap_or_default();
    let mut messages = Vec::new();

    for item in items {
        let kind = item["kind"].as_str().unwrap_or("");
        let id = item["id"].as_str().unwrap_or_default().to_string();
        let content = item_text(&item);
        if content.is_empty() && kind != "tool_call" {
            continue;
        }

        match kind {
            "user_message" => messages.push(HistoryMessage {
                id,
                role: "user".to_string(),
                content,
                tool_name: None,
                timestamp: 0,
            }),
            "agent_message" => messages.push(HistoryMessage {
                id,
                role: "assistant".to_string(),
                content,
                tool_name: None,
                timestamp: 0,
            }),
            "agent_reasoning" => messages.push(HistoryMessage {
                id,
                role: "assistant".to_string(),
                content: format!("> {content}"),
                tool_name: None,
                timestamp: 0,
            }),
            "tool_call" => {
                let summary = item["summary"].as_str().unwrap_or("tool");
                let tool_name = summary
                    .split(':')
                    .next()
                    .unwrap_or("tool")
                    .trim()
                    .to_string();
                let body = if content.is_empty() {
                    summary.to_string()
                } else {
                    content
                };
                messages.push(HistoryMessage {
                    id,
                    role: "tool".to_string(),
                    content: body,
                    tool_name: Some(tool_name),
                    timestamp: 0,
                });
            }
            _ => {}
        }
    }

    messages
}

fn pending_approval_from_thread_json(
    json: &serde_json::Value,
) -> Option<PendingApproval> {
    let turns = json["turns"].as_array().cloned().unwrap_or_default();
    let latest_turn = turns.last()?;

    if latest_turn["status"].as_str() != Some("in_progress") {
        return None;
    }

    let turn_id = latest_turn["id"].as_str().unwrap_or_default();
    let items = json["items"].as_array().cloned().unwrap_or_default();

    for item in items.iter().rev() {
        if item["turn_id"].as_str() != Some(turn_id) {
            continue;
        }

        let status = item["status"].as_str().unwrap_or("");
        if status != "in_progress" && status != "awaiting_approval" {
            continue;
        }

        let kind = item["kind"].as_str().unwrap_or("");
        if kind != "tool_call" && kind != "command_execution" {
            continue;
        }

        let approval_id = item
            .get("metadata")
            .and_then(|metadata| {
                metadata
                    .get("approval_id")
                    .or_else(|| metadata.get("approvalId"))
                    .and_then(|value| value.as_str())
            })
            .filter(|id| !id.is_empty())?;

        let description = item_text(item);
        return Some(PendingApproval {
            id: approval_id.to_string(),
            description: if description.is_empty() {
                "需要审批".to_string()
            } else {
                description
            },
        });
    }

    None
}

fn thread_has_active_turn(json: &serde_json::Value) -> bool {
    let turns = json["turns"].as_array().cloned().unwrap_or_default();
    for turn in turns.iter().rev() {
        let status = turn["status"].as_str().unwrap_or("");
        if status == "in_progress" || status == "awaiting_approval" {
            return true;
        }
    }
    false
}

fn thread_turn_complete(json: &serde_json::Value) -> bool {
    let turns = json["turns"].as_array().cloned().unwrap_or_default();
    let Some(latest) = turns.last() else {
        return false;
    };
    let status = latest["status"].as_str().unwrap_or("");
    !matches!(status, "in_progress" | "awaiting_approval" | "")
}

#[derive(Serialize)]
pub struct CodewhaleTurnPoll {
    pub messages: Vec<HistoryMessage>,
    pub busy: bool,
    pub pending: Option<PendingApproval>,
    pub turn_complete: bool,
}

pub async fn poll_turn_state(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<CodewhaleTurnPoll, String> {
    let json = fetch_thread_json(client, url, thread_id).await?;
    let messages = history_messages_from_thread_json(&json);
    let pending = pending_approval_from_thread_json(&json);
    let busy = pending.is_some() || thread_has_active_turn(&json);
    let turn_complete = !busy && thread_turn_complete(&json);

    Ok(CodewhaleTurnPoll {
        messages,
        busy,
        pending,
        turn_complete,
    })
}

async fn active_turn_id(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<Option<String>, String> {
    let response = client
        .get(format!("{url}/v1/threads/{thread_id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Load thread failed: {text}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let turns = json["turns"].as_array().cloned().unwrap_or_default();

    for turn in turns.iter().rev() {
        let status = turn["status"].as_str().unwrap_or("");
        if status == "in_progress" || status == "awaiting_approval" {
            if let Some(id) = turn["id"].as_str().filter(|id| !id.is_empty()) {
                return Ok(Some(id.to_string()));
            }
        }
    }

    Ok(None)
}

pub async fn cancel_turn(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<(), String> {
    let Some(turn_id) = active_turn_id(client, url, thread_id).await? else {
        return Err("当前没有可取消的生成任务".to_string());
    };

    let response = client
        .post(format!(
            "{url}/v1/threads/{thread_id}/turns/{turn_id}/interrupt"
        ))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        return Ok(());
    }

    let text = response.text().await.unwrap_or_default();
    Err(format!("Cancel turn failed: {text}"))
}

pub async fn patch_thread_mode(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
    mode: &str,
    model: Option<&str>,
) -> Result<(), String> {
    let mut body = serde_json::json!({ "mode": mode });
    if let Some(model) = model {
        body["model"] = serde_json::Value::String(model.to_string());
    }

    let response = client
        .patch(format!("{url}/v1/threads/{thread_id}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Patch thread failed: {text}"));
    }

    Ok(())
}

pub async fn approve_tool(
    client: &reqwest::Client,
    url: &str,
    approval_id: &str,
    allow: bool,
) -> Result<(), String> {
    let decision = if allow { "allow" } else { "deny" };
    let body = serde_json::json!({
        "decision": decision,
        "remember": false,
    });

    let response = client
        .post(format!("{url}/v1/approvals/{approval_id}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Approval failed: {text}"));
    }

    Ok(())
}

fn approval_id_from_payload(payload: &serde_json::Value) -> Option<String> {
    let candidates = [
        payload.get("approval_id"),
        payload.get("id"),
        payload.get("approval").and_then(|value| value.get("id")),
    ];

    for candidate in candidates {
        if let Some(id) = candidate.and_then(|value| value.as_str()) {
            if !id.is_empty() && !id.starts_with("item_") && !id.starts_with("call_") {
                return Some(id.to_string());
            }
        }
    }

    None
}

pub async fn get_thread_latest_seq(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<u64, String> {
    let response = client
        .get(format!("{url}/v1/threads/{thread_id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Load thread failed: {text}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json["latest_seq"].as_u64().unwrap_or(0))
}

pub async fn get_pending_approval(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<Option<crate::agent::history::PendingApproval>, String> {
    let json = fetch_thread_json(client, url, thread_id).await?;
    Ok(pending_approval_from_thread_json(&json))
}

pub fn normalize_event(raw: &serde_json::Value, thread_id: &str) -> Option<serde_json::Value> {
    let event = raw.get("event").and_then(|value| value.as_str())?;
    if raw
        .get("thread_id")
        .and_then(|value| value.as_str())
        .is_some_and(|id| id != thread_id)
    {
        return None;
    }

    let payload = raw.get("payload").cloned().unwrap_or_else(|| raw.clone());

    match event {
        "approval.required" => {
            let id = approval_id_from_payload(&payload)?;
            let description = payload
                .get("description")
                .or_else(|| payload.get("summary"))
                .or_else(|| payload.get("message"))
                .and_then(|value| value.as_str())
                .unwrap_or("需要审批");
            Some(serde_json::json!({
                "event": "approval.required",
                "payload": {
                    "approval_id": id,
                    "description": description,
                }
            }))
        }
        "approval.decided" | "approval.timeout" => Some(serde_json::json!({
            "event": "approval.resolved",
            "payload": {}
        })),
        _ => Some(raw.clone()),
    }
}

fn normalize_workspace(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn workspaces_match(left: &str, right: &str) -> bool {
    normalize_workspace(left) == normalize_workspace(right)
}

fn item_text(value: &serde_json::Value) -> String {
    value["detail"]
        .as_str()
        .or_else(|| value["summary"].as_str())
        .unwrap_or("")
        .to_string()
}

pub async fn list_thread_summaries(
    client: &reqwest::Client,
    url: &str,
    workspace: &str,
    limit: u32,
) -> Result<Vec<ThreadSummary>, String> {
    let response = client
        .get(format!("{url}/v1/threads/summary?limit={limit}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List threads failed: {text}"));
    }

    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let items = json.as_array().cloned().unwrap_or_default();

    Ok(items
        .into_iter()
        .filter_map(|item| {
            let ws = item["workspace"].as_str().unwrap_or("");
            if !workspaces_match(ws, workspace) {
                return None;
            }
            Some(ThreadSummary {
                id: item["id"].as_str().unwrap_or_default().to_string(),
                title: item["title"].as_str().unwrap_or("未命名会话").to_string(),
                preview: item["preview"].as_str().map(|s| s.to_string()),
                workspace: item["workspace"].as_str().map(|s| s.to_string()),
                updated_at: item["updated_at"].as_str().map(|s| s.to_string()),
            })
        })
        .collect())
}

pub async fn load_thread_history(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<Vec<HistoryMessage>, String> {
    let json = fetch_thread_json(client, url, thread_id).await?;
    Ok(history_messages_from_thread_json(&json))
}

pub async fn delete_thread(
    client: &reqwest::Client,
    url: &str,
    thread_id: &str,
) -> Result<(), String> {
    let response = client
        .patch(format!("{url}/v1/threads/{thread_id}"))
        .json(&serde_json::json!({ "archived": true }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        if response.status().as_u16() == 404 {
            return Ok(());
        }
        let text = response.text().await.unwrap_or_default();
        if text.to_ascii_lowercase().contains("not found") {
            return Ok(());
        }
        return Err(format!("Delete thread failed: {text}"));
    }

    Ok(())
}
