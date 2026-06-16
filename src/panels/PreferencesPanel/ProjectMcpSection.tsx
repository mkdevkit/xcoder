import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { tauriInvoke } from "../../utils/tauri";
import type { McpConfigView } from "../../types/mcp";
import { ProviderMcpSection } from "./ProviderMcpSection";

interface ProjectMcpSectionProps {
  workspace: string;
  providerId: "codewhale" | "opencode";
  disabled?: boolean;
  embedded?: boolean;
}

function emptyMcpConfig(): McpConfigView {
  return {
    path: "",
    installed: false,
    servers: [],
  };
}

export function ProjectMcpSection({
  workspace,
  providerId,
  disabled = false,
  embedded = false,
}: ProjectMcpSectionProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<McpConfigView>(emptyMcpConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const data = await tauriInvoke<McpConfigView>("load_project_mcp_config", {
        workspace,
        provider: providerId,
      });
      setConfig(data);
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, [workspace, providerId]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      const data = await tauriInvoke<McpConfigView>("save_project_mcp_config", {
        workspace,
        provider: providerId,
        servers: config.servers,
      });
      setConfig(data);
      setStatus("ok");
      setStatusMessage(t("preferences.saved"));
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

  return (
    <div
      className={`project-mcp-section${embedded ? " project-mcp-embedded" : " preferences-section"}`}
    >
      {!embedded && (
        <div className="preferences-label">{t("preferences.projectMcp")}</div>
      )}
      <p className="preferences-hint">{t("preferences.projectMcpSaveHint")}</p>

      <ProviderMcpSection
        providerId={providerId}
        configPath={config.path}
        servers={config.servers}
        workspace={workspace}
        disabled={disabled || saving}
        scope="project"
        embedded
        onChange={(servers) =>
          setConfig((prev) => ({
            ...prev,
            servers,
          }))
        }
      />

      <div className="preferences-runtime-actions" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="preferences-btn primary"
          disabled={disabled || saving}
          onClick={() => save().catch(console.error)}
        >
          {saving ? t("preferences.savingProjectMcp") : t("preferences.saveProjectMcp")}
        </button>
      </div>

      {status !== "idle" && (
        <p
          className={`preferences-status ${status === "ok" ? "ok" : "err"}`}
          style={{ marginTop: 8 }}
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}
