use std::fs;
use std::path::{Path, PathBuf};

pub fn project_codewhale_config_path(workspace: &str) -> PathBuf {
    Path::new(workspace).join(".codewhale").join("config.toml")
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_existing_toml(path: &Path) -> toml::Value {
    if !path.is_file() {
        return toml::Value::Table(toml::map::Map::new());
    }
    let content = fs::read_to_string(path).unwrap_or_default();
    if content.trim().is_empty() {
        toml::Value::Table(toml::map::Map::new())
    } else {
        toml::from_str(&content).unwrap_or(toml::Value::Table(toml::map::Map::new()))
    }
}

/// Merge-update project `.codewhale/config.toml` without dropping unrelated keys (`instructions`, `[ui]`, …).
pub fn update_project_codewhale_config(
    workspace: &str,
    mutator: impl FnOnce(&mut toml::map::Map<String, toml::Value>) -> Result<(), String>,
) -> Result<(), String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required".to_string());
    }

    let path = project_codewhale_config_path(workspace);
    let mut parsed = read_existing_toml(&path);
    let Some(table) = parsed.as_table_mut() else {
        return Err("Invalid .codewhale/config.toml root".to_string());
    };

    mutator(table)?;

    if table.is_empty() {
        if path.is_file() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        return Ok(());
    }

    ensure_parent(&path)?;
    let content = toml::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}
