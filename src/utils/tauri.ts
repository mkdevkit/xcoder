import { invoke, isTauri } from "@tauri-apps/api/core";
import { t } from "../i18n";

export { isTauri };

export function ensureTauri(): void {
  if (!isTauri()) {
    throw new Error(t("error.tauriRequired"));
  }
}

export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  ensureTauri();
  return invoke<T>(cmd, args);
}
