use crate::utils::command::{build_command, resolve_executable};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::process::Output;

const SKILL_CATALOG: &str = include_str!("../../../public/skill-catalog.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalogEntry {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalogSource {
    pub id: String,
    pub label: String,
    pub skills: Vec<SkillCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCatalog {
    pub directory_url: String,
    pub sources: Vec<SkillCatalogSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
    pub location: String,
}

fn project_skill_roots(provider_id: &str) -> Vec<&'static str> {
    match provider_id {
        "opencode" => vec![".opencode/skills", ".agents/skills", ".claude/skills"],
        _ => vec![".agents/skills"],
    }
}

fn parse_frontmatter(content: &str) -> (String, String) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (String::new(), String::new());
    }

    let rest = trimmed.strip_prefix("---").unwrap_or("").trim_start();
    let Some(end) = rest.find("\n---") else {
        return (String::new(), String::new());
    };

    let block = &rest[..end];
    let mut name = String::new();
    let mut description = String::new();

    for line in block.lines() {
        let line = line.trim();
        if let Some(value) = line.strip_prefix("name:") {
            name = value.trim().trim_matches('"').to_string();
        } else if let Some(value) = line.strip_prefix("description:") {
            description = value.trim().trim_matches('"').to_string();
        }
    }

    (name, description)
}

fn read_skill_info(skill_dir: &Path, location: &str) -> Option<ProjectSkillInfo> {
    let skill_md = skill_dir.join("SKILL.md");
    if !skill_md.is_file() {
        return None;
    }

    let content = fs::read_to_string(&skill_md).ok()?;
    let (mut name, description) = parse_frontmatter(&content);
    if name.is_empty() {
        name = skill_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_string();
    }

    Some(ProjectSkillInfo {
        name,
        description,
        path: skill_dir.to_string_lossy().to_string(),
        location: location.to_string(),
    })
}

pub fn list_project_skills(workspace: &str, provider_id: &str) -> Result<Vec<ProjectSkillInfo>, String> {
    let workspace = Path::new(workspace);
    if !workspace.is_dir() {
        return Err("Workspace not found".to_string());
    }

    let mut skills = Vec::new();
    let mut seen = std::collections::BTreeSet::new();

    for root in project_skill_roots(provider_id) {
        let dir = workspace.join(root);
        if !dir.is_dir() {
            continue;
        }

        let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
        for entry in entries.filter_map(|item| item.ok()) {
            if !entry.file_type().map(|meta| meta.is_dir()).unwrap_or(false) {
                continue;
            }
            let Some(info) = read_skill_info(&entry.path(), root) else {
                continue;
            };
            if seen.insert(info.name.clone()) {
                skills.push(info);
            }
        }
    }

    skills.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(skills)
}

fn run_command_in_workspace(workspace: &str, program: &Path, args: &[&str]) -> Result<Output, String> {
    let output = build_command(program, args)
        .current_dir(workspace)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(output)
}

fn command_output(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    format!("{stdout}{stderr}").trim().to_string()
}

pub fn install_project_skill(
    workspace: &str,
    provider_id: &str,
    source: &str,
    skill_name: &str,
) -> Result<(), String> {
    let source = source.trim();
    let skill_name = skill_name.trim();
    if source.is_empty() || skill_name.is_empty() {
        return Err("Skill source and name are required".to_string());
    }

    let npx = resolve_executable("npx")?;
    let agent = if provider_id == "opencode" {
        "opencode"
    } else {
        "opencode"
    };

    let output = run_command_in_workspace(
        workspace,
        &npx,
        &[
            "skills",
            "add",
            source,
            "--skill",
            skill_name,
            "-a",
            agent,
            "--copy",
            "-y",
        ],
    )?;

    if !output.status.success() {
        return Err(format!(
            "Failed to install skill: {}",
            command_output(&output)
        ));
    }

    Ok(())
}

pub fn remove_project_skill(
    workspace: &str,
    provider_id: &str,
    skill_name: &str,
) -> Result<(), String> {
    let skill_name = skill_name.trim();
    if skill_name.is_empty() {
        return Err("Skill name is required".to_string());
    }

    if let Ok(npx) = resolve_executable("npx") {
        let output = run_command_in_workspace(
            workspace,
            &npx,
            &["skills", "remove", skill_name, "-y"],
        )?;
        if output.status.success() {
            return Ok(());
        }
    }

    let workspace = Path::new(workspace);
    for root in project_skill_roots(provider_id) {
        let skill_dir = workspace.join(root).join(skill_name);
        if skill_dir.is_dir() {
            fs::remove_dir_all(&skill_dir).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    Err(format!("Skill not found: {skill_name}"))
}

#[tauri::command]
pub fn load_skill_catalog_cmd() -> Result<SkillCatalog, String> {
    serde_json::from_str(SKILL_CATALOG).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_project_skills_cmd(
    workspace: String,
    provider_id: String,
) -> Result<Vec<ProjectSkillInfo>, String> {
    list_project_skills(&workspace, &provider_id)
}

#[tauri::command]
pub fn install_project_skill_cmd(
    workspace: String,
    provider_id: String,
    source: String,
    skill_name: String,
) -> Result<Vec<ProjectSkillInfo>, String> {
    install_project_skill(&workspace, &provider_id, &source, &skill_name)?;
    list_project_skills(&workspace, &provider_id)
}

#[tauri::command]
pub fn remove_project_skill_cmd(
    workspace: String,
    provider_id: String,
    skill_name: String,
) -> Result<Vec<ProjectSkillInfo>, String> {
    remove_project_skill(&workspace, &provider_id, &skill_name)?;
    list_project_skills(&workspace, &provider_id)
}
