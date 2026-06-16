import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { tauriInvoke } from "../../utils/tauri";
import { ConfigPathRow } from "./ConfigPathRow";
import { ProviderNotInstalledNotice } from "./ProviderNotInstalledNotice";
import type { CodewhaleConfigView } from "../../types/providerConfig";

function emptyConfig(): CodewhaleConfigView {
  return {
    path: "",
    installed: true,
    apiKey: "",
    provider: "deepseek",
    authMode: "api_key",
    providers: [{ id: "deepseek", apiKey: "" }],
    defaultMode: "agent",
    approvalMode: "suggest",
    reasoningEffort: "high",
  };
}

export function CodewhaleConfigTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CodewhaleConfigView>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const data = await tauriInvoke<CodewhaleConfigView>(
        "load_codewhale_provider_config",
      );
      setConfig({
        ...data,
        providers:
          data.providers.length > 0
            ? data.providers
            : [{ id: data.provider || "deepseek", apiKey: data.apiKey }],
      });
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const updateProvider = (
    index: number,
    patch: Partial<CodewhaleConfigView["providers"][number]>,
  ) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    }));
  };

  const addProvider = () => {
    setConfig((prev) => ({
      ...prev,
      providers: [...prev.providers, { id: "", apiKey: "" }],
    }));
  };

  const removeProvider = (index: number) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.filter((_, i) => i !== index),
    }));
  };

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      const primary = config.providers.find((item) => item.id === config.provider);
      const payload: CodewhaleConfigView = {
        ...config,
        apiKey: primary?.apiKey ?? config.apiKey,
      };
      await tauriInvoke("save_codewhale_provider_config", { config: payload });
      setStatus("ok");
      setStatusMessage(t("preferences.saved"));
      await load();
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="preferences-hint">{t("preferences.loading")}</p>;
  }

  if (!config.installed) {
    return (
      <ProviderNotInstalledNotice
        titleKey="preferences.tabCodewhale"
        hintKey="preferences.codewhaleInstallHint"
        configPath={config.path}
        onReload={() => load().catch(console.error)}
        reloading={loading}
      />
    );
  }

  return (
    <div>
      <h3 className="preferences-label">{t("preferences.modelConfig")}</h3>
      <ConfigPathRow path={config.path} />
      <p className="preferences-hint">{t("preferences.reconnectHint")}</p>

      <section className="preferences-section">
        <div className="preferences-field">
          <label>{t("preferences.provider")}</label>
          <input
            className="preferences-input"
            value={config.provider}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, provider: e.target.value }))
            }
          />
        </div>
        <div className="preferences-field">
          <label>{t("preferences.authMode")}</label>
          <input
            className="preferences-input"
            value={config.authMode}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, authMode: e.target.value }))
            }
          />
        </div>
      </section>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.defaultMode")}</div>
        <select
          className="preferences-select"
          value={config.defaultMode}
          onChange={(e) =>
            setConfig((prev) => ({ ...prev, defaultMode: e.target.value }))
          }
        >
          <option value="plan">plan</option>
          <option value="agent">agent</option>
          <option value="yolo">yolo</option>
        </select>

        <div className="preferences-field" style={{ marginTop: 12 }}>
          <label>{t("preferences.reasoningEffort")}</label>
          <select
            className="preferences-select"
            value={config.reasoningEffort}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                reasoningEffort: e.target.value,
              }))
            }
          >
            <option value="off">off</option>
            <option value="high">high</option>
            <option value="max">max</option>
          </select>
        </div>
      </section>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.permissions")}</div>
        <p className="preferences-hint">{t("preferences.codewhalePermissionsHint")}</p>
        <div className="preferences-field">
          <label>{t("preferences.approvalMode")}</label>
          <select
            className="preferences-select"
            value={config.approvalMode}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, approvalMode: e.target.value }))
            }
          >
            <option value="suggest">suggest</option>
            <option value="auto">auto</option>
            <option value="never">never</option>
          </select>
        </div>
      </section>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.apiKey")}</div>
        <p className="preferences-hint">{t("preferences.apiKeyHint")}</p>
        {config.providers.map((entry, index) => (
          <div key={`${entry.id}-${index}`} className="preferences-card">
            <div className="preferences-card-header">
              <span className="preferences-card-title">
                {entry.id || t("preferences.providerId")}
              </span>
              {config.providers.length > 1 && (
                <button
                  type="button"
                  className="preferences-link-btn"
                  onClick={() => removeProvider(index)}
                >
                  {t("preferences.remove")}
                </button>
              )}
            </div>
            <div className="preferences-field">
              <label>{t("preferences.providerId")}</label>
              <input
                className="preferences-input"
                value={entry.id}
                onChange={(e) => updateProvider(index, { id: e.target.value })}
              />
            </div>
            <div className="preferences-field">
              <label>{t("preferences.apiKey")}</label>
              <input
                className="preferences-input"
                type="password"
                value={entry.apiKey}
                onChange={(e) =>
                  updateProvider(index, { apiKey: e.target.value })
                }
                autoComplete="off"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          className="preferences-link-btn"
          style={{ marginTop: 12 }}
          onClick={addProvider}
        >
          {t("preferences.addProvider")}
        </button>
      </section>

      <div className="preferences-actions">
        <button
          type="button"
          className="preferences-btn primary"
          disabled={saving}
          onClick={() => save().catch(console.error)}
        >
          {saving ? t("preferences.saving") : t("preferences.save")}
        </button>
        <button
          type="button"
          className="preferences-btn"
          disabled={loading || saving}
          onClick={() => load().catch(console.error)}
        >
          {t("preferences.reload")}
        </button>
        {status !== "idle" && (
          <span className={`preferences-status ${status}`}>{statusMessage}</span>
        )}
      </div>
    </div>
  );
}
