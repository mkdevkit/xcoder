export interface CodewhaleModelOption {
  modelId: string;
  provider: string;
  label: string;
  value: string;
}

export const CODEWHALE_MODES = ["plan", "agent", "yolo"] as const;

export function pickCodewhaleDefaults(
  catalog: CodewhaleModelOption[],
  preferredModel = "",
) {
  if (catalog.length === 0) {
    return { model: "" };
  }

  const preferred = catalog.find((item) => item.value === preferredModel);
  if (preferred) {
    return { model: preferred.value };
  }

  const auto = catalog.find((item) => item.value === "auto");
  return { model: auto?.value ?? catalog[0].value };
}
