import { invoke, isTauri } from "@tauri-apps/api/core";

export { isTauri };

export function ensureTauri(): void {
  if (!isTauri()) {
    throw new Error(
      "请在 Tauri 桌面窗口中使用 xcoder（npm run tauri dev），不要直接在浏览器打开 http://localhost:1420",
    );
  }
}

export async function tauriInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  ensureTauri();
  return invoke<T>(cmd, args);
}
