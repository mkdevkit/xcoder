mod agent;
mod commands;
mod config;
mod utils;

use agent::codewhale::CodewhaleState;
use agent::opencode::OpencodeState;
use commands::terminal::TerminalState;
use commands::watch::WatchState;
use std::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(CodewhaleState::default()))
        .manage(Mutex::new(OpencodeState::default()))
        .manage(Mutex::new(WatchState::default()))
        .manage(Mutex::new(TerminalState::default()))
        .invoke_handler(tauri::generate_handler![
            commands::fs::list_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::reveal_path_in_explorer,
            commands::fs::rename_path,
            commands::fs::delete_path,
            commands::fs::create_path,
            commands::fs::copy_paths_into_directory,
            commands::fs::move_paths_into_directory,
            commands::config::load_config,
            commands::config::save_config,
            commands::config::get_config_paths,
            commands::config::open_config_directory,
            commands::config::get_provider_config_path,
            commands::agent::codewhale_doctor,
            commands::agent::codewhale_list_models,
            commands::agent::codewhale_start_runtime,
            commands::agent::codewhale_restart_runtime,
            commands::agent::codewhale_stop_runtime,
            commands::agent::codewhale_runtime_status,
            commands::agent::codewhale_create_thread,
            commands::agent::codewhale_send_turn,
            commands::agent::codewhale_cancel_turn,
            commands::agent::codewhale_set_thread_mode,
            commands::agent::codewhale_approve,
            commands::agent::codewhale_subscribe_events,
            commands::agent::codewhale_list_threads,
            commands::agent::codewhale_load_thread_history,
            commands::agent::codewhale_poll_turn,
            commands::agent::codewhale_get_pending_approval,
            commands::agent::codewhale_delete_thread,
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
