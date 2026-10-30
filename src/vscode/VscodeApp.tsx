import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../i18n";
import { ChatPanel } from "../panels/ChatPanel/ChatPanel";
import { PreferencesPanel } from "../panels/PreferencesPanel/PreferencesPanel";
import { SessionManagerPanel } from "../panels/SessionManagerPanel/SessionManagerPanel";
import { useChatStore } from "../stores/chat";
import { createProviderChatSlice } from "../stores/providerChatSlice";
import { useWorkspaceStore } from "../stores/workspace";
import { applyAppTheme } from "../utils/appTheme";
import { tauriInvoke } from "../utils/tauri";
import { workspacesMatch } from "../utils/path";
import type { ProjectConfigInfo } from "../types/projectConfig";

type VscodeTab = "chat" | "sessions" | "preferences";

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

function editableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>(
    'input, textarea, [contenteditable="true"]',
  );
  if (!element) return null;
  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    if (
      ![
        "text",
        "search",
        "url",
        "tel",
        "email",
        "password",
        "number",
      ].includes(type)
    ) {
      return null;
    }
  }
  return element;
}

function selectedText(target: EventTarget | null): string {
  const element = editableTarget(target);
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? 0;
    return end > start ? element.value.slice(start, end) : "";
  }
  return window.getSelection()?.toString() ?? "";
}

function clipboardBridge<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> | null {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<T>;
      };
    }
  ).__TAURI_INTERNALS__;
  if (typeof internals?.invoke !== "function") return null;
  return internals.invoke(command, args);
}

async function writeClipboardText(text: string) {
  const bridge = clipboardBridge<void>("xcoder_clipboard_write", { text });
  if (bridge) {
    try {
      await bridge;
      return;
    } catch {
      // fall back to the browser clipboard
    }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand("copy");
    } finally {
      area.remove();
    }
  }
}

async function readClipboardText() {
  const bridge = clipboardBridge<string>("xcoder_clipboard_read");
  if (bridge) {
    try {
      const text = await bridge;
      if (typeof text === "string") return text;
    } catch {
      // fall back to the browser clipboard
    }
  }

  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
}

function insertText(target: HTMLElement, text: string) {
  target.focus();
  if (document.execCommand("insertText", false, text)) return;

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    const next = target.value.slice(0, start) + text + target.value.slice(end);
    const prototype =
      target instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    setter?.call(target, next);
    target.selectionStart = target.selectionEnd = start + text.length;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  target.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text,
    }),
  );
}

