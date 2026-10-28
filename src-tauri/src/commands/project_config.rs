use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::config::load_app_config;
use crate::config::provider_config::{
    OpencodePermissionsView, sync_project_opencode_permissions,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfig {
    pub provider: String,
    #[serde(default)]
    pub default_model: String,
    #[serde(default)]
    pub opencode_permissions: OpencodePermissionsView,
}

pub fn sync_project_opencode_from_config(workspace: &str) -> Result<(), String> {
    let Ok(config) = load_project_config(workspace) else {
        return Ok(());
    };
    sync_project_opencode_permissions(workspace, &config.opencode_permissions)
}

pub fn project_config_dir(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".xcoder")
}

pub fn project_config_path(workspace: &str) -> PathBuf {
    project_config_dir(workspace).join("config.json")
}

pub fn ensure_project_config(
    workspace: &str,
    default_provider: &str,
    default_model: &str,
) -> Result<ProjectConfig, String> {
    let dir = project_config_dir(workspace);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let path = project_config_path(workspace);
    if path.is_file() {
        return load_project_config(workspace);
    }

    let config = ProjectConfig {
        provider: default_provider.to_string(),
        default_model: default_model.to_string(),
        opencode_permissions: OpencodePermissionsView::default(),
    };
    save_project_config(workspace, &config)?;
    Ok(config)
}

pub fn load_project_config(workspace: &str) -> Result<ProjectConfig, String> {
    let path = project_config_path(workspace);
    if !path.is_file() {
        return Err("Project config not found".to_string());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

pub fn save_project_config(workspace: &str, config: &ProjectConfig) -> Result<(), String> {
    let dir = project_config_dir(workspace);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(
        project_config_path(workspace),
        format!("{content}\n"),
    )
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfigInfo {
    pub config: ProjectConfig,
    pub path: String,
}

#[tauri::command]
pub fn ensure_project_config_cmd(workspace: String) -> Result<ProjectConfigInfo, String> {
    let app = load_app_config()?;
    let config = ensure_project_config(
        &workspace,
        &app.app.default_provider,
        &app.app.default_model,
    )?;
    Ok(ProjectConfigInfo {
        path: project_config_path(&workspace).to_string_lossy().to_string(),
        config,
    })
}

#[tauri::command]
pub fn load_project_config_cmd(workspace: String) -> Result<ProjectConfigInfo, String> {
    let config = load_project_config(&workspace)?;
    Ok(ProjectConfigInfo {
        path: project_config_path(&workspace).to_string_lossy().to_string(),
        config,
    })
}

#[tauri::command]
pub fn save_project_config_cmd(
    workspace: String,
    config: ProjectConfig,
) -> Result<ProjectConfigInfo, String> {
    save_project_config(&workspace, &config)?;
    Ok(ProjectConfigInfo {
        path: project_config_path(&workspace).to_string_lossy().to_string(),
        config,
    })
}
