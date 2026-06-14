use crate::config::{config_dir, config_path, load_app_config, save_app_config, AppConfig};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize)]
pub struct ConfigPaths {
    pub dir: String,
    pub file: String,
}

#[tauri::command]
pub fn load_config() -> Result<AppConfig, String> {
    load_app_config()
}

#[tauri::command]
pub fn save_config(config: AppConfig) -> Result<(), String> {
    save_app_config(&config)
}

#[tauri::command]
pub fn get_config_paths() -> Result<ConfigPaths, String> {
    let _ = load_app_config()?;
    Ok(ConfigPaths {
        dir: config_dir().to_string_lossy().to_string(),
        file: config_path().to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn open_config_directory(app: AppHandle) -> Result<(), String> {
    let _ = load_app_config()?;
    let dir = config_dir();
    app.opener()
        .reveal_item_in_dir(&dir)
        .map_err(|e| e.to_string())
}

fn expand_tilde(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn ensure_provider_config_file(path: &Path, provider_id: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let content = match provider_id {
        "opencode" => "{\n}\n",
        "codewhale" => "# CodeWhale configuration\n",
        _ => "",
    };
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_provider_config_path(provider_id: String) -> Result<String, String> {
    let config = load_app_config()?;
    let provider = config
        .providers
        .into_iter()
        .find(|item| item.id == provider_id)
        .ok_or_else(|| format!("Provider not found: {provider_id}"))?;

    let raw = provider
        .config_path
        .ok_or_else(|| format!("{provider_id} has no config_path"))?;
    let path = expand_tilde(&raw);
    ensure_provider_config_file(&path, &provider_id)?;

    Ok(path.to_string_lossy().to_string())
}
