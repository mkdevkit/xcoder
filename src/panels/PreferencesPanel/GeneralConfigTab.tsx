import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useChatStore } from "../../stores/chat";
import { tauriInvoke } from "../../utils/tauri";
import { applyAppTheme } from "../../utils/appTheme";
import type { AppConfig, RuntimeStatus } from "../../types/agent";
import { ConfigPathRow } from "./ConfigPathRow";
import {
  CODEWHALE_DEFAULT_ARGS,
  CODEWHALE_RUNTIME_DEFAULTS,
  OPENCODE_DEFAULT_ARGS,
  OPENCODE_RUNTIME_DEFAULTS,
  readRuntimeEndpoint,
  writeRuntimeEndpoint,
} from "../../utils/providerRuntimeArgs";
import { getAgentCommands } from "../../utils/agentProvider";

function ensureProvider(config: AppConfig, id: string): AppConfig {
  if (config.providers.some((item) => item.id === id)) {
    return config;
  }
  return {
    ...config,
    providers: [
      ...config.providers,
      {
        id,
        type: "http",
        command: id,
        args: id === "codewhale" ? [...CODEWHALE_DEFAULT_ARGS] : [...OPENCODE_DEFAULT_ARGS],
        health_cmd: [],
      },
    ],
  };
}

export function GeneralConfigTab() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [codewhaleRuntime, setCodewhaleRuntime] = useState<RuntimeStatus | null>(null);
  const [opencodeRuntime, setOpencodeRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const [cw, oc] = await Promise.all([
        tauriInvoke<RuntimeStatus>("codewhale_runtime_status"),
        tauriInvoke<RuntimeStatus>("opencode_runtime_status"),
      ]);
      setCodewhaleRuntime(cw);
      setOpencodeRuntime(oc);
    } catch {
      setCodewhaleRuntime(null);
      setOpencodeRuntime(null);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const [appConfig, paths] = await Promise.all([
        tauriInvoke<AppConfig>("load_config"),
        tauriInvoke<{ dir: string; file: string }>("get_config_paths"),
      ]);
      setConfig(
        ensureProvider(ensureProvider(appConfig, "codewhale"), "opencode"),
      );
      setConfigPath(paths.file);
      await refreshRuntimeStatus();
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      refreshRuntimeStatus().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refreshRuntimeStatus]);

  const updateProvider = (
    providerId: "codewhale" | "opencode",
    patch: Partial<AppConfig["providers"][number]>,
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        providers: prev.providers.map((item) =>
          item.id === providerId ? { ...item, ...patch } : item,
        ),
      };
    });
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setStatus("idle");
    try {
      await tauriInvoke("save_config", { config });
      applyAppTheme(config.app.theme);
      await useChatStore.getState().loadConfig();
      setStatus("ok");
      setStatusMessage(t("preferences.saved"));
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  const runRuntimeAction = async (
    providerId: "codewhale" | "opencode",
    action: "start" | "restart" | "stop",
  ) => {
    const commands = getAgentCommands(providerId);
    setRuntimeBusy(`${providerId}:${action}`);
    setStatus("idle");
    try {
      if (action === "start") {
        if (providerId === "opencode") {
          await tauriInvoke(commands.startRuntime, {
            workspace: "",
            spawnIfMissing: true,
          });
        } else {
          await tauriInvoke(commands.startRuntime, { spawnIfMissing: true });
        }
      } else if (action === "restart") {
        if (providerId === "opencode") {
          await tauriInvoke(commands.restartRuntime, { workspace: "" });
        } else {
          await tauriInvoke(commands.restartRuntime);
        }
      } else {
        await tauriInvoke(commands.stopRuntime);
        await useChatStore.getState().refreshProviderRuntime(providerId);
      }
      await refreshRuntimeStatus();
      if (action === "start" || action === "restart") {
        await useChatStore
          .getState()
          .autoConnectAfterRuntimeService(providerId)
          .catch(console.error);
      }
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setRuntimeBusy(null);
    }
  };

  if (loading || !config) {
    return <p className="preferences-hint">{t("preferences.loading")}</p>;
  }

  const codewhale = config.providers.find((item) => item.id === "codewhale");
  const opencode = config.providers.find((item) => item.id === "opencode");
  const cwEndpoint = readRuntimeEndpoint(
    codewhale?.args ?? CODEWHALE_DEFAULT_ARGS,
    CODEWHALE_RUNTIME_DEFAULTS,
  );
  const ocEndpoint = readRuntimeEndpoint(
    opencode?.args ?? OPENCODE_DEFAULT_ARGS,
    OPENCODE_RUNTIME_DEFAULTS,
  );

  const renderRuntimeCard = (
    providerId: "codewhale" | "opencode",
    title: string,
    provider: AppConfig["providers"][number] | undefined,
    endpoint: { host: string; port: string },
    hostFlag: "--host" | "--hostname",
    runtime: RuntimeStatus | null,
    defaultArgs: string[],
  ) => {
    if (!provider) return null;
    const busyPrefix = `${providerId}:`;
    const isRunning = runtime?.running ?? false;
    const actionBusy = runtimeBusy !== null;
    return (
      <div className="preferences-card">
        <div className="preferences-card-header">
          <span className="preferences-card-title">{title}</span>
          <span className="preferences-runtime-status">
            {runtime?.running
              ? t("preferences.runtimeRunning")
              : t("preferences.runtimeStopped")}
            {runtime?.base_url ? ` · ${runtime.base_url}` : ""}
          </span>
        </div>

        <div className="preferences-field">
          <label>{t("preferences.runtimeCommand")}</label>
          <input
            className="preferences-input preferences-input-readonly"
            value={provider.command}
            readOnly
          />
        </div>
        <div className="preferences-field-row">
          <div className="preferences-field">
            <label>{t("preferences.runtimeHost")}</label>
            <input
              className="preferences-input"
              value={endpoint.host}
              onChange={(e) =>
                updateProvider(providerId, {
                  args: writeRuntimeEndpoint(
                    provider.args.length > 0 ? provider.args : [...defaultArgs],
                    { ...endpoint, host: e.target.value },
                    hostFlag,
                  ),
                })
              }
            />
          </div>
          <div className="preferences-field">
            <label>{t("preferences.runtimePort")}</label>
            <input
              className="preferences-input"
              value={endpoint.port}
              onChange={(e) =>
                updateProvider(providerId, {
                  args: writeRuntimeEndpoint(
                    provider.args.length > 0 ? provider.args : [...defaultArgs],
                    { ...endpoint, port: e.target.value },
                    hostFlag,
                  ),
                })
              }
            />
          </div>
        </div>

        <div className="preferences-runtime-actions">
          <button
            type="button"
            className="preferences-btn"
            disabled={actionBusy || isRunning}
            onClick={() => runRuntimeAction(providerId, "start").catch(console.error)}
          >
            {runtimeBusy === `${busyPrefix}start`
              ? t("preferences.runtimeStarting")
              : t("preferences.runtimeStart")}
          </button>
          <button
            type="button"
            className="preferences-btn"
            disabled={actionBusy || !isRunning}
            onClick={() => runRuntimeAction(providerId, "restart").catch(console.error)}
          >
            {runtimeBusy === `${busyPrefix}restart`
              ? t("preferences.runtimeRestarting")
              : t("preferences.runtimeRestart")}
          </button>
          <button
            type="button"
            className="preferences-btn"
            disabled={actionBusy || !isRunning}
            onClick={() => runRuntimeAction(providerId, "stop").catch(console.error)}
          >
            {runtimeBusy === `${busyPrefix}stop`
              ? t("preferences.runtimeStopping")
              : t("preferences.runtimeStop")}
          </button>
        </div>
        <p className="preferences-hint">{t("preferences.runtimeServiceHint")}</p>
      </div>
    );
  };

  return (
    <div>
      <ConfigPathRow path={configPath} />

      <section className="preferences-section">
        <div className="preferences-field">
          <label>{t("preferences.theme")}</label>
          <select
            className="preferences-select"
            value={config.app.theme}
            onChange={(e) =>
              setConfig((prev) =>
                prev
                  ? { ...prev, app: { ...prev.app, theme: e.target.value } }
                  : prev,
              )
            }
          >
            <option value="dark">{t("preferences.themeDark")}</option>
            <option value="light">{t("preferences.themeLight")}</option>
          </select>
        </div>

        <div className="preferences-field">
          <label>{t("preferences.defaultProvider")}</label>
          <select
            className="preferences-select"
            value={config.app.default_provider}
            onChange={(e) =>
              setConfig((prev) =>
                prev
                  ? {
                      ...prev,
                      app: { ...prev.app, default_provider: e.target.value },
                    }
                  : prev,
              )
            }
          >
            {config.providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
          <p className="preferences-hint">{t("preferences.defaultProviderHint")}</p>
        </div>

        <div className="preferences-field">
          <label>{t("preferences.defaultModel")}</label>
          <input
            className="preferences-input"
            value={config.app.default_model}
            onChange={(e) =>
              setConfig((prev) =>
                prev
                  ? {
                      ...prev,
                      app: { ...prev.app, default_model: e.target.value },
                    }
                  : prev,
              )
            }
          />
          <p className="preferences-hint">{t("preferences.defaultModelHint")}</p>
        </div>
      </section>

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.runtimeServices")}</div>
        <p className="preferences-hint">{t("preferences.runtimePortHint")}</p>
        {renderRuntimeCard(
          "codewhale",
          "CodeWhale",
          codewhale,
          cwEndpoint,
          "--host",
          codewhaleRuntime,
          CODEWHALE_DEFAULT_ARGS,
        )}
        {renderRuntimeCard(
          "opencode",
          "OpenCode",
          opencode,
          ocEndpoint,
          "--hostname",
          opencodeRuntime,
          OPENCODE_DEFAULT_ARGS,
        )}
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
