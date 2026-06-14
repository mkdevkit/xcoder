use crate::agent::history::{HistoryMessage, ThreadSummary};
use crate::config::{load_app_config, ProviderConfig};
use crate::utils::command::{build_command, resolve_executable};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::{Child, Output, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub use crate::agent::codewhale::ThreadInfo;

#[derive(Default)]
pub struct OpencodeState {
    pub base_url: Option<String>,
    pub child: Option<Child>,
    pub listening: Arc<AtomicBool>,
    pub workspace: Option<String>,
}

fn provider_config() -> Result<ProviderConfig, String> {
    let config = load_app_config()?;
    config
        .providers
        .into_iter()
        .find(|p| p.id == "opencode")
        .ok_or_else(|| "OpenCode provider is not configured".to_string())
}

fn resolve_opencode_command() -> Result<std::path::PathBuf, String> {
    let provider = provider_config()?;
    resolve_executable(&provider.command)
}

pub fn base_url() -> String {
    "http://127.0.0.1:4096".to_string()
}

pub fn check_installed() -> Result<Value, String> {
    let program = resolve_opencode_command()?;
    Ok(serde_json::json!({
        "installed": true,
        "command": program.display().to_string(),
    }))
}

pub async fn wait_for_health(client: &reqwest::Client, url: &str) -> Result<(), String> {
    for _ in 0..30 {
        if client
            .get(format!("{url}/global/health"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    Err("OpenCode server failed to start".to_string())
}

pub fn spawn_runtime(workspace: &str) -> Result<Child, String> {
    let program = resolve_opencode_command()?;
    let child = build_command(
        &program,
        &[
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            "4096",
            "--cors",
            "http://localhost:1420",
            "--cors",
            "tauri://localhost",
        ],
    )
    .current_dir(workspace)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| {
        format!(
            "Failed to start opencode at {}: {e}",
            program.display()
        )
    })?;

    Ok(child)
}

pub async fn list_agents(client: &reqwest::Client, url: &str) -> Result<Vec<String>, String> {
    let response = client
        .get(format!("{url}/agent"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List agents failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let agents = json
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| item.get("hidden").and_then(|v| v.as_bool()) != Some(true))
                .filter(|item| {
                    item.get("mode")
                        .and_then(|v| v.as_str())
                        .is_none_or(|mode| mode == "primary")
                })
                .filter_map(|item| {
                    item.get("name")
                        .or_else(|| item.get("id"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(agents)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModelOption {
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub model_name: String,
    pub value: String,
}

fn provider_id_from(value: &Value) -> Option<String> {
    value
        .get("id")
        .or_else(|| value.get("providerID"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn provider_name_from(value: &Value, provider_id: &str) -> String {
    value
        .get("name")
        .or_else(|| value.get("title"))
        .or_else(|| value.get("label"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| provider_id.to_string())
}

fn model_name_from(model_id: &str, model_value: Option<&Value>) -> String {
    model_value
        .and_then(|value| {
            value
                .get("name")
                .or_else(|| value.get("title"))
                .or_else(|| value.get("label"))
                .and_then(|v| v.as_str())
        })
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| model_id.to_string())
}

fn push_model_option(
    options: &mut Vec<OpencodeModelOption>,
    seen: &mut std::collections::BTreeSet<String>,
    provider_id: &str,
    provider_name: &str,
    model_id: &str,
    model_name: &str,
) {
    let value = format!("{provider_id}/{model_id}");
    if !seen.insert(value.clone()) {
        return;
    }
    options.push(OpencodeModelOption {
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        model_id: model_id.to_string(),
        model_name: model_name.to_string(),
        value,
    });
}

fn collect_models_from_provider(
    options: &mut Vec<OpencodeModelOption>,
    seen: &mut std::collections::BTreeSet<String>,
    provider: &Value,
) {
    let Some(provider_id) = provider_id_from(provider) else {
        return;
    };
    let provider_name = provider_name_from(provider, &provider_id);

    let Some(models) = provider.get("models") else {
        return;
    };

    match models {
        Value::Object(map) => {
            for (model_id, model_value) in map {
                if model_id.is_empty() {
                    continue;
                }
                let model_name = model_name_from(model_id, Some(model_value));
                push_model_option(
                    options,
                    seen,
                    &provider_id,
                    &provider_name,
                    model_id,
                    &model_name,
                );
            }
        }
        Value::Array(items) => {
            for item in items {
                let model_id = item
                    .get("id")
                    .or_else(|| item.get("modelID"))
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if model_id.is_empty() {
                    continue;
                }
                let model_name = model_name_from(model_id, Some(item));
                push_model_option(
                    options,
                    seen,
                    &provider_id,
                    &provider_name,
                    model_id,
                    &model_name,
                );
            }
        }
        _ => {}
    }
}

fn providers_array<'a>(payload: &'a Value) -> Option<&'a Vec<Value>> {
    if let Some(items) = payload.as_array() {
        return Some(items);
    }

    payload
        .get("providers")
        .or_else(|| payload.get("all"))
        .and_then(|value| value.as_array())
}

fn connected_provider_ids(payload: &Value) -> Option<std::collections::BTreeSet<String>> {
    let connected: std::collections::BTreeSet<String> = payload
        .get("connected")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if connected.is_empty() {
        None
    } else {
        Some(connected)
    }
}

fn parse_provider_models(payload: &Value) -> Vec<OpencodeModelOption> {
    let mut options = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let connected = connected_provider_ids(payload);

    let Some(providers) = providers_array(payload) else {
        return options;
    };

    for provider in providers {
        if let Some(connected) = &connected {
            let Some(provider_id) = provider_id_from(provider) else {
                continue;
            };
            if !connected.contains(&provider_id) {
                continue;
            }
        }
        collect_models_from_provider(&mut options, &mut seen, provider);
    }

    options.sort_by(|a, b| {
        a.provider_name
            .cmp(&b.provider_name)
            .then(a.model_name.cmp(&b.model_name))
    });
    options
}

async fn fetch_provider_models_from(
    client: &reqwest::Client,
    url: &str,
    path: &str,
) -> Result<Vec<OpencodeModelOption>, String> {
    let response = client
        .get(format!("{url}{path}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List provider models failed ({path}): {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(parse_provider_models(&json))
}

pub async fn list_provider_models(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<OpencodeModelOption>, String> {
    match fetch_provider_models_from(client, url, "/config/providers").await {
        Ok(options) if !options.is_empty() => Ok(options),
        Ok(_) | Err(_) => fetch_provider_models_from(client, url, "/provider").await,
    }
}

pub async fn create_session(
    client: &reqwest::Client,
    url: &str,
    workspace: &str,
    agent: &str,
) -> Result<ThreadInfo, String> {
    let body = serde_json::json!({
        "title": "新会话",
    });

    let response = client
        .post(format!("{url}/session"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Create session failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(ThreadInfo {
        id: json["id"].as_str().unwrap_or_default().to_string(),
        mode: Some(agent.to_string()),
        model: None,
        workspace: Some(workspace.to_string()),
    })
}

pub async fn update_session_title(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    title: &str,
) -> Result<(), String> {
    let body = serde_json::json!({ "title": title });

    let response = client
        .patch(format!("{url}/session/{session_id}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Update session title failed: {text}"));
    }

    Ok(())
}

pub async fn send_prompt(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    agent: &str,
    model: Option<&str>,
    message: &str,
) -> Result<(), String> {
    let mut body = serde_json::json!({
        "agent": agent,
        "parts": [{ "type": "text", "text": message }],
    });

    if let Some(model) = model.filter(|m| !m.is_empty()) {
        if let Some((provider_id, model_id)) = model.split_once('/') {
            body["model"] = serde_json::json!({
                "providerID": provider_id,
                "modelID": model_id,
            });
        }
    }

    let response = client
        .post(format!("{url}/session/{session_id}/prompt_async"))
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Send prompt failed: {text}"));
    }

    Ok(())
}

fn permission_request_id(properties: &Value) -> Option<String> {
    if let Some(request_id) = properties.get("requestID").and_then(|v| v.as_str()) {
        if !request_id.is_empty() {
            return Some(request_id.to_string());
        }
    }

    let id = properties.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let call_id = properties
        .get("tool")
        .and_then(|tool| tool.get("callID"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if !id.is_empty() && id != call_id && !id.starts_with("call_") {
        return Some(id.to_string());
    }

    None
}

fn permission_description(properties: &Value) -> String {
    if let Some(desc) = properties
        .get("description")
        .or_else(|| properties.get("title"))
        .or_else(|| properties.get("message"))
        .and_then(|v| v.as_str())
    {
        if !desc.is_empty() {
            return desc.to_string();
        }
    }

    let permission = properties
        .get("permission")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let patterns: Vec<&str> = properties
        .get("patterns")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|p| p.as_str()).collect())
        .unwrap_or_default();

    if !patterns.is_empty() {
        let label = if permission.is_empty() {
            "需要审批"
        } else {
            permission
        };
        return format!("{label}: {}", patterns.join(", "));
    }

    if !permission.is_empty() {
        return permission.to_string();
    }

    "需要审批".to_string()
}

pub async fn get_pending_permission(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
) -> Result<Option<crate::agent::history::PendingApproval>, String> {
    let response = client
        .get(format!("{url}/permission"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List permissions failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let entries = json.as_array().cloned().unwrap_or_default();

    for entry in entries {
        let sid = entry.get("sessionID").and_then(|v| v.as_str());
        if sid != Some(session_id) {
            continue;
        }

        let Some(id) = permission_request_id(&entry) else {
            continue;
        };

        return Ok(Some(crate::agent::history::PendingApproval {
            id,
            description: permission_description(&entry),
        }));
    }

    Ok(None)
}

pub async fn approve_permission(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    permission_id: &str,
    allow: bool,
) -> Result<(), String> {
    let reply = if allow { "once" } else { "reject" };

    let response = client
        .post(format!("{url}/permission/{permission_id}/reply"))
        .json(&serde_json::json!({ "reply": reply }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() {
        return Ok(());
    }

    let text = response.text().await.unwrap_or_default();
    let fallback = client
        .post(format!(
            "{url}/session/{session_id}/permissions/{permission_id}"
        ))
        .json(&serde_json::json!({
            "response": reply,
            "remember": false,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !fallback.status().is_success() {
        let fallback_text = fallback.text().await.unwrap_or_default();
        return Err(format!("Approval failed: {text}; fallback: {fallback_text}"));
    }

    Ok(())
}

fn workspaces_match(left: &str, right: &str) -> bool {
    left.replace('/', "\\")
        .trim_end_matches('\\')
        .eq_ignore_ascii_case(
            &right
                .replace('/', "\\")
                .trim_end_matches('\\')
                .to_string(),
        )
}

fn part_text(part: &Value) -> Option<String> {
    part.get("text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

pub async fn list_sessions(
    client: &reqwest::Client,
    url: &str,
    workspace: &str,
    limit: u32,
) -> Result<Vec<ThreadSummary>, String> {
    let limit_str = limit.to_string();
    let response = client
        .get(format!("{url}/session"))
        .query(&[("directory", workspace), ("limit", limit_str.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List sessions failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let items = json.as_array().cloned().unwrap_or_default();

    Ok(items
        .into_iter()
        .filter_map(|item| {
            let directory = item["directory"].as_str().unwrap_or("");
            if !workspaces_match(directory, workspace) {
                return None;
            }
            Some(ThreadSummary {
                id: item["id"].as_str().unwrap_or_default().to_string(),
                title: item["title"].as_str().unwrap_or("未命名会话").to_string(),
                preview: None,
                workspace: Some(directory.to_string()),
                updated_at: item["time"]["updated"]
                    .as_i64()
                    .map(|ms| ms.to_string()),
            })
        })
        .collect())
}

pub async fn load_session_history(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
) -> Result<Vec<HistoryMessage>, String> {
    let response = client
        .get(format!("{url}/session/{session_id}/message"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Load session messages failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let entries = json.as_array().cloned().unwrap_or_default();
    let mut messages = Vec::new();

    for entry in entries {
        let info = entry.get("info").cloned().unwrap_or(Value::Null);
        let role = info["role"].as_str().unwrap_or("");
        let message_id = info["id"].as_str().unwrap_or_default().to_string();
        let timestamp = info["time"]["created"].as_i64().unwrap_or(0);
        let parts = entry["parts"].as_array().cloned().unwrap_or_default();

        if role == "user" {
            let mut content = String::new();
            for part in &parts {
                if part["type"].as_str() == Some("text") {
                    if let Some(text) = part_text(part) {
                        if !content.is_empty() {
                            content.push('\n');
                        }
                        content.push_str(&text);
                    }
                }
            }
            if !content.is_empty() {
                messages.push(HistoryMessage {
                    id: message_id.clone(),
                    role: "user".to_string(),
                    content,
                    tool_name: None,
                    timestamp,
                });
            }
            continue;
        }

        if role == "assistant" {
            if let Some(error) = info.get("error") {
                let message = error["data"]["message"]
                    .as_str()
                    .or_else(|| error["message"].as_str())
                    .unwrap_or("OpenCode 会话出错");
                messages.push(HistoryMessage {
                    id: format!("{message_id}-error"),
                    role: "assistant".to_string(),
                    content: format!("错误：{message}"),
                    tool_name: None,
                    timestamp,
                });
            }

            for (index, part) in parts.iter().enumerate() {
                let part_type = part["type"].as_str().unwrap_or("");
                let part_id = part["id"]
                    .as_str()
                    .unwrap_or(&format!("{message_id}-{index}"))
                    .to_string();

                match part_type {
                    "text" => {
                        if let Some(text) = part_text(part) {
                            if !text.is_empty() {
                                messages.push(HistoryMessage {
                                    id: part_id,
                                    role: "assistant".to_string(),
                                    content: text,
                                    tool_name: None,
                                    timestamp,
                                });
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = part_text(part) {
                            if !text.is_empty() {
                                messages.push(HistoryMessage {
                                    id: part_id,
                                    role: "assistant".to_string(),
                                    content: format!("> {text}"),
                                    tool_name: None,
                                    timestamp,
                                });
                            }
                        }
                    }
                    "tool" | "tool-call" => {
                        let tool_name = part["tool"]
                            .as_str()
                            .or_else(|| part["name"].as_str())
                            .unwrap_or("tool")
                            .to_string();
                        let state = part
                            .get("state")
                            .or_else(|| part.get("data"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        let content = serde_json::to_string_pretty(&state)
                            .unwrap_or_else(|_| state.to_string());
                        messages.push(HistoryMessage {
                            id: part_id,
                            role: "tool".to_string(),
                            content,
                            tool_name: Some(tool_name),
                            timestamp,
                        });
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(messages)
}

pub async fn delete_session(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
) -> Result<(), String> {
    let response = client
        .delete(format!("{url}/session/{session_id}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Delete session failed: {text}"));
    }

    Ok(())
}

pub fn normalize_event(raw: &Value, session_id: &str) -> Option<Value> {
    let event_type = raw.get("type").and_then(|v| v.as_str())?;
    let properties = raw.get("properties").unwrap_or(raw);

    if let Some(sid) = properties.get("sessionID").and_then(|v| v.as_str()) {
        if sid != session_id {
            return None;
        }
    }

    match event_type {
        "message.part.updated" => {
            let part = properties.get("part")?;
            let part_type = part.get("type").and_then(|v| v.as_str()).unwrap_or("");

            let delta = properties
                .get("delta")
                .or_else(|| part.get("delta"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty());

            if let Some(delta) = delta {
                let kind = if part_type == "reasoning" {
                    "reasoning"
                } else {
                    "agent_message"
                };
                return Some(serde_json::json!({
                    "event": "item.delta",
                    "payload": {
                        "delta": delta,
                        "kind": kind,
                    }
                }));
            }

            if part_type == "tool" || part_type == "tool-call" {
                return Some(serde_json::json!({
                    "event": "item.completed",
                    "payload": {
                        "kind": "tool_call",
                        "name": part.get("tool")
                            .or_else(|| part.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool"),
                        "args": part.get("state")
                            .or_else(|| part.get("data"))
                            .cloned()
                            .unwrap_or(Value::Null),
                    }
                }));
            }

            if part_type == "text" {
                if let Some(role) = part.get("role").and_then(|v| v.as_str()) {
                    if role == "user" {
                        return None;
                    }
                }
                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        return Some(serde_json::json!({
                            "event": "item.delta",
                            "payload": {
                                "delta": text,
                                "kind": "agent_message",
                            }
                        }));
                    }
                }
            }

            None
        }
        "permission.asked" | "permission.updated" => {
            let id = permission_request_id(properties)?;
            let description = permission_description(properties);
            Some(serde_json::json!({
                "event": "approval.required",
                "payload": {
                    "approval_id": id,
                    "description": description,
                }
            }))
        }
        "permission.replied" => Some(serde_json::json!({
            "event": "approval.resolved",
            "payload": {}
        })),
        "session.error" => {
            let message = properties
                .get("error")
                .and_then(|error| {
                    error
                        .get("data")
                        .and_then(|data| data.get("message"))
                        .or_else(|| error.get("message"))
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("OpenCode 会话出错");
            Some(serde_json::json!({
                "event": "turn.error",
                "payload": { "message": message }
            }))
        }
        "message.updated" => {
            let info = properties.get("info")?;
            if info.get("role").and_then(|v| v.as_str()) != Some("assistant") {
                return None;
            }
            if info.get("time").and_then(|t| t.get("completed")).is_none() {
                return None;
            }
            let message = info
                .get("error")
                .and_then(|error| {
                    error
                        .get("data")
                        .and_then(|data| data.get("message"))
                        .or_else(|| error.get("message"))
                        .and_then(|v| v.as_str())
                })?;
            Some(serde_json::json!({
                "event": "turn.error",
                "payload": { "message": message }
            }))
        }
        "session.status" | "session.idle" => {
            let is_idle = if event_type == "session.idle" {
                true
            } else {
                properties
                    .get("status")
                    .and_then(|status| status.get("type").and_then(|v| v.as_str()))
                    == Some("idle")
            };
            if is_idle {
                Some(serde_json::json!({ "event": "turn.completed", "payload": {} }))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn run_command(program: &std::path::Path, args: &[&str]) -> Result<Output, String> {
    build_command(program, args)
        .output()
        .map_err(|e| format!("Failed to run {}: {e}", program.display()))
}

#[allow(dead_code)]
pub fn run_version() -> Result<String, String> {
    let program = resolve_opencode_command()?;
    let output = run_command(&program, &["--version"])?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}
