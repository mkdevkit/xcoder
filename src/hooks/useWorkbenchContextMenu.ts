import { useCallback, useEffect } from "react";
import { useContextMenu } from "../components/ContextMenuProvider";
import { useTranslation } from "../i18n";
import { useTerminalStore } from "../stores/terminal";
import { useWorkspaceStore } from "../stores/workspace";
import type { ContextMenuItem } from "../types/contextMenu";
import { getTerminalSelection } from "../utils/terminalRegistry";
import { workspacesMatch } from "../utils/path";
import { tauriInvoke } from "../utils/tauri";

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore clipboard failures
  }
}

function revealInSystemExplorer(path: string) {
  tauriInvoke("reveal_path_in_explorer", { path }).catch(console.error);
}

function openDirectoryInSystemExplorer(path: string) {
  tauriInvoke("open_directory_in_explorer", { path }).catch(console.error);
}

export function useWorkbenchContextMenu() {
  const { showMenu, setMenuHandler } = useContextMenu();
  const {
    rootPath,
    activeFile,
    bumpExplorerRefresh,
    saveActiveFile,
    reloadActiveFile,
    closeTab,
    getActiveTab,
    explorerSelectedPath,
    explorerSelectedPaths,
    setExplorerSelectedPath,
    beginExplorerRename,
    beginExplorerCreate,
    deleteExplorerEntry,
    deleteExplorerEntries,
    getExplorerParentDir,
  } = useWorkspaceStore();
  const { createTerminal, activeId } = useTerminalStore();
  const { t } = useTranslation();

  const buildMenu = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const items: ContextMenuItem[] = [];
      const activeTab = getActiveTab();

      if (target.closest(".file-explorer")) {
        const row = target.closest(".tree-item") as HTMLElement | null;
        const filePath = row?.dataset.path;
        const isDir = row?.dataset.isDir === "1";
        const parentDir = filePath
          ? getExplorerParentDir(filePath, isDir)
          : rootPath;

        items.push(
          {
            id: "explorer-new-file",
            label: t("context.newFile"),
            disabled: !parentDir,
            onClick: () => {
              if (parentDir) beginExplorerCreate(parentDir, false);
            },
          },
          {
            id: "explorer-new-folder",
            label: t("context.newFolder"),
            disabled: !parentDir,
            onClick: () => {
              if (parentDir) beginExplorerCreate(parentDir, true);
            },
          },
          {
            id: "explorer-refresh",
            label: t("context.refresh"),
            onClick: () => bumpExplorerRefresh(),
          },
          {
            id: "explorer-open-folder",
            label: t("context.openProjectFolder"),
            disabled: !rootPath,
            onClick: () => {
              if (rootPath) openDirectoryInSystemExplorer(rootPath);
            },
          },
        );

        const workspaceState = useWorkspaceStore.getState();
        let menuPaths = workspaceState.explorerSelectedPaths;
        if (filePath) {
          const inSelection = menuPaths.some((path) =>
            workspacesMatch(path, filePath),
          );
          if (!inSelection) {
            workspaceState.setExplorerSelectedPath(filePath, isDir);
            menuPaths = [filePath];
          }
        } else {
          menuPaths = workspaceState.explorerSelectedPaths;
        }
        const multiSelected = menuPaths.length > 1;
        const primaryPath = menuPaths[menuPaths.length - 1] ?? filePath ?? explorerSelectedPath;

        if (filePath || menuPaths.length > 0) {
          items.push(
            {
              id: "explorer-rename",
              label: t("context.rename"),
              disabled: multiSelected || !primaryPath,
              onClick: () => {
                if (primaryPath) beginExplorerRename(primaryPath);
              },
            },
            {
              id: "explorer-delete",
              label: t("context.delete"),
              disabled: menuPaths.length === 0,
              onClick: () => {
                if (menuPaths.length === 1) {
                  const path = menuPaths[0];
                  const resolvedIsDir =
                    workspaceState.explorerPathIsDir[path] ??
                    (filePath && workspacesMatch(path, filePath) ? isDir : undefined);
                  deleteExplorerEntry(path, resolvedIsDir).catch(console.error);
                  return;
                }
                deleteExplorerEntries(menuPaths).catch(console.error);
              },
            },
            {
              id: "explorer-copy-path",
              label: t("context.copyPath"),
              disabled: !primaryPath,
              onClick: () => {
                if (primaryPath) copyText(primaryPath);
              },
            },
            {
              id: "explorer-reveal",
              label: t("context.revealInExplorer"),
              disabled: multiSelected || !primaryPath,
              onClick: () => {
                if (primaryPath) revealInSystemExplorer(primaryPath);
              },
            },
          );
        }
      } else if (target.closest(".editor-panel")) {
        items.push(
          {
            id: "editor-save",
            label: t("context.save"),
            disabled: !activeFile || !activeTab?.dirty,
            onClick: () => saveActiveFile(),
          },
          {
            id: "editor-reload",
            label: t("context.reload"),
            disabled: !activeFile,
            onClick: () => reloadActiveFile(),
          },
        );

        const tabClose = target.closest(".editor-tab-close") as HTMLElement | null;
        if (tabClose) {
          return;
        }

        const tabItem = target.closest(".editor-tab") as HTMLElement | null;
        const tabPath = tabItem?.dataset.path;
        if (tabPath) {
          items.push({
            id: "editor-reveal-in-explorer",
            label: t("context.revealInExplorer"),
            onClick: () => revealInSystemExplorer(tabPath),
          });
          items.push({
            id: "editor-close-tab",
            label: t("context.closeTab"),
            onClick: () => closeTab(tabPath),
          });
        }
      } else if (target.closest(".terminal-panel")) {
        const inTerminalViewport = target.closest(".terminal-viewport");
        if (inTerminalViewport) {
          const selection = getTerminalSelection(activeId);
          if (selection) {
            items.push({
              id: "terminal-copy",
              label: t("context.copy"),
              onClick: () => copyText(selection),
            });
          }
        }

        items.push({
          id: "terminal-new",
          label: t("context.newTerminal"),
          onClick: () => createTerminal(rootPath ?? undefined),
        });
      } else {
        items.push(
          {
            id: "general-open-folder",
            label: t("context.openProjectFolder"),
            disabled: !rootPath,
            onClick: () => {
              if (rootPath) openDirectoryInSystemExplorer(rootPath);
            },
          },
          {
            id: "general-new-terminal",
            label: t("context.newTerminal"),
            onClick: () => createTerminal(rootPath ?? undefined),
          },
        );
      }

      if (rootPath) {
        items.push({
          id: "copy-workspace",
          label: t("context.copyWorkspacePath"),
          onClick: () => copyText(rootPath),
        });
      }

      showMenu(event.clientX, event.clientY, items);
    },
    [
      activeFile,
      activeId,
      beginExplorerCreate,
      beginExplorerRename,
      bumpExplorerRefresh,
      closeTab,
      createTerminal,
      deleteExplorerEntry,
      deleteExplorerEntries,
      explorerSelectedPath,
      explorerSelectedPaths,
      setExplorerSelectedPath,
      getActiveTab,
      getExplorerParentDir,
      reloadActiveFile,
      rootPath,
      saveActiveFile,
      showMenu,
      t,
    ],
  );

  useEffect(() => {
    setMenuHandler(buildMenu);
    return () => setMenuHandler(null);
  }, [buildMenu, setMenuHandler]);
}
