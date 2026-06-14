export interface OpencodeModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  value: string;
}

export function deriveOpencodeVendors(catalog: OpencodeModelOption[]) {
  const vendors = new Map<string, string>();
  for (const item of catalog) {
    if (!vendors.has(item.providerId)) {
      vendors.set(item.providerId, item.providerName);
    }
  }
  return Array.from(vendors, ([id, name]) => ({ id, name }));
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

export function pickOpencodeDefaults(
  catalog: OpencodeModelOption[],
  preferredModel = "",
) {
  if (catalog.length === 0) {
    return { vendor: "", model: "" };
  }

  const preferred = catalog.find((item) => item.value === preferredModel);
  if (preferred) {
    return { vendor: preferred.providerId, model: preferred.value };
  }

  const vendors = deriveOpencodeVendors(catalog);
  const vendor = vendors[0]?.id ?? catalog[0].providerId;
  const firstModel =
    modelsForOpencodeVendor(catalog, vendor)[0]?.value ?? catalog[0].value;
  return { vendor, model: firstModel };
}
