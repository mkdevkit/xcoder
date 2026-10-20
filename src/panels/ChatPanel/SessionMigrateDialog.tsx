import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "../../i18n";
import { getAgentCommands } from "../../utils/agentProvider";
import { localizeSessionTitle } from "../../utils/localChatHistory";
import { workspacesMatch } from "../../utils/path";
import { tauriInvoke } from "../../utils/tauri";
import type {
  MigratableSession,
  SessionMigrationResult,
} from "../../types/agent";

interface SessionMigrateDialogProps {
  open: boolean;
  workspace: string;
  onClose: () => void;
  onMigrated: () => void | Promise<void>;
}

function formatUpdatedAt(value?: number | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function SessionMigrateDialog({
  open,
  workspace,
  onClose,
  onMigrated,
}: SessionMigrateDialogProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<MigratableSession[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    const command = getAgentCommands("opencode").listMigratableSessions;
    if (!command) {
      setError(t("chat.migrateLoadFailed", { message: "Command unavailable" }));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const items = await tauriInvoke<MigratableSession[]>(command, {
        limit: 500,
      });
      setSessions(items);
    } catch (loadError) {
      setError(
        t("chat.migrateLoadFailed", { message: String(loadError) }),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setQuery("");
    setError(null);
    setSuccessCount(null);
    void loadSessions();
  }, [open, loadSessions]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 40);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, busy, onClose]);

  const inCurrentDirectory = useCallback(
    (session: MigratableSession) =>
      workspacesMatch(session.directory, workspace),
    [workspace],
  );

  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? sessions.filter((session) =>
          [session.title, session.directory, session.projectWorktree ?? ""]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(needle)),
        )
      : sessions;

    return [...filtered].sort((left, right) => {
      const currentDelta =
        Number(inCurrentDirectory(left)) - Number(inCurrentDirectory(right));
      if (currentDelta !== 0) return currentDelta;
      return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
    });
  }, [inCurrentDirectory, query, sessions]);

  const toggleSession = (session: MigratableSession) => {
    if (busy || inCurrentDirectory(session)) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(session.id)) {
        next.delete(session.id);
      } else {
        next.add(session.id);
      }
      return next;
    });
  };

  const handleMigrate = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0 || busy) return;

    const command = getAgentCommands("opencode").migrateSessions;
    if (!command) {
      setError(t("chat.migrateFailed", { message: "Command unavailable" }));
      return;
    }

    setBusy(true);
    setError(null);
    setSuccessCount(null);
    try {
      const result = await tauriInvoke<SessionMigrationResult>(command, {
        sessionIds: ids,
        workspace,
      });
      setSelected(new Set());
      setSuccessCount(result.migrated);
      try {
        await onMigrated();
      } catch (refreshError) {
        console.error("Failed to refresh sessions after migration:", refreshError);
      }
      await loadSessions();
    } catch (migrationError) {
      setError(
        t("chat.migrateFailed", { message: String(migrationError) }),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const selectedCount = selected.size;

  return (
    <div
      className="session-migrate-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div
        className="session-migrate-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("chat.migrateTitle")}
      >
        <div className="session-migrate-header">
          <div>
            <div className="session-migrate-title">{t("chat.migrateTitle")}</div>
            <div className="session-migrate-subtitle">
              {t("chat.migrateHint")}
            </div>
          </div>
          <button
            type="button"
            className="session-migrate-close"
            title={t("chat.migrateClose")}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="session-migrate-destination">
          <div className="session-migrate-label">
            {t("chat.migrateDestination")}
          </div>
          <div className="session-migrate-destination-path">{workspace}</div>
          <div className="session-migrate-child-hint">
            {t("chat.migrateChildHint")}
          </div>
        </div>

        <input
          ref={searchRef}
          className="session-migrate-search"
          type="search"
          value={query}
          placeholder={t("chat.migrateSearch")}
          disabled={busy}
          onChange={(event) => setQuery(event.target.value)}
        />

        {successCount !== null && (
          <div className="session-migrate-success">
            {t("chat.migrateSuccess", { count: String(successCount) })}
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}

        <div className="session-migrate-list">
          {loading ? (
            <div className="session-migrate-empty">
              {t("chat.migrateLoading")}
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="session-migrate-empty">
              {t("chat.migrateEmpty")}
            </div>
          ) : (
            visibleSessions.map((session) => {
              const current = inCurrentDirectory(session);
              const checked = selected.has(session.id);
              return (
                <button
                  type="button"
                  key={session.id}
                  className={`session-migrate-item${checked ? " selected" : ""}`}
                  disabled={current || busy}
                  onClick={() => toggleSession(session)}
                >
                  <span
                    className={`session-migrate-check${checked ? " checked" : ""}`}
                  >
                    {checked ? "✓" : ""}
                  </span>
                  <span className="session-migrate-info">
                    <span className="session-migrate-session-title">
                      {localizeSessionTitle(session.title) || session.id}
                    </span>
                    <span className="session-migrate-path">
                      {session.directory || session.id}
                    </span>
                    {session.projectWorktree &&
                      session.projectWorktree !== "/" &&
                      !workspacesMatch(
                        session.projectWorktree,
                        session.directory,
                      ) && (
                        <span className="session-migrate-project">
                          {session.projectWorktree}
                        </span>
                      )}
                    {(session.orphan || current) && (
                      <span className="session-migrate-badges">
                        {session.orphan && (
                          <span className="session-migrate-badge orphan">
                            {t("chat.migrateOrphan")}
                          </span>
                        )}
                        {current && (
                          <span className="session-migrate-badge current">
                            {t("chat.migrateCurrent")}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="session-migrate-time">
                    {formatUpdatedAt(session.updatedAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="session-migrate-footer">
          <span className="session-migrate-count">
            {t("chat.migrateSelected", { count: String(selectedCount) })}
          </span>
          <span className="session-migrate-footer-hint">
            {t("chat.migrateChildHint")}
          </span>
          <div className="session-migrate-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              {successCount !== null
                ? t("chat.migrateClose")
                : t("chat.migrateCancel")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || selectedCount === 0}
              onClick={() => handleMigrate().catch(console.error)}
            >
              {busy ? t("chat.migrateMigrating") : t("chat.migrateConfirm")}
            </button>
          </div>
        </div>
      </div>

      <style>{`
        .session-migrate-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: rgba(0, 0, 0, 0.52);
        }
        .session-migrate-modal {
          width: min(780px, 100%);
          max-height: min(84vh, 820px);
          display: flex;
          flex-direction: column;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }
        .session-migrate-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 18px 12px;
          border-bottom: 1px solid var(--border);
        }
        .session-migrate-title {
          font-size: 15px;
          font-weight: 600;
        }
        .session-migrate-subtitle {
          margin-top: 4px;
          max-width: 620px;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .session-migrate-close {
          width: 28px;
          height: 28px;
          padding: 0;
          flex-shrink: 0;
          font-size: 18px;
          line-height: 1;
        }
        .session-migrate-destination {
          margin: 12px 18px 0;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--bg-elevated);
        }
        .session-migrate-label {
          color: var(--text-muted);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .session-migrate-destination-path {
          margin-top: 4px;
          font-family: var(--font-mono);
          font-size: 12px;
          word-break: break-all;
        }
        .session-migrate-child-hint {
          margin-top: 4px;
          color: var(--text-muted);
          font-size: 11px;
        }
        .session-migrate-search {
          margin: 12px 18px 0;
          padding: 6px 10px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-elevated);
          color: var(--text);
          outline: none;
        }
        .session-migrate-search:focus {
          border-color: var(--accent);
        }
        .session-migrate-success {
          margin: 12px 18px 0;
          padding: 8px 12px;
          border: 1px solid color-mix(in srgb, var(--success) 60%, var(--border));
          border-radius: 4px;
          background: color-mix(in srgb, var(--success) 12%, transparent);
          color: var(--success);
          font-size: 12px;
        }
        .session-migrate-modal > .error-banner {
          margin: 12px 18px 0;
        }
        .session-migrate-list {
          flex: 1;
          min-height: 160px;
          margin-top: 10px;
          overflow: auto;
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          padding: 4px 0;
        }
        .session-migrate-empty {
          padding: 36px 18px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }
        .session-migrate-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          padding: 9px 18px;
          border: none;
          border-radius: 0;
          background: transparent;
          text-align: left;
        }
        .session-migrate-item:hover:not(:disabled) {
          background: var(--bg-hover);
        }
        .session-migrate-item.selected {
          background: color-mix(in srgb, var(--accent) 14%, transparent);
        }
        .session-migrate-item:disabled {
          opacity: 0.55;
          cursor: default;
        }
        .session-migrate-check {
          width: 16px;
          height: 16px;
          margin-top: 2px;
          border: 1px solid var(--border);
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 11px;
          line-height: 1;
        }
        .session-migrate-check.checked {
          border-color: var(--accent);
          background: var(--accent);
          color: #fff;
        }
        .session-migrate-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .session-migrate-session-title {
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .session-migrate-path,
        .session-migrate-project {
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 11px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .session-migrate-project {
          opacity: 0.8;
        }
        .session-migrate-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .session-migrate-badge {
          padding: 1px 6px;
          border-radius: 999px;
          font-size: 10px;
          line-height: 1.5;
        }
        .session-migrate-badge.orphan {
          background: color-mix(in srgb, var(--warning) 18%, transparent);
          color: var(--warning);
        }
        .session-migrate-badge.current {
          background: color-mix(in srgb, var(--accent) 18%, transparent);
          color: var(--accent);
        }
        .session-migrate-time {
          flex-shrink: 0;
          color: var(--text-muted);
          font-size: 11px;
          white-space: nowrap;
        }
        .session-migrate-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 18px;
        }
        .session-migrate-count {
          font-size: 12px;
        }
        .session-migrate-footer-hint {
          color: var(--text-muted);
          font-size: 11px;
        }
        .session-migrate-actions {
          display: flex;
          gap: 8px;
          margin-left: auto;
        }
        @media (max-width: 640px) {
          .session-migrate-backdrop {
            padding: 10px;
          }
          .session-migrate-footer {
            flex-wrap: wrap;
          }
          .session-migrate-actions {
            margin-left: 0;
            width: 100%;
            justify-content: flex-end;
          }
          .session-migrate-time {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
