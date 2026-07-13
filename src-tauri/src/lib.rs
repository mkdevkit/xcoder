mod agent;
mod commands;
mod config;
mod utils;

use agent::opencode::OpencodeState;
use commands::terminal::TerminalState;
use commands::watch::WatchState;
use std::sync::Mutex;
use tauri::{Manager, PhysicalSize};

fn fit_and_center_main_window(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Ok(Some(monitor)) = window.current_monitor() {
        let work_area = monitor.work_area();
        let max_width = work_area.size.width;
        let max_height = work_area.size.height;

        if let Ok(outer) = window.outer_size() {
            if outer.width > max_width || outer.height > max_height {
                let _ = window.set_size(tauri::Size::Physical(PhysicalSize {
                    width: outer.width.min(max_width),
                    height: outer.height.min(max_height),
                }));
            }
        }
    }

    let _ = window.center();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(OpencodeState::default()))
        .manage(Mutex::new(WatchState::default()))
        .manage(Mutex::new(TerminalState::default()))
        .setup(|app| {
            fit_and_center_main_window(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::reveal_path_in_explorer,
            commands::fs::open_directory_in_explorer,
            commands::fs::rename_path,
            commands::fs::delete_path,
            commands::fs::create_path,
            commands::fs::copy_paths_into_directory,
            commands::fs::move_paths_into_directory,
            commands::search::search_in_workspace,
            commands::search::replace_in_workspace,
            commands::config::load_config,
            commands::config::save_config,
            commands::config::get_config_paths,
            commands::config::load_opencode_provider_config,
            commands::config::save_opencode_provider_config,
            commands::project_config::ensure_project_config_cmd,
            commands::project_config::load_project_config_cmd,
            commands::project_config::save_project_config_cmd,
            commands::project_rules::load_project_rules_cmd,
            commands::project_rules::save_project_rules_cmd,
            commands::skills::load_skill_catalog_cmd,
            commands::skills::list_project_skills_cmd,
            commands::skills::install_project_skill_cmd,
            commands::skills::remove_project_skill_cmd,
            commands::mcp::query_opencode_mcp_status,
            commands::mcp::load_project_mcp_config,
            commands::mcp::save_project_mcp_config,
            commands::mcp::apply_mcp_server_connection,
            commands::agent::opencode_doctor,
            commands::agent::opencode_start_runtime,
            commands::agent::opencode_restart_runtime,
            commands::agent::opencode_stop_runtime,
            commands::agent::opencode_runtime_status,
            commands::agent::opencode_list_agents,
            commands::agent::opencode_list_provider_models,
            commands::agent::opencode_create_thread,
            commands::agent::opencode_update_session_title,
            commands::agent::opencode_send_turn,
            commands::agent::opencode_cancel_turn,
            commands::agent::opencode_set_thread_mode,
            commands::agent::opencode_approve,
            commands::agent::opencode_subscribe_events,
            commands::agent::opencode_list_sessions,
            commands::agent::opencode_load_session_history,
            commands::agent::opencode_poll_turn,
            commands::agent::opencode_poll_status,
            commands::agent::opencode_is_session_busy,
            commands::agent::opencode_get_pending_approval,
            commands::agent::opencode_get_pending_question,
            commands::agent::opencode_reply_question,
            commands::agent::opencode_reject_question,
            commands::agent::opencode_delete_session,
            commands::history::save_local_chat_history,
            commands::history::list_local_chat_sessions,
            commands::history::load_local_chat_session,
            commands::history::get_local_active_session_id,
            commands::history::set_local_active_session_id,
            commands::history::delete_local_chat_session,
            commands::watch::start_workspace_watch,
            commands::watch::stop_workspace_watch,
            commands::terminal::terminal_spawn,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
