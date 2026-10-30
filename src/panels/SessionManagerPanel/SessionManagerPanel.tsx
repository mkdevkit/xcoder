import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "../../stores/chat";
import { createProviderChatSlice } from "../../stores/providerChatSlice";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import { localizeSessionTitle } from "../../utils/localChatHistory";

export function SessionManagerPanel() {
  const { t } = useTranslation();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const {
    providerId,
    thread,
    threads,
    threadsLoading,
    connectedIntent,
    runtime,
    error,
  } = useChatStore(
    useShallow((state) => {
      const slice =
        state.providerStates[state.providerId] ??
        createProviderChatSlice(state.providerId);
      return {
        providerId: state.providerId,
        thread: slice.thread,
        threads: slice.threads,
        threadsLoading: slice.threadsLoading,
        connectedIntent: slice.connectedIntent,
        runtime: slice.runtime,
        error: slice.error,
      };
    }),
  );
  const loadThreads = useChatStore((state) => state.loadThreads);
  const deleteThread = useChatStore((state) => state.deleteThread);
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  const canManage = Boolean(
    rootPath && connectedIntent && runtime.running,
  );
  const currentId = thread?.id ?? null;

  const refresh = () => {
    if (!rootPath) return;
    loadThreads(rootPath, providerId).catch(console.error);
  };

  const remove = async (threadId: string) => {
    if (!rootPath || deletingId || threadId === currentId) return;
    setDeletingId(threadId);
    try {
      await deleteThread(threadId, rootPath);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="session-manager">
      <div className="session-manager-header">
        <div>
          <h3 className="session-manager-title">{t("chat.sessionManager")}</h3>
          <p className="session-manager-hint">
            {t("chat.sessionManagerHint")}
          </p>
        </div>
        <button
          type="button"
          className="session-manager-refresh"
          disabled={!canManage || threadsLoading}
          onClick={refresh}
        >
          {t("chat.refreshSessions")}
        </button>
      </div>

      {!canManage ? (
        <div className="session-manager-empty">{t("chat.connectFirst")}</div>
      ) : error ? (
        <div className="session-manager-error">{error}</div>
      ) : threadsLoading && threads.length === 0 ? (
        <div className="session-manager-empty">{t("chat.migrateLoading")}</div>
      ) : threads.length === 0 ? (
        <div className="session-manager-empty">{t("chat.noSessions")}</div>
      ) : (
        <>
          <div className="session-manager-count">
            {t("chat.sessionsCount", { count: String(threads.length) })}
          </div>
          <ul className="session-manager-list">
            {threads.map((item) => {
              const isCurrent = item.id === currentId;
              const title =
                localizeSessionTitle(item.title) ||
                item.preview ||
                item.id;
              return (
                <li
                  key={item.id}
                  className={`session-manager-item ${isCurrent ? "current" : ""}`}
                >
                  <div className="session-manager-info">
                    <span className="session-manager-name" title={title}>
                      {title}
                    </span>
                    <span className="session-manager-id" title={item.id}>
                      {item.id}
                    </span>
                  </div>
                  {isCurrent ? (
                    <span className="session-manager-badge">
                      {t("chat.currentSession")}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="session-manager-delete"
                      title={t("chat.deleteSession")}
                      aria-label={t("chat.deleteSession")}
                      disabled={deletingId === item.id}
                      onClick={() => {
                        void remove(item.id);
                      }}
                    >
                      {deletingId === item.id ? "…" : "×"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <style>{`
        .session-manager {
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-editor);
          color: var(--text);
        }
        .session-manager-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 18px 20px 14px;
          border-bottom: 1px solid var(--border);
        }
        .session-manager-title {
          margin: 0 0 4px;
          font-size: 16px;
          font-weight: 600;
        }
        .session-manager-hint {
          margin: 0;
          max-width: 640px;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .session-manager-refresh {
          flex-shrink: 0;
        }
        .session-manager-count {
          padding: 10px 20px 0;
          color: var(--text-muted);
          font-size: 12px;
        }
        .session-manager-list {
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
        .session-manager-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-elevated);
        }
        .session-manager-item.current {
          border-color: var(--user-bubble-border);
          background: color-mix(
            in srgb,
            var(--user-bubble-bg) 55%,
            var(--bg-elevated)
          );
        }
        .session-manager-info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .session-manager-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          font-weight: 600;
        }
        .session-manager-id {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 11px;
        }
        .session-manager-badge {
          flex-shrink: 0;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--user-bubble-bg);
          color: var(--text);
          font-size: 11px;
        }
        .session-manager-delete {
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
        .session-manager-delete:hover:not(:disabled) {
          border-color: var(--danger);
          background: transparent;
          color: var(--danger);
        }
        .session-manager-empty,
        .session-manager-error {
          padding: 24px 20px;
          color: var(--text-muted);
          font-size: 13px;
        }
        .session-manager-error {
          color: var(--danger);
        }
      `}</style>
    </div>
  );
}
