export interface OpencodeModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  value: string;
}

export const OPENCODE_DEFAULT_AGENTS = ["build", "plan"] as const;
export type OpencodeDefaultAgent = (typeof OPENCODE_DEFAULT_AGENTS)[number];

export function normalizeOpencodeDefaultAgent(value: string): OpencodeDefaultAgent {
  return OPENCODE_DEFAULT_AGENTS.includes(value as OpencodeDefaultAgent)
    ? (value as OpencodeDefaultAgent)
    : "build";
}

export interface OpencodeVendorOption {
  id: string;
  name: string;
  connected: boolean;
}

export function deriveOpencodeVendors(
  catalog: OpencodeModelOption[],
  connectedProviderIds: string[] = [],
) {
  const connected = new Set(connectedProviderIds);
  const vendors = new Map<string, OpencodeVendorOption>();
  for (const item of catalog) {
    if (!vendors.has(item.providerId)) {
      vendors.set(item.providerId, {
        id: item.providerId,
        name: item.providerName,
        connected: connected.has(item.providerId),
      });
    }
  }
  return Array.from(vendors.values());
}

export function formatOpencodeVendorLabel(vendor: OpencodeVendorOption) {
  const mark = vendor.connected ? "✓" : "✗";
  return `${vendor.name}  ${mark}`;
}

export function modelsForOpencodeVendor(
  catalog: OpencodeModelOption[],
  vendorId: string,
) {
  return catalog.filter((item) => item.providerId === vendorId);
}

export function resolveOpencodeVendor(model: string, fallback = "") {
  const slash = model.indexOf("/");
  if (slash <= 0) return fallback;
  return model.slice(0, slash);
}

export function findOpencodeModelMatch(
  catalog: OpencodeModelOption[],
  preferredModel: string,
) {
  const trimmed = preferredModel.trim();
  if (!trimmed) return undefined;

  const exact = catalog.find((item) => item.value === trimmed);
  if (exact) return exact;

  const byModelId = catalog.find((item) => item.modelId === trimmed);
  if (byModelId) return byModelId;

  return catalog.find((item) => item.value.endsWith(`/${trimmed}`));
}

export function pickOpencodeDefaults(
  catalog: OpencodeModelOption[],
  preferredModel = "",
) {
  if (catalog.length === 0) {
    return { vendor: "", model: "" };
  }

  const preferred = findOpencodeModelMatch(catalog, preferredModel);
  if (preferred) {
    return { vendor: preferred.providerId, model: preferred.value };
  }

  const vendors = deriveOpencodeVendors(catalog);
  const vendor = vendors[0]?.id ?? catalog[0].providerId;
  const firstModel =
    modelsForOpencodeVendor(catalog, vendor)[0]?.value ?? catalog[0].value;
  return { vendor, model: firstModel };
}
