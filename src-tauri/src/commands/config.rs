use crate::config::provider_config::{
    load_codewhale_config, load_opencode_config, save_codewhale_config, save_opencode_config,
    CodewhaleConfigView, OpencodeConfigView,
};
use crate::config::{config_dir, config_path, load_app_config, save_app_config, AppConfig};
use serde::Serialize;
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
pub fn load_codewhale_provider_config() -> Result<CodewhaleConfigView, String> {
    load_codewhale_config()
}

#[tauri::command]
pub fn save_codewhale_provider_config(config: CodewhaleConfigView) -> Result<(), String> {
    save_codewhale_config(config)
}

#[tauri::command]
pub fn load_opencode_provider_config() -> Result<OpencodeConfigView, String> {
    load_opencode_config()
}

#[tauri::command]
pub fn save_opencode_provider_config(config: OpencodeConfigView) -> Result<(), String> {
    save_opencode_config(config)
}