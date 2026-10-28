import { useCallback, useState } from "react";
import { useTranslation } from "../../i18n";
import { tauriInvoke } from "../../utils/tauri";
import { ConfigPathRow } from "./ConfigPathRow";
import {
  McpKeyValueEditor,
} from "./McpKeyValueEditor";
import {
  emptyMcpServer,
  mergeMcpServersFromDisk,
  mcpEndpointLabel,
  type McpServerEntry,
  type McpTransport,
} from "../../types/mcp";

interface McpStatusResult {
  output: string;
  servers?: McpServerEntry[];
}

interface ProviderMcpSectionProps {
  providerId: "opencode";
  configPath: string;
  servers: McpServerEntry[];
  onChange: (servers: McpServerEntry[]) => void;
  workspace?: string | null;
  disabled?: boolean;
  scope?: "global" | "project";
  embedded?: boolean;
}

export function ProviderMcpSection({
  providerId,
  configPath,
  servers,
  onChange,
  workspace,
  disabled = false,
  scope = "global",
  embedded = false,
}: ProviderMcpSectionProps) {
  const { t } = useTranslation();
  const [statusOutput, setStatusOutput] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [connectingIndex, setConnectingIndex] = useState<number | null>(null);

  const updateServer = (index: number, patch: Partial<McpServerEntry>) => {
    onChange(
      servers.map((server, i) => (i === index ? { ...server, ...patch } : server)),
    );
  };

  const addServer = () => {
    onChange([...servers, emptyMcpServer()]);
  };

  const removeServer = (index: number) => {
    onChange(servers.filter((_, i) => i !== index));
  };

  const toggleServerConnection = async (index: number, connected: boolean) => {
    const server = servers[index];
    const serverId = server.id.trim();
    if (!serverId) {
      setStatusError(t("preferences.mcpConnectNeedName"));
      return;
    }
    if (connected && providerId === "opencode") {
      if (server.transport === "remote" && !server.url.trim()) {
        setStatusError(t("preferences.mcpConnectNeedUrl"));
        return;
      }
      if (server.transport !== "remote" && !server.command.trim()) {
        setStatusError(t("preferences.mcpConnectNeedCommand"));
        return;
      }
    }

    const nextServers = servers.map((item, i) =>
      i === index ? { ...item, enabled: connected } : item,
    );
    const previousServers = servers;

    setConnectingIndex(index);
    setStatusError("");
    onChange(nextServers);
    try {
      const result = await tauriInvoke<McpStatusResult>("apply_mcp_server_connection", {
        provider: providerId,
        scope,
        workspace: workspace ?? "",
        servers: nextServers,
        serverId,
        connected,
      });
      if (result.servers && result.servers.length > 0) {
        onChange(result.servers);
      }
      setStatusOutput(result.output);
    } catch (error) {
      onChange(previousServers);
      setStatusError(String(error));
    } finally {
      setConnectingIndex(null);
    }
  };

  const refreshStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError("");
    try {
      const result = await tauriInvoke<McpStatusResult>("query_opencode_mcp_status", {
        workspace: workspace ?? "",
        scope,
      });
      if (result.servers) {
        onChange(mergeMcpServersFromDisk(servers, result.servers));
      }
      setStatusOutput(result.output);
    } catch (error) {
      setStatusError(String(error));
      setStatusOutput("");
    } finally {
      setStatusLoading(false);
    }
  }, [providerId, workspace, scope, servers, onChange]);

  const hintKey =
    scope === "project"
      ? "preferences.projectOpencodeMcpHint"
      : "preferences.opencodeMcpHint";

  const content = (
    <>
      <ConfigPathRow path={configPath} />
      <p className="preferences-hint">{t(hintKey)}</p>
      {scope === "global" && (
        <p className="preferences-hint">{t("preferences.mcpSaveHint")}</p>
      )}
      <p className="preferences-hint">{t("preferences.mcpConnectHint")}</p>

      {servers.length === 0 && (
        <p className="preferences-hint">{t("preferences.mcpEmpty")}</p>
      )}

      {servers.map((server, index) => (
        <div key={`mcp-${index}`} className="preferences-card">
          <div className="preferences-card-header">
            <span className="preferences-card-title">
              {server.id || t("preferences.mcpServerName")}
            </span>
            <button
              type="button"
              className="preferences-link-btn"
              disabled={disabled}
              onClick={() => removeServer(index)}
            >
              {t("preferences.remove")}
            </button>
          </div>

          <div className="preferences-field">
            <label>{t("preferences.mcpServerName")}</label>
            <input
              className="preferences-input"
              value={server.id}
              disabled={disabled}
              onChange={(e) => updateServer(index, { id: e.target.value })}
            />
          </div>

          <div className="preferences-field">
            <label>{t("preferences.mcpTransport")}</label>
            <select
              className="preferences-select"
              value={server.transport}
              disabled={disabled}
              onChange={(e) =>
                updateServer(index, { transport: e.target.value as McpTransport })
              }
            >
              <option value="stdio">stdio</option>
              <option value="remote">remote</option>
            </select>
          </div>

          {server.transport === "stdio" ? (
            <>
              <div className="preferences-field">
                <label>{t("preferences.mcpCommand")}</label>
                <input
                  className="preferences-input"
                  value={server.command}
                  disabled={disabled}
                  placeholder="npx"
                  onChange={(e) => updateServer(index, { command: e.target.value })}
                />
              </div>
              <div className="preferences-field">
                <label>{t("preferences.mcpArgs")}</label>
                <input
                  className="preferences-input"
                  value={server.args.join(" ")}
                  disabled={disabled}
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  onChange={(e) =>
                    updateServer(index, {
                      args: e.target.value
                        .split(/\s+/)
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </div>
              <McpKeyValueEditor
                label={t("preferences.mcpEnv")}
                addLabelKey="preferences.addMcpEnv"
                keyLabelKey="preferences.mcpEnvKey"
                valueLabelKey="preferences.mcpEnvValue"
                record={server.env}
                disabled={disabled}
                onChange={(env) => updateServer(index, { env })}
              />
            </>
          ) : (
            <>
              <div className="preferences-field">
                <label>{t("preferences.mcpUrl")}</label>
                <input
                  className="preferences-input"
                  value={server.url}
                  disabled={disabled}
                  placeholder="https://example.com/mcp"
                  onChange={(e) => updateServer(index, { url: e.target.value })}
                />
              </div>
              <McpKeyValueEditor
                label={t("preferences.mcpHeaders")}
                addLabelKey="preferences.addMcpHeader"
                keyLabelKey="preferences.mcpHeaderKey"
                valueLabelKey="preferences.mcpHeaderValue"
                record={server.headers}
                disabled={disabled}
                secretValues
                onChange={(headers) => updateServer(index, { headers })}
              />
            </>
          )}

          <div className="preferences-field">
            <label>
              <input
                type="checkbox"
                checked={server.enabled}
                disabled={
                  disabled ||
                  connectingIndex === index ||
                  !server.id.trim()
                }
                onChange={(e) => {
                  toggleServerConnection(index, e.target.checked).catch(console.error);
                }}
              />{" "}
              {connectingIndex === index
                ? t("preferences.mcpConnecting")
                : t("preferences.mcpConnected")}
            </label>
          </div>

          <p className="preferences-hint">
            {t("preferences.mcpEndpoint")}: {mcpEndpointLabel(server)}
          </p>
        </div>
      ))}

      <button
        type="button"
        className="preferences-link-btn"
        style={{ marginTop: 8 }}
        disabled={disabled}
        onClick={addServer}
      >
        {t("preferences.addMcpServer")}
      </button>

      <div className="preferences-runtime-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="preferences-btn"
          disabled={disabled || statusLoading}
          onClick={() => refreshStatus().catch(console.error)}
        >
          {statusLoading ? t("preferences.mcpStatusLoading") : t("preferences.mcpRefreshStatus")}
        </button>
      </div>

      {statusError && (
        <p className="preferences-status err" style={{ marginTop: 8 }}>
          {statusError}
        </p>
      )}
      {statusOutput && (
        <pre className="preferences-mcp-status-output">{statusOutput}</pre>
      )}
    </>
  );

  if (embedded) {
    return content;
  }

  return <section className="preferences-section">{content}</section>;
}
