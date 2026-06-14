import { create } from "zustand";
import type { AppLocale } from "../i18n/types";
import { APP_LOCALES } from "../i18n/types";

const LOCALE_STORAGE_KEY = "xcoder:locale";

function readStoredLocale(): AppLocale {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (value && APP_LOCALES.includes(value as AppLocale)) {
      return value as AppLocale;
    }
  } catch {
    // ignore storage failures
  }
  return "zh";
}

function persistLocale(locale: AppLocale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore storage failures
  }
  document.documentElement.lang = locale;
}

const initialLocale = readStoredLocale();
document.documentElement.lang = initialLocale;

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 600;
export const CHAT_MIN_WIDTH = 280;
export const CHAT_MAX_WIDTH = 800;
export const TERMINAL_MIN_HEIGHT = 120;
export const EDITOR_MIN_HEIGHT = 160;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

interface SettingsState {
  locale: AppLocale;
  sidebarWidth: number;
  chatWidth: number;
  terminalVisible: boolean;
  terminalHeight: number;
  setLocale: (locale: AppLocale) => void;
  setSidebarWidth: (width: number) => void;
  setChatWidth: (width: number) => void;
  setTerminalVisible: (visible: boolean) => void;
  setTerminalHeight: (height: number) => void;
  resizeSidebarBy: (delta: number) => void;
  resizeChatBy: (delta: number) => void;
  resizeTerminalBy: (delta: number, maxHeight: number) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  locale: initialLocale,
  sidebarWidth: 260,
  chatWidth: 380,
  terminalVisible: false,
  terminalHeight: 220,
  setLocale: (locale) => {
    persistLocale(locale);
    set({ locale });
  },
  setSidebarWidth: (width) =>
    set({ sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) }),
  setChatWidth: (width) =>
    set({ chatWidth: clamp(width, CHAT_MIN_WIDTH, CHAT_MAX_WIDTH) }),
  setTerminalVisible: (visible) => set({ terminalVisible: visible }),
  setTerminalHeight: (height) =>
    set({ terminalHeight: Math.max(TERMINAL_MIN_HEIGHT, height) }),
  resizeSidebarBy: (delta) => {
    const { sidebarWidth } = get();
    set({
      sidebarWidth: clamp(
        sidebarWidth + delta,
        SIDEBAR_MIN_WIDTH,
        SIDEBAR_MAX_WIDTH,
      ),
    });
  },
  resizeChatBy: (delta) => {
    const { chatWidth } = get();
    set({
      chatWidth: clamp(chatWidth - delta, CHAT_MIN_WIDTH, CHAT_MAX_WIDTH),
    });
  },
  resizeTerminalBy: (delta, maxHeight) => {
    const { terminalHeight } = get();
    set({
      terminalHeight: clamp(
        terminalHeight - delta,
        TERMINAL_MIN_HEIGHT,
        maxHeight,
      ),
    });
  },
}));
