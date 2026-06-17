use crate::config::provider_config::{expand_tilde, resolve_provider_config_path};
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

pub fn resolve_codewhale_mcp_path() -> PathBuf {
    expand_tilde("~/.codewhale/mcp.json")
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

fn parse_codewhale_server(id: &str, value: &Value) -> McpServerEntry {
    let url = value
        .get("url")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let command = value
        .get("command")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_string();
    let args = value
        .get("args")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|text| text.to_string()))
                .collect()
        })
        .unwrap_or_default();
    let transport = if !url.trim().is_empty() {
        "remote".to_string()
    } else {
        "stdio".to_string()
    };
    let enabled = if let Some(disabled) = value.get("disabled").and_then(|item| item.as_bool()) {
        !disabled
    } else {
        value
            .get("enabled")
            .and_then(|item| item.as_bool())
            .unwrap_or(true)
    };

    McpServerEntry {
        id: id.to_string(),
        transport,
        command,
        args,
        url,
        enabled,
        env: string_map_from_json(value.get("env")),
        headers: string_map_from_json(value.get("headers")),
    }
}

pub fn resolve_project_codewhale_mcp_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".codewhale").join("mcp.json")
}

pub fn resolve_project_opencode_config_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join("opencode.json")
}

fn load_codewhale_mcp_from_path(path: PathBuf) -> Result<McpConfigView, String> {
    if !path.exists() {
        return Ok(McpConfigView {
            path: path.to_string_lossy().to_string(),
            installed: false,
            servers: Vec::new(),
        });
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&content).unwrap_or_else(|_| json!({}));
    let mut servers = Vec::new();

    if let Some(map) = json
        .get("servers")
        .or_else(|| json.get("mcpServers"))
        .and_then(|value| value.as_object())
    {
        for (id, value) in map {
            servers.push(parse_codewhale_server(id, value));
        }
    }

    servers.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(McpConfigView {
        path: path.to_string_lossy().to_string(),
        installed: true,
        servers,
    })
}

pub fn load_codewhale_mcp_config() -> Result<McpConfigView, String> {
    load_codewhale_mcp_from_path(resolve_codewhale_mcp_path())
}

pub fn load_project_codewhale_mcp_config(workspace: &str) -> Result<McpConfigView, String> {
    load_codewhale_mcp_from_path(resolve_project_codewhale_mcp_path(workspace))
}

fn build_codewhale_server_json(entry: &McpServerEntry) -> Value {
    let mut obj = Map::new();
    if entry.transport == "remote" {
        if !entry.url.trim().is_empty() {
            obj.insert("url".to_string(), Value::String(entry.url.trim().to_string()));
        }
        if !entry.headers.is_empty() {
            let mut headers = Map::new();
            for (key, value) in &entry.headers {
                headers.insert(key.clone(), Value::String(value.clone()));
            }
            obj.insert("headers".to_string(), Value::Object(headers));
        }
    } else if !entry.command.trim().is_empty() {
        obj.insert(
            "command".to_string(),
            Value::String(entry.command.trim().to_string()),
        );
        if !entry.args.is_empty() {
            obj.insert(
                "args".to_string(),
                Value::Array(
                    entry
                        .args
                        .iter()
                        .map(|item| Value::String(item.clone()))
                        .collect(),
                ),
            );
        }
        if !entry.env.is_empty() {
            let mut env = Map::new();
            for (key, value) in &entry.env {
                env.insert(key.clone(), Value::String(value.clone()));
            }
            obj.insert("env".to_string(), Value::Object(env));
        }
    }

    if entry.enabled {
        obj.insert("enabled".to_string(), Value::Bool(true));
        obj.remove("disabled");
    } else {
        obj.insert("disabled".to_string(), Value::Bool(true));
        obj.remove("enabled");
    }

    Value::Object(obj)
}

fn save_codewhale_mcp_to_path(path: &std::path::Path, servers: &[McpServerEntry]) -> Result<(), String> {
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

    let mut server_map = Map::new();
    for entry in servers {
        let id = entry.id.trim();
        if id.is_empty() {
            continue;
        }
        server_map.insert(id.to_string(), build_codewhale_server_json(entry));
    }

    if let Some(obj) = json.as_object_mut() {
        obj.insert("servers".to_string(), Value::Object(server_map));
        obj.remove("mcpServers");
    }

    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
}

pub fn save_codewhale_mcp_config(servers: &[McpServerEntry]) -> Result<(), String> {
    save_codewhale_mcp_to_path(&resolve_codewhale_mcp_path(), servers)
}

pub fn save_project_codewhale_mcp_config(
    workspace: &str,
    servers: &[McpServerEntry],
) -> Result<(), String> {
    save_codewhale_mcp_to_path(&resolve_project_codewhale_mcp_path(workspace), servers)
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
        ("codewhale", "global") => save_codewhale_mcp_config(servers),
        ("codewhale", "project") => {
            if workspace.trim().is_empty() {
                return Err("Workspace is required".to_string());
            }
            save_project_codewhale_mcp_config(workspace, servers)
        }
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
