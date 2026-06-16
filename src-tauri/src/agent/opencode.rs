use crate::agent::history::{HistoryMessage, ThreadSummary};
use crate::config::runtime_args::{
    default_opencode_serve_args, opencode_serve_args_with_cors, runtime_http_base_url,
};
use crate::config::provider_config::resolve_provider_config_path;
use crate::config::{load_app_config, ProviderConfig};
use crate::utils::command::{build_command, resolve_executable};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::process::{Child, Output, Stdio};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub use crate::agent::codewhale::ThreadInfo;

#[derive(Default)]
pub struct OpencodeState {
    pub base_url: Option<String>,
    pub child: Option<Child>,
    pub listening: Arc<AtomicBool>,
    pub workspace: Option<String>,
    pub subscribed_session_id: Arc<Mutex<Option<String>>>,
    pub sse_task_active: Arc<AtomicBool>,
    pub sse_reconnect: Arc<AtomicBool>,
    pub http_client: Option<reqwest::Client>,
}

pub fn shared_http_client(state: &Mutex<OpencodeState>) -> Result<reqwest::Client, String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if guard.http_client.is_none() {
        guard.http_client = Some(http_client()?);
    }
    Ok(guard.http_client.as_ref().unwrap().clone())
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
    let provider = provider_config().unwrap_or_else(|_| ProviderConfig {
        id: "opencode".to_string(),
        provider_type: "http".to_string(),
        command: "opencode".to_string(),
        args: default_opencode_serve_args(),
        config_path: None,
        health_cmd: vec![],
        ui_options: None,
    });
    runtime_http_base_url(&provider.args, "127.0.0.1", "4096")
}

fn resolve_spawn_workspace(workspace: &str) -> String {
    if workspace.trim().is_empty() {
        return dirs::home_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
    }
    workspace.to_string()
}

pub fn check_installed() -> Result<Value, String> {
    let program = resolve_opencode_command()?;
    Ok(serde_json::json!({
        "installed": true,
        "command": program.display().to_string(),
    }))
}

