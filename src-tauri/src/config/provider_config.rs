use crate::config::load_app_config;
use crate::config::mcp_config::{build_opencode_mcp_json, parse_opencode_mcp_servers, McpServerEntry};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    if let Some(rest) = path.strip_prefix("~\\") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

pub fn resolve_provider_config_path(provider_id: &str) -> Result<PathBuf, String> {
    let config = load_app_config()?;
    let provider = config
        .providers
        .into_iter()
        .find(|item| item.id == provider_id)
        .ok_or_else(|| format!("Provider not found: {provider_id}"))?;

    let raw = provider
        .config_path
        .ok_or_else(|| format!("{provider_id} has no config_path"))?;
    Ok(expand_tilde(&raw))
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodewhaleProviderEntry {
    pub id: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodewhaleConfigView {
    pub path: String,
    #[serde(default)]
    pub installed: bool,
    pub api_key: String,
    pub provider: String,
    pub auth_mode: String,
    pub providers: Vec<CodewhaleProviderEntry>,
    pub default_mode: String,
    pub approval_mode: String,
    pub reasoning_effort: String,
    pub mcp_path: String,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CodewhaleProviderSection {
    #[serde(default)]
    api_key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CodewhaleUiSection {
    #[serde(default)]
    default_mode: String,
    #[serde(default)]
    approval_mode: String,
    #[serde(default)]
    reasoning_effort: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct CodewhaleConfigFile {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    auth_mode: String,
    #[serde(default)]
    default_text_model: String,
    #[serde(default)]
    providers: HashMap<String, CodewhaleProviderSection>,
    #[serde(default)]
    ui: CodewhaleUiSection,
}

pub fn read_codewhale_default_text_model() -> Option<String> {
    let path = resolve_provider_config_path("codewhale").ok()?;
    if !path.exists() {
        return None;
    }
    let content = fs::read_to_string(&path).ok()?;
    let parsed: CodewhaleConfigFile = toml::from_str(&content).ok()?;
    if parsed.default_text_model.is_empty() {
        None
    } else {
        Some(parsed.default_text_model)
    }
}

pub fn load_codewhale_config() -> Result<CodewhaleConfigView, String> {
    let mcp = crate::config::mcp_config::load_codewhale_mcp_config()?;
    let path = resolve_provider_config_path("codewhale")?;
    if !path.exists() {
        return Ok(CodewhaleConfigView {
            path: path.to_string_lossy().to_string(),
            installed: false,
            api_key: String::new(),
            provider: String::new(),
            auth_mode: "api_key".to_string(),
            providers: Vec::new(),
            default_mode: "agent".to_string(),
            approval_mode: "suggest".to_string(),
            reasoning_effort: "high".to_string(),
            mcp_path: mcp.path,
            mcp_servers: mcp.servers,
        });
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed: CodewhaleConfigFile = toml::from_str(&content).unwrap_or_default();

    let mut providers: Vec<CodewhaleProviderEntry> = parsed
        .providers
        .into_iter()
        .map(|(id, section)| CodewhaleProviderEntry {
            id,
            api_key: section.api_key,
        })
        .collect();
    providers.sort_by(|a, b| a.id.cmp(&b.id));

    if providers.is_empty() && !parsed.provider.is_empty() {
        providers.push(CodewhaleProviderEntry {
            id: parsed.provider.clone(),
            api_key: parsed.api_key.clone(),
        });
    }

    Ok(CodewhaleConfigView {
        path: path.to_string_lossy().to_string(),
        installed: true,
        api_key: parsed.api_key,
        provider: parsed.provider,
        auth_mode: if parsed.auth_mode.is_empty() {
            "api_key".to_string()
        } else {
            parsed.auth_mode
        },
        providers,
        default_mode: if parsed.ui.default_mode.is_empty() {
            "agent".to_string()
        } else {
            parsed.ui.default_mode
        },
        approval_mode: if parsed.ui.approval_mode.is_empty() {
            "suggest".to_string()
        } else {
            parsed.ui.approval_mode
        },
        reasoning_effort: if parsed.ui.reasoning_effort.is_empty() {
            "high".to_string()
        } else {
            parsed.ui.reasoning_effort
        },
        mcp_path: mcp.path,
        mcp_servers: mcp.servers,
    })
}

pub fn save_codewhale_config(view: CodewhaleConfigView) -> Result<(), String> {
    let path = resolve_provider_config_path("codewhale")?;
    if !path.exists() {
        return Err("CodeWhale 配置文件不存在，请先安装并初始化 CodeWhale".to_string());
    }
    ensure_parent(&path)?;

    let existing_content = fs::read_to_string(&path).unwrap_or_default();
    let existing: CodewhaleConfigFile =
        toml::from_str(&existing_content).unwrap_or_default();

    let mut providers_map = HashMap::new();
    for entry in &view.providers {
        let id = entry.id.trim();
        if id.is_empty() {
            continue;
        }
        providers_map.insert(
            id.to_string(),
            CodewhaleProviderSection {
                api_key: entry.api_key.clone(),
            },
        );
    }

    let mut primary_provider = if !view.provider.trim().is_empty() {
        view.provider.trim().to_string()
    } else {
        view.providers
            .first()
            .map(|item| item.id.trim().to_string())
            .unwrap_or_default()
    };
    if !primary_provider.is_empty() && !providers_map.contains_key(&primary_provider) {
        primary_provider = providers_map
            .keys()
            .next()
            .cloned()
            .unwrap_or_default();
    }

    let primary_api_key = view
        .providers
        .iter()
        .find(|item| item.id == primary_provider)
        .map(|item| item.api_key.clone())
        .filter(|key| !key.is_empty())
        .unwrap_or_else(|| view.api_key.clone());

    let file = CodewhaleConfigFile {
        api_key: primary_api_key,
        provider: primary_provider,
        auth_mode: if view.auth_mode.trim().is_empty() {
            "api_key".to_string()
        } else {
            view.auth_mode
        },
        default_text_model: existing.default_text_model,
        providers: providers_map,
        ui: CodewhaleUiSection {
            default_mode: view.default_mode,
            approval_mode: view.approval_mode,
            reasoning_effort: view.reasoning_effort,
        },
    };

    let content = toml::to_string_pretty(&file).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    crate::config::mcp_config::save_codewhale_mcp_config(&view.mcp_servers)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeModelEntry {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_context: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_output: Option<u64>,
    #[serde(default)]
    pub modalities_input: Vec<String>,
    #[serde(default)]
    pub modalities_output: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeProviderEntry {
    pub id: String,
    pub npm: String,
    pub base_url: String,
    pub api_key: String,
    pub set_cache_key: bool,
    #[serde(default)]
    pub models: Vec<OpencodeModelEntry>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodePermissionsView {
    pub edit: String,
    pub bash: String,
    pub read: String,
    pub webfetch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpencodeConfigView {
    pub path: String,
    #[serde(default)]
    pub installed: bool,
    pub default_agent: String,
    pub permissions: OpencodePermissionsView,
    pub providers: Vec<OpencodeProviderEntry>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServerEntry>,
}

fn permission_value_to_action(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(map) = value.as_object() {
        if let Some(star) = map.get("*").and_then(|v| v.as_str()) {
            return star.to_string();
        }
    }
    String::new()
}

fn parse_permission_action(permission: Option<&Value>, key: &str) -> String {
    let Some(permission) = permission else {
        return String::new();
    };
    if let Some(text) = permission.as_str() {
        return text.to_string();
    }
    let Some(map) = permission.as_object() else {
        return String::new();
    };
    if let Some(value) = map.get(key) {
        return permission_value_to_action(value);
    }
    if let Some(value) = map.get("*") {
        return permission_value_to_action(value);
    }
    String::new()
}

pub fn project_codewhale_config_path(workspace: &str) -> PathBuf {
    crate::config::project_codewhale_config::project_codewhale_config_path(workspace)
}

pub fn sync_project_codewhale_approval(workspace: &str, approval_mode: &str) -> Result<(), String> {
    use crate::config::project_codewhale_config::update_project_codewhale_config;

    let mode = approval_mode.trim();
    if mode.is_empty() {
        return update_project_codewhale_config(workspace, |table| {
            if let Some(ui) = table.get_mut("ui").and_then(|value| value.as_table_mut()) {
                ui.remove("approval_mode");
                if ui.is_empty() {
                    table.remove("ui");
                }
            }
            Ok(())
        });
    }

    update_project_codewhale_config(workspace, |table| {
        let ui = table
            .entry("ui".to_string())
            .or_insert_with(|| toml::Value::Table(toml::map::Map::new()));
        if let Some(ui_table) = ui.as_table_mut() {
            ui_table.insert(
                "approval_mode".to_string(),
                toml::Value::String(mode.to_string()),
            );
        }
        Ok(())
    })
}

pub fn project_opencode_config_path(workspace: &str) -> PathBuf {
    crate::config::project_opencode_config::project_opencode_config_path(workspace)
}

pub fn sync_project_opencode_permissions(
    workspace: &str,
    permissions: &OpencodePermissionsView,
) -> Result<(), String> {
    use crate::config::project_opencode_config::update_project_opencode_config;

    let has_any = !permissions.edit.trim().is_empty()
        || !permissions.bash.trim().is_empty()
        || !permissions.read.trim().is_empty()
        || !permissions.webfetch.trim().is_empty();

    if !has_any {
        return update_project_opencode_config(workspace, |obj| {
            obj.remove("permission");
            Ok(())
        });
    }

    update_project_opencode_config(workspace, |obj| {
        let existing_permission = obj.get("permission").cloned();
        apply_opencode_permissions(obj, permissions, existing_permission.as_ref());
        Ok(())
    })
}

pub fn apply_opencode_permissions(
    obj: &mut Map<String, Value>,
    view: &OpencodePermissionsView,
    existing: Option<&Value>,
) {
    let mut permission = existing
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();

    for (key, value) in [
        ("edit", view.edit.trim()),
        ("bash", view.bash.trim()),
        ("read", view.read.trim()),
        ("webfetch", view.webfetch.trim()),
    ] {
        if value.is_empty() {
            permission.remove(key);
        } else {
            permission.insert(key.to_string(), Value::String(value.to_string()));
        }
    }

    if permission.is_empty() {
        obj.remove("permission");
    } else {
        obj.insert("permission".to_string(), Value::Object(permission));
    }
}

fn opencode_model_name(model_id: &str, model_value: Option<&Value>) -> String {
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

fn parse_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

fn parse_model_limit(model_value: &Value) -> (Option<u64>, Option<u64>) {
    let Some(limit) = model_value.get("limit").and_then(|v| v.as_object()) else {
        return (None, None);
    };
    let context = limit.get("context").and_then(|v| v.as_u64());
    let output = limit.get("output").and_then(|v| v.as_u64());
    (context, output)
}

fn parse_model_modalities(model_value: &Value) -> (Vec<String>, Vec<String>) {
    let Some(modalities) = model_value.get("modalities").and_then(|v| v.as_object()) else {
        return (Vec::new(), Vec::new());
    };
    let input = parse_string_array(modalities.get("input"));
    let output = parse_string_array(modalities.get("output"));
    (input, output)
}

fn build_model_value_json(model: &OpencodeModelEntry) -> Value {
    let mut obj = Map::new();
    let name = model.name.trim();
    if !name.is_empty() {
        obj.insert("name".to_string(), Value::String(name.to_string()));
    }

    if model.limit_context.is_some() || model.limit_output.is_some() {
        let mut limit = Map::new();
        if let Some(context) = model.limit_context {
            limit.insert("context".to_string(), Value::Number(context.into()));
        }
        if let Some(output) = model.limit_output {
            limit.insert("output".to_string(), Value::Number(output.into()));
        }
        obj.insert("limit".to_string(), Value::Object(limit));
    }

    if !model.modalities_input.is_empty() || !model.modalities_output.is_empty() {
        let mut modalities = Map::new();
        if !model.modalities_input.is_empty() {
            modalities.insert(
                "input".to_string(),
                Value::Array(
                    model
                        .modalities_input
                        .iter()
                        .map(|item| Value::String(item.clone()))
                        .collect(),
                ),
            );
        }
        if !model.modalities_output.is_empty() {
            modalities.insert(
                "output".to_string(),
                Value::Array(
                    model
                        .modalities_output
                        .iter()
                        .map(|item| Value::String(item.clone()))
                        .collect(),
                ),
            );
        }
        obj.insert("modalities".to_string(), Value::Object(modalities));
    }

    Value::Object(obj)
}

fn parse_opencode_models(value: &Value) -> Vec<OpencodeModelEntry> {
    let Some(models) = value.get("models") else {
        return Vec::new();
    };

    let mut entries = Vec::new();
    match models {
        Value::Object(map) => {
            for (id, model_value) in map {
                if id.is_empty() {
                    continue;
                }
                let (limit_context, limit_output) = parse_model_limit(model_value);
                let (modalities_input, modalities_output) =
                    parse_model_modalities(model_value);
                entries.push(OpencodeModelEntry {
                    id: id.clone(),
                    name: opencode_model_name(id, Some(model_value)),
                    limit_context,
                    limit_output,
                    modalities_input,
                    modalities_output,
                });
            }
        }
        Value::Array(items) => {
            for item in items {
                let id = item
                    .get("id")
                    .or_else(|| item.get("modelID"))
                    .or_else(|| item.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                let (limit_context, limit_output) = parse_model_limit(item);
                let (modalities_input, modalities_output) = parse_model_modalities(item);
                entries.push(OpencodeModelEntry {
                    id: id.clone(),
                    name: opencode_model_name(&id, Some(item)),
                    limit_context,
                    limit_output,
                    modalities_input,
                    modalities_output,
                });
            }
        }
        _ => {}
    }

    entries.sort_by(|a, b| a.id.cmp(&b.id));
    entries
}

fn build_opencode_models_json(models: &[OpencodeModelEntry]) -> Value {
    let mut map = Map::new();
    for model in models {
        let id = model.id.trim();
        if id.is_empty() {
            continue;
        }
        let name = model.name.trim();
        let model_json = if name.is_empty()
            && model.limit_context.is_none()
            && model.limit_output.is_none()
            && model.modalities_input.is_empty()
            && model.modalities_output.is_empty()
        {
            json!({})
        } else {
            build_model_value_json(model)
        };
        map.insert(id.to_string(), model_json);
    }
    Value::Object(map)
}

fn parse_opencode_provider(id: &str, value: &Value) -> OpencodeProviderEntry {
    let options = value.get("options").and_then(|v| v.as_object());
    let base_url = options
        .and_then(|opts| {
            opts.get("baseURL")
                .or_else(|| opts.get("baseUrl"))
                .and_then(|v| v.as_str())
        })
        .unwrap_or("")
        .to_string();
    let api_key = options
        .and_then(|opts| opts.get("apiKey").and_then(|v| v.as_str()))
        .unwrap_or("")
        .to_string();
    let set_cache_key = options
        .and_then(|opts| opts.get("setCacheKey").and_then(|v| v.as_bool()))
        .unwrap_or(true);

    OpencodeProviderEntry {
        id: id.to_string(),
        npm: value
            .get("npm")
            .and_then(|v| v.as_str())
            .unwrap_or("@ai-sdk/openai-compatible")
            .to_string(),
        base_url,
        api_key,
        set_cache_key,
        models: parse_opencode_models(value),
    }
}

pub fn load_opencode_config() -> Result<OpencodeConfigView, String> {
    let path = resolve_provider_config_path("opencode")?;
    if !path.exists() {
        return Ok(OpencodeConfigView {
            path: path.to_string_lossy().to_string(),
            installed: false,
            default_agent: String::new(),
            permissions: OpencodePermissionsView {
                edit: String::new(),
                bash: String::new(),
                read: String::new(),
                webfetch: String::new(),
            },
            providers: Vec::new(),
            mcp_servers: Vec::new(),
        });
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&content).unwrap_or_else(|_| json!({}));

    let mut providers = Vec::new();
    if let Some(provider_map) = json.get("provider").and_then(|v| v.as_object()) {
        for (id, value) in provider_map {
            providers.push(parse_opencode_provider(id, value));
        }
    }
    providers.sort_by(|a, b| a.id.cmp(&b.id));

    let default_agent = json
        .get("default_agent")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let permission = json.get("permission");
    let permissions = OpencodePermissionsView {
        edit: parse_permission_action(permission, "edit"),
        bash: parse_permission_action(permission, "bash"),
        read: parse_permission_action(permission, "read"),
        webfetch: parse_permission_action(permission, "webfetch"),
    };

    Ok(OpencodeConfigView {
        path: path.to_string_lossy().to_string(),
        installed: true,
        default_agent,
        permissions,
        providers,
        mcp_servers: parse_opencode_mcp_servers(&json),
    })
}

fn build_opencode_provider_json(entry: &OpencodeProviderEntry, _existing: Option<&Value>) -> Value {
    let models = build_opencode_models_json(&entry.models);

    let mut options = Map::new();
    if !entry.base_url.trim().is_empty() {
        options.insert(
            "baseURL".to_string(),
            Value::String(entry.base_url.trim().to_string()),
        );
    }
    if !entry.api_key.is_empty() {
        options.insert("apiKey".to_string(), Value::String(entry.api_key.clone()));
    }
    if entry.set_cache_key {
        options.insert("setCacheKey".to_string(), Value::Bool(true));
    }

    let npm = if entry.npm.trim().is_empty() {
        "@ai-sdk/openai-compatible".to_string()
    } else {
        entry.npm.trim().to_string()
    };

    json!({
        "npm": npm,
        "options": Value::Object(options),
        "models": models,
    })
}

pub fn save_opencode_config(view: OpencodeConfigView) -> Result<(), String> {
    let path = resolve_provider_config_path("opencode")?;
    if !path.exists() {
        return Err("OpenCode 配置文件不存在，请先安装并初始化 OpenCode".to_string());
    }
    ensure_parent(&path)?;

    let existing_content = fs::read_to_string(&path).unwrap_or_else(|_| "{}".to_string());
    let mut json: Value =
        serde_json::from_str(&existing_content).unwrap_or_else(|_| json!({}));
    let existing_permission = json.get("permission").cloned();

    if json.get("$schema").is_none() {
        if let Some(obj) = json.as_object_mut() {
            obj.insert(
                "$schema".to_string(),
                Value::String("https://opencode.ai/config.json".to_string()),
            );
        }
    }

    if let Some(obj) = json.as_object_mut() {
        let existing_providers = obj
            .get("provider")
            .and_then(|value| value.as_object())
            .cloned()
            .unwrap_or_default();

        let mut provider_map = Map::new();
        for entry in &view.providers {
            let id = entry.id.trim();
            if id.is_empty() {
                continue;
            }
            let existing = existing_providers.get(id);
            provider_map.insert(
                id.to_string(),
                build_opencode_provider_json(entry, existing),
            );
        }
        let configured_ids: Vec<String> = provider_map.keys().cloned().collect();
        obj.insert("provider".to_string(), Value::Object(provider_map));

        let default_agent = view.default_agent.trim();
        if default_agent.is_empty() {
            obj.remove("default_agent");
        } else {
            obj.insert(
                "default_agent".to_string(),
                Value::String(default_agent.to_string()),
            );
        }

        apply_opencode_permissions(
            obj,
            &view.permissions,
            existing_permission.as_ref(),
        );

        let mcp = build_opencode_mcp_json(&view.mcp_servers);
        if mcp.as_object().is_some_and(|map| map.is_empty()) {
            obj.remove("mcp");
        } else {
            obj.insert("mcp".to_string(), mcp);
        }

        if let Some(model) = obj.get("model").and_then(|value| value.as_str()) {
            if let Some((provider, _)) = model.split_once('/') {
                if !configured_ids.iter().any(|id| id == provider) {
                    obj.remove("model");
                }
            }
        }
    }

    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
}
