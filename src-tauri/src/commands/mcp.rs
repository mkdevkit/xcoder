use crate::config::load_app_config;
use crate::config::mcp_config::{
    load_codewhale_mcp_config, load_project_codewhale_mcp_config, load_project_opencode_mcp_config,
    save_mcp_config_for_scope, save_project_codewhale_mcp_config,
    save_project_opencode_mcp_config, McpConfigView, McpServerEntry,
};
use crate::config::provider_config::{load_opencode_config, resolve_provider_config_path};
use crate::utils::command::{build_command, resolve_executable};
use serde::Serialize;
use std::path::Path;
use std::process::Output;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatusResult {
    pub output: String,
    pub servers: Vec<McpServerEntry>,
}

fn command_output(output: &Output) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let text = format!("{stdout}{stderr}").trim().to_string();
    if text.is_empty() {
        "No output".to_string()
    } else {
        text
    }
}

fn resolve_provider_command(provider_id: &str) -> Result<std::path::PathBuf, String> {
    let config = load_app_config()?;
    let provider = config
        .providers
        .into_iter()
        .find(|item| item.id == provider_id)
        .ok_or_else(|| format!("Provider not found: {provider_id}"))?;
    resolve_executable(&provider.command)
}

fn run_provider_command_in(
    provider_id: &str,
    args: &[&str],
    workspace: Option<&str>,
) -> Result<Output, String> {
    let program = resolve_provider_command(provider_id)?;
    let mut command = build_command(&program, args);
    if let Some(workspace) = workspace.filter(|value| !value.trim().is_empty()) {
        command.current_dir(workspace);
    }
    command.output().map_err(|e| e.to_string())
}

fn opencode_workdir(workspace: &str) -> Option<&str> {
    if workspace.is_empty() || !Path::new(workspace).is_dir() {
        None
    } else {
        Some(workspace)
    }
}

fn validate_opencode_mcp_server(entry: &McpServerEntry) -> Result<(), String> {
    if entry.id.trim().is_empty() {
        return Err("MCP server name is required".to_string());
    }
    if entry.transport == "remote" {
        if entry.url.trim().is_empty() {
            return Err("Remote MCP server requires a URL".to_string());
        }
    } else if entry.command.trim().is_empty() {
        return Err("Local MCP server requires a command".to_string());
    }
    Ok(())
}

fn load_mcp_servers_for_scope(
    provider: &str,
    scope: &str,
    workspace: &str,
) -> Result<Vec<McpServerEntry>, String> {
    match (provider, scope) {
        ("opencode", "global") => Ok(load_opencode_config()?.mcp_servers),
        ("opencode", "project") => {
            if workspace.is_empty() {
                return Err("Workspace is required".to_string());
            }
            Ok(load_project_opencode_mcp_config(workspace)?.servers)
        }
        ("codewhale", "global") => Ok(load_codewhale_mcp_config()?.servers),
        ("codewhale", "project") => {
            if workspace.is_empty() {
                return Err("Workspace is required".to_string());
            }
            Ok(load_project_codewhale_mcp_config(workspace)?.servers)
        }
        _ => Err(format!("Unsupported MCP scope: {provider}/{scope}")),
    }
}

fn opencode_config_summary(scope: &str, workspace: &str) -> Result<String, String> {
    let mut lines = Vec::new();
    let count_valid = |servers: &[McpServerEntry]| {
        servers
            .iter()
            .filter(|entry| {
                entry.transport == "remote" && !entry.url.trim().is_empty()
                    || entry.transport != "remote" && !entry.command.trim().is_empty()
            })
            .count()
    };

    let global = load_opencode_config()?;
    lines.push(format!(
        "global: {} ({} valid MCP entries)",
        global.path,
        count_valid(&global.mcp_servers)
    ));

    if scope == "project" {
        if workspace.is_empty() {
            lines.push("project: workspace not set".to_string());
        } else {
            let project = load_project_opencode_mcp_config(workspace)?;
            lines.push(format!(
                "project: {} ({} valid MCP entries)",
                project.path,
                count_valid(&project.servers)
            ));
        }
    } else if let Some(workdir) = opencode_workdir(workspace) {
        let project = load_project_opencode_mcp_config(workdir)?;
        if project.installed {
            lines.push(format!(
                "project override: {} ({} valid MCP entries)",
                project.path,
                count_valid(&project.servers)
            ));
        }
    }

    Ok(lines.join("\n"))
}

#[tauri::command]
pub async fn query_codewhale_mcp_status(
    workspace: String,
    scope: String,
) -> Result<McpStatusResult, String> {
    let workspace = workspace.trim();
    let scope = scope.trim();
    let cwd = if scope == "project" {
        opencode_workdir(workspace)
    } else {
        None
    };
    let mut sections = Vec::new();

    let list = run_provider_command_in("codewhale", &["mcp", "list"], cwd)?;
    sections.push(format!("=== codewhale mcp list ===\n{}", command_output(&list)));

    if list.status.success() {
        if let Ok(tools) = run_provider_command_in("codewhale", &["mcp", "tools"], cwd) {
            sections.push(format!(
                "=== codewhale mcp tools ===\n{}",
                command_output(&tools)
            ));
        }
    }

    let servers = load_mcp_servers_for_scope("codewhale", scope, workspace).unwrap_or_default();

    Ok(McpStatusResult {
        output: sections.join("\n\n"),
        servers,
    })
}

