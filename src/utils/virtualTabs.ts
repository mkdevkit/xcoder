export const PREFERENCES_TAB_PATH = "xcoder://preferences";
export const SESSIONS_TAB_PATH = "xcoder://sessions";
export const LOCAL_HISTORY_TAB_PATH = "xcoder://local-history";

export function isPreferencesTab(path: string) {
  return path === PREFERENCES_TAB_PATH;
}

export function isSessionsTab(path: string) {
  return path === SESSIONS_TAB_PATH;
}

export function isLocalHistoryTab(path: string) {
  return path === LOCAL_HISTORY_TAB_PATH;
}

export function isVirtualTab(path: string) {
  return (
    isPreferencesTab(path) ||
    isSessionsTab(path) ||
    isLocalHistoryTab(path)
  );
}
