import type { OpencodeModelOption } from "./opencodeModels";

const LAST_MODEL_KEY = "xcoder:last-model";

export interface LastUsedModel {
  providerId: string;
  model: string;
}

function isValidRecord(value: unknown): value is LastUsedModel {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerId === "string" &&
    record.providerId.trim().length > 0 &&
    typeof record.model === "string" &&
    record.model.trim().length > 0
  );
}

export function readLastUsedModel(): LastUsedModel | null {
  try {
    const raw = localStorage.getItem(LAST_MODEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastUsedModel(providerId: string, model: string) {
  const id = providerId.trim();
  const value = model.trim();
  if (!id || !value) return;
  try {
    localStorage.setItem(
      LAST_MODEL_KEY,
      JSON.stringify({ providerId: id, model: value }),
    );
  } catch {
    // ignore storage failures
  }
}

export function clearLastUsedModel() {
  try {
    localStorage.removeItem(LAST_MODEL_KEY);
  } catch {
    // ignore storage failures
  }
}

export function findLastUsedModel(
  catalog: OpencodeModelOption[],
  record: LastUsedModel,
) {
  return catalog.find(
    (item) =>
      item.providerId === record.providerId && item.value === record.model,
  );
}
