import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { ChatPanel } from "../panels/ChatPanel/ChatPanel";
import { PreferencesPanel } from "../panels/PreferencesPanel/PreferencesPanel";
import { useChatStore } from "../stores/chat";
import { createProviderChatSlice } from "../stores/providerChatSlice";
import { useWorkspaceStore } from "../stores/workspace";
import { applyAppTheme } from "../utils/appTheme";
import { tauriInvoke } from "../utils/tauri";
import type { ProjectConfigInfo } from "../types/projectConfig";

type VscodeTab = "chat" | "preferences";

interface InitMessage {
  type: "init" | "workspace";
  view?: "chat" | "preferences";
  workspace?: string | null;
  theme?: string;
}

declare global {
  interface Window {
    __XCODER_INIT__?: InitMessage;
  }
}

function readInitialMessage(): InitMessage | null {
  return window.__XCODER_INIT__ ?? null;
}

function findEditableTarget(
  target: EventTarget | null,
): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target;
  }
  const editable = target.closest<HTMLElement>('[contenteditable="true"]');
  return editable?.isContentEditable ? editable : null;
}

function insertTextAtTarget(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
  text: string,
) {
  if (!text) return;
  target.focus();

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    const next = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`;
    const prototype =
      target instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(target, next);
    target.setSelectionRange(start + text.length, start + text.length);
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  if (
    selection &&
    selection.rangeCount > 0 &&
    target.contains(selection.getRangeAt(0).commonAncestorContainer)
  ) {
    range.selectNodeContents(target);
    range.setStart(
      selection.getRangeAt(0).startContainer,
      selection.getRangeAt(0).startOffset,
    );
    range.setEnd(
      selection.getRangeAt(0).endContainer,
      selection.getRangeAt(0).endOffset,
    );
  } else {
    range.selectNodeContents(target);
    range.collapse(false);
  }

  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  target.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
}

function selectedTextAtTarget(
  target: HTMLInputElement | HTMLTextAreaElement | HTMLElement,
) {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return end > start ? target.value.slice(start, end) : "";
  }
  return window.getSelection()?.toString() ?? "";
}

export function VscodeApp() {
  const { t } = useTranslation();
  const [init, setInit] = useState<InitMessage | null>(readInitialMessage);
  const [tab, setTab] = useState<VscodeTab>(
    init?.view === "preferences" ? "preferences" : "chat",
  );
  const connectedWorkspace = useRef<string | null>(null);
  const userSelectedTab = useRef(false);
  const wasConnected = useRef(false);
  const connected = useChatStore((state) => {
    const slice =
      state.providerStates[state.providerId] ??
      createProviderChatSlice(state.providerId);
    return Boolean(slice.connectedIntent && slice.runtime.running);
  });

  useEffect(() => {
    const handleClipboardShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey) return;
      const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (key !== "v" && key !== "c") return;
      const target = findEditableTarget(event.target);

      if (key === "c") {
        if (!navigator.clipboard?.writeText) return;
        const text = target
          ? selectedTextAtTarget(target)
          : (window.getSelection()?.toString() ?? "");
        if (!text) return;
        event.preventDefault();
        void navigator.clipboard.writeText(text).catch(console.error);
        return;
      }

      if (!target || !navigator.clipboard?.readText) return;
      event.preventDefault();
      void navigator.clipboard
        .readText()
        .then((text) => insertTextAtTarget(target, text))
        .catch(console.error);
    };

    window.addEventListener("keydown", handleClipboardShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleClipboardShortcut, true);
  }, []);

  useEffect(() => {
    const storedInit = window.__XCODER_INIT__;
    if (storedInit) {
      setInit((current) => current ?? storedInit);
      if (storedInit.view === "preferences") {
        setTab("preferences");
      }
    }
    const onInit = (event: Event) => {
      const message = (event as CustomEvent<InitMessage>).detail;
      if (!message) return;
      setInit((current) => {
        if (message.type === "workspace") {
          return current
            ? { ...current, workspace: message.workspace }
            : {
                type: "workspace",
                workspace: message.workspace ?? null,
              };
        }
        return message;
      });
      if (message.view === "preferences") {
        setTab("preferences");
      }
    };
    window.addEventListener("xcoder:init", onInit);
    return () => window.removeEventListener("xcoder:init", onInit);
  }, []);

  const workspace = init?.workspace ?? null;

  useEffect(() => {
    if (!init) return;
    applyAppTheme(init.theme ?? "dark");
  }, [init?.theme]);

  useEffect(() => {
    useWorkspaceStore.setState({
      rootPath: workspace,
      projectConfig: null,
      projectConfigPath: null,
      openTabs: [],
      activeFile: null,
      editorReveal: null,
    });
  }, [workspace]);

  useEffect(() => {
    let disposed = false;
    let cleanupEvents: (() => void) | undefined;
    let cleanupWorkspace: (() => void) | undefined;

    void (async () => {
      try {
        await useChatStore.getState().loadConfig();
        if (disposed) return;
        cleanupEvents = await useChatStore.getState().setupEventListener();
        cleanupWorkspace =
          await useWorkspaceStore.getState().setupWorkspaceListener();
      } catch (error) {
        console.error("Failed to initialize xcoder webview:", error);
      }
    })();

    const stopHealth = useChatStore.getState().startRuntimeHealthMonitor();

    return () => {
      disposed = true;
      cleanupEvents?.();
      cleanupWorkspace?.();
      stopHealth();
    };
  }, [workspace]);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await tauriInvoke<ProjectConfigInfo>(
          "ensure_project_config_cmd",
          { workspace },
        );
        if (cancelled) return;
        useWorkspaceStore.setState({
          projectConfig: info.config,
          projectConfigPath: info.path,
        });
      } catch (error) {
        console.error("Failed to load project config:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  useEffect(() => {
    if (tab !== "chat" || !workspace) return;
    if (connectedWorkspace.current === workspace) return;
    connectedWorkspace.current = workspace;

    void (async () => {
      try {
        const chat = useChatStore.getState();
        if (!chat.config) await chat.loadConfig();
        const info = await tauriInvoke<ProjectConfigInfo>(
          "ensure_project_config_cmd",
          { workspace },
        );
        useWorkspaceStore.setState({
          projectConfig: info.config,
          projectConfigPath: info.path,
        });
        await useChatStore
          .getState()
          .onProjectOpened(workspace, info.config);
      } catch (error) {
        console.error("Failed to open project config:", error);
        await useChatStore
          .getState()
          .connectRuntime(workspace)
          .catch((connectError) =>
            console.error("Failed to connect OpenCode runtime:", connectError),
          );
      }
    })();
  }, [tab, workspace]);

  useEffect(() => {
    if (!connected) {
      setTab("preferences");
    } else if (
      !wasConnected.current &&
      !userSelectedTab.current &&
      init?.view === "chat"
    ) {
      setTab("chat");
    }
    wasConnected.current = connected;
  }, [connected, init?.view]);

  const tabs = useMemo(
    () => [
      ...(connected
        ? [{ id: "chat" as const, label: t("vscode.chat") }]
        : []),
      { id: "preferences" as const, label: t("vscode.preferences") },
    ],
    [connected, t],
  );

  if (!init) {
    return <div className="vscode-loading">{t("preferences.loading")}</div>;
  }

  return (
    <div className="vscode-app">
      <div className="vscode-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`vscode-tab ${tab === item.id ? "active" : ""}`}
            aria-selected={tab === item.id}
            onClick={() => {
              userSelectedTab.current = true;
              setTab(item.id);
            }}
          >
            {item.label}
          </button>
        ))}
        <span className="vscode-workspace" title={workspace ?? ""}>
          {workspace ?? t("chat.openFolderFirst")}
        </span>
      </div>

      <div className="vscode-content">
        {tab === "preferences" || !connected ? (
          <div className="vscode-preferences">
            <PreferencesPanel
              showMcp={false}
              showProjectMcp={false}
              showProjectRules={false}
            />
          </div>
        ) : !workspace ? (
          <div className="vscode-empty">
            <p>{t("chat.openFolderFirst")}</p>
          </div>
        ) : (
          <ChatPanel />
        )}
      </div>

      <style>{`
        .vscode-app {
          height: 100vh;
          min-height: 0;
          display: flex;
          flex-direction: column;
          background: var(--bg-base);
          color: var(--text);
        }
        .vscode-loading {
          padding: 24px;
          color: var(--text-muted);
        }
        .vscode-tabs {
          display: flex;
          align-items: center;
          gap: 2px;
          min-height: 34px;
          padding: 0 8px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-panel);
          flex-shrink: 0;
        }
        .vscode-tab {
          height: 26px;
          padding: 0 12px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
        }
        .vscode-tab:hover:not(:disabled) {
          background: var(--bg-hover);
        }
        .vscode-tab.active {
          background: var(--bg-elevated);
          color: var(--text);
        }
        .vscode-workspace {
          margin-left: auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 11px;
          padding-left: 12px;
        }
        .vscode-content {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .vscode-content > .chat-panel {
          flex: 1;
          min-height: 0;
        }
        .vscode-preferences {
          flex: 1;
          min-height: 0;
          overflow: auto;
          padding: 8px 16px 24px;
        }
        .vscode-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          color: var(--text-muted);
          text-align: center;
        }
      `}</style>
    </div>
  );
}
