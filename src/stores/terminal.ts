import { create } from "zustand";
import { t } from "../i18n";
import { useSettingsStore } from "./settings";
import { isTauri, tauriInvoke } from "../utils/tauri";import type { TerminalTab } from "../types/terminal";

const TERMINAL_TITLE = () => t("terminal.title");

interface TerminalState {
  tabs: TerminalTab[];
  activeId: string | null;
  createTerminal: (cwd?: string) => Promise<string | null>;
  closeTerminal: (id: string) => Promise<void>;
  setActiveTerminal: (id: string) => void;
  markTerminalExited: (id: string) => void;
  resetTerminals: () => Promise<void>;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeId: null,

  createTerminal: async (cwd) => {
    if (!isTauri()) return null;

    const id = await tauriInvoke<string>("terminal_spawn", { cwd: cwd ?? null });
    const tab: TerminalTab = {
      id,
      title: TERMINAL_TITLE(),
      cwd,
      exited: false,
    };

    useSettingsStore.getState().setTerminalVisible(true);

    set((state) => ({
      tabs: [...state.tabs, tab],
      activeId: id,
    }));

    return id;
  },

  closeTerminal: async (id) => {
    if (!isTauri()) return;

    await tauriInvoke("terminal_close", { id });

    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      let activeId = state.activeId;
      if (activeId === id) {
        activeId = tabs.length > 0 ? tabs[tabs.length - 1].id : null;
      }
      return { tabs, activeId };
    });

    if (get().tabs.length === 0) {
      useSettingsStore.getState().setTerminalVisible(false);
    }
  },

  setActiveTerminal: (id) => set({ activeId: id }),

  markTerminalExited: (id) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === id ? { ...tab, exited: true } : tab,
      ),
    })),

  resetTerminals: async () => {
    const { tabs, closeTerminal } = get();
    await Promise.all(tabs.map((tab) => closeTerminal(tab.id)));
    set({ tabs: [], activeId: null });
  },
}));
