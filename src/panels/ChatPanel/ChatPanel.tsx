import { useEffect, useRef, useState } from "react";
import { ApprovalGate } from "../../components/ApprovalGate";
import { MessageBubble } from "../../components/MessageBubble";
import { useChatStore } from "../../stores/chat";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import { getProviderLabel } from "../../utils/agentProvider";
import { isTauri } from "../../utils/tauri";

export function ChatPanel() {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const {
    config,
    providerId,
    runtime,
    mode,
    model,
    dynamicModes,
    thread,
    threads,
    threadsLoading,
    messages,
    streaming,
    pendingApproval,
    error,
    initialized,
    loadConfig,
    setProvider,
    connectRuntime,
    disconnectRuntime,
    selectThread,
    createNewThread,
    deleteThread,
    setMode,
    setModel,
    sendMessage,
    approve,
    setupEventListener,
    getActiveProvider,
  } = useChatStore();
  const { rootPath } = useWorkspaceStore();
  const { t } = useTranslation();

  const activeProvider = getActiveProvider();
  const uiOptions = activeProvider?.ui_options;
  const modeOptions =
    dynamicModes.length > 0 ? dynamicModes : (uiOptions?.modes ?? ["agent"]);
  const modelOptions = uiOptions?.models ?? [];
  const showModelSelect = modelOptions.length > 0;
  const providerLabel = getProviderLabel(providerId);

  useEffect(() => {
    if (!isTauri()) return;

    loadConfig().catch(console.error);
    let cleanup: (() => void) | undefined;
    setupEventListener()
      .then((fn) => {
        cleanup = fn;
      })
      .catch(console.error);
    return () => cleanup?.();
  }, [loadConfig, setupEventListener]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingApproval]);

  const handleConnect = async () => {
    if (runtime.running) {
      await disconnectRuntime();
      return;
    }
    await connectRuntime(rootPath ?? undefined);
  };

  const handleSend = async () => {
    if (!input.trim() || streaming || !runtime.running || !thread) return;
    if (!rootPath) return;

    await sendMessage(input);
    setInput("");
  };

  const canChat = Boolean(rootPath && runtime.running && thread);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-top">
          <div className="panel-title">{providerLabel}</div>
          {config && config.providers.length > 1 && (
            <select
              className="provider-select"
              value={providerId}
              onChange={(e) => setProvider(e.target.value).catch(console.error)}
              disabled={streaming}
            >
              {config.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {getProviderLabel(provider.id)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="chat-controls">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={!initialized}
          >
            {modeOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {showModelSelect && (
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!initialized}
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <button
            className={runtime.running ? "" : "primary"}
            onClick={handleConnect}
          >
            {runtime.running ? t("chat.disconnect") : t("chat.connect")}
          </button>
        </div>
        {runtime.running && (
          <div className="chat-thread-row">
            <select
              className="thread-select"
              value={thread?.id ?? ""}
              disabled={threadsLoading || streaming || threads.length === 0}
              onChange={(e) => {
                const nextId = e.target.value;
                if (!nextId || !rootPath) return;
                selectThread(nextId, rootPath).catch(console.error);
              }}
            >
              {threads.length === 0 ? (
                <option value="">{t("chat.noSessions")}</option>
              ) : (
                <>
                  {!thread && <option value="">{t("chat.selectSession")}</option>}
                  {threads.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title || item.preview || item.id}
                    </option>
                  ))}
                </>
              )}
            </select>
            <button
              type="button"
              className="thread-delete-btn"
              title={t("chat.deleteSession")}
              disabled={!thread || streaming}
              onClick={() => {
                if (!rootPath || !thread) return;
                deleteThread(thread.id, rootPath).catch(console.error);
              }}
            >
              ×
            </button>
            <button
              type="button"
              className="thread-new-btn"
              title={t("chat.newSession")}
              disabled={!rootPath || streaming}
              onClick={() => {
                if (!rootPath) return;
                createNewThread(rootPath).catch(console.error);
              }}
            >
              +
            </button>
          </div>
        )}
      </div>

      {!rootPath && (
        <div className="chat-hint">{t("chat.openFolderFirst")}</div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-placeholder">
            {!runtime.running
              ? t("chat.hintDisconnected", { provider: providerLabel })
              : !thread
                ? t("chat.hintNoSession")
                : t("chat.hintReady", { provider: providerLabel })}
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {pendingApproval && (
          <ApprovalGate
            description={pendingApproval.description}
            onApprove={() => approve(true).catch(console.error)}
            onDeny={() => approve(false).catch(console.error)}
          />
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          rows={4}
          placeholder={
            !rootPath
              ? t("chat.openFolderToChat")
              : !runtime.running
                ? t("chat.connectFirst")
                : !thread
                  ? t("chat.selectOrCreateSession")
                  : t("chat.inputPlaceholder")
          }
          value={input}
          disabled={!canChat || streaming}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          className="primary send-btn"
          disabled={!canChat || streaming || !input.trim()}
          onClick={handleSend}
        >
          {streaming ? t("chat.sending") : t("chat.send")}
        </button>
      </div>

      <style>{`
        .chat-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-panel);
        }
        .chat-header {
          padding: 10px 12px;
          border-bottom: 1px solid var(--border);
        }
        .chat-header-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .provider-select {
          min-width: 120px;
        }
        .chat-controls {
          display: flex;
          gap: 8px;
          margin-top: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .chat-thread-row {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-top: 8px;
        }
        .thread-select {
          flex: 1;
          min-width: 0;
        }
        .thread-new-btn,
        .thread-delete-btn {
          width: 28px;
          padding: 0;
          flex-shrink: 0;
        }
        .thread-delete-btn:disabled {
          opacity: 0.4;
        }
        .chat-hint,
        .chat-placeholder {
          color: var(--text-muted);
          padding: 12px;
          font-size: 12px;
        }
        .chat-messages {
          flex: 1;
          overflow: auto;
          padding: 12px;
        }
        .chat-input-area {
          padding: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .chat-input-area textarea {
          width: 100%;
          padding: 10px;
        }
        .send-btn {
          align-self: flex-end;
        }
      `}</style>
    </div>
  );
}
