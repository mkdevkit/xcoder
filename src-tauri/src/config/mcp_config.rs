use crate::config::provider_config::resolve_provider_config_path;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerEntry {
    pub id: String,
    pub transport: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub url: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConfigView {
    pub path: String,
    #[serde(default)]
    pub installed: bool,
    pub servers: Vec<McpServerEntry>,
}

fn ensure_parent(path: &std::path::Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn string_map_from_json(value: Option<&Value>) -> HashMap<String, String> {
    value
        .and_then(|item| item.as_object())
        .map(|map| {
            map.iter()
                .filter_map(|(key, value)| {
                    value
                        .as_str()
                        .map(|text| (key.clone(), text.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn resolve_project_opencode_config_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join("opencode.json")
}

pub fn load_project_opencode_mcp_config(workspace: &str) -> Result<McpConfigView, String> {
    let path = resolve_project_opencode_config_path(workspace);
    if !path.is_file() {
        return Ok(McpConfigView {
            path: path.to_string_lossy().to_string(),
            installed: false,
            servers: Vec::new(),
        });
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&content).unwrap_or_else(|_| json!({}));
    Ok(McpConfigView {
        path: path.to_string_lossy().to_string(),
        installed: true,
        servers: parse_opencode_mcp_servers(&json),
    })
}

fn save_opencode_mcp_to_path(path: &std::path::Path, servers: &[McpServerEntry]) -> Result<(), String> {
    ensure_parent(path)?;

    let existing_content = if path.is_file() {
        fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string())
    } else {
        String::new()
    };
    let mut json: Value = if existing_content.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&existing_content).unwrap_or_else(|_| json!({}))
    };

    if let Some(obj) = json.as_object_mut() {
        if obj.get("$schema").is_none() {
            obj.insert(
                "$schema".to_string(),
                Value::String("https://opencode.ai/config.json".to_string()),
            );
        }

        let mcp = build_opencode_mcp_json(servers);
        if mcp.as_object().is_some_and(|map| map.is_empty()) {
            obj.remove("mcp");
        } else {
            obj.insert("mcp".to_string(), mcp);
        }
    }

    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
}

pub fn save_global_opencode_mcp_config(servers: &[McpServerEntry]) -> Result<(), String> {
    let path = resolve_provider_config_path("opencode")?;
    if !path.exists() {
        return Err("OpenCode 配置文件不存在，请先安装并初始化 OpenCode".to_string());
    }
    save_opencode_mcp_to_path(&path, servers)
}

pub fn save_mcp_config_for_scope(
    provider: &str,
    scope: &str,
    workspace: &str,
    servers: &[McpServerEntry],
) -> Result<(), String> {
    match (provider, scope) {
        ("opencode", "global") => save_global_opencode_mcp_config(servers),
        ("opencode", "project") => {
            if workspace.trim().is_empty() {
                return Err("Workspace is required".to_string());
            }
            save_project_opencode_mcp_config(workspace, servers)
        }
        _ => Err(format!("Unsupported MCP scope: {provider}/{scope}")),
    }
}

pub fn save_project_opencode_mcp_config(
    workspace: &str,
    servers: &[McpServerEntry],
) -> Result<(), String> {
    use crate::config::project_opencode_config::update_project_opencode_config;

    update_project_opencode_config(workspace, |obj| {
        let mcp = build_opencode_mcp_json(servers);
        if mcp.as_object().is_some_and(|map| map.is_empty()) {
            obj.remove("mcp");
        } else {
            obj.insert("mcp".to_string(), mcp);
        }
        Ok(())
    })
}

fn parse_opencode_mcp_server(id: &str, value: &Value) -> McpServerEntry {
    let explicit_type = value.get("type").and_then(|item| item.as_str());
    let url = value
        .get("url")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let command_parts = value
        .get("command")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|text| text.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let transport = match explicit_type {
        Some("remote") => "remote".to_string(),
        Some("local") | Some("stdio") => "stdio".to_string(),
        _ if !url.trim().is_empty() => "remote".to_string(),
        _ => "stdio".to_string(),
    };
    let command = command_parts.first().cloned().unwrap_or_default();
    let args = if command_parts.len() > 1 {
        command_parts[1..].to_vec()
    } else {
        Vec::new()
    };
    let enabled = value
        .get("enabled")
        .and_then(|item| item.as_bool())
        .unwrap_or(true);

    McpServerEntry {
        id: id.to_string(),
        transport,
        command,
        args,
        url,
        enabled,
        env: string_map_from_json(
            value
                .get("environment")
                .or_else(|| value.get("env")),
        ),
        headers: string_map_from_json(value.get("headers")),
    }
}

pub fn parse_opencode_mcp_servers(json: &Value) -> Vec<McpServerEntry> {
    let Some(map) = json.get("mcp").and_then(|value| value.as_object()) else {
        return Vec::new();
    };

    let mut servers = map
        .iter()
        .map(|(id, value)| parse_opencode_mcp_server(id, value))
        .collect::<Vec<_>>();
    servers.sort_by(|left, right| left.id.cmp(&right.id));
    servers
}

pub fn build_opencode_mcp_json(servers: &[McpServerEntry]) -> Value {
    let mut map = Map::new();
    for entry in servers {
        let id = entry.id.trim();
        if id.is_empty() {
            continue;
        }

        let mut obj = Map::new();
        if entry.transport == "remote" {
            if entry.url.trim().is_empty() {
                continue;
            }
            obj.insert("type".to_string(), Value::String("remote".to_string()));
            obj.insert("url".to_string(), Value::String(entry.url.trim().to_string()));
            if !entry.headers.is_empty() {
                let mut headers = Map::new();
                for (key, value) in &entry.headers {
                    headers.insert(key.clone(), Value::String(value.clone()));
                }
                obj.insert("headers".to_string(), Value::Object(headers));
            }
        } else if !entry.command.trim().is_empty() {
            obj.insert("type".to_string(), Value::String("local".to_string()));
            let mut command = vec![entry.command.trim().to_string()];
            command.extend(entry.args.iter().cloned());
            obj.insert(
                "command".to_string(),
                Value::Array(command.into_iter().map(Value::String).collect()),
            );
            if !entry.env.is_empty() {
                let mut env = Map::new();
                for (key, value) in &entry.env {
                    env.insert(key.clone(), Value::String(value.clone()));
                }
                obj.insert("environment".to_string(), Value::Object(env));
            }
        } else {
            continue;
        }

        obj.insert("enabled".to_string(), Value::Bool(entry.enabled));
        map.insert(id.to_string(), Value::Object(obj));
    }

    Value::Object(map)
}
