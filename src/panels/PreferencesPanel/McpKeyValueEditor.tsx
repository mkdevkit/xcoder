import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../i18n";

export interface McpKeyValuePair {
  key: string;
  value: string;
}

interface McpKeyValueEditorProps {
  label: string;
  addLabelKey: "preferences.addMcpEnv" | "preferences.addMcpHeader";
  keyLabelKey: "preferences.mcpEnvKey" | "preferences.mcpHeaderKey";
  valueLabelKey: "preferences.mcpEnvValue" | "preferences.mcpHeaderValue";
  record: Record<string, string>;
  disabled?: boolean;
  secretValues?: boolean;
  onChange: (record: Record<string, string>) => void;
}

export function recordToMcpPairs(record: Record<string, string>): McpKeyValuePair[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export function mcpPairsToRecord(pairs: McpKeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) {
      continue;
    }
    out[key] = pair.value;
  }
  return out;
}

export function McpKeyValueEditor({
  label,
  addLabelKey,
  keyLabelKey,
  valueLabelKey,
  record,
  disabled = false,
  secretValues = false,
  onChange,
}: McpKeyValueEditorProps) {
  const { t } = useTranslation();
  const [pairs, setPairs] = useState(() => recordToMcpPairs(record));
  const lastEmittedRef = useRef(JSON.stringify(record));

  useEffect(() => {
    const externalSerialized = JSON.stringify(record);
    if (externalSerialized !== lastEmittedRef.current) {
      setPairs(recordToMcpPairs(record));
      lastEmittedRef.current = externalSerialized;
    }
  }, [record]);

  const commitPairs = (next: McpKeyValuePair[]) => {
    setPairs(next);
    const nextRecord = mcpPairsToRecord(next);
    const serialized = JSON.stringify(nextRecord);
    lastEmittedRef.current = serialized;
    onChange(nextRecord);
  };

  const updatePair = (index: number, patch: Partial<McpKeyValuePair>) => {
    commitPairs(
      pairs.map((pair, i) => (i === index ? { ...pair, ...patch } : pair)),
    );
  };

  const addPair = () => {
    commitPairs([...pairs, { key: "", value: "" }]);
  };

  const removePair = (index: number) => {
    commitPairs(pairs.filter((_, i) => i !== index));
  };

  return (
    <div className="preferences-field">
      <label>{label}</label>
      {pairs.length === 0 && (
        <p className="preferences-hint">{t("preferences.mcpKeyValueEmpty")}</p>
      )}
      {pairs.map((pair, index) => (
        <div key={`kv-${index}`} className="preferences-mcp-kv-row">
          <div className="preferences-model-compact-field">
            <label>{t(keyLabelKey)}</label>
            <input
              className="preferences-input"
              value={pair.key}
              disabled={disabled}
              onChange={(e) => updatePair(index, { key: e.target.value })}
            />
          </div>
          <div className="preferences-model-compact-field">
            <label>{t(valueLabelKey)}</label>
            <input
              className="preferences-input"
              type={secretValues ? "password" : "text"}
              value={pair.value}
              disabled={disabled}
              autoComplete="off"
              onChange={(e) => updatePair(index, { value: e.target.value })}
            />
          </div>
          <button
            type="button"
            className="preferences-link-btn"
            disabled={disabled}
            onClick={() => removePair(index)}
          >
            {t("preferences.remove")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="preferences-link-btn"
        style={{ marginTop: pairs.length > 0 ? 8 : 0 }}
        disabled={disabled}
        onClick={addPair}
      >
        {t(addLabelKey)}
      </button>
    </div>
  );
}
