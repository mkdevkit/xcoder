import { useEffect, useRef } from "react";
import { useTranslation } from "../../i18n";
import { PreferencesPanel } from "../PreferencesPanel/PreferencesPanel";
import { useChatStore } from "../../stores/chat";
import { useWorkspaceStore } from "../../stores/workspace";
import { languageFromPath } from "../../utils/language";
import { isPreferencesTab } from "../../utils/virtualTabs";
import { startFileDrag } from "../../utils/chatFileReference";
import { projectDisplayName } from "../../utils/recentProjects";
import { useDropZone } from "../../hooks/useDropZone";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";

export function EditorPanel() {
  const { t } = useTranslation();
  const {
    openTabs,
    activeFile,
    editorReveal,
    setActiveFile,
    closeTab,
    setFileContent,
    saveActiveFile,
    consumeEditorReveal,
    getActiveTab,
    rootPath,
    openDroppedPaths,
    recentProjects,
    openRecentProject,
  } = useWorkspaceStore();
  const appTheme = useChatStore((state) => state.config?.app.theme ?? "dark");
  const monacoTheme = appTheme === "light" ? "vs" : "vs-dark";

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const editorDrop = useDropZone({
    onDrop: (paths) => openDroppedPaths(paths).catch(console.error),
  });
  const activeTab = getActiveTab();
  const showingPreferences = activeFile ? isPreferencesTab(activeFile) : false;

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    if (!editorReveal || !activeFile || editorReveal.path !== activeFile) {
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;

    const line = Math.max(1, editorReveal.line);
    const column = Math.max(1, editorReveal.column ?? 1);
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column });
    editor.focus();
    consumeEditorReveal();
  }, [activeFile, activeTab?.content, consumeEditorReveal, editorReveal]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActiveFile().catch(console.error);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActiveFile]);

  if (!activeFile || !activeTab) {
    if (!rootPath) {
      return (
        <div
          className={`editor-empty editor-recent ${editorDrop.active ? "drop-active" : ""}`}
          data-zone="editor"
          onDragEnter={editorDrop.handleDragEnter}
          onDragOver={editorDrop.handleDragOver}
          onDragLeave={editorDrop.handleDragLeave}
          onDrop={editorDrop.handleDrop}
        >
          <div className="editor-recent-panel">
            <h3 className="editor-recent-title">{t("editor.recentProjects")}</h3>
            {recentProjects.length === 0 ? (
              <p className="editor-recent-empty">{t("editor.noRecentProjects")}</p>
            ) : (
              <ul className="editor-recent-list">
                {recentProjects.map((path) => (
                  <li key={path}>
                    <button
                      type="button"
                      className="editor-recent-item"
                      title={path}
                      onClick={() => openRecentProject(path).catch(console.error)}
                    >
                      <span className="editor-recent-name">{projectDisplayName(path)}</span>
                      <span className="editor-recent-path">{path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <style>{`
            .editor-empty {
              height: 100%;
              display: flex;
              align-items: center;
              justify-content: center;
              color: var(--text-muted);
            }
            .editor-empty.editor-recent {
              align-items: flex-start;
              justify-content: center;
              padding: 48px 24px;
              overflow: auto;
            }
            .editor-recent-panel {
              width: min(720px, 100%);
            }
            .editor-recent-title {
              margin: 0 0 16px;
              font-size: 18px;
              font-weight: 600;
              color: var(--text);
            }
            .editor-recent-empty {
              margin: 0;
              color: var(--text-muted);
            }
            .editor-recent-list {
              list-style: none;
              margin: 0;
              padding: 0;
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .editor-recent-item {
              width: 100%;
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              gap: 4px;
              padding: 12px 14px;
              border: 1px solid var(--border);
              border-radius: 8px;
              background: var(--bg-elevated);
              color: var(--text);
              text-align: left;
            }
            .editor-recent-item:hover {
              background: var(--bg-hover);
              border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
            }
            .editor-recent-name {
              font-size: 14px;
              font-weight: 600;
            }
            .editor-recent-path {
              font-size: 12px;
              color: var(--text-muted);
              word-break: break-all;
            }
            .editor-empty.drop-active {
              background: color-mix(in srgb, var(--accent) 8%, var(--bg-editor));
              outline: 1px dashed color-mix(in srgb, var(--accent) 55%, var(--border));
              outline-offset: -8px;
            }
          `}</style>
        </div>
      );
    }

    return (
      <div
        className={`editor-empty ${editorDrop.active ? "drop-active" : ""}`}
        data-zone="editor"
        onDragEnter={editorDrop.handleDragEnter}
        onDragOver={editorDrop.handleDragOver}
        onDragLeave={editorDrop.handleDragLeave}
        onDrop={editorDrop.handleDrop}
      >
        <p>{t("editor.empty")}</p>
        <style>{`
          .editor-empty {
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--text-muted);
          }
          .editor-empty.drop-active {
            background: color-mix(in srgb, var(--accent) 8%, var(--bg-editor));
            outline: 1px dashed color-mix(in srgb, var(--accent) 55%, var(--border));
            outline-offset: -8px;
          }
        `}</style>
      </div>
    );
  }

  const tabLabel = (path: string) => {
    if (isPreferencesTab(path)) return t("panel.preferences");
    return path.split(/[\\/]/).pop() ?? path;
  };

  return (
    <div
      className={`editor-panel ${editorDrop.active ? "drop-active" : ""}`}
      data-zone="editor"
      onDragEnter={editorDrop.handleDragEnter}
      onDragOver={editorDrop.handleDragOver}
      onDragLeave={editorDrop.handleDragLeave}
      onDrop={editorDrop.handleDrop}
    >
      <div className="editor-tabs">
        {openTabs.map((tab) => {
          const isActive = tab.path === activeFile;
          const isFileTab = !isPreferencesTab(tab.path);
          return (
            <div
              key={tab.path}
              className={`editor-tab ${isActive ? "active" : ""}`}
              data-path={tab.path}
              draggable={isFileTab}
              onDragStart={
                isFileTab
                  ? (event) => startFileDrag(event, tab.path, rootPath)
                  : undefined
              }
              onClick={() => setActiveFile(tab.path)}
            >
              <span className="editor-tab-name">
                {tabLabel(tab.path)}
                {tab.dirty && <span className="dirty-dot">●</span>}
              </span>
              <button
                type="button"
                className="editor-tab-close"
                title={t("editor.close")}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.path);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div className="editor-body">
        {showingPreferences ? (
          <PreferencesPanel />
        ) : (
          <Editor
            key={activeFile}
            height="100%"
            language={languageFromPath(activeFile)}
            theme={monacoTheme}
            value={activeTab.content}
            onMount={handleEditorMount}
            onChange={(value) => setFileContent(value ?? "")}
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              fontFamily: "Cascadia Code, Consolas, Monaco, monospace",
              wordWrap: "on",
              automaticLayout: true,
              contextmenu: false,
            }}
          />
        )}
      </div>
      <style>{`
        .editor-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-editor);
        }
        .editor-panel.drop-active .editor-body {
          background: color-mix(in srgb, var(--accent) 6%, var(--bg-editor));
          outline: 1px dashed color-mix(in srgb, var(--accent) 55%, var(--border));
          outline-offset: -4px;
        }
        .editor-tabs {
          display: flex;
          align-items: stretch;
          height: 36px;
          overflow-x: auto;
          border-bottom: 1px solid var(--border);
          background: var(--bg-sidebar);
        }
        .editor-tab {
          display: flex;
          align-items: center;
          gap: 4px;
          max-width: 220px;
          padding: 0 4px 0 12px;
          border-right: 1px solid var(--border);
          background: transparent;
          cursor: grab;
          flex-shrink: 0;
        }
        .editor-tab:active {
          cursor: grabbing;
        }
        .editor-tab.active {
          background: var(--bg-editor);
          border-top: 2px solid var(--accent);
        }
        .editor-tab-name {
          display: flex;
          align-items: center;
          gap: 6px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
        }
        .dirty-dot {
          color: var(--warning);
          font-size: 10px;
        }
        .editor-tab-close {
          width: 20px;
          height: 20px;
          padding: 0;
          border: none;
          background: transparent;
          border-radius: 4px;
          font-size: 14px;
          line-height: 1;
          flex-shrink: 0;
        }
        .editor-tab-close:hover {
          background: var(--bg-hover);
        }
        .editor-body {
          flex: 1;
          min-height: 0;
        }
      `}</style>
    </div>
  );
}
