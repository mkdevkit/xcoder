import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useChatStore } from "../../stores/chat";
import { tauriInvoke } from "../../utils/tauri";
import { applyAppTheme } from "../../utils/appTheme";
import type { AppConfig, RuntimeStatus } from "../../types/agent";
import { ConfigPathRow } from "./ConfigPathRow";
import {
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
        args: [...OPENCODE_DEFAULT_ARGS],
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
  const [opencodeRuntime, setOpencodeRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const oc = await tauriInvoke<RuntimeStatus>("opencode_runtime_status");
      setOpencodeRuntime(oc);
    } catch {
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
      setConfig(ensureProvider(appConfig, "opencode"));
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
    patch: Partial<AppConfig["providers"][number]>,
  ) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        providers: prev.providers.map((item) =>
          item.id === "opencode" ? { ...item, ...patch } : item,
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

  const runRuntimeAction = async (action: "start" | "restart" | "stop") => {
    const commands = getAgentCommands("opencode");
    setRuntimeBusy(`opencode:${action}`);
    setStatus("idle");
    try {
      if (action === "start") {
        await tauriInvoke(commands.startRuntime, {
          workspace: "",
          spawnIfMissing: true,
        });
      } else if (action === "restart") {
        await tauriInvoke(commands.restartRuntime, { workspace: "" });
      } else {
        await tauriInvoke(commands.stopRuntime);
        await useChatStore.getState().refreshProviderRuntime("opencode");
      }
      await refreshRuntimeStatus();
      if (action === "start" || action === "restart") {
        await useChatStore
          .getState()
          .autoConnectAfterRuntimeService("opencode")
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

  const opencode = config.providers.find((item) => item.id === "opencode");
  const ocEndpoint = readRuntimeEndpoint(
    opencode?.args ?? OPENCODE_DEFAULT_ARGS,
    OPENCODE_RUNTIME_DEFAULTS,
  );

  const busyPrefix = "opencode:";
  const isRunning = opencodeRuntime?.running ?? false;
  const actionBusy = runtimeBusy !== null;

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
                  ? {
                      ...prev,
                      app: { ...prev.app, theme: e.target.value },
                    }
                  : prev,
              )
            }
          >
            <option value="dark">{t("preferences.themeDark")}</option>
            <option value="light">{t("preferences.themeLight")}</option>
          </select>
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
        {opencode && (
          <div className="preferences-card">
            <div className="preferences-card-header">
              <span className="preferences-card-title">OpenCode</span>
              <span className="preferences-runtime-status">
                {opencodeRuntime?.running
                  ? t("preferences.runtimeRunning")
                  : t("preferences.runtimeStopped")}
                {opencodeRuntime?.base_url ? ` · ${opencodeRuntime.base_url}` : ""}
              </span>
            </div>
            <div className="preferences-runtime-grid">
              <div className="preferences-field">
                <label>{t("preferences.runtimeHost")}</label>
                <input
                  className="preferences-input"
                  value={ocEndpoint.host}
                  onChange={(e) =>
                    updateProvider({
                      args: writeRuntimeEndpoint(
                        opencode.args ?? OPENCODE_DEFAULT_ARGS,
                        { ...ocEndpoint, host: e.target.value },
                        "--hostname",
                      ),
                    })
                  }
                />
              </div>
              <div className="preferences-field">
                <label>{t("preferences.runtimePort")}</label>
                <input
                  className="preferences-input"
                  value={ocEndpoint.port}
                  onChange={(e) =>
                    updateProvider({
                      args: writeRuntimeEndpoint(
                        opencode.args ?? OPENCODE_DEFAULT_ARGS,
                        { ...ocEndpoint, port: e.target.value },
                        "--hostname",
                      ),
                    })
                  }
                />
              </div>
            </div>
            <div className="preferences-runtime-actions">
              <button
                type="button"
                className="preferences-btn primary"
                disabled={actionBusy || isRunning}
                onClick={() => runRuntimeAction("start").catch(console.error)}
              >
                {runtimeBusy === `${busyPrefix}start`
                  ? t("preferences.runtimeStarting")
                  : t("preferences.runtimeStart")}
              </button>
              <button
                type="button"
                className="preferences-btn"
                disabled={actionBusy || !isRunning}
                onClick={() => runRuntimeAction("restart").catch(console.error)}
              >
                {runtimeBusy === `${busyPrefix}restart`
                  ? t("preferences.runtimeRestarting")
                  : t("preferences.runtimeRestart")}
              </button>
              <button
                type="button"
                className="preferences-btn"
                disabled={actionBusy || !isRunning}
                onClick={() => runRuntimeAction("stop").catch(console.error)}
              >
                {runtimeBusy === `${busyPrefix}stop`
                  ? t("preferences.runtimeStopping")
                  : t("preferences.runtimeStop")}
              </button>
            </div>
          </div>
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
