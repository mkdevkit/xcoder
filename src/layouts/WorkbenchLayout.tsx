import { useEffect, useMemo, useRef } from "react";
import appIcon from "../../src-tauri/icons/icon.png";
import { MenuBar, type MenuBarMenu } from "../components/MenuBar";
import { PanelResizeHandle } from "../components/PanelResizeHandle";
import { FileExplorer } from "../panels/FileExplorer/FileExplorer";
import { EditorPanel } from "../panels/EditorPanel/EditorPanel";
import { ChatPanel } from "../panels/ChatPanel/ChatPanel";
import { TerminalPanel } from "../panels/TerminalPanel/TerminalPanel";
import { useWorkbenchContextMenu } from "../hooks/useWorkbenchContextMenu";
import {
  EDITOR_MIN_HEIGHT,
  useSettingsStore,
} from "../stores/settings";
import { useTerminalStore } from "../stores/terminal";
import { useWorkspaceStore } from "../stores/workspace";
import { useChatStore } from "../stores/chat";
import { createProviderChatSlice } from "../stores/providerChatSlice";
import { useTranslation } from "../i18n";
import { projectDisplayName } from "../utils/recentProjects";
import { isTauri } from "../utils/tauri";

export function WorkbenchLayout() {
  const {
    sidebarWidth,
    chatWidth,
    terminalVisible,
    terminalHeight,
    resizeSidebarBy,
    resizeChatBy,
    resizeTerminalBy,
  } = useSettingsStore();
  const centerColumnRef = useRef<HTMLElement>(null);
  const { openFolder, openPreferencesTab, openRecentProject, closeProject, recentProjects, rootPath, activeFile, setupWorkspaceListener } =
    useWorkspaceStore();
  const { createTerminal } = useTerminalStore();
  const connectedIntent = useChatStore(
    (state) =>
      (state.providerStates[state.providerId] ??
        createProviderChatSlice(state.providerId)).connectedIntent,
  );
  const showChatPanel = Boolean(rootPath && connectedIntent);
  const { t } = useTranslation();
  useWorkbenchContextMenu();

  useEffect(() => {
    useWorkspaceStore.getState().refreshRecentProjects();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const { loadConfig, setupEventListener } = useChatStore.getState();
    loadConfig().catch(console.error);
    let cleanup: (() => void) | undefined;
    setupEventListener()
      .then((fn) => {
        cleanup = fn;
      })
      .catch(console.error);
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setupWorkspaceListener()
      .then((fn) => {
        cleanup = fn;
      })
      .catch(console.error);
    return () => cleanup?.();
  }, [setupWorkspaceListener]);

  useEffect(() => {
    if (!rootPath) return;
    return useChatStore.getState().startRuntimeHealthMonitor();
  }, [rootPath]);

  const handleNewTerminal = () => {
    createTerminal(rootPath ?? undefined).catch(console.error);
  };

  const menuBarMenus = useMemo((): MenuBarMenu[] => {
    const recentItems =
      recentProjects.length > 0
        ? recentProjects.map((path) => ({
            id: `recent-${path}`,
            label: projectDisplayName(path),
            title: path,
            onClick: () => openRecentProject(path).catch(console.error),
          }))
        : [
            {
              id: "open-recent-empty",
              label: t("menu.openRecentEmpty"),
              disabled: true,
            },
          ];

    return [
      {
        id: "file",
        label: t("menu.file"),
        items: [
          {
            id: "open-project",
            label: t("menu.openProject"),
            onClick: () => openFolder().catch(console.error),
          },
          {
            id: "open-recent",
            label: t("menu.openRecent"),
            children: recentItems,
          },
          {
            id: "close-project",
            label: t("menu.closeProject"),
            disabled: !rootPath,
            onClick: () => closeProject().catch(console.error),
          },
          {
            id: "preferences",
            label: t("menu.preferences"),
            dividerBefore: true,
            onClick: () => openPreferencesTab(),
          },
        ],
      },
      {
        id: "terminal",
        label: t("menu.terminal"),
        items: [
          {
            id: "new-terminal",
            label: t("menu.newTerminal"),
            onClick: handleNewTerminal,
          },
        ],
      },
    ];
  }, [closeProject, handleNewTerminal, openFolder, openPreferencesTab, openRecentProject, recentProjects, rootPath, t]);

  const handleTerminalResize = (delta: number) => {
    const maxHeight = centerColumnRef.current
      ? centerColumnRef.current.clientHeight - EDITOR_MIN_HEIGHT
      : 600;
    resizeTerminalBy(delta, maxHeight);
  };

  return (
    <div className="workbench">
      <header className="toolbar">
        <img className="app-logo" src={appIcon} alt="xcoder" />
        <MenuBar menus={menuBarMenus} />
        <div className="toolbar-meta">
          {rootPath && (
            <span className="workspace-path" title={rootPath}>
              {rootPath}
            </span>
          )}
          {activeFile && (
            <span className="active-file" title={activeFile}>
              {activeFile.split(/[\\/]/).pop()}
            </span>
          )}
        </div>
      </header>

      <div className="workbench-body">
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="panel-header">
            <span className="panel-title">{t("panel.explorer")}</span>
          </div>
          <FileExplorer />
        </aside>

        <PanelResizeHandle direction="horizontal" onResizeDelta={resizeSidebarBy} />

        <main className="center-column" ref={centerColumnRef}>
          <section className="editor-area">
            <EditorPanel />
          </section>
          {terminalVisible && (
            <>
              <PanelResizeHandle
                direction="vertical"
                onResizeDelta={handleTerminalResize}
              />
              <div className="terminal-area" style={{ height: terminalHeight }}>
                <TerminalPanel />
              </div>
            </>
          )}
        </main>

        {showChatPanel && (
          <>
            <PanelResizeHandle direction="horizontal" onResizeDelta={resizeChatBy} />

            <aside className="chat-sidebar" style={{ width: chatWidth }}>
              <ChatPanel />
            </aside>
          </>
        )}
      </div>

      <style>{`
        .workbench {
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .toolbar {
          height: 36px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 8px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-panel);
        }
        .menu-bar {
          display: flex;
          align-items: stretch;
          height: 100%;
          gap: 2px;
        }
        .menu-root {
          position: relative;
          display: flex;
          align-items: stretch;
        }
        .menu-trigger {
          height: 100%;
          padding: 0 10px;
          border: none;
          background: transparent;
          border-radius: 0;
          color: var(--text);
        }
        .menu-root.open .menu-trigger,
        .menu-trigger:hover {
          background: var(--bg-hover);
        }
        .menu-dropdown {
          position: absolute;
          top: 100%;
          left: 0;
          z-index: 1000;
          min-width: 180px;
          margin: 0;
          padding: 4px 0;
          list-style: none;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .menu-item {
          display: block;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          padding: 7px 14px;
          border-radius: 0;
          color: var(--text);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .menu-item:hover:not(:disabled) {
          background: var(--bg-hover);
        }
        .menu-item:disabled {
          opacity: 0.45;
        }
        .menu-divider {
          height: 1px;
          margin: 4px 0;
          background: var(--border);
        }
        .menu-item-row {
          position: relative;
        }
        .menu-item-submenu {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .menu-submenu-arrow {
          font-size: 10px;
          opacity: 0.7;
        }
        .menu-submenu-root {
          position: relative;
        }
        .menu-submenu {
          display: none;
          position: absolute;
          top: 0;
          left: 100%;
          z-index: 1001;
          min-width: 220px;
          margin: 0;
          padding: 4px 0;
          list-style: none;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .menu-submenu-root.open .menu-submenu {
          display: block;
        }
        .menu-error {
          color: var(--danger);
          font-size: 12px;
          max-width: 320px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .app-logo {
          width: 24px;
          height: 24px;
          flex-shrink: 0;
          object-fit: contain;
        }
        .toolbar-meta {
          margin-left: auto;
          display: flex;
          gap: 12px;
          min-width: 0;
          color: var(--text-muted);
          font-size: 12px;
        }
        .workspace-path,
        .active-file {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 280px;
        }
        .workbench-body {
          flex: 1;
          min-height: 0;
          display: flex;
        }
        .sidebar,
        .chat-sidebar {
          flex-shrink: 0;
          min-width: 0;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .sidebar {
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border);
        }
        .chat-sidebar {
          border-left: none;
          background: var(--bg-sidebar);
        }
        .panel-header {
          padding: 10px 12px 6px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-sidebar);
        }
        .center-column {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .editor-area {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          background: var(--bg-editor);
        }
        .terminal-area {
          flex-shrink: 0;
          min-height: 0;
          overflow: hidden;
        }
        .terminal-area .terminal-panel {
          height: 100%;
        }
        .panel-resize-handle {
          flex-shrink: 0;
          background: transparent;
          transition: background 0.15s;
        }
        .panel-resize-handle.horizontal {
          width: 4px;
          cursor: col-resize;
        }
        .panel-resize-handle.vertical {
          height: 4px;
          cursor: row-resize;
        }
        .panel-resize-handle:hover,
        .panel-resize-handle:active {
          background: var(--accent);
        }
      `}</style>
    </div>
  );
}
