import { useCallback, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { PanelResizeHandle } from "../../components/PanelResizeHandle";
import {
  RichChatComposer,
  type RichChatComposerHandle,
} from "../../components/RichChatComposer";
import { useChatStore } from "../../stores/chat";
import { createProviderChatSlice } from "../../stores/providerChatSlice";
import { isGenerating } from "../../utils/turnState";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import { useChatInputDrop } from "../../hooks/useChatInputDrop";
import { isInternalPathDrag } from "../../utils/chatFileReference";
import { getProviderLabel } from "../../utils/agentProvider";
import {
  deriveOpencodeVendors,
  formatOpencodeVendorLabel,
  modelsForOpencodeVendor,
} from "../../utils/opencodeModels";
import { localizeSessionTitle } from "../../utils/localChatHistory";
import { ChatMessageList } from "./ChatMessageList";

const CHAT_INPUT_HEIGHT_KEY = "xcoder:chat-input-height";
const CHAT_INPUT_MIN_HEIGHT = 112;
const CHAT_INPUT_DEFAULT_HEIGHT = 168;
const CHAT_MESSAGES_MIN_HEIGHT = 120;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function readStoredInputHeight() {
  try {
    const raw = localStorage.getItem(CHAT_INPUT_HEIGHT_KEY);
    if (!raw) return CHAT_INPUT_DEFAULT_HEIGHT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return CHAT_INPUT_DEFAULT_HEIGHT;
    return clamp(parsed, CHAT_INPUT_MIN_HEIGHT, 600);
  } catch {
    return CHAT_INPUT_DEFAULT_HEIGHT;
  }
}

function persistInputHeight(height: number) {
  try {
    localStorage.setItem(CHAT_INPUT_HEIGHT_KEY, String(height));
  } catch {
    // ignore storage failures
  }
}

export function ChatPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<RichChatComposerHandle>(null);
  const [hasContent, setHasContent] = useState(false);
  const [inputAreaHeight, setInputAreaHeight] = useState(readStoredInputHeight);
  const {
    providerId,
    runtime,
    mode,
    model,
    dynamicModes,
    thread,
    threads,
    threadsLoading,
    streaming,
    activeTurn,
    error,
    initialized,
    runtimeBusy,
    connectedIntent,
    opencodeModelCatalog,
    opencodeConnectedProviders,
    opencodeVendor,
  } = useChatStore(
    useShallow((state) => {
      const slice =
        state.providerStates[state.providerId] ??
        createProviderChatSlice(state.providerId);
      return {
        providerId: state.providerId,
        initialized: state.initialized,
        runtime: slice.runtime,
        connectedIntent: slice.connectedIntent,
        thread: slice.thread,
        threads: slice.threads,
        threadsLoading: slice.threadsLoading,
        mode: slice.mode,
        model: slice.model,
        dynamicModes: slice.dynamicModes,
        streaming: slice.streaming,
        activeTurn: slice.activeTurn,
        runtimeBusy: slice.runtimeBusy,
        error: slice.error,
        opencodeModelCatalog: slice.opencodeModelCatalog,
        opencodeConnectedProviders: slice.opencodeConnectedProviders,
        opencodeVendor: slice.opencodeVendor,
      };
    }),
  );
  const {
    selectThread,
    createNewThread,
    deleteThread,
    setMode,
    setModel,
    setOpencodeVendor,
    sendMessage,
    cancelGeneration,
  } = useChatStore();
  const { rootPath } = useWorkspaceStore();
  const { t } = useTranslation();
  const generating = isGenerating({ streaming, activeTurn });
  const canChat = Boolean(rootPath && connectedIntent && runtime.running && thread);
  const canCompose = Boolean(rootPath && connectedIntent && runtime.running && !generating);
  const controlsLocked = generating || runtimeBusy;

  const handleAttachReferences = useCallback((refs: string[]) => {
    composerRef.current?.insertReferences(refs);
  }, []);

  const {
    dropAreaRef,
    dragOver,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useChatInputDrop({
    rootPath,
    onAttach: handleAttachReferences,
    disabled: !rootPath || generating,
    onFocus: () => composerRef.current?.focus(),
  });

  const modeOptions =
    dynamicModes.length > 0 ? dynamicModes : ["agent"];
  const isOpencode = providerId === "opencode";
  const opencodeVendors = deriveOpencodeVendors(
    opencodeModelCatalog,
    opencodeConnectedProviders,
  );
  const opencodeModels = modelsForOpencodeVendor(
    opencodeModelCatalog,
    opencodeVendor,
  );
  const showOpencodeVendor =
    isOpencode && connectedIntent && runtime.running && opencodeVendors.length > 0;
  const showModelSelect =
    isOpencode && connectedIntent && runtime.running && opencodeModels.length > 0;
  const providerLabel = getProviderLabel(providerId);

  const composerPlaceholder = !rootPath
    ? t("chat.openFolderToChat")
    : !connectedIntent
      ? t("chat.connectInProjectPrefs")
      : !runtime.running
        ? t("chat.serviceNotRunning")
      : !thread
        ? t("chat.selectOrCreateSession")
        : t("chat.inputPlaceholder");

  const handleSend = async () => {
    const message = composerRef.current?.getMessage() ?? "";
    if (!message || generating || !connectedIntent || !runtime.running || !thread) return;
    if (!rootPath) return;

    await sendMessage(message);
    composerRef.current?.clear();
    setHasContent(false);
  };

  const handleSendOrCancel = async () => {
    if (generating) {
      await cancelGeneration();
      return;
    }
    await handleSend();
  };

  const handleComposerChange = () => {
    setHasContent(!(composerRef.current?.isEmpty() ?? true));
  };

  const handleInputResize = useCallback((delta: number) => {
    const panelHeight = panelRef.current?.clientHeight ?? 600;
    const maxHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT,
      panelHeight - CHAT_MESSAGES_MIN_HEIGHT,
    );
    setInputAreaHeight((current) => {
      const next = clamp(current - delta, CHAT_INPUT_MIN_HEIGHT, maxHeight);
      persistInputHeight(next);
      return next;
    });
  }, []);

  const handlePanelDragOver = useCallback((event: React.DragEvent) => {
    if (!isInternalPathDrag(event.dataTransfer)) return;
    const inInput = (event.target as HTMLElement).closest(".chat-input-area");
    if (inInput) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  }, []);

  const handlePanelDrop = useCallback((event: React.DragEvent) => {
    if (!isInternalPathDrag(event.dataTransfer)) return;
    const inInput = (event.target as HTMLElement).closest(".chat-input-area");
    if (inInput) return;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return (
    <div
      className="chat-panel"
      ref={panelRef}
      onDragOver={handlePanelDragOver}
      onDrop={handlePanelDrop}
    >
      <div className="chat-header">
        <div className="chat-header-top">
          <div className="panel-title">{providerLabel}</div>
        </div>
        {connectedIntent && (
          <div className="chat-thread-row">
            <select
              className="thread-select"
              value={thread?.id ?? ""}
              disabled={threadsLoading || controlsLocked || threads.length === 0}
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
                      {localizeSessionTitle(item.title) || item.preview || item.id}
                    </option>
                  ))}
                </>
              )}
            </select>
            <button
              type="button"
              className="thread-delete-btn"
              title={t("chat.deleteSession")}
              disabled={!thread || controlsLocked}
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
              disabled={!rootPath || controlsLocked}
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

      <ChatMessageList />

      <PanelResizeHandle
        direction="vertical"
        onResizeDelta={handleInputResize}
      />

      <div
        ref={dropAreaRef}
        className={`chat-input-area ${dragOver ? "drag-over" : ""}`}
        style={{ height: inputAreaHeight }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <RichChatComposer
          ref={composerRef}
          placeholder={composerPlaceholder}
          editable={canCompose}
          onContentChange={handleComposerChange}
          onEnter={handleSend}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        />
        <div className="chat-composer-toolbar">
          <div className="chat-controls-selects">
            <select
              className="chat-mode-select"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={!initialized || controlsLocked}
            >
              {modeOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {showOpencodeVendor && (
              <select
                className="chat-vendor-select"
                value={opencodeVendor}
                onChange={(e) => setOpencodeVendor(e.target.value)}
                disabled={!initialized || controlsLocked}
                title={t("chat.modelProvider")}
              >
                {opencodeVendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {formatOpencodeVendorLabel(vendor)}
                  </option>
                ))}
              </select>
            )}
            {showModelSelect && (
              <select
                className="chat-model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={!initialized || controlsLocked}
                title={model}
              >
                {opencodeModels.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.modelName}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            className={`send-btn ${generating ? "" : "primary"}`}
            disabled={generating ? !canChat : !canChat || !hasContent}
            onClick={() => handleSendOrCancel().catch(console.error)}
          >
            {generating ? t("chat.cancel") : t("chat.send")}
          </button>
        </div>
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
        .chat-controls-selects {
          display: flex;
          gap: 8px;
          min-width: 0;
          flex: 1;
          flex-wrap: wrap;
          align-items: center;
        }
        .chat-controls-selects select {
          flex: 1 1 0;
          min-width: 72px;
          max-width: 100%;
          text-overflow: ellipsis;
        }
        .chat-mode-select {
          flex: 0 1 96px;
        }
        .chat-vendor-select {
          flex: 1 1 120px;
        }
        .chat-model-select {
          flex: 2 1 160px;
        }
        .chat-composer-toolbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
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
        .chat-panel .panel-resize-handle.vertical {
          flex-shrink: 0;
          height: 4px;
          cursor: row-resize;
          background: transparent;
          transition: background 0.15s;
        }
        .chat-panel .panel-resize-handle.vertical:hover,
        .chat-panel .panel-resize-handle.vertical:active {
          background: var(--accent);
        }
        .chat-input-area {
          flex-shrink: 0;
          min-height: 0;
          padding: 12px;
          border-top: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-radius: 0;
          transition: background 0.15s, box-shadow 0.15s;
          overflow: hidden;
        }
        .chat-input-area .rich-chat-composer-wrap {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .chat-input-area .rich-chat-composer {
          flex: 1;
          min-height: 0;
          max-height: none;
          height: auto;
        }
        .chat-input-area.drag-over {
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: inset 0 0 0 1px var(--accent);
        }
        .chat-input-area.drag-over .rich-chat-composer {
          border-color: var(--accent);
          cursor: copy;
        }
        .send-btn {
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
}
