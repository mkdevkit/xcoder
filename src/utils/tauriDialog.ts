import { confirm, open, type ConfirmDialogOptions, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";
import { isTauri } from "./tauri";

export async function safeConfirm(
  message: string,
  options?: ConfirmDialogOptions,
): Promise<boolean> {
  if (!isTauri()) {
    return window.confirm(message);
  }
  try {
    return await confirm(message, options);
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[dialog] confirm failed:", error);
    }
    return false;
  }
}

export async function safePickDirectory(
  options?: OpenDialogOptions,
): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  try {
    const selected = await open({
      directory: true,
      multiple: false,
      ...options,
    });
    return typeof selected === "string" ? selected : null;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[dialog] open fallback:", error);
    }
    return null;
  }
}
