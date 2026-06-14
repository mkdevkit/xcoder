import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { isTauri, tauriInvoke } from "../utils/tauri";
import { safeConfirm, safePickDirectory } from "../utils/tauriDialog";
import {
  parseFileLinkText,
  resolveTerminalFilePath,
} from "../utils/terminalFileLinks";
import { parentPath } from "../utils/path";
import { resolveDroppedOpenPath } from "../utils/externalFileDrop";
import { PREFERENCES_TAB_PATH } from "../utils/virtualTabs";
import type { FsEntry } from "../types/fs";

export interface EditorTab {
  path: string;
  content: string;
  dirty: boolean;
  kind?: "file" | "preferences";
}

export interface EditorRevealTarget {
  path: string;
  line: number;
  column?: number;
}

export interface ExplorerEditState {
  mode: "rename" | "create";
  targetPath?: string;
  parentDir: string;
  isDir: boolean;
  initialName: string;
}

interface WorkspaceState {
  rootPath: string | null;
  openTabs: EditorTab[];
  activeFile: string | null;
  editorReveal: EditorRevealTarget | null;
  explorerRefreshKey: number;
  explorerSelectedPath: string | null;
  explorerSelectedIsDir: boolean | null;
  explorerEdit: ExplorerEditState | null;
  explorerError: string | null;
  bumpExplorerRefresh: () => void;
  setExplorerSelectedPath: (path: string | null, isDir?: boolean) => void;
  beginExplorerRename: (path: string) => void;
  beginExplorerCreate: (parentDir: string, isDir: boolean) => void;
  cancelExplorerEdit: () => void;
  commitExplorerEdit: (name: string) => Promise<void>;
  deleteExplorerEntry: (path: string, isDir?: boolean) => Promise<void>;
  getExplorerParentDir: (path?: string | null, isDir?: boolean) => string | null;
  openFolder: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  openPreferencesTab: () => void;
  openFileAtLocation: (linkText: string) => Promise<void>;
  consumeEditorReveal: () => void;
  closeTab: (path: string) => void;
  setActiveFile: (path: string) => void;
  setFileContent: (content: string) => void;
  reloadActiveFile: () => Promise<void>;
  saveActiveFile: () => Promise<void>;
  listDirectory: (path: string) => Promise<FsEntry[]>;
  importPathsIntoExplorer: (
    targetDir: string,
    sources: string[],
  ) => Promise<string[]>;
  openDroppedPaths: (paths: string[]) => Promise<void>;
  startWorkspaceWatch: (path: string) => Promise<void>;
  stopWorkspaceWatch: () => Promise<void>;
  setupWorkspaceListener: () => Promise<() => void>;
  getActiveTab: () => EditorTab | null;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function syncActiveTab(
  tabs: EditorTab[],
  activeFile: string | null,
): EditorTab | null {
  if (!activeFile) return null;
  return tabs.find((tab) => tab.path === activeFile) ?? null;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  openTabs: [],
  activeFile: null,
  editorReveal: null,
  explorerRefreshKey: 0,
  explorerSelectedPath: null,
  explorerSelectedIsDir: null,
  explorerEdit: null,
  explorerError: null,

  getActiveTab: () => syncActiveTab(get().openTabs, get().activeFile),

  bumpExplorerRefresh: () =>
    set((state) => ({ explorerRefreshKey: state.explorerRefreshKey + 1 })),

  setExplorerSelectedPath: (path, isDir) =>
    set({
      explorerSelectedPath: path,
      explorerSelectedIsDir: isDir ?? null,
    }),

  getExplorerParentDir: (path, isDir) => {
    const { rootPath, explorerSelectedPath } = get();
    if (!rootPath) return null;
    const target = path ?? explorerSelectedPath;
    if (!target) return rootPath;
    if (isDir) return target;
    return parentPath(target);
  },

  beginExplorerRename: (path) => {
    set({
      explorerSelectedPath: path,
      explorerEdit: {
        mode: "rename",
        targetPath: path,
        parentDir: parentPath(path),
        isDir: false,
        initialName: fileName(path),
      },
      explorerError: null,
    });
  },

  beginExplorerCreate: (parentDir, isDir) => {
    set({
      explorerEdit: {
        mode: "create",
        parentDir,
        isDir,
        initialName: isDir ? "新建文件夹" : "新建文件.txt",
      },
      explorerError: null,
    });
  },

  cancelExplorerEdit: () => set({ explorerEdit: null, explorerError: null }),

  commitExplorerEdit: async (name) => {
    const { explorerEdit } = get();
    if (!explorerEdit) return;

    const trimmed = name.trim();
    if (!trimmed) {
      set({ explorerError: "名称不能为空" });
      return;
    }

    try {
      if (explorerEdit.mode === "rename" && explorerEdit.targetPath) {
        if (trimmed === explorerEdit.initialName) {
          set({ explorerEdit: null, explorerError: null });
          return;
        }

        const newPath = await tauriInvoke<string>("rename_path", {
          path: explorerEdit.targetPath,
          newName: trimmed,
        });
        set((state) => ({
          explorerEdit: null,
          explorerError: null,
          explorerSelectedPath: newPath,
          openTabs: state.openTabs.map((tab) =>
            tab.path === explorerEdit.targetPath
              ? { ...tab, path: newPath }
              : tab,
          ),
          activeFile:
            state.activeFile === explorerEdit.targetPath
              ? newPath
              : state.activeFile,
          explorerRefreshKey: state.explorerRefreshKey + 1,
        }));
        return;
      }

      if (explorerEdit.mode === "create") {
        const newPath = await tauriInvoke<string>("create_path", {
          parent: explorerEdit.parentDir,
          name: trimmed,
          isDir: explorerEdit.isDir,
        });
        set((state) => ({
          explorerEdit: null,
          explorerError: null,
          explorerSelectedPath: newPath,
          explorerRefreshKey: state.explorerRefreshKey + 1,
        }));
        if (!explorerEdit.isDir) {
          await get().openFile(newPath);
        }
      }
    } catch (error) {
      set({ explorerError: String(error) });
    }
  },

  deleteExplorerEntry: async (path, isDir) => {
    const state = get();
    const resolvedIsDir =
      isDir ??
      (state.explorerSelectedPath === path
        ? (state.explorerSelectedIsDir ?? false)
        : false);
    const label = fileName(path);
    const kind = resolvedIsDir ? "文件夹" : "文件";
    const message = `确定删除${kind}「${label}」吗？此操作不可撤销。`;
    const confirmed = await safeConfirm(message, {
      title: "确认删除",
      kind: "warning",
      okLabel: "删除",
      cancelLabel: "取消",
    });
    if (!confirmed) return;

    try {
      await tauriInvoke("delete_path", { path });
      set((state) => {
        const openTabs = state.openTabs.filter((tab) => tab.path !== path);
        let activeFile = state.activeFile;
        if (activeFile === path) {
          activeFile = openTabs[openTabs.length - 1]?.path ?? null;
        }
        return {
          openTabs,
          activeFile,
          explorerSelectedPath:
            state.explorerSelectedPath === path
              ? null
              : state.explorerSelectedPath,
          explorerEdit:
            state.explorerEdit?.targetPath === path ? null : state.explorerEdit,
          explorerError: null,
          explorerRefreshKey: state.explorerRefreshKey + 1,
        };
      });
    } catch (error) {
      set({ explorerError: String(error) });
    }
  },

  openFolder: async () => {
    const selected = await safePickDirectory();
    if (!selected) return;

    await get().stopWorkspaceWatch();
    set({
      rootPath: selected,
      openTabs: [],
      activeFile: null,
      editorReveal: null,
      explorerRefreshKey: get().explorerRefreshKey + 1,
    });
    await get().startWorkspaceWatch(selected);
    const { useChatStore } = await import("./chat");
    void useChatStore.getState().onProjectOpened(selected);
  },

  openFile: async (path) => {
    const existing = get().openTabs.find((tab) => tab.path === path);
    if (existing) {
      set({ activeFile: path });
      return;
    }

    const content = await tauriInvoke<string>("read_file", { path });
    const tab: EditorTab = { path, content, dirty: false, kind: "file" };
    set((state) => ({
      openTabs: [...state.openTabs, tab],
      activeFile: path,
    }));
  },

  openPreferencesTab: () => {
    const path = PREFERENCES_TAB_PATH;
    const existing = get().openTabs.find((tab) => tab.path === path);
    if (existing) {
      set({ activeFile: path });
      return;
    }

    const tab: EditorTab = {
      path,
      content: "",
      dirty: false,
      kind: "preferences",
    };
    set((state) => ({
      openTabs: [...state.openTabs, tab],
      activeFile: path,
    }));
  },

  openFileAtLocation: async (linkText) => {
    const parsed = parseFileLinkText(linkText);
    if (!parsed) return;

    const path = await resolveTerminalFilePath(
      parsed.filePath,
      get().rootPath,
      (target) => tauriInvoke<string>("read_file", { path: target }),
    );
    if (!path) return;

    await get().openFile(path);
    if (parsed.line) {
      set({
        editorReveal: {
          path,
          line: parsed.line,
          column: parsed.column,
        },
      });
    }
  },

  consumeEditorReveal: () => set({ editorReveal: null }),

  closeTab: (path) => {
    set((state) => {
      const index = state.openTabs.findIndex((tab) => tab.path === path);
      if (index < 0) return state;

      const openTabs = state.openTabs.filter((tab) => tab.path !== path);
      let activeFile = state.activeFile;

      if (state.activeFile === path) {
        const nextTab = openTabs[index] ?? openTabs[index - 1] ?? null;
        activeFile = nextTab?.path ?? null;
      }

      return { openTabs, activeFile };
    });
  },

  setActiveFile: (path) => {
    if (get().openTabs.some((tab) => tab.path === path)) {
      set({ activeFile: path });
    }
  },

  setFileContent: (content) => {
    const { activeFile } = get();
    if (!activeFile) return;
    const activeTab = get().openTabs.find((tab) => tab.path === activeFile);
    if (activeTab?.kind && activeTab.kind !== "file") return;

    set((state) => ({
      openTabs: state.openTabs.map((tab) =>
        tab.path === activeFile ? { ...tab, content, dirty: true } : tab,
      ),
    }));
  },

  reloadActiveFile: async () => {
    const { activeFile } = get();
    if (!activeFile) return;
    const activeTab = get().openTabs.find((tab) => tab.path === activeFile);
    if (activeTab?.kind && activeTab.kind !== "file") return;

    const content = await tauriInvoke<string>("read_file", { path: activeFile });
    set((state) => ({
      openTabs: state.openTabs.map((tab) =>
        tab.path === activeFile ? { ...tab, content, dirty: false } : tab,
      ),
    }));
  },

  saveActiveFile: async () => {
    const tab = get().getActiveTab();
    if (!tab || (tab.kind && tab.kind !== "file")) return;

    await tauriInvoke("write_file", { path: tab.path, content: tab.content });
    set((state) => ({
      openTabs: state.openTabs.map((item) =>
        item.path === tab.path ? { ...item, dirty: false } : item,
      ),
    }));
  },

  listDirectory: async (path) => {
    return tauriInvoke<FsEntry[]>("list_directory", { path });
  },

  importPathsIntoExplorer: async (targetDir, sources) => {
    const uniqueSources = Array.from(new Set(sources.map((item) => item.trim()))).filter(
      (item) => item.length > 0,
    );
    if (uniqueSources.length === 0) return [];

    try {
      const copied = await tauriInvoke<string[]>("copy_paths_into_directory", {
        sources: uniqueSources,
        destinationDir: targetDir,
      });
      set((state) => ({
        explorerError: null,
        explorerRefreshKey: state.explorerRefreshKey + 1,
        explorerSelectedPath: copied[copied.length - 1] ?? state.explorerSelectedPath,
      }));
      return copied;
    } catch (error) {
      set({ explorerError: String(error) });
      throw error;
    }
  },

  openDroppedPaths: async (paths) => {
    const { rootPath } = get();

    for (const raw of paths) {
      const path = resolveDroppedOpenPath(raw, rootPath);
      if (!path) continue;
      try {
        await get().openFile(path);
      } catch {
        // skip folders or unreadable paths
      }
    }
  },

  startWorkspaceWatch: async (path) => {
    if (!isTauri()) return;
    await tauriInvoke("start_workspace_watch", { path });
  },

  stopWorkspaceWatch: async () => {
    if (!isTauri()) return;
    await tauriInvoke("stop_workspace_watch");
  },

  setupWorkspaceListener: async () => {
    if (!isTauri()) {
      return () => {};
    }

    const unlisten = await listen("workspace-changed", (event) => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        get().bumpExplorerRefresh();

        const changedPaths = (event.payload as { paths?: string[] })?.paths ?? [];
        set((state) => ({
          openTabs: state.openTabs.map((tab) => {
            const changed = changedPaths.some(
              (p) => p === tab.path || p.endsWith(fileName(tab.path)),
            );
            if (!changed || tab.dirty || tab.path !== state.activeFile) {
              return tab;
            }
            return tab;
          }),
        }));

        const { activeFile } = get();
        const activeTab = get().getActiveTab();
        if (activeFile && activeTab && !activeTab.dirty) {
          get()
            .reloadActiveFile()
            .catch(() => undefined);
        }
      }, 250);
    });

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      unlisten();
    };
  },
}));
