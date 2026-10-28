use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize, Clone)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".specstory",
    ".cursor",
];

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FsEntry>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut entries: Vec<FsEntry> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') && SKIP_DIRS.contains(&name.as_str()) {
                return None;
            }
            let path = entry.path();
            let metadata = entry.metadata().ok()?;
            Some(FsEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_dir: metadata.is_dir(),
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn reveal_path_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("File not found: {path}"));
    }

    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_directory_in_explorer(app: AppHandle, path: String) -> Result<(), String> {
    let path_ref = Path::new(&path);
    if !path_ref.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<String, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if trimmed.contains(['/', '\\']) {
        return Err("名称不能包含路径分隔符".to_string());
    }

    let old = Path::new(&path);
    if !old.exists() {
        return Err(format!("Path not found: {path}"));
    }

    let parent = old
        .parent()
        .ok_or_else(|| "Invalid path".to_string())?;
    let new_path = parent.join(trimmed);
    if new_path == old {
        return Ok(path);
    }
    if new_path.exists() {
        return Err("已存在同名文件或文件夹".to_string());
    }

    fs::rename(old, &new_path).map_err(|e| e.to_string())?;
    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_path(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err(format!("Path not found: {path}"));
    }

    if target.is_dir() {
        fs::remove_dir_all(target).map_err(|e| e.to_string())
    } else {
        fs::remove_file(target).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn create_path(parent: String, name: String, is_dir: bool) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("名称不能为空".to_string());
    }
    if trimmed.contains(['/', '\\']) {
        return Err("名称不能包含路径分隔符".to_string());
    }

    let parent_path = Path::new(&parent);
    if !parent_path.is_dir() {
        return Err(format!("Not a directory: {parent}"));
    }

    let new_path = parent_path.join(trimmed);
    if new_path.exists() {
        return Err("已存在同名文件或文件夹".to_string());
    }

    if is_dir {
        fs::create_dir(&new_path).map_err(|e| e.to_string())?;
    } else {
        fs::write(&new_path, "").map_err(|e| e.to_string())?;
    }

    Ok(new_path.to_string_lossy().to_string())
}

fn copy_entry_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    if src.is_file() {
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(src, dest).map_err(|e| e.to_string())?;
        return Ok(());
    }

    if src.is_dir() {
        fs::create_dir_all(dest).map_err(|e| e.to_string())?;
        for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let child_dest = dest.join(entry.file_name());
            copy_entry_recursive(&entry.path(), &child_dest)?;
        }
        return Ok(());
    }

    Err(format!("Source not found: {}", src.display()))
}

fn validate_transfer_into_directory(
    src: &Path,
    dest_dir: &Path,
    dest: &Path,
    action: &str,
) -> Result<(), String> {
    if src == dest_dir {
        return Err(format!("不能{action}到相同目录"));
    }

    if dest.exists() {
        let file_name = src
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| src.display().to_string());
        return Err(format!("已存在同名项: {file_name}"));
    }

    if src.is_dir() {
        let canonical_src = src.canonicalize().map_err(|e| e.to_string())?;
        let canonical_dest = dest_dir.canonicalize().map_err(|e| e.to_string())?;
        if canonical_dest.starts_with(&canonical_src) {
            return Err(format!("不能将文件夹{action}到其子目录"));
        }
    }

    Ok(())
}

fn transfer_paths_into_directory(
    sources: Vec<String>,
    destination_dir: String,
    move_files: bool,
) -> Result<Vec<String>, String> {
    let dest_dir = Path::new(&destination_dir);
    if !dest_dir.is_dir() {
        return Err(format!("Not a directory: {destination_dir}"));
    }

    let action = if move_files { "移动" } else { "复制" };
    let mut results = Vec::new();

    for source in sources {
        let src = Path::new(&source);
        if !src.exists() {
            return Err(format!("Source not found: {source}"));
        }

        let file_name = src
            .file_name()
            .ok_or_else(|| format!("Invalid source path: {source}"))?;
        let dest = dest_dir.join(file_name);

        if src == dest {
            results.push(dest.to_string_lossy().to_string());
            continue;
        }

        if src.parent().is_some_and(|parent| parent == dest_dir) {
            results.push(src.to_string_lossy().to_string());
            continue;
        }

        validate_transfer_into_directory(src, dest_dir, &dest, action)?;

        if move_files {
            fs::rename(src, &dest).map_err(|e| e.to_string())?;
        } else {
            copy_entry_recursive(src, &dest)?;
        }

        results.push(dest.to_string_lossy().to_string());
    }

    Ok(results)
}

#[tauri::command]
pub fn copy_paths_into_directory(
    sources: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, String> {
    transfer_paths_into_directory(sources, destination_dir, false)
}

#[tauri::command]
pub fn move_paths_into_directory(
    sources: Vec<String>,
    destination_dir: String,
) -> Result<Vec<String>, String> {
    transfer_paths_into_directory(sources, destination_dir, true)
}