pub async fn is_healthy(client: &reqwest::Client, url: &str) -> bool {
    client
        .get(format!("{url}/global/health"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
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
    let provider = provider_config()?;
    let program = resolve_opencode_command()?;
    let args = opencode_serve_args_with_cors(&provider.args);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let cwd = resolve_spawn_workspace(workspace);
    let child = build_command(&program, &arg_refs)
    .current_dir(&cwd)
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

fn with_directory(
    builder: reqwest::RequestBuilder,
    workspace: Option<&str>,
) -> reqwest::RequestBuilder {
    match workspace.filter(|value| !value.is_empty()) {
        Some(directory) => builder.query(&[("directory", directory)]),
        None => builder,
    }
}

pub fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .connect_timeout(std::time::Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeProviderCatalog {
    pub models: Vec<OpencodeModelOption>,
    pub connected_provider_ids: Vec<String>,
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

fn merge_model_options(
    target: &mut Vec<OpencodeModelOption>,
    seen: &mut BTreeSet<String>,
    incoming: Vec<OpencodeModelOption>,
) {
    for option in incoming {
        if seen.insert(option.value.clone()) {
            target.push(option);
        }
    }
}

fn parse_provider_models(payload: &Value, filter_connected: bool) -> Vec<OpencodeModelOption> {
    let mut options = Vec::new();
    let mut seen = BTreeSet::new();
    let connected = if filter_connected {
        connected_provider_ids(payload)
    } else {
        None
    };

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

    options
}

fn parse_config_provider_map(payload: &Value) -> Vec<OpencodeModelOption> {
    let mut options = Vec::new();
    let mut seen = BTreeSet::new();

    let Some(provider_map) = payload.get("provider").and_then(|value| value.as_object()) else {
        return options;
    };

    for (provider_id, provider_value) in provider_map {
        if provider_id.is_empty() {
            continue;
        }
        let mut provider = provider_value.clone();
        if provider.get("id").is_none() {
            provider["id"] = Value::String(provider_id.clone());
        }
        collect_models_from_provider(&mut options, &mut seen, &provider);
    }

    options
}

fn local_opencode_config_path() -> Option<PathBuf> {
    resolve_provider_config_path("opencode").ok()
}

fn parse_local_opencode_providers() -> Vec<OpencodeModelOption> {
    let Some(path) = local_opencode_config_path() else {
        return Vec::new();
    };
    if !path.is_file() {
        return Vec::new();
    }

    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(_) => return Vec::new(),
    };
    let json: Value = match serde_json::from_str(&content) {
        Ok(json) => json,
        Err(_) => return Vec::new(),
    };

    parse_config_provider_map(&json)
}

fn sort_model_options(options: &mut [OpencodeModelOption]) {
    options.sort_by(|a, b| {
        a.provider_name
            .cmp(&b.provider_name)
            .then(a.model_name.cmp(&b.model_name))
    });
}

async fn fetch_json(client: &reqwest::Client, url: &str, path: &str) -> Result<Value, String> {
    let response = client
        .get(format!("{url}{path}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Request failed ({path}): {text}"));
    }

    response.json().await.map_err(|e| e.to_string())
}

pub async fn list_provider_models(
    client: &reqwest::Client,
    url: &str,
) -> Result<OpencodeProviderCatalog, String> {
    let mut options = Vec::new();
    let mut seen = BTreeSet::new();
    let mut connected_ids: Vec<String> = Vec::new();

    if let Ok(json) = fetch_json(client, url, "/config/providers").await {
        merge_model_options(
            &mut options,
            &mut seen,
            parse_provider_models(&json, false),
        );
    }

    if let Ok(json) = fetch_json(client, url, "/config").await {
        merge_model_options(
            &mut options,
            &mut seen,
            parse_config_provider_map(&json),
        );
    }

    merge_model_options(
        &mut options,
        &mut seen,
        parse_local_opencode_providers(),
    );

    if let Ok(json) = fetch_json(client, url, "/provider").await {
        if let Some(connected) = connected_provider_ids(&json) {
            connected_ids = connected.into_iter().collect();
        }
        merge_model_options(
            &mut options,
            &mut seen,
            parse_provider_models(&json, true),
        );
    }

    if options.is_empty() {
        return Err("No provider models found".to_string());
    }

    sort_model_options(&mut options);
    Ok(OpencodeProviderCatalog {
        models: options,
        connected_provider_ids: connected_ids,
    })
}

pub async fn create_session(
    client: &reqwest::Client,
    url: &str,
    workspace: &str,
    agent: &str,
    title: &str,
) -> Result<ThreadInfo, String> {
    let body = serde_json::json!({
        "title": title,
    });

    let response = with_directory(
        client.post(format!("{url}/session")),
        Some(workspace),
    )
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
    workspace: Option<&str>,
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

    let response = with_directory(
        client.post(format!("{url}/session/{session_id}/prompt_async")),
        workspace,
    )
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
    for key in ["requestID", "id", "permissionID"] {
        let Some(id) = properties.get(key).and_then(|v| v.as_str()) else {
            continue;
        };
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }

    properties
        .get("tool")
        .and_then(|tool| tool.get("callID"))
        .and_then(|v| v.as_str())
        .filter(|id| !id.is_empty())
        .map(|id| id.to_string())
}

fn permission_event_for_session(properties: &Value, session_id: &str, strict: bool) -> bool {
    match properties.get("sessionID").and_then(|v| v.as_str()) {
        Some(sid) => sid == session_id,
        None => !strict,
    }
}

fn permission_entries(json: &Value) -> Vec<Value> {
    if let Some(items) = json.as_array() {
        return items.clone();
    }
    for key in ["data", "permissions", "items", "requests"] {
        if let Some(items) = json.get(key).and_then(|v| v.as_array()) {
            return items.clone();
        }
    }
    Vec::new()
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
    workspace: Option<&str>,
) -> Result<Option<crate::agent::history::PendingApproval>, String> {
    let response = with_directory(client.get(format!("{url}/permission")), workspace)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List permissions failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let entries = permission_entries(&json);

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
    workspace: Option<&str>,
) -> Result<(), String> {
    let reply = if allow { "once" } else { "reject" };

    let mut session_request = client.post(format!(
        "{url}/session/{session_id}/permissions/{permission_id}"
    ));
    if let Some(dir) = workspace.filter(|value| !value.is_empty()) {
        session_request = session_request.query(&[("directory", dir)]);
    }
    let session_response = session_request
        .json(&serde_json::json!({
            "response": reply,
            "remember": false,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if session_response.status().is_success() {
        return Ok(());
    }

    let session_text = session_response.text().await.unwrap_or_default();

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
    Err(format!(
        "Approval failed: session={session_text}; permission={text}"
    ))
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

fn part_timestamp(part: &Value, fallback: i64) -> i64 {
    part.get("time")
        .and_then(|time| time.get("start").or_else(|| time.get("created")))
        .and_then(|v| v.as_i64())
        .unwrap_or(fallback)
}

fn normalize_planning_message_order(batch: &mut [HistoryMessage]) {
    let mut index = 0usize;
    while index + 1 < batch.len() {
        let swap_pair = batch[index].role == "assistant"
            && batch[index].tool_name.is_none()
            && batch[index + 1].role == "tool"
            && batch[index + 1].tool_name.as_deref() == Some("task");
        if swap_pair {
            batch.swap(index, index + 1);
            index += 2;
        } else {
            index += 1;
        }
    }
}

pub async fn list_sessions(
    client: &reqwest::Client,
    url: &str,
    workspace: &str,
    limit: u32,
) -> Result<Vec<ThreadSummary>, String> {
    let limit_str = limit.to_string();
    let mut response = client
        .get(format!("{url}/session"))
        .query(&[
            ("directory", workspace),
            ("limit", limit_str.as_str()),
            ("roots", "true"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        response = client
            .get(format!("{url}/session"))
            .query(&[("directory", workspace), ("limit", limit_str.as_str())])
            .send()
            .await
            .map_err(|e| e.to_string())?;
    }

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("List sessions failed: {text}"));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    let items = json.as_array().cloned().unwrap_or_default();

    Ok(items
        .into_iter()
        .filter_map(|item| {
            if item
                .get("parentID")
                .and_then(|value| value.as_str())
                .is_some_and(|parent| !parent.is_empty())
            {
                return None;
            }
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
    workspace: Option<&str>,
    limit: Option<u32>,
) -> Result<Vec<HistoryMessage>, String> {
    let mut request = with_directory(
        client.get(format!("{url}/session/{session_id}/message")),
        workspace,
    );
    if let Some(limit) = limit {
        request = request.query(&[("limit", limit.to_string())]);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;

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

            let mut batch = Vec::new();

            for (index, part) in parts.iter().enumerate() {
                let part_type = part["type"].as_str().unwrap_or("");
                let part_id = part["id"]
                    .as_str()
                    .unwrap_or(&format!("{message_id}-{index}"))
                    .to_string();
                let part_time = part_timestamp(part, timestamp);

                match part_type {
                    "text" => {
                        if let Some(text) = part_text(part) {
                            if !text.is_empty() {
                                batch.push(HistoryMessage {
                                    id: part_id,
                                    role: "assistant".to_string(),
                                    content: text,
                                    tool_name: None,
                                    timestamp: part_time,
                                });
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = part_text(part) {
                            if !text.is_empty() {
                                batch.push(HistoryMessage {
                                    id: part_id,
                                    role: "assistant".to_string(),
                                    content: format!("> {text}"),
                                    tool_name: None,
                                    timestamp: part_time,
                                });
                            }
                        }
                    }
                    "tool" | "tool-call" => {
                        let state = part
                            .get("state")
                            .or_else(|| part.get("data"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        if state.is_null() {
                            continue;
                        }
                        if let Some(obj) = state.as_object() {
                            if obj.is_empty() {
                                continue;
                            }
                        }
                        let tool_name = part["tool"]
                            .as_str()
                            .or_else(|| part["name"].as_str())
                            .unwrap_or("tool")
                            .to_string();
                        let content = serde_json::to_string_pretty(&state)
                            .unwrap_or_else(|_| state.to_string());
                        batch.push(HistoryMessage {
                            id: part_id,
                            role: "tool".to_string(),
                            content,
                            tool_name: Some(tool_name),
                            timestamp: part_time,
                        });
                    }
                    _ => {}
                }
            }

            normalize_planning_message_order(&mut batch);
            messages.extend(batch);
        }
    }

    Ok(messages)
}

fn tool_part_is_active(part: &Value) -> bool {
    let part_type = part.get("type").and_then(|v| v.as_str()).unwrap_or("");
    if part_type != "tool" && part_type != "tool-call" {
        return false;
    }
    part.get("state")
        .and_then(|state| state.get("status"))
        .and_then(|v| v.as_str())
        .map(|status| {
            matches!(
                status,
                "running" | "pending" | "in_progress" | "executing"
            )
        })
        .unwrap_or(false)
}

async fn session_status_type(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<Option<String>, String> {
    let response = with_directory(
        client.get(format!("{url}/session/status")),
        workspace,
    )
    .send()
    .await
    .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json
        .get(session_id)
        .and_then(|status| status.get("type"))
        .and_then(|v| v.as_str())
        .map(str::to_string))
}

fn assistant_entry_is_active(entry: &Value) -> bool {
    let info = entry.get("info").cloned().unwrap_or(Value::Null);
    if info.get("role").and_then(|v| v.as_str()) != Some("assistant") {
        return false;
    }

    let parts = entry
        .get("parts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    if parts.iter().any(tool_part_is_active) {
        return true;
    }

    if info
        .get("time")
        .and_then(|t| t.get("completed"))
        .is_some()
    {
        return false;
    }

    let has_tool_part = parts.iter().any(|part| {
        matches!(
            part.get("type").and_then(|v| v.as_str()),
            Some("tool") | Some("tool-call")
        )
    });
    if has_tool_part {
        return false;
    }

    let has_text = parts.iter().any(|part| {
        part.get("type").and_then(|v| v.as_str()) == Some("text")
            && part
                .get("text")
                .and_then(|v| v.as_str())
                .is_some_and(|text| !text.is_empty())
    });
    if has_text {
        return false;
    }

    let has_reasoning = parts.iter().any(|part| {
        part.get("type").and_then(|v| v.as_str()) == Some("reasoning")
            && part
                .get("text")
                .and_then(|v| v.as_str())
                .is_some_and(|text| !text.is_empty())
    });
    if has_reasoning {
        return false;
    }

    true
}

fn messages_indicate_busy(entries: &[Value]) -> bool {
    for entry in entries.iter().rev() {
        let info = entry.get("info").cloned().unwrap_or(Value::Null);
        let role = info.get("role").and_then(|v| v.as_str());
        if role == Some("assistant") {
            return assistant_entry_is_active(entry);
        }
        if role == Some("user") {
            // Session may report idle before the assistant entry is created.
            return true;
        }
    }
    false
}

async fn fetch_recent_message_entries(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<Vec<Value>, String> {
    let response = with_directory(
        client.get(format!("{url}/session/{session_id}/message")),
        workspace,
    )
    .query(&[("limit", "8")])
    .send()
    .await
    .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json.as_array().cloned().unwrap_or_default())
}

async fn fetch_messages_indicate_busy(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<bool, String> {
    let entries = fetch_recent_message_entries(client, url, session_id, workspace).await?;
    Ok(messages_indicate_busy(&entries))
}

async fn resolve_session_busy(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
    status: Option<String>,
) -> Result<bool, String> {
    if matches!(status.as_deref(), Some("busy") | Some("retry")) {
        return Ok(true);
    }
    fetch_messages_indicate_busy(client, url, session_id, workspace).await
}

#[derive(Serialize)]
pub struct OpencodeTurnPoll {
    pub messages: Vec<HistoryMessage>,
    pub busy: bool,
    pub pending: Option<crate::agent::history::PendingApproval>,
    pub turn_complete: bool,
}

pub async fn poll_turn_state(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
    limit: Option<u32>,
) -> Result<OpencodeTurnPoll, String> {
    let history_fut = load_session_history(client, url, session_id, workspace, limit);
    let status_fut = session_status_type(client, url, session_id, workspace);
    let permission_fut = get_pending_permission(client, url, session_id, workspace);

    let (history_res, status_res, permission_res) =
        tokio::join!(history_fut, status_fut, permission_fut);

    let messages = history_res?;
    let pending = permission_res?;
    let busy = if pending.is_some() {
        true
    } else {
        resolve_session_busy(
            client,
            url,
            session_id,
            workspace,
            status_res?,
        )
        .await?
    };

    let turn_complete = pending.is_none() && !busy;

    Ok(OpencodeTurnPoll {
        messages,
        busy,
        pending,
        turn_complete,
    })
}

#[derive(Serialize)]
pub struct OpencodeSessionStatusPoll {
    pub busy: bool,
    pub pending: Option<crate::agent::history::PendingApproval>,
}

pub async fn poll_session_status(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<OpencodeSessionStatusPoll, String> {
    let status_fut = session_status_type(client, url, session_id, workspace);
    let permission_fut = get_pending_permission(client, url, session_id, workspace);

    let (status_res, permission_res) = tokio::join!(status_fut, permission_fut);

    let pending = permission_res?;
    let busy = if pending.is_some() {
        true
    } else {
        resolve_session_busy(
            client,
            url,
            session_id,
            workspace,
            status_res?,
        )
        .await?
    };

    Ok(OpencodeSessionStatusPoll { busy, pending })
}

pub async fn is_session_busy(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<bool, String> {
    if let Ok(Some(_)) = get_pending_permission(client, url, session_id, workspace).await {
        return Ok(true);
    }

    let status = session_status_type(client, url, session_id, workspace).await?;
    resolve_session_busy(client, url, session_id, workspace, status).await
}

pub async fn abort_session(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<(), String> {
    let response = with_directory(
        client.post(format!("{url}/session/{session_id}/abort")),
        workspace,
    )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() || response.status().as_u16() == 404 {
        return Ok(());
    }

    let text = response.text().await.unwrap_or_default();
    if text.is_empty() {
        Ok(())
    } else {
        Err(format!("Abort session failed: {text}"))
    }
}

fn friendly_delete_error(text: &str) -> String {
    if let Ok(json) = serde_json::from_str::<Value>(text) {
        if let Some(message) = json
            .pointer("/error/data/message")
            .and_then(|v| v.as_str())
        {
            return format!("删除会话失败：{message}");
        }
        if let Some(message) = json.get("message").and_then(|v| v.as_str()) {
            return format!("删除会话失败：{message}");
        }
    }

    if text.contains("FOREIGN KEY") || text.contains("Failed query") {
        return "删除会话失败：会话仍在后台运行，请稍后重试".to_string();
    }

    format!("Delete session failed: {text}")
}

fn delete_error_is_not_found(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("notfounderror")
        || lower.contains("not found")
        || lower.contains("session not found")
}

async fn delete_session_once(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<(), String> {
    let response = with_directory(
        client.delete(format!("{url}/session/{session_id}")),
        workspace,
    )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if response.status().is_success() || response.status().as_u16() == 404 {
        return Ok(());
    }

    let text = response.text().await.unwrap_or_default();
    if delete_error_is_not_found(&text) {
        return Ok(());
    }
    Err(friendly_delete_error(&text))
}

fn delete_should_retry(message: &str) -> bool {
    message.contains("FOREIGN KEY")
        || message.contains("Failed query")
        || message.contains("ConstraintError")
        || message.contains("仍在后台运行")
}

fn is_abort_message(message: &str) -> bool {
    let normalized = message.trim().to_ascii_lowercase();
    normalized == "aborted"
        || normalized == "abort"
        || normalized.contains("cancelled")
        || normalized.contains("canceled")
}

fn turn_abort_or_error_event(message: &str) -> Value {
    if is_abort_message(message) {
        serde_json::json!({
            "event": "turn.aborted",
            "payload": {}
        })
    } else {
        serde_json::json!({
            "event": "turn.error",
            "payload": { "message": message }
        })
    }
}

pub async fn cancel_generation(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<(), String> {
    abort_session(client, url, session_id, workspace).await
}

pub async fn delete_session(
    client: &reqwest::Client,
    url: &str,
    session_id: &str,
    workspace: Option<&str>,
) -> Result<(), String> {
    let mut last_error = String::from("删除会话失败");

    for attempt in 0..3 {
        let _ = abort_session(client, url, session_id, workspace).await;
        let wait_ms = 250 + attempt * 250;
        tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;

        match delete_session_once(client, url, session_id, workspace).await {
            Ok(()) => return Ok(()),
            Err(err) => {
                if delete_error_is_not_found(&err) {
                    return Ok(());
                }
                last_error = err;
                if attempt < 2 && delete_should_retry(&last_error) {
                    continue;
                }
                return Err(last_error);
            }
        }
    }

    Err(last_error)
}

pub fn normalize_event(raw: &Value, session_id: &str) -> Option<Value> {
    let event_type = raw.get("type").and_then(|v| v.as_str())?;
    let properties = raw.get("properties").unwrap_or(raw);

    let event_session_id = properties
        .get("sessionID")
        .or_else(|| raw.get("sessionID"))
        .and_then(|v| v.as_str());
    if let Some(sid) = event_session_id {
        if !session_id.is_empty() && sid != session_id {
            return None;
        }
    }

    match event_type {
        "message.part.delta" => {
            let delta = properties
                .get("delta")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())?;

            let field = properties
                .get("field")
                .and_then(|v| v.as_str())
                .unwrap_or("text");

            let kind = if field == "reasoning" {
                "reasoning"
            } else {
                "agent_message"
            };

            let mut payload = serde_json::json!({
                "delta": delta,
                "kind": kind,
            });

            if let Some(part_id) = properties
                .get("partID")
                .or_else(|| properties.get("partId"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                payload["partId"] = serde_json::json!(part_id);
            }

            Some(serde_json::json!({
                "event": "item.delta",
                "payload": payload,
            }))
        }
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
                let state = part
                    .get("state")
                    .or_else(|| part.get("data"))
                    .cloned()
                    .unwrap_or(Value::Null);
                if state.is_null() {
                    return None;
                }
                if let Some(obj) = state.as_object() {
                    if obj.is_empty() {
                        return None;
                    }
                }
                return Some(serde_json::json!({
                    "event": "item.updated",
                    "payload": {
                        "kind": "tool_call",
                        "id": part.get("id").and_then(|v| v.as_str()).unwrap_or(""),
                        "name": part.get("tool")
                            .or_else(|| part.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool"),
                        "args": state,
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
                            "event": "item.text",
                            "payload": {
                                "text": text,
                                "kind": "agent_message",
                            }
                        }));
                    }
                }
            }

            if part_type == "reasoning" {
                if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        return Some(serde_json::json!({
                            "event": "item.text",
                            "payload": {
                                "text": text,
                                "kind": "reasoning",
                            }
                        }));
                    }
                }
            }

            None
        }
        "permission.asked" | "permission.updated" | "permission.request" => {
            if !permission_event_for_session(properties, session_id, false) {
                return None;
            }
            let description = permission_description(properties);
            Some(serde_json::json!({
                "event": "approval.required",
                "payload": {
                    "approval_id": permission_request_id(properties).unwrap_or_default(),
                    "description": description,
                }
            }))
        }
        "permission.replied" => {
            if !permission_event_for_session(properties, session_id, true) {
                return None;
            }
            Some(serde_json::json!({
                "event": "approval.resolved",
                "payload": {}
            }))
        }
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
            Some(turn_abort_or_error_event(message))
        }
        "message.updated" => {
            let info = properties.get("info")?;
            if info.get("role").and_then(|v| v.as_str()) != Some("assistant") {
                return None;
            }
            if info.get("time").and_then(|t| t.get("completed")).is_none() {
                return None;
            }
            if let Some(error) = info.get("error") {
                let message = error
                    .get("data")
                    .and_then(|data| data.get("message"))
                    .or_else(|| error.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("OpenCode 会话出错");
                return Some(turn_abort_or_error_event(message));
            }
            None
        }
        "session.turn.completed" => Some(serde_json::json!({
            "event": "turn.completed",
            "payload": {}
        })),
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
                return Some(serde_json::json!({
                    "event": "session.idle",
                    "payload": {}
                }));
            }

            let is_busy = properties
                .get("status")
                .and_then(|status| status.get("type").and_then(|v| v.as_str()))
                == Some("busy");
            if is_busy {
                return Some(serde_json::json!({
                    "event": "session.busy",
                    "payload": {}
                }));
            }

            None
        }
        _ => None,
    }
}

pub fn logout_provider_auth(provider: &str) -> Result<(), String> {
    let id = provider.trim();
    if id.is_empty() {
        return Ok(());
    }
    let program = resolve_opencode_command()?;
    let output = run_command(&program, &["auth", "logout", id])?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        Ok(())
    } else {
        Err(stderr)
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
