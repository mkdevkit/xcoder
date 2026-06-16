import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useChatStore } from "../../stores/chat";
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
  OpencodeModelEntry,
  OpencodeProviderEntry,
} from "../../types/providerConfig";
import { ModalityMultiSelect } from "./ModalityMultiSelect";
import {
  PreferencesConfigActions,
  PreferencesSubTabs,
} from "./PreferencesSubTabs";
import { ProviderMcpSection } from "./ProviderMcpSection";
import { useWorkspaceStore } from "../../stores/workspace";

type OpencodeSubTab = "basic" | "provider" | "mcp";

function emptyModel(): OpencodeModelEntry {
  return {
    id: "",
    name: "",
    limitContext: null,
    limitOutput: null,
    modalitiesInput: [],
    modalitiesOutput: [],
  };
}

function normalizeModel(model: OpencodeModelEntry): OpencodeModelEntry {
  return {
    ...model,
    limitContext: model.limitContext ?? null,
    limitOutput: model.limitOutput ?? null,
    modalitiesInput: model.modalitiesInput ?? [],
    modalitiesOutput: model.modalitiesOutput ?? [],
  };
}

function emptyProvider(): OpencodeProviderEntry {
  return {
    id: "",
    npm: "@ai-sdk/openai-compatible",
    baseUrl: "",
    apiKey: "",
    setCacheKey: true,
    models: [],
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
    providers: [],
    mcpServers: [],
  };
}

export function OpenCodeConfigTab() {
  const { t } = useTranslation();
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const [activeSubTab, setActiveSubTab] = useState<OpencodeSubTab>("basic");
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
        providers: data.providers.map((provider) => ({
          ...provider,
          models: (provider.models ?? []).map(normalizeModel),
        })),
        mcpServers: data.mcpServers ?? [],
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

  const updateModel = (
    providerIndex: number,
    modelIndex: number,
    patch: Partial<OpencodeModelEntry>,
  ) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((provider, i) => {
        if (i !== providerIndex) {
          return provider;
        }
        return {
          ...provider,
          models: provider.models.map((model, j) =>
            j === modelIndex ? { ...model, ...patch } : model,
          ),
        };
      }),
    }));
  };

  const addModel = (providerIndex: number) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((provider, i) =>
        i === providerIndex
          ? { ...provider, models: [...provider.models, emptyModel()] }
          : provider,
      ),
    }));
  };

  const removeModel = (providerIndex: number, modelIndex: number) => {
    setConfig((prev) => ({
      ...prev,
      providers: prev.providers.map((provider, i) => {
        if (i !== providerIndex) {
          return provider;
        }
        return {
          ...provider,
          models: provider.models.filter((_, j) => j !== modelIndex),
        };
      }),
    }));
  };

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      await tauriInvoke("save_opencode_provider_config", { config });
      await useChatStore.getState().reloadProviderConfig("opencode");
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

      <PreferencesSubTabs<OpencodeSubTab>
        tabs={[
          { id: "basic", labelKey: "preferences.subTabBasicConfig" },
          { id: "provider", labelKey: "preferences.subTabProvider" },
          { id: "mcp", labelKey: "preferences.subTabMcp" },
        ]}
        activeTab={activeSubTab}
        onChange={setActiveSubTab}
      >
        {activeSubTab === "basic" && (
          <>
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
          </>
        )}

        {activeSubTab === "provider" && (
          <section className="preferences-section">
            {config.providers.length === 0 && (
              <p className="preferences-hint">{t("preferences.noProvidersConfigured")}</p>
            )}
        {config.providers.map((entry, providerIndex) => (
          <div key={`${entry.id}-${providerIndex}`} className="preferences-card">
            <div className="preferences-card-header">
              <span className="preferences-card-title">
                {entry.id || t("preferences.providerId")}
              </span>
              <button
                type="button"
                className="preferences-link-btn"
                onClick={() => removeProvider(providerIndex)}
              >
                {t("preferences.remove")}
              </button>
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

            <div className="preferences-field">
              <label>{t("preferences.models")}</label>
              <p className="preferences-hint">
                {t("preferences.opencodeModelFormat")}
              </p>
              {entry.models.map((model, modelIndex) => (
                <div
                  key={`${providerIndex}-model-${modelIndex}`}
                  className="preferences-model-card"
                >
                  <div className="preferences-model-row">
                    <div className="preferences-model-compact-field">
                      <label>{t("preferences.modelId")}</label>
                      <input
                        className="preferences-input"
                        value={model.id}
                        onChange={(e) =>
                          updateModel(providerIndex, modelIndex, {
                            id: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="preferences-model-compact-field">
                      <label>{t("preferences.modelName")}</label>
                      <input
                        className="preferences-input"
                        value={model.name}
                        onChange={(e) =>
                          updateModel(providerIndex, modelIndex, {
                            name: e.target.value,
                          })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="preferences-link-btn"
                      onClick={() => removeModel(providerIndex, modelIndex)}
                    >
                      {t("preferences.remove")}
                    </button>
                  </div>

                  <div className="preferences-model-limit-row">
                    <div className="preferences-model-compact-field">
                      <label>{t("preferences.limitContext")}</label>
                      <input
                        className="preferences-input"
                        type="number"
                        min={0}
                        value={model.limitContext ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            updateModel(providerIndex, modelIndex, {
                              limitContext: null,
                            });
                            return;
                          }
                          const parsed = Number.parseInt(raw, 10);
                          updateModel(providerIndex, modelIndex, {
                            limitContext: Number.isNaN(parsed) ? null : parsed,
                          });
                        }}
                      />
                    </div>
                    <div className="preferences-model-compact-field">
                      <label>{t("preferences.limitOutput")}</label>
                      <input
                        className="preferences-input"
                        type="number"
                        min={0}
                        value={model.limitOutput ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          if (raw === "") {
                            updateModel(providerIndex, modelIndex, {
                              limitOutput: null,
                            });
                            return;
                          }
                          const parsed = Number.parseInt(raw, 10);
                          updateModel(providerIndex, modelIndex, {
                            limitOutput: Number.isNaN(parsed) ? null : parsed,
                          });
                        }}
                      />
                    </div>
                  </div>

                  <div className="preferences-label" style={{ marginTop: 8 }}>
                    {t("preferences.modalities")}
                  </div>
                  <div className="preferences-modalities-row">
                    <ModalityMultiSelect
                      label={t("preferences.modalitiesInput")}
                      value={model.modalitiesInput}
                      onChange={(modalitiesInput) =>
                        updateModel(providerIndex, modelIndex, {
                          modalitiesInput,
                        })
                      }
                    />
                    <ModalityMultiSelect
                      label={t("preferences.modalitiesOutput")}
                      value={model.modalitiesOutput}
                      onChange={(modalitiesOutput) =>
                        updateModel(providerIndex, modelIndex, {
                          modalitiesOutput,
                        })
                      }
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="preferences-link-btn"
                style={{ marginTop: 8 }}
                onClick={() => addModel(providerIndex)}
              >
                {t("preferences.addModel")}
              </button>
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
        )}

        {activeSubTab === "mcp" && (
          <ProviderMcpSection
            providerId="opencode"
            configPath={config.path}
            servers={config.mcpServers}
            workspace={rootPath}
            disabled={saving}
            onChange={(mcpServers) =>
              setConfig((prev) => ({
                ...prev,
                mcpServers,
              }))
            }
          />
        )}
      </PreferencesSubTabs>

      <PreferencesConfigActions
        saving={saving}
        status={status}
        statusMessage={statusMessage}
        onSave={() => save().catch(console.error)}
      />
    </div>
  );
}
