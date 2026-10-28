import { create } from "zustand";
import type {
  WorkspaceReplaceResult,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "../types/search";
import { folderIncludePattern } from "../utils/path";
import { tauriInvoke } from "../utils/tauri";
import { useSettingsStore } from "./settings";

interface SearchState {
  query: string;
  replaceWith: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  includePattern: string;
  excludePattern: string;
  scopePath: string | null;
  showReplace: boolean;
  searching: boolean;
  replacing: boolean;
  error: string | null;
  matches: WorkspaceSearchMatch[];
  fileCount: number;
  matchCount: number;
  truncated: boolean;
  collapsedFiles: Record<string, boolean>;
  searchGeneration: number;
  focusRequest: number;
  setQuery: (query: string) => void;
  setReplaceWith: (value: string) => void;
  setCaseSensitive: (value: boolean) => void;
  setWholeWord: (value: boolean) => void;
  setUseRegex: (value: boolean) => void;
  setIncludePattern: (value: string) => void;
  setExcludePattern: (value: string) => void;
  setScopePath: (path: string | null) => void;
  setShowReplace: (value: boolean) => void;
  toggleFileCollapsed: (path: string) => void;
  findInFolder: (rootPath: string | null, folderPath: string) => void;
  runSearch: (rootPath: string | null) => Promise<void>;
  replaceAll: (rootPath: string | null) => Promise<WorkspaceReplaceResult | null>;
  clearResults: () => void;
}

function emptyResults() {
  return {
    matches: [] as WorkspaceSearchMatch[],
    fileCount: 0,
    matchCount: 0,
    truncated: false,
    collapsedFiles: {} as Record<string, boolean>,
    error: null as string | null,
  };
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: "",
  replaceWith: "",
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  includePattern: "",
  excludePattern: "",
  scopePath: null,
  showReplace: false,
  searching: false,
  replacing: false,
  error: null,
  matches: [],
  fileCount: 0,
  matchCount: 0,
  truncated: false,
  collapsedFiles: {},
  searchGeneration: 0,
  focusRequest: 0,

  setQuery: (query) => set({ query }),
  setReplaceWith: (replaceWith) => set({ replaceWith }),
  setCaseSensitive: (caseSensitive) => set({ caseSensitive }),
  setWholeWord: (wholeWord) => set({ wholeWord }),
  setUseRegex: (useRegex) => set({ useRegex }),
  setIncludePattern: (includePattern) => set({ includePattern }),
  setExcludePattern: (excludePattern) => set({ excludePattern }),
  setScopePath: (scopePath) => set({ scopePath }),
  setShowReplace: (showReplace) => set({ showReplace }),
  toggleFileCollapsed: (path) =>
    set((state) => ({
      collapsedFiles: {
        ...state.collapsedFiles,
        [path]: !state.collapsedFiles[path],
      },
    })),
  clearResults: () => set(emptyResults()),

  findInFolder: (rootPath, folderPath) => {
    const includePattern = rootPath
      ? folderIncludePattern(rootPath, folderPath)
      : "";
    useSettingsStore.getState().setSidebarView("search");
    set((state) => ({
      scopePath: folderPath,
      includePattern,
      focusRequest: state.focusRequest + 1,
    }));
    if (rootPath && get().query.trim()) {
      void get().runSearch(rootPath);
    }
  },

  runSearch: async (rootPath) => {
    const {
      query,
      caseSensitive,
      wholeWord,
      useRegex,
      includePattern,
      excludePattern,
      scopePath,
      searchGeneration,
    } = get();

    if (!rootPath || !query.trim()) {
      set({ ...emptyResults(), searching: false });
      return;
    }

    const generation = searchGeneration + 1;
    set({ searching: true, error: null, searchGeneration: generation });

    try {
      const result = await tauriInvoke<WorkspaceSearchResult>(
        "search_in_workspace",
        {
          options: {
            root: rootPath,
            query,
            caseSensitive,
            wholeWord,
            useRegex,
            includePattern: includePattern.trim() || null,
            excludePattern: excludePattern.trim() || null,
            scopePath,
          },
        },
      );

      if (get().searchGeneration !== generation) return;

      set({
        searching: false,
        matches: result.matches,
        fileCount: result.fileCount,
        matchCount: result.matchCount,
        truncated: result.truncated,
        collapsedFiles: {},
        error: null,
      });
    } catch (error) {
      if (get().searchGeneration !== generation) return;
      set({
        searching: false,
        ...emptyResults(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  replaceAll: async (rootPath) => {
    const {
      query,
      replaceWith,
      caseSensitive,
      wholeWord,
      useRegex,
      includePattern,
      excludePattern,
      scopePath,
    } = get();

    if (!rootPath || !query.trim()) return null;

    set({ replacing: true, error: null });
    try {
      const result = await tauriInvoke<WorkspaceReplaceResult>(
        "replace_in_workspace",
        {
          options: {
            root: rootPath,
            query,
            replaceWith,
            caseSensitive,
            wholeWord,
            useRegex,
            includePattern: includePattern.trim() || null,
            excludePattern: excludePattern.trim() || null,
            scopePath,
          },
        },
      );
      set({ replacing: false });
      await get().runSearch(rootPath);
      return result;
    } catch (error) {
      set({
        replacing: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
}));
