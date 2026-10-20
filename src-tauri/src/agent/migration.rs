use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigratableSession {
    pub id: String,
    pub title: String,
    pub directory: String,
    pub project_id: String,
    pub project_worktree: Option<String>,
    pub updated_at: Option<i64>,
    pub orphan: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated: usize,
    pub target_project_id: String,
    pub target_directory: String,
}

#[derive(Debug, Clone)]
pub struct GlobalProjectBackup {
    pub worktree: String,
    pub vcs: Option<String>,
    pub time_updated: i64,
}

fn data_dir() -> Option<PathBuf> {
    if let Some(value) = env::var_os("XDG_DATA_HOME") {
        let path = PathBuf::from(value);
        if !path.as_os_str().is_empty() {
            return Some(path.join("opencode"));
        }
    }
    dirs::home_dir().map(|home| home.join(".local").join("share").join("opencode"))
}

pub fn resolve_db_path() -> Result<PathBuf, String> {
    if let Ok(raw) = env::var("OPENCODE_DB") {
        let trimmed = raw.trim();
        if !trimmed.is_empty() && trimmed != ":memory:" {
            let path = PathBuf::from(trimmed);
            if path.is_absolute() {
                return Ok(path);
            }
            if let Some(base) = data_dir() {
                return Ok(base.join(path));
            }
        }
    }

    let mut candidates = Vec::new();
    if let Some(base) = data_dir() {
        candidates.push(base.join("opencode.db"));
    }
    if let Ok(local) = env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("opencode")
                .join("opencode.db"),
        );
    }
    if let Ok(app) = env::var("APPDATA") {
        candidates.push(PathBuf::from(app).join("opencode").join("opencode.db"));
    }

    if let Some(path) = candidates.iter().find(|path| path.is_file()) {
        return Ok(path.clone());
    }

    let searched = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!("未找到 OpenCode 数据库，已检查：{searched}"))
}

fn open_database() -> Result<Connection, String> {
    let path = resolve_db_path()?;
    let connection = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("打开 OpenCode 数据库失败：{error}"))?;
    connection
        .busy_timeout(Duration::from_secs(10))
        .map_err(|error| format!("设置数据库超时失败：{error}"))?;
    Ok(connection)
}

fn storage_path(path: &str) -> String {
    path.replace('\\', "/")
}

pub fn list_migratable_sessions(limit: u32) -> Result<Vec<MigratableSession>, String> {
    let connection = open_database()?;
    let limit = limit.clamp(1, 2000) as i64;
    let mut statement = connection
        .prepare(
            "SELECT s.id, s.title, s.directory, s.project_id, s.time_updated, p.worktree
             FROM session s
             LEFT JOIN project p ON p.id = s.project_id
             WHERE s.parent_id IS NULL AND s.time_archived IS NULL
             ORDER BY s.time_updated DESC
             LIMIT ?1",
        )
        .map_err(|error| format!("读取会话列表失败：{error}"))?;

    let rows = statement
        .query_map(params![limit], |row| {
            let directory: String = row.get(2)?;
            let orphan = directory.trim().is_empty() || !Path::new(&directory).exists();
            Ok(MigratableSession {
                id: row.get(0)?,
                title: row.get(1)?,
                directory,
                project_id: row.get(3)?,
                updated_at: row.get(4)?,
                project_worktree: row.get(5)?,
                orphan,
            })
        })
        .map_err(|error| format!("读取会话列表失败：{error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取会话列表失败：{error}"))
}

pub fn migrate_sessions(
    session_ids: &[String],
    target_project_id: &str,
    target_directory: &str,
) -> Result<usize, String> {
    if session_ids.is_empty() {
        return Ok(0);
    }

    let mut connection = open_database()?;
    let directory = storage_path(target_directory);
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| format!("无法开始数据库事务：{error}"))?;

    let project_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM project WHERE id = ?1)",
            params![target_project_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("检查目标项目失败：{error}"))?;
    if !project_exists {
        return Err("目标项目尚未在 OpenCode 中建立，请重新打开项目后重试".to_string());
    }

    let mut selected = HashSet::new();
    for session_id in session_ids {
        if !selected.insert(session_id.clone()) {
            continue;
        }

        let mut statement = transaction
            .prepare(
                "WITH RECURSIVE tree(id) AS (
                     SELECT id FROM session WHERE id = ?1
                     UNION ALL
                     SELECT s.id FROM session s JOIN tree t ON s.parent_id = t.id
                 )
                 UPDATE session
                 SET project_id = ?2, directory = ?3, path = NULL, workspace_id = NULL
                 WHERE id IN (SELECT id FROM tree)",
            )
            .map_err(|error| format!("准备迁移语句失败：{error}"))?;
        statement
            .execute(params![session_id, target_project_id, directory])
            .map_err(|error| format!("迁移会话 {session_id} 失败：{error}"))?;
    }

    transaction
        .commit()
        .map_err(|error| format!("提交迁移失败：{error}"))?;
    Ok(selected.len())
}

pub fn read_global_project() -> Result<Option<GlobalProjectBackup>, String> {
    let connection = open_database()?;
    connection
        .query_row(
            "SELECT worktree, vcs, time_updated FROM project WHERE id = 'global'",
            [],
            |row| {
                Ok(GlobalProjectBackup {
                    worktree: row.get(0)?,
                    vcs: row.get(1)?,
                    time_updated: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("读取 global 项目失败：{error}"))
}

pub fn restore_global_project(backup: &GlobalProjectBackup) -> Result<(), String> {
    let connection = open_database()?;
    connection
        .execute(
            "UPDATE project SET worktree = ?1, vcs = ?2, time_updated = ?3 WHERE id = 'global'",
            params![backup.worktree, backup.vcs, backup.time_updated],
        )
        .map_err(|error| format!("恢复 global 项目失败：{error}"))?;
    Ok(())
}
