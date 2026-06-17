use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiOptions {
    pub modes: Vec<String>,
    #[serde(default)]
    pub default_mode: String,
    #[serde(default)]
    pub approval_modes: Vec<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub default_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub config_path: Option<String>,
    #[serde(default)]
    pub health_cmd: Vec<String>,
    #[serde(default)]
    pub ui_options: Option<UiOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSection {
    #[serde(default = "default_provider")]
    pub default_provider: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_text_model")]
    pub default_model: String,
}

fn default_provider() -> String {
    "codewhale".to_string()
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_text_model() -> String {
    "deepseek-v4-pro".to_string()
}

impl Default for AppSection {
    fn default() -> Self {
        Self {
            default_provider: default_provider(),
            theme: default_theme(),
            default_model: default_text_model(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub app: AppSection,
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            app: AppSection {
                default_provider: "codewhale".to_string(),
                theme: "dark".to_string(),
                default_model: default_text_model(),
            },
            providers: vec![
                ProviderConfig {
                    id: "codewhale".to_string(),
                    provider_type: "http".to_string(),
                    command: "codewhale".to_string(),
                    args: vec![
                        "serve".to_string(),
                        "--http".to_string(),
                        "--port".to_string(),
                        "7878".to_string(),
                        "--insecure".to_string(),
                    ],
                    config_path: Some("~/.codewhale/config.toml".to_string()),
                    health_cmd: vec![
                        "codewhale".to_string(),
                        "doctor".to_string(),
                        "--json".to_string(),
                    ],
                    ui_options: None,
                },
                ProviderConfig {
                    id: "opencode".to_string(),
                    provider_type: "http".to_string(),
                    command: "opencode".to_string(),
                    args: vec![
                        "serve".to_string(),
                        "--hostname".to_string(),
                        "127.0.0.1".to_string(),
                        "--port".to_string(),
                        "4096".to_string(),
                    ],
                    config_path: Some("~/.config/opencode/opencode.json".to_string()),
                    health_cmd: vec!["opencode".to_string(), "--version".to_string()],
                    ui_options: None,
                },
            ],
        }
    }
}

pub mod mcp_config;
pub mod project_codewhale_config;
pub mod project_opencode_config;
pub mod project_rules;
pub mod provider_config;
pub mod runtime_args;

pub fn config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("xcoder")
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.toml")
}

const DEFAULT_CONFIG_TOML: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/config.toml"));

fn ensure_default_config_file(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, DEFAULT_CONFIG_TOML).map_err(|e| e.to_string())
}

pub fn load_app_config() -> Result<AppConfig, String> {
    let path = config_path();
    ensure_default_config_file(&path)?;

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut config: AppConfig = toml::from_str(&content).map_err(|e| e.to_string())?;

    if config.app.default_model.is_empty() {
        if let Some(model) = provider_config::read_codewhale_default_text_model() {
            config.app.default_model = model;
        }
    }

    Ok(config)
}

pub fn save_app_config(config: &AppConfig) -> Result<(), String> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = toml::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(config_path(), content).map_err(|e| e.to_string())
}