#[tauri::command]
pub async fn query_opencode_mcp_status(
    workspace: String,
    scope: String,
) -> Result<McpStatusResult, String> {
    let workspace = workspace.trim();
    let scope = scope.trim();
    let workdir = opencode_workdir(workspace);
    let global_path = resolve_provider_config_path("opencode")?
        .to_string_lossy()
        .to_string();

    let mut sections = vec![format!(
        "=== opencode config paths ===\nglobal: {global_path}\nworkdir: {}",
        workdir.unwrap_or("(not set)")
    )];

    if let Ok(summary) = opencode_config_summary(scope, workspace) {
        sections.push(format!("=== saved MCP entries ===\n{summary}"));
    }

    let list = run_provider_command_in("opencode", &["mcp", "list"], workdir)?;
    sections.push(format!(
        "=== opencode mcp list ===\n{}",
        command_output(&list)
    ));

    let servers = load_mcp_servers_for_scope("opencode", scope, workspace).unwrap_or_default();

    Ok(McpStatusResult {
        output: sections.join("\n\n"),
        servers,
    })
}

#[tauri::command]
pub fn load_project_mcp_config(workspace: String, provider: String) -> Result<McpConfigView, String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required".to_string());
    }
    match provider.as_str() {
        "codewhale" => load_project_codewhale_mcp_config(workspace),
        "opencode" => load_project_opencode_mcp_config(workspace),
        other => Err(format!("Unsupported provider for project MCP: {other}")),
    }
}

#[tauri::command]
pub fn save_project_mcp_config(
    workspace: String,
    provider: String,
    servers: Vec<McpServerEntry>,
) -> Result<McpConfigView, String> {
    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err("Workspace is required".to_string());
    }
    match provider.as_str() {
        "codewhale" => {
            save_project_codewhale_mcp_config(workspace, &servers)?;
            load_project_codewhale_mcp_config(workspace)
        }
        "opencode" => {
            save_project_opencode_mcp_config(workspace, &servers)?;
            load_project_opencode_mcp_config(workspace)
        }
        other => Err(format!("Unsupported provider for project MCP: {other}")),
    }
}

#[tauri::command]
pub async fn apply_mcp_server_connection(
    provider: String,
    scope: String,
    workspace: String,
    servers: Vec<McpServerEntry>,
    server_id: String,
    connected: bool,
) -> Result<McpStatusResult, String> {
    let server_id = server_id.trim();
    if server_id.is_empty() {
        return Err("MCP server name is required".to_string());
    }

    let workspace = workspace.trim();
    let workdir = opencode_workdir(workspace);
    let cwd = if provider == "codewhale" {
        if scope == "project" {
            workdir
        } else {
            None
        }
    } else {
        workdir
    };

    if provider == "opencode" {
        let target = servers
            .iter()
            .find(|entry| entry.id.trim() == server_id)
            .ok_or_else(|| format!("MCP server not found: {server_id}"))?;
        if connected {
            validate_opencode_mcp_server(target)?;
        }
    }

    save_mcp_config_for_scope(&provider, &scope, workspace, &servers)?;

    if provider == "codewhale" {
        let action = if connected { "enable" } else { "disable" };
        let action_output = run_provider_command_in("codewhale", &["mcp", action, server_id], cwd)?;
        if !action_output.status.success() {
            return Err(command_output(&action_output));
        }

        let mut sections = vec![format!(
            "=== codewhale mcp {action} {server_id} ===\n{}",
            command_output(&action_output)
        )];

        if connected {
            let connect_output =
                run_provider_command_in("codewhale", &["mcp", "connect", server_id], cwd)?;
            sections.push(format!(
                "=== codewhale mcp connect {server_id} ===\n{}",
                command_output(&connect_output)
            ));
            if !connect_output.status.success() {
                return Err(sections.join("\n\n"));
            }
        }

        let servers =
            load_mcp_servers_for_scope("codewhale", &scope, workspace).unwrap_or_default();

        return Ok(McpStatusResult {
            output: sections.join("\n\n"),
            servers,
        });
    }

    if provider != "opencode" {
        return Err(format!("Unsupported provider for MCP connection: {provider}"));
    }

    let mut sections = Vec::new();
    if let Ok(summary) = opencode_config_summary(&scope, workspace) {
        sections.push(format!("=== saved MCP entries ===\n{summary}"));
    }

    let list = run_provider_command_in("opencode", &["mcp", "list"], cwd)?;
    if !list.status.success() {
        return Err(command_output(&list));
    }

    sections.push(format!(
        "=== opencode mcp list ===\n{}",
        command_output(&list)
    ));

    let servers = load_mcp_servers_for_scope("opencode", &scope, workspace).unwrap_or_default();

    Ok(McpStatusResult {
        output: sections.join("\n\n"),
        servers,
    })
}
