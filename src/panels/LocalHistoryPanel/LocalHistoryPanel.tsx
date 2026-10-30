import { useCallback, useEffect, useState } from "react";
import { useChatStore } from "../../stores/chat";
import { createProviderChatSlice } from "../../stores/providerChatSlice";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import {
  deleteLocalChatSession,
  listLocalChatSessions,
  localizeSessionTitle,
  type LocalSessionMeta,
} from "../../utils/localChatHistory";
import { safeConfirm } from "../../utils/tauriDialog";

export function LocalHistoryPanel() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<LocalSessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const providerId = useChatStore((state) => state.providerId);
  const thread = useChatStore(
    (state) =>
      (state.providerStates[state.providerId] ??
        createProviderChatSlice(state.providerId)).thread,
  );
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  const load = useCallback(async () => {
    if (!rootPath) {
      setSessions([]);
      return;
    }
    setLoading(true);
    try {
      setSessions(await listLocalChatSessions(rootPath, providerId));
    } finally {
      setLoading(false);
    }
  }, [providerId, rootPath]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (session: LocalSessionMeta) => {
    if (!rootPath || deletingId || session.id === thread?.id) return;
    const title =
      localizeSessionTitle(session.title) ||
      session.preview ||
      session.id;
    const confirmed = await safeConfirm(
      t("chat.deleteLocalConfirm", {
        label: `${t("chat.localSessionTag")} ${title}`,
      }),
    );
    if (!confirmed) return;
    setDeletingId(session.id);
    try {
      await deleteLocalChatSession(rootPath, providerId, session.id);
      await load();
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="local-history">
      <div className="local-history-header">
        <div>
          <h3 className="local-history-title">{t("chat.localHistory")}</h3>
          <p className="local-history-hint">{t("chat.localHistoryHint")}</p>
        </div>
        <button
          type="button"
          className="local-history-refresh"
          disabled={!rootPath || loading}
          onClick={() => {
            void load();
          }}
        >
          {t("chat.refreshSessions")}
        </button>
      </div>

      {!rootPath ? (
        <div className="local-history-empty">{t("chat.openFolderFirst")}</div>
      ) : loading && sessions.length === 0 ? (
        <div className="local-history-empty">{t("chat.migrateLoading")}</div>
      ) : sessions.length === 0 ? (
        <div className="local-history-empty">
          {t("chat.localHistoryEmpty")}
        </div>
      ) : (
        <>
          <div className="local-history-count">
            {t("chat.localHistoryCount", {
              count: String(sessions.length),
            })}
          </div>
          <ul className="local-history-list">
            {sessions.map((session) => {
              const isCurrent = session.id === thread?.id;
              const title =
                localizeSessionTitle(session.title) ||
                session.preview ||
                session.id;
              const displayTitle = `${t("chat.localSessionTag")} ${title}`;
              return (
                <li
                  key={session.id}
                  className={`local-history-item ${
                    isCurrent ? "current" : ""
                  }`}
                >
                  <div className="local-history-info">
                    <span className="local-history-name" title={displayTitle}>
                      {displayTitle}
                    </span>
                    <span className="local-history-id" title={session.id}>
                      {session.id}
                    </span>
                  </div>
                  {isCurrent ? (
                    <span className="local-history-badge">
                      {t("chat.currentSession")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="local-history-delete"
                      title={t("chat.deleteSession")}
                      aria-label={t("chat.deleteSession")}
                      disabled={deletingId === session.id}
                      onClick={() => {
                        void remove(session);
                      }}
                    >
                      {deletingId === session.id ? "…" : "×"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <style>{`
        .local-history {
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-editor);
          color: var(--text);
        }
        .local-history-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px 14px;
          border-bottom: 1px solid var(--border);
        }
        .local-history-title {
          margin: 0 0 4px;
          font-size: 16px;
          font-weight: 600;
        }
        .local-history-hint {
          margin: 0;
          max-width: 640px;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .local-history-refresh {
          flex-shrink: 0;
        }
        .local-history-count {
          padding: 10px 20px 0;
          color: var(--text-muted);
          font-size: 12px;
        }
        .local-history-list {
          flex: 1;
          min-height: 0;
          overflow: auto;
          list-style: none;
          margin: 0;
          padding: 12px 20px 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .local-history-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
          border-radius: 8px;
          background: color-mix(in srgb, var(--warning) 7%, var(--bg-elevated));
        }
        .local-history-item.current {
          border-color: var(--user-bubble-border);
          background: color-mix(
            in srgb,
            var(--user-bubble-bg) 55%,
            var(--bg-elevated)
          );
        }
        .local-history-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .local-history-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--warning);
          font-size: 13px;
          font-weight: 600;
        }
        .local-history-id {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 11px;
        }
        .local-history-badge {
          flex-shrink: 0;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--user-bubble-bg);
          color: var(--text);
          font-size: 11px;
        }
        .local-history-delete {
          flex-shrink: 0;
          width: 28px;
          height: 28px;
          padding: 0;
          border-color: transparent;
          background: transparent;
          color: var(--text-muted);
          font-size: 16px;
          line-height: 1;
        }
        .local-history-delete:hover:not(:disabled) {
          border-color: var(--danger);
          background: transparent;
          color: var(--danger);
        }
        .local-history-empty {
          padding: 24px 20px;
          color: var(--text-muted);
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}
