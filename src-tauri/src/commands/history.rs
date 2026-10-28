use crate::agent::history::HistoryMessage;
use crate::agent::local_history::{
    delete_session, get_active_session_id, list_sessions, load_session, save_session,
    set_active_session, LocalChatSession, LocalSessionMeta,
};

#[tauri::command]
pub fn save_local_chat_history(
    workspace: String,
    provider: String,
    session_id: String,
    title: String,
    mode: Option<String>,
    model: Option<String>,
    messages: Vec<HistoryMessage>,
    updated_at: Option<String>,
    set_active: Option<bool>,
) -> Result<LocalSessionMeta, String> {
    let session = LocalChatSession {
        id: session_id,
        title,
        mode,
        model,
        messages,
        updated_at: updated_at.unwrap_or_else(crate::agent::local_history::now_iso),
    };
    save_session(
        &workspace,
        &provider,
        session,
        set_active.unwrap_or(true),
    )
}

#[tauri::command]
pub fn list_local_chat_sessions(
    workspace: String,
    provider: String,
) -> Result<Vec<LocalSessionMeta>, String> {
    list_sessions(&workspace, &provider)
}

#[tauri::command]
pub fn load_local_chat_session(
    workspace: String,
    provider: String,
    session_id: String,
) -> Result<Option<LocalChatSession>, String> {
    load_session(&workspace, &provider, &session_id)
}

#[tauri::command]
pub fn get_local_active_session_id(
    workspace: String,
    provider: String,
) -> Result<Option<String>, String> {
    get_active_session_id(&workspace, &provider)
}

#[tauri::command]
pub fn set_local_active_session_id(
    workspace: String,
    provider: String,
    session_id: Option<String>,
) -> Result<(), String> {
    set_active_session(&workspace, &provider, session_id.as_deref())
}

#[tauri::command]
pub fn delete_local_chat_session(
    workspace: String,
    provider: String,
    session_id: String,
) -> Result<(), String> {
    delete_session(&workspace, &provider, &session_id)
}
