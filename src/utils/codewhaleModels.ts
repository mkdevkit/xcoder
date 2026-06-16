import type { CodewhaleModelOption } from "../types/agent";

export const CODEWHALE_MODES = ["plan", "agent", "yolo"] as const;

export function isCodewhaleModelAvailable(item: CodewhaleModelOption) {
  return item.available !== false;
}

export function formatCodewhaleModelLabel(item: CodewhaleModelOption) {
  const mark = isCodewhaleModelAvailable(item) ? "✓" : "✗";
  return `${item.label}  ${mark}`;
}

export function pickCodewhaleDefaults(
  catalog: CodewhaleModelOption[],
  preferredModel = "",
) {
  if (catalog.length === 0) {
    return { model: "" };
  }

  const usable = catalog.filter(isCodewhaleModelAvailable);
  const pool = usable.length > 0 ? usable : catalog;
  const trimmed = preferredModel.trim();

  if (trimmed) {
    const preferred = pool.find(
      (item) =>
        item.value === trimmed ||
        item.modelId === trimmed ||
        item.label === trimmed,
    );
    if (preferred) {
      return { model: preferred.value };
    }
  }

  const auto = pool.find((item) => item.value === "auto");
  return { model: auto?.value ?? pool[0].value };
}
