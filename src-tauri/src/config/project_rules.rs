use crate::config::provider_config::project_opencode_config_path;
use crate::config::project_opencode_config::update_project_opencode_config;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRulesView {
    pub provider: String,
    pub agents_path: String,
    pub agents_installed: bool,
    pub agents_content: String,
    pub instructions_path: String,
    pub instructions: Vec<String>,
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn project_agents_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join("AGENTS.md")
}

fn read_agents_file(path: &Path) -> Result<(bool, String), String> {
    if !path.is_file() {
        return Ok((false, String::new()));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    Ok((true, content))
}

fn parse_opencode_instructions(json: &Value) -> Vec<String> {
    json.get("instructions")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|text| text.to_string()))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub fn load_project_rules(workspace: &str, provider: &str) -> Result<ProjectRulesView, String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required".to_string());
    }
    if provider != "opencode" {
        return Err(format!("Unsupported provider for project rules: {provider}"));
    }

    let agents_path = project_agents_path(workspace);
    let (agents_installed, agents_content) = read_agents_file(&agents_path)?;

    let instructions_path = project_opencode_config_path(workspace);
    let instructions = if instructions_path.is_file() {
        let content = fs::read_to_string(&instructions_path).map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&content).unwrap_or_else(|_| json!({}));
        parse_opencode_instructions(&json)
    } else {
        Vec::new()
    };

    Ok(ProjectRulesView {
        provider: provider.to_string(),
        agents_path: agents_path.to_string_lossy().to_string(),
        agents_installed,
        agents_content,
        instructions_path: instructions_path.to_string_lossy().to_string(),
        instructions,
    })
}

fn normalize_instructions(instructions: &[String]) -> Vec<String> {
    instructions
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string())
        .collect()
}

fn save_agents_file(path: &Path, content: &str) -> Result<(), String> {
    if content.is_empty() {
        if path.is_file() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    ensure_parent(path)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn save_opencode_instructions(workspace: &str, instructions: &[String]) -> Result<(), String> {
    update_project_opencode_config(workspace, |obj| {
        if instructions.is_empty() {
            obj.remove("instructions");
        } else {
            obj.insert(
                "instructions".to_string(),
                Value::Array(
                    instructions
                        .iter()
                        .map(|item| Value::String(item.clone()))
                        .collect(),
                ),
            );
        }
        Ok(())
    })
}

pub fn save_project_rules(
    workspace: &str,
    provider: &str,
    agents_content: &str,
    instructions: &[String],
) -> Result<ProjectRulesView, String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required".to_string());
    }
    if provider != "opencode" {
        return Err(format!("Unsupported provider for project rules: {provider}"));
    }

    let instructions = normalize_instructions(instructions);
    save_agents_file(&project_agents_path(workspace), agents_content)?;
    save_opencode_instructions(workspace, &instructions)?;

    load_project_rules(workspace, provider)
}
