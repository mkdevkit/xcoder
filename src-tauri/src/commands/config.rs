use crate::agent::opencode::{logout_provider_auth, sync_opencode_provider_auths};
use crate::config::provider_config::{
    load_opencode_config, save_opencode_config, OpencodeConfigView, OpencodeProviderEntry,
};
use crate::config::{config_dir, config_path, load_app_config, save_app_config, AppConfig};
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize)]
pub struct ConfigPaths {
    pub dir: String,
    pub file: String,
}

fn opencode_provider_ids(providers: &[OpencodeProviderEntry]) -> HashSet<String> {
    providers
        .iter()
        .map(|entry| entry.id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect()
}

fn cleanup_removed_provider_auth(
    previous: &HashSet<String>,
    next: &HashSet<String>,
    clear: fn(&str) -> Result<(), String>,
) {
    for removed in previous.difference(next) {
        if let Err(error) = clear(removed) {
            eprintln!("provider auth cleanup failed for {removed}: {error}");
        }
    }
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
pub fn load_opencode_provider_config() -> Result<OpencodeConfigView, String> {
    load_opencode_config()
}

#[tauri::command]
pub fn save_opencode_provider_config(config: OpencodeConfigView) -> Result<(), String> {
    let previous = load_opencode_config()
        .map(|view| opencode_provider_ids(&view.providers))
        .unwrap_or_default();
    let next = opencode_provider_ids(&config.providers);

    save_opencode_config(config.clone())?;

    cleanup_removed_provider_auth(&previous, &next, logout_provider_auth);
    sync_opencode_provider_auths(&config.providers)?;

    Ok(())
}
