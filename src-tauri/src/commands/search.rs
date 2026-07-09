use globset::{Glob, GlobSetBuilder};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    ".specstory",
    ".cursor",
];

const BINARY_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg",
    "woff", "woff2", "ttf", "eot", "otf",
    "zip", "gz", "tar", "rar", "7z", "jar",
    "exe", "dll", "so", "dylib", "bin",
    "pdf", "mp3", "mp4", "avi", "mov", "mkv",
    "wasm", "pdb", "o", "a", "class",
    "lock",
];

const MAX_RESULTS: usize = 10_000;
const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchOptions {
    pub root: String,
    pub query: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    #[serde(default)]
    pub include_pattern: Option<String>,
    #[serde(default)]
    pub exclude_pattern: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReplaceOptions {
    pub root: String,
    pub query: String,
    pub replace_with: String,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub use_regex: bool,
    #[serde(default)]
    pub include_pattern: Option<String>,
    #[serde(default)]
    pub exclude_pattern: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
    pub path: String,
    pub line: u32,
    pub column: u32,
    pub preview: String,
    pub match_start: u32,
    pub match_end: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    pub matches: Vec<WorkspaceSearchMatch>,
    pub file_count: usize,
    pub match_count: usize,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
}

fn build_glob_set(pattern: &str) -> Result<globset::GlobSet, String> {
    let mut builder = GlobSetBuilder::new();
    let mut added = false;
    for part in pattern.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        builder
            .add(Glob::new(trimmed).map_err(|e| e.to_string())?);
        added = true;
    }
    if !added {
        return Err("empty glob pattern".to_string());
    }
    builder.build().map_err(|e| e.to_string())
}

fn optional_glob_set(pattern: &Option<String>) -> Result<Option<globset::GlobSet>, String> {
    match pattern {
        Some(value) if !value.trim().is_empty() => Ok(Some(build_glob_set(value)?)),
        _ => Ok(None),
    }
}

fn build_search_regex(
    query: &str,
    case_sensitive: bool,
    whole_word: bool,
    use_regex: bool,
) -> Result<Regex, String> {
    if query.is_empty() {
        return Err("empty query".to_string());
    }

    let pattern = if use_regex {
        if whole_word {
            format!(r"\b(?:{})\b", query)
        } else {
            query.to_string()
        }
    } else {
        let escaped = regex::escape(query);
        if whole_word {
            format!(r"\b{escaped}\b")
        } else {
            escaped
        }
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!case_sensitive)
        .build()
        .map_err(|e| e.to_string())
}

fn normalize_relative_path(path: &Path, root: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

fn should_skip_dir(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

fn is_probably_binary(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext_lower = ext.to_ascii_lowercase();
            BINARY_EXTENSIONS.iter().any(|item| *item == ext_lower)
        })
        .unwrap_or(false)
}

fn should_search_file(
    relative: &str,
    include: &Option<globset::GlobSet>,
    exclude: &Option<globset::GlobSet>,
) -> bool {
    if let Some(exclude_set) = exclude {
        if exclude_set.is_match(relative) {
            return false;
        }
    }
    match include {
        Some(include_set) => include_set.is_match(relative),
        None => true,
    }
}

fn collect_matches_in_file(
    path: &Path,
    re: &Regex,
    max_remaining: &mut usize,
    truncated: &mut bool,
) -> Result<Vec<WorkspaceSearchMatch>, String> {
    if is_probably_binary(path) {
        return Ok(Vec::new());
    }

    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > MAX_FILE_SIZE {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.contains('\0') {
        return Ok(Vec::new());
    }

    let path_str = path.to_string_lossy().to_string();
    let mut matches = Vec::new();

    for (index, line) in content.lines().enumerate() {
        for mat in re.find_iter(line) {
            if *max_remaining == 0 {
                *truncated = true;
                return Ok(matches);
            }

            let column = line[..mat.start()].chars().count() as u32 + 1;
            let match_start = column;
            let match_end = column + mat.as_str().chars().count() as u32;

            matches.push(WorkspaceSearchMatch {
                path: path_str.clone(),
                line: (index as u32) + 1,
                column,
                preview: line.to_string(),
                match_start,
                match_end,
            });
            *max_remaining -= 1;
        }
    }

    Ok(matches)
}

fn walk_workspace_files(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if !entry.file_type().is_dir() {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !should_skip_dir(name.as_ref())
        })
    {
        let Ok(entry) = entry else { continue };
        if entry.file_type().is_file() {
            files.push(entry.into_path());
        }
    }
    files
}

