import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { isTauri, tauriInvoke } from "../utils/tauri";
import { t } from "../i18n";
import { safeConfirm, safePickDirectory } from "../utils/tauriDialog";
import {
  parseFileLinkText,
  resolveTerminalFilePath,
} from "../utils/terminalFileLinks";
import {
  parentPath,
  resolveFilePathInWorkspace,
  workspacesMatch,
} from "../utils/path";
import { resolveDroppedOpenPath } from "../utils/externalFileDrop";
import { PREFERENCES_TAB_PATH } from "../utils/virtualTabs";
import type { FsEntry } from "../types/fs";
import type { ProjectConfig, ProjectConfigInfo } from "../types/projectConfig";

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
  projectConfig: ProjectConfig | null;
  projectConfigPath: string | null;
  openTabs: EditorTab[];
  activeFile: string | null;
  editorReveal: EditorRevealTarget | null;
  explorerRefreshKey: number;
  explorerSelectedPath: string | null;
  explorerSelectedIsDir: boolean | null;
  explorerSelectedPaths: string[];
  explorerPathIsDir: Record<string, boolean>;
  explorerSelectionAnchor: string | null;
  explorerEdit: ExplorerEditState | null;
  explorerError: string | null;
  bumpExplorerRefresh: () => void;
  setExplorerSelectedPath: (path: string | null, isDir?: boolean) => void;
  selectExplorerEntry: (
    path: string,
    isDir: boolean,
    options?: { additive?: boolean },
  ) => void;
  selectExplorerRange: (targetPath: string, siblings: FsEntry[]) => void;
  isExplorerPathSelected: (path: string) => boolean;
  getExplorerSelectedPaths: () => string[];
  beginExplorerRename: (path: string) => void;
  beginExplorerCreate: (parentDir: string, isDir: boolean) => void;
  cancelExplorerEdit: () => void;
  commitExplorerEdit: (name: string) => Promise<void>;
  deleteExplorerEntry: (path: string, isDir?: boolean) => Promise<void>;
  deleteExplorerEntries: (paths: string[], isDirHint?: boolean) => Promise<void>;
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
  reloadOpenFilesIfClean: (paths: string[]) => void;
  saveActiveFile: () => Promise<void>;
  listDirectory: (path: string) => Promise<FsEntry[]>;
  importPathsIntoExplorer: (
    targetDir: string,
    sources: string[],
  ) => Promise<string[]>;
  movePathsInExplorer: (
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
let reloadOpenFilesTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReloadPaths: string[] = [];

function pathMatchesOpenTab(changedPath: string, tabPath: string, rootPath: string | null) {
  const candidates = new Set<string>([
    changedPath,
    resolveFilePathInWorkspace(changedPath, rootPath),
  ]);
  return Array.from(candidates).some((candidate) =>
    workspacesMatch(candidate, tabPath),
  );
}

async function flushReloadOpenFilesIfClean(
  get: () => WorkspaceState,
  set: (
    partial:
      | Partial<WorkspaceState>
      | ((state: WorkspaceState) => Partial<WorkspaceState>),
  ) => void,
) {
  const paths = pendingReloadPaths;
  pendingReloadPaths = [];
  if (paths.length === 0) return;

  const { openTabs, rootPath } = get();
  const tabsToReload = openTabs.filter(
    (tab) =>
      (!tab.kind || tab.kind === "file") &&
      !tab.dirty &&
      paths.some((changedPath) => pathMatchesOpenTab(changedPath, tab.path, rootPath)),
  );
  if (tabsToReload.length === 0) return;

  const updates = await Promise.all(
    tabsToReload.map(async (tab) => {
      try {
        const content = await tauriInvoke<string>("read_file", { path: tab.path });
        return { path: tab.path, content };
      } catch {
        return null;
      }
    }),
  );

  const updatedPaths = new Set(
    updates
      .filter((item): item is { path: string; content: string } => item !== null)
      .map((item) => item.path),
  );
  if (updatedPaths.size === 0) return;

  set((state) => ({
    openTabs: state.openTabs.map((tab) => {
      if (tab.dirty) return tab;
      const update = updates.find(
        (item) => item && workspacesMatch(item.path, tab.path),
      );
      if (!update) return tab;
      return { ...tab, content: update.content, dirty: false };
    }),
  }));
}

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

function remapPath(
  current: string | null,
  sources: string[],
  destinations: string[],
): string | null {
  if (!current) return current;
  for (let i = 0; i < sources.length; i += 1) {
    if (workspacesMatch(current, sources[i])) {
      return destinations[i] ?? current;
    }
  }
  return current;
}

function findSelectedIndex(paths: string[], target: string): number {
  return paths.findIndex((path) => workspacesMatch(path, target));
}

function buildExplorerSelection(
  paths: string[],
  isDirMap: Record<string, boolean>,
): Pick<
  WorkspaceState,
  | "explorerSelectedPaths"
  | "explorerPathIsDir"
  | "explorerSelectedPath"
  | "explorerSelectedIsDir"
> {
  const uniquePaths = paths.filter((path, index) => {
    return paths.findIndex((item) => workspacesMatch(item, path)) === index;
  });
  const primary = uniquePaths[uniquePaths.length - 1] ?? null;
  return {
    explorerSelectedPaths: uniquePaths,
    explorerPathIsDir: isDirMap,
    explorerSelectedPath: primary,
    explorerSelectedIsDir: primary ? (isDirMap[primary] ?? null) : null,
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rootPath: null,
  projectConfig: null,
  projectConfigPath: null,
  openTabs: [],
  activeFile: null,
  editorReveal: null,
  explorerRefreshKey: 0,
  explorerSelectedPath: null,
  explorerSelectedIsDir: null,
  explorerSelectedPaths: [],
  explorerPathIsDir: {},
  explorerSelectionAnchor: null,
  explorerEdit: null,
  explorerError: null,

  getActiveTab: () => syncActiveTab(get().openTabs, get().activeFile),

  bumpExplorerRefresh: () =>
    set((state) => ({ explorerRefreshKey: state.explorerRefreshKey + 1 })),

  setExplorerSelectedPath: (path, isDir) => {
    if (!path) {
      set({
        explorerSelectedPath: null,
        explorerSelectedIsDir: null,
        explorerSelectedPaths: [],
        explorerPathIsDir: {},
        explorerSelectionAnchor: null,
      });
      return;
    }
    set({
      explorerSelectionAnchor: path,
      ...buildExplorerSelection([path], {
        [path]: isDir ?? false,
      }),
    });
  },

  selectExplorerEntry: (path, isDir, options = {}) => {
    const { additive = false } = options;
    const { explorerSelectedPaths, explorerPathIsDir } = get();

    if (!additive) {
      set({
        explorerSelectionAnchor: path,
        ...buildExplorerSelection([path], { [path]: isDir }),
      });
      return;
    }

    const existingIndex = findSelectedIndex(explorerSelectedPaths, path);
    if (existingIndex >= 0) {
      const nextPaths = explorerSelectedPaths.filter((_, index) => index !== existingIndex);
      const nextMap = { ...explorerPathIsDir };
      for (const key of Object.keys(nextMap)) {
        if (workspacesMatch(key, path)) {
          delete nextMap[key];
        }
      }
      if (nextPaths.length === 0) {
        set({
          explorerSelectedPath: null,
          explorerSelectedIsDir: null,
          explorerSelectedPaths: [],
          explorerPathIsDir: {},
          explorerSelectionAnchor: null,
        });
        return;
      }
      set(buildExplorerSelection(nextPaths, nextMap));
      return;
    }

    set(
      buildExplorerSelection(
        [...explorerSelectedPaths, path],
        { ...explorerPathIsDir, [path]: isDir },
      ),
    );
  },

  selectExplorerRange: (targetPath, siblings) => {
    const state = get();
    const anchor = state.explorerSelectionAnchor ?? state.explorerSelectedPath;
    const targetEntry = siblings.find((entry) =>
      workspacesMatch(entry.path, targetPath),
    );
    if (!targetEntry) return;

    const selectSingle = () => {
      set({
        explorerSelectionAnchor: targetPath,
        ...buildExplorerSelection([targetPath], {
          [targetPath]: targetEntry.is_dir,
        }),
      });
    };

    if (!anchor) {
      selectSingle();
      return;
    }

    const anchorParent = parentPath(anchor);
    const targetParent = parentPath(targetPath);
    if (!workspacesMatch(anchorParent, targetParent)) {
      selectSingle();
      return;
    }

    const anchorIndex = siblings.findIndex((entry) =>
      workspacesMatch(entry.path, anchor),
    );
    const targetIndex = siblings.findIndex((entry) =>
      workspacesMatch(entry.path, targetPath),
    );
    if (anchorIndex < 0 || targetIndex < 0) {
      selectSingle();
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const range = siblings.slice(start, end + 1);
    const isDirMap: Record<string, boolean> = { ...state.explorerPathIsDir };
    for (const entry of range) {
      isDirMap[entry.path] = entry.is_dir;
    }

    set({
      explorerSelectionAnchor: anchor,
      ...buildExplorerSelection(
        range.map((entry) => entry.path),
        isDirMap,
      ),
    });
  },

  isExplorerPathSelected: (path) =>
    findSelectedIndex(get().explorerSelectedPaths, path) >= 0,

  getExplorerSelectedPaths: () => get().explorerSelectedPaths,

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
      ...buildExplorerSelection([path], { [path]: false }),
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
        initialName: isDir ? t("explorer.newFolderName") : t("explorer.newFileName"),
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
      set({ explorerError: t("error.nameRequired") });
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
          ...buildExplorerSelection([newPath], { [newPath]: false }),
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
          ...buildExplorerSelection([newPath], {
            [newPath]: explorerEdit.isDir,
          }),
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
    await get().deleteExplorerEntries([path], isDir);
  },

  deleteExplorerEntries: async (paths, isDirHint) => {
    const state = get();
    const uniquePaths = paths.filter((path, index, array) => {
      const trimmed = path.trim();
      if (!trimmed) return false;
      return array.findIndex((item) => workspacesMatch(item, trimmed)) === index;
    });
    if (uniquePaths.length === 0) return;

    if (uniquePaths.length === 1) {
      const path = uniquePaths[0];
      const resolvedIsDir =
        isDirHint ??
        state.explorerPathIsDir[path] ??
        (state.explorerSelectedPath && workspacesMatch(state.explorerSelectedPath, path)
          ? (state.explorerSelectedIsDir ?? false)
          : false);
      const label = fileName(path);
      const kind = resolvedIsDir
        ? t("explorer.deleteKind.folder")
        : t("explorer.deleteKind.file");
      const message = t("explorer.deleteConfirm", { kind, label });
      const confirmed = await safeConfirm(message, {
        title: t("dialog.confirmDelete"),
        kind: "warning",
        okLabel: t("dialog.delete"),
        cancelLabel: t("dialog.cancel"),
      });
      if (!confirmed) return;

      try {
        await tauriInvoke("delete_path", { path });
        set((state) => {
          const openTabs = state.openTabs.filter((tab) => !workspacesMatch(tab.path, path));
          let activeFile = state.activeFile;
          if (activeFile && workspacesMatch(activeFile, path)) {
            activeFile = openTabs[openTabs.length - 1]?.path ?? null;
          }
          const nextSelectedPaths = state.explorerSelectedPaths.filter(
            (item) => !workspacesMatch(item, path),
          );
          const nextMap = { ...state.explorerPathIsDir };
          for (const key of Object.keys(nextMap)) {
            if (workspacesMatch(key, path)) {
              delete nextMap[key];
            }
          }
          return {
            openTabs,
            activeFile,
            ...buildExplorerSelection(nextSelectedPaths, nextMap),
            explorerEdit:
              state.explorerEdit?.targetPath &&
              workspacesMatch(state.explorerEdit.targetPath, path)
                ? null
                : state.explorerEdit,
            explorerError: null,
            explorerRefreshKey: state.explorerRefreshKey + 1,
          };
        });
      } catch (error) {
        set({ explorerError: String(error) });
      }
      return;
    }

    const message = t("explorer.deleteConfirmMultiple", {
      count: String(uniquePaths.length),
    });
    const confirmed = await safeConfirm(message, {
      title: t("dialog.confirmDelete"),
      kind: "warning",
      okLabel: t("dialog.delete"),
      cancelLabel: t("dialog.cancel"),
    });
    if (!confirmed) return;

    try {
      for (const path of uniquePaths) {
        await tauriInvoke("delete_path", { path });
      }
      set((state) => {
        const openTabs = state.openTabs.filter(
          (tab) => !uniquePaths.some((path) => workspacesMatch(tab.path, path)),
        );
        let activeFile = state.activeFile;
        const currentActive = state.activeFile;
        const deletedActive =
          currentActive !== null &&
          uniquePaths.some((path) => workspacesMatch(currentActive, path));
        if (deletedActive) {
          activeFile = openTabs[openTabs.length - 1]?.path ?? null;
        }
        const nextSelectedPaths = state.explorerSelectedPaths.filter(
          (item) => !uniquePaths.some((path) => workspacesMatch(item, path)),
        );
        const nextMap = { ...state.explorerPathIsDir };
        for (const key of Object.keys(nextMap)) {
          if (uniquePaths.some((path) => workspacesMatch(key, path))) {
            delete nextMap[key];
          }
        }
        const clearedEdit =
          state.explorerEdit?.targetPath &&
          uniquePaths.some((path) =>
            workspacesMatch(state.explorerEdit?.targetPath ?? "", path),
          )
            ? null
            : state.explorerEdit;
        return {
          openTabs,
          activeFile,
          ...buildExplorerSelection(nextSelectedPaths, nextMap),
          explorerEdit: clearedEdit,
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

    const { useChatStore } = await import("./chat");
    const chat = useChatStore.getState();
    if (!chat.config) {
      await chat.loadConfig();
    }
    if (get().rootPath) {
      await chat.disconnectRuntime();
    }

    await get().stopWorkspaceWatch();
    set({
      rootPath: selected,
      projectConfig: null,
      projectConfigPath: null,
      openTabs: [],
      activeFile: null,
      editorReveal: null,
      explorerRefreshKey: get().explorerRefreshKey + 1,
    });
    await get().startWorkspaceWatch(selected);

    const projectInfo = await tauriInvoke<ProjectConfigInfo>(
      "ensure_project_config_cmd",
      { workspace: selected },
    );
    set({
      projectConfig: projectInfo.config,
      projectConfigPath: projectInfo.path,
    });

    await chat.onProjectOpened(selected, projectInfo.config);
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
    get().reloadOpenFilesIfClean([activeFile]);
  },

  reloadOpenFilesIfClean: (paths) => {
    const normalized = paths.map((path) => path.trim()).filter((path) => path.length > 0);
    if (normalized.length === 0) return;

    pendingReloadPaths.push(...normalized);
    if (reloadOpenFilesTimer) {
      clearTimeout(reloadOpenFilesTimer);
    }
    reloadOpenFilesTimer = setTimeout(() => {
      reloadOpenFilesTimer = null;
      void flushReloadOpenFilesIfClean(get, set);
    }, 200);
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

  movePathsInExplorer: async (targetDir, sources) => {
    const uniqueSources = Array.from(new Set(sources.map((item) => item.trim()))).filter(
      (item) => item.length > 0,
    );
    if (uniqueSources.length === 0) return [];

    try {
      const moved = await tauriInvoke<string[]>("move_paths_into_directory", {
        sources: uniqueSources,
        destinationDir: targetDir,
      });
      set((state) => {
        const nextPaths: string[] = [];
        const nextMap: Record<string, boolean> = {};
        for (const oldPath of state.explorerSelectedPaths) {
          const newPath = remapPath(oldPath, uniqueSources, moved) ?? oldPath;
          if (!nextPaths.some((item) => workspacesMatch(item, newPath))) {
            nextPaths.push(newPath);
          }
          nextMap[newPath] = state.explorerPathIsDir[oldPath] ?? false;
        }
        return {
          explorerError: null,
          explorerRefreshKey: state.explorerRefreshKey + 1,
          ...buildExplorerSelection(nextPaths, nextMap),
          activeFile: remapPath(state.activeFile, uniqueSources, moved),
          openTabs: state.openTabs.map((tab) => {
            const nextPath = remapPath(tab.path, uniqueSources, moved);
            return nextPath && !workspacesMatch(nextPath, tab.path)
              ? { ...tab, path: nextPath }
              : tab;
          }),
        };
      });
      return moved;
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
        if (changedPaths.length > 0) {
          get().reloadOpenFilesIfClean(changedPaths);
        }
      }, 250);
    });

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }
      if (reloadOpenFilesTimer) {
        clearTimeout(reloadOpenFilesTimer);
      }
      pendingReloadPaths = [];
      unlisten();
    };
  },
}));