export function VscodeApp() {
  const { t } = useTranslation();
  const [init, setInit] = useState<InitMessage | null>(readInitialMessage);
  const [tab, setTab] = useState<VscodeTab>(
    init?.view === "preferences" ? "preferences" : "chat",
  );
  const [preferencesMounted, setPreferencesMounted] = useState(false);
  const [connectNonce, setConnectNonce] = useState(0);
  const connectingRef = useRef(false);
  const pendingConnectRef = useRef(false);
  const userSelectedTab = useRef(false);
  const wasConnected = useRef(false);
  const connected = useChatStore((state) => {
    const slice =
      state.providerStates[state.providerId] ??
      createProviderChatSlice(state.providerId);
    return Boolean(slice.connectedIntent && slice.runtime.running);
  });

  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey) return;
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (!modifier) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        const text = selectedText(event.target);
        if (!text) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void writeClipboardText(text);
        return;
      }

      const element = editableTarget(event.target);
      if (!element) return;

      if (key === "v") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void readClipboardText().then((text) => {
          if (text) insertText(element, text);
        });
        return;
      }

      if (key === "z" || key === "y") {
        event.preventDefault();
        event.stopImmediatePropagation();
        element.focus();
        document.execCommand(key === "y" || event.shiftKey ? "redo" : "undo");
      }
    };

    window.addEventListener("keydown", handleShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleShortcut, true);
  }, []);

  useEffect(() => {
    const storedInit = window.__XCODER_INIT__;
    if (storedInit) {
      setInit((current) => current ?? storedInit);
      if (storedInit.view === "preferences") {
        setTab("preferences");
      } else if (storedInit.view === "chat") {
        userSelectedTab.current = false;
        setTab("chat");
        setConnectNonce((value) => value + 1);
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
      } else if (message.view === "chat") {
        userSelectedTab.current = false;
        setTab("chat");
        setConnectNonce((value) => value + 1);
      }
    };
    window.addEventListener("xcoder:init", onInit);
    return () => window.removeEventListener("xcoder:init", onInit);
  }, []);

  const workspace = init?.workspace ?? null;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

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
    if (connectNonce === 0) return;
    const targetWorkspace = workspaceRef.current;
    if (!targetWorkspace) return;
    if (connectingRef.current) {
      pendingConnectRef.current = true;
      return;
    }

    const state = useChatStore.getState();
    const slice =
      state.providerStates[state.providerId] ??
      createProviderChatSlice(state.providerId);
    const currentWorkspace =
      slice.chatWorkspace ?? slice.thread?.workspace ?? null;
    if (
      slice.connectedIntent &&
      slice.runtime.running &&
      currentWorkspace &&
      workspacesMatch(currentWorkspace, targetWorkspace)
    ) {
      return;
    }

    connectingRef.current = true;
    void (async () => {
      try {
        const chat = useChatStore.getState();
        if (!chat.config) await chat.loadConfig();
        const info = await tauriInvoke<ProjectConfigInfo>(
          "ensure_project_config_cmd",
          { workspace: targetWorkspace },
        );
        useWorkspaceStore.setState({
          projectConfig: info.config,
          projectConfigPath: info.path,
        });
        await useChatStore
          .getState()
          .onProjectOpened(targetWorkspace, info.config);
      } catch (error) {
        console.error("Failed to open project config:", error);
        await useChatStore
          .getState()
          .connectRuntime(targetWorkspace)
          .catch((connectError) =>
            console.error("Failed to connect OpenCode runtime:", connectError),
          );
      } finally {
        connectingRef.current = false;
        if (pendingConnectRef.current) {
          pendingConnectRef.current = false;
          setConnectNonce((value) => value + 1);
        }
      }
    })();
  }, [connectNonce]);

  useEffect(() => {
    if (!connected) {
      userSelectedTab.current = false;
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

  useEffect(() => {
    const openSessions = () => {
      userSelectedTab.current = true;
      setTab("sessions");
    };
    window.addEventListener("xcoder:open-sessions", openSessions);
    return () =>
      window.removeEventListener("xcoder:open-sessions", openSessions);
  }, []);

  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, [tab]);

  useEffect(() => {
    if (tab === "preferences" || !connected) {
      setPreferencesMounted(true);
      return;
    }
    if (!connected || preferencesMounted) return;
    const timer = window.setTimeout(() => setPreferencesMounted(true), 1200);
    return () => window.clearTimeout(timer);
  }, [tab, connected, preferencesMounted]);

  const tabs = useMemo(
    () => [
      ...(connected
        ? [{ id: "chat" as const, label: t("vscode.chat") }]
        : []),
      ...(workspace
        ? [
            {
              id: "sessions" as const,
              label: t("chat.sessionManager"),
            },
          ]
        : []),
      { id: "preferences" as const, label: t("vscode.preferences") },
    ],
    [connected, t, workspace],
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
        {workspace && connected && (
          <div
            className={`vscode-pane ${tab === "chat" ? "active" : "hidden"}`}
          >
            <ChatPanel />
          </div>
        )}
        {workspace && (
          <div
            className={`vscode-pane ${
              tab === "sessions" ? "active" : "hidden"
            }`}
          >
            <SessionManagerPanel />
          </div>
        )}
        {preferencesMounted && (
          <div
            className={`vscode-pane preferences ${
              tab === "preferences" ? "active" : "hidden"
            }`}
          >
            <PreferencesPanel
              showMcp={false}
              showProjectMcp={false}
              showProjectRules={false}
            />
          </div>
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
          overflow: hidden;
        }
        .vscode-tab {
          height: 26px;
          padding: 0 12px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--text-muted);
          flex: 0 0 auto;
          white-space: nowrap;
        }
        .vscode-tab:hover:not(:disabled) {
          background: var(--bg-hover);
        }
        .vscode-tab.active {
          background: var(--bg-elevated);
          color: var(--text);
        }
        .vscode-workspace {
          flex: 0 1 auto;
          margin-left: auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 11px;
          padding-left: 12px;
          text-align: right;
        }
        .vscode-content {
          position: relative;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .vscode-pane {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
        }
        .vscode-pane.hidden {
          visibility: hidden;
          pointer-events: none;
        }
        .vscode-pane > .chat-panel {
          flex: 1;
          min-height: 0;
        }
        .vscode-pane.preferences {
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
