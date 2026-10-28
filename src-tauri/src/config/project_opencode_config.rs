use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub fn project_opencode_config_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join("opencode.json")
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_existing_json(path: &Path) -> (String, Value) {
    let existing_content = if path.is_file() {
        fs::read_to_string(path).unwrap_or_else(|_| "{}".to_string())
    } else {
        String::new()
    };
    let json = if existing_content.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(&existing_content).unwrap_or_else(|_| json!({}))
    };
    (existing_content, json)
}

fn ensure_schema(obj: &mut Map<String, Value>) {
    if obj.get("$schema").is_none() {
        obj.insert(
            "$schema".to_string(),
            Value::String("https://opencode.ai/config.json".to_string()),
        );
    }
}

/// Merge-update project `opencode.json` without dropping unrelated keys (`mcp`, `instructions`, `permission`, …).
pub fn update_project_opencode_config(
    workspace: &str,
    mutator: impl FnOnce(&mut Map<String, Value>) -> Result<(), String>,
) -> Result<(), String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required".to_string());
    }

    let path = project_opencode_config_path(workspace);
    let (existing_content, mut json) = read_existing_json(&path);
    let Some(obj) = json.as_object_mut() else {
        return Err("Invalid opencode.json root".to_string());
    };

    ensure_schema(obj);
    mutator(obj)?;

    if obj.len() <= 1 && obj.contains_key("$schema") {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    if obj.is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    if existing_content.trim().is_empty() && obj.len() == 1 && obj.contains_key("$schema") {
        return Ok(());
    }

    ensure_parent(&path)?;
    let content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    fs::write(path, format!("{content}\n")).map_err(|e| e.to_string())
}