fn search_workspace_internal(options: &WorkspaceSearchOptions) -> Result<WorkspaceSearchResult, String> {
    let root = PathBuf::from(&options.root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", options.root));
    }

    let re = build_search_regex(
        &options.query,
        options.case_sensitive,
        options.whole_word,
        options.use_regex,
    )?;
    let include = optional_glob_set(&options.include_pattern)?;
    let exclude = optional_glob_set(&options.exclude_pattern)?;

    let mut all_matches = Vec::new();
    let mut truncated = false;
    let mut max_remaining = MAX_RESULTS;
    let mut matched_files = std::collections::BTreeSet::new();

    for file in walk_workspace_files(&root) {
        let Some(relative) = normalize_relative_path(&file, &root) else {
            continue;
        };
        if !should_search_file(&relative, &include, &exclude) {
            continue;
        }

        let file_matches = collect_matches_in_file(&file, &re, &mut max_remaining, &mut truncated)?;
        if !file_matches.is_empty() {
            matched_files.insert(file.to_string_lossy().to_string());
            all_matches.extend(file_matches);
        }
        if truncated {
            break;
        }
    }

    Ok(WorkspaceSearchResult {
        match_count: all_matches.len(),
        file_count: matched_files.len(),
        matches: all_matches,
        truncated,
    })
}

#[tauri::command]
pub fn search_in_workspace(options: WorkspaceSearchOptions) -> Result<WorkspaceSearchResult, String> {
    search_workspace_internal(&options)
}

#[tauri::command]
pub fn replace_in_workspace(options: WorkspaceReplaceOptions) -> Result<WorkspaceReplaceResult, String> {
    let root = PathBuf::from(&options.root);
    if !root.is_dir() {
        return Err(format!("Not a directory: {}", options.root));
    }

    let re = build_search_regex(
        &options.query,
        options.case_sensitive,
        options.whole_word,
        options.use_regex,
    )?;
    let include = optional_glob_set(&options.include_pattern)?;
    let exclude = optional_glob_set(&options.exclude_pattern)?;

    let mut files_changed = 0usize;
    let mut replacements = 0usize;

    for file in walk_workspace_files(&root) {
        let Some(relative) = normalize_relative_path(&file, &root) else {
            continue;
        };
        if !should_search_file(&relative, &include, &exclude) {
            continue;
        }
        if is_probably_binary(&file) {
            continue;
        }

        let metadata = fs::metadata(&file).map_err(|e| e.to_string())?;
        if metadata.len() > MAX_FILE_SIZE {
            continue;
        }

        let content = match fs::read_to_string(&file) {
            Ok(value) if !value.contains('\0') => value,
            _ => continue,
        };

        let mut file_replacements = 0usize;
        let new_content = content
            .lines()
            .map(|line| {
                let replaced = re.replace_all(line, options.replace_with.as_str());
                if replaced != line {
                    file_replacements += re.find_iter(line).count();
                }
                replaced.into_owned()
            })
            .collect::<Vec<_>>()
            .join("\n");

        let restored = if content.ends_with('\n') && !new_content.ends_with('\n') {
            format!("{new_content}\n")
        } else {
            new_content
        };

        if file_replacements > 0 && restored != content {
            fs::write(&file, restored).map_err(|e| e.to_string())?;
            files_changed += 1;
            replacements += file_replacements;
        }
    }

    Ok(WorkspaceReplaceResult {
        files_changed,
        replacements,
    })
}
