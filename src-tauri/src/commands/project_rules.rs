use crate::config::project_rules::{load_project_rules, save_project_rules, ProjectRulesView};

#[tauri::command]
pub fn load_project_rules_cmd(
    workspace: String,
    provider: String,
) -> Result<ProjectRulesView, String> {
    load_project_rules(workspace.trim(), provider.trim())
}

#[tauri::command]
pub fn save_project_rules_cmd(
    workspace: String,
    provider: String,
    agents_content: String,
    instructions: Vec<String>,
) -> Result<ProjectRulesView, String> {
    save_project_rules(
        workspace.trim(),
        provider.trim(),
        &agents_content,
        &instructions,
    )
}
