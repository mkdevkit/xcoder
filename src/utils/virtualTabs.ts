export const PREFERENCES_TAB_PATH = "xcoder://preferences";

export function isPreferencesTab(path: string) {
  return path === PREFERENCES_TAB_PATH;
}

export function isVirtualTab(path: string) {
  return isPreferencesTab(path);
}
