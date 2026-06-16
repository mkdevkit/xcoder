import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { tauriInvoke } from "../../utils/tauri";
import { ConfigPathRow } from "./ConfigPathRow";
import { ProviderNotInstalledNotice } from "./ProviderNotInstalledNotice";
import { PermissionActionSelect } from "./PermissionActionSelect";
import {
  OPENCODE_DEFAULT_AGENTS,
  normalizeOpencodeDefaultAgent,
} from "../../utils/opencodeModels";
import type {
  OpencodeConfigView,
  OpencodeProviderEntry,
} from "../../types/providerConfig";

function emptyProvider(): OpencodeProviderEntry {
  return {
    id: "",
    npm: "@ai-sdk/openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    setCacheKey: true,
  };
}

function emptyPermissions() {
  return {
    edit: "",
    bash: "",
    read: "",
    webfetch: "",
  };
}

function emptyConfig(): OpencodeConfigView {
  return {
    path: "",
    installed: true,
    defaultAgent: "build",
    permissions: emptyPermissions(),
    providers: [emptyProvider()],
  };
}

export function OpenCodeConfigTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<OpencodeConfigView>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const data = await tauriInvoke<OpencodeConfigView>(
        "load_opencode_provider_config",
      );
      setConfig({
        ...data,
        defaultAgent: normalizeOpencodeDefaultAgent(data.defaultAgent),
        permissions: data.permissions ?? emptyPermissions(),
        providers: data.providers.length > 0 ? data.providers : [emptyProvider()],
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
    patch: Partial<OpencodeProviderEntry>,
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
      providers: [...prev.providers, emptyProvider()],
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
      await tauriInvoke("save_opencode_provider_config", { config });
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
        titleKey="preferences.tabOpencode"
        hintKey="preferences.opencodeInstallHint"
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
      <p className="preferences-hint">{t("preferences.opencodeModelsDynamic")}</p>
      <p className="preferences-hint">{t("preferences.reconnectHint")}</p>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.defaultMode")}</div>
        <select
          className="preferences-select"
          value={config.defaultAgent}
          onChange={(e) =>
            setConfig((prev) => ({ ...prev, defaultAgent: e.target.value }))
          }
        >
          {OPENCODE_DEFAULT_AGENTS.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>
        <p className="preferences-hint">
          {t("preferences.opencodeDefaultModeHint")}
        </p>
      </section>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.permissions")}</div>
        <p className="preferences-hint">{t("preferences.opencodePermissionsHint")}</p>
        <PermissionActionSelect
          labelKey="preferences.permissionEdit"
          value={config.permissions.edit}
          onChange={(value) =>
            setConfig((prev) => ({
              ...prev,
              permissions: { ...prev.permissions, edit: value },
            }))
          }
        />
        <PermissionActionSelect
          labelKey="preferences.permissionBash"
          value={config.permissions.bash}
          onChange={(value) =>
            setConfig((prev) => ({
              ...prev,
              permissions: { ...prev.permissions, bash: value },
            }))
          }
        />
        <PermissionActionSelect
          labelKey="preferences.permissionRead"
          value={config.permissions.read}
          onChange={(value) =>
            setConfig((prev) => ({
              ...prev,
              permissions: { ...prev.permissions, read: value },
            }))
          }
        />
        <PermissionActionSelect
          labelKey="preferences.permissionWebfetch"
          value={config.permissions.webfetch}
          onChange={(value) =>
            setConfig((prev) => ({
              ...prev,
              permissions: { ...prev.permissions, webfetch: value },
            }))
          }
        />
      </section>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.provider")}</div>
        {config.providers.map((entry, providerIndex) => (
          <div key={`${entry.id}-${providerIndex}`} className="preferences-card">
            <div className="preferences-card-header">
              <span className="preferences-card-title">
                {entry.id || t("preferences.providerId")}
              </span>
              {config.providers.length > 1 && (
                <button
                  type="button"
                  className="preferences-link-btn"
                  onClick={() => removeProvider(providerIndex)}
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
                onChange={(e) =>
                  updateProvider(providerIndex, { id: e.target.value })
                }
              />
            </div>
            <div className="preferences-field">
              <label>{t("preferences.npmPackage")}</label>
              <input
                className="preferences-input"
                value={entry.npm}
                onChange={(e) =>
                  updateProvider(providerIndex, { npm: e.target.value })
                }
              />
            </div>
            <div className="preferences-field">
              <label>{t("preferences.baseUrl")}</label>
              <input
                className="preferences-input"
                value={entry.baseUrl}
                onChange={(e) =>
                  updateProvider(providerIndex, { baseUrl: e.target.value })
                }
              />
            </div>
            <div className="preferences-field">
              <label>{t("preferences.apiKey")}</label>
              <input
                className="preferences-input"
                type="password"
                value={entry.apiKey}
                onChange={(e) =>
                  updateProvider(providerIndex, { apiKey: e.target.value })
                }
                autoComplete="off"
              />
            </div>
            <div className="preferences-field">
              <label>
                <input
                  type="checkbox"
                  checked={entry.setCacheKey}
                  onChange={(e) =>
                    updateProvider(providerIndex, {
                      setCacheKey: e.target.checked,
                    })
                  }
                />{" "}
                {t("preferences.setCacheKey")}
              </label>
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
