import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../i18n";
import { useChatStore, useActiveProviderChat } from "../../stores/chat";
import { useWorkspaceStore } from "../../stores/workspace";
import { ConfigPathRow } from "./ConfigPathRow";
import { ProjectSkillsSection } from "./ProjectSkillsSection";
import { ProjectMcpSection } from "./ProjectMcpSection";
import { ProjectRulesSection } from "./ProjectRulesSection";
import { PermissionActionSelect } from "./PermissionActionSelect";
import {
  PreferencesSubTabs,
  type PreferencesSubTabItem,
} from "./PreferencesSubTabs";
import { getProviderLabel } from "../../utils/agentProvider";
import {
  emptyOpencodePermissions,
  resolveProjectCodewhaleApprovalMode,
  resolveProjectOpencodePermission,
  resolveProjectPreferredModel,
} from "../../utils/projectConfig";
import { tauriInvoke } from "../../utils/tauri";
import type {
  CodewhaleConfigView,
  OpencodeConfigView,
  OpencodePermissionsView,
} from "../../types/providerConfig";

type ProjectSubTab = "permissions" | "skills" | "mcp" | "rules";

export function ProjectConfigTab() {
  const { t } = useTranslation();
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const projectConfigPath = useWorkspaceStore((state) => state.projectConfigPath);
  const projectConfig = useWorkspaceStore((state) => state.projectConfig);
  const {
    config,
    providerId,
    runtime,
    connectedIntent,
    runtimeBusy,
    runtimeAction,
  } = useActiveProviderChat();
  const {
    connectRuntime,
    disconnectRuntime,
    setProjectProvider,
    setProjectDefaultModel,
    setProjectOpencodePermissions,
    setProjectCodewhaleApprovalMode,
  } = useChatStore();
  const [defaultModelDraft, setDefaultModelDraft] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<ProjectSubTab>("permissions");
  const [globalOpencodePermissions, setGlobalOpencodePermissions] =
    useState<OpencodePermissionsView>(emptyOpencodePermissions());
  const [globalCodewhaleApprovalMode, setGlobalCodewhaleApprovalMode] = useState("suggest");

  const effectiveProvider = projectConfig?.provider ?? providerId;
  const isOpencodeProject = effectiveProvider === "opencode";
  const isCodewhaleProject = effectiveProvider === "codewhale";
  const showProjectPermissions = isOpencodeProject || isCodewhaleProject;
  const showProjectSkills = showProjectPermissions;
  const showProjectMcp = showProjectSkills;
  const showProjectRules = showProjectPermissions;

  const projectSubTabs = useMemo((): PreferencesSubTabItem<ProjectSubTab>[] => {
    const tabs: PreferencesSubTabItem<ProjectSubTab>[] = [];
    if (showProjectPermissions) {
      tabs.push({
        id: "permissions",
        labelKey: "preferences.subTabProjectPermissions",
      });
    }
    if (showProjectSkills) {
      tabs.push({ id: "skills", labelKey: "preferences.projectSkills" });
    }
    if (showProjectMcp) {
      tabs.push({ id: "mcp", labelKey: "preferences.projectMcp" });
    }
    if (showProjectRules) {
      tabs.push({ id: "rules", labelKey: "preferences.projectRules" });
    }
    return tabs;
  }, [showProjectMcp, showProjectPermissions, showProjectRules, showProjectSkills]);

  useEffect(() => {
    if (projectSubTabs.length === 0) return;
    if (!projectSubTabs.some((tab) => tab.id === activeSubTab)) {
      setActiveSubTab(projectSubTabs[0].id);
    }
  }, [activeSubTab, projectSubTabs]);

  useEffect(() => {
    setDefaultModelDraft(projectConfig?.defaultModel ?? "");
  }, [projectConfig?.defaultModel]);

  useEffect(() => {
    if (!isOpencodeProject) return;
    tauriInvoke<OpencodeConfigView>("load_opencode_provider_config")
      .then((data) => {
        setGlobalOpencodePermissions(data.permissions ?? emptyOpencodePermissions());
      })
      .catch(console.error);
  }, [isOpencodeProject]);

  useEffect(() => {
    if (!isCodewhaleProject) return;
    tauriInvoke<CodewhaleConfigView>("load_codewhale_provider_config")
      .then((data) => {
        setGlobalCodewhaleApprovalMode(data.approvalMode || "suggest");
      })
      .catch(console.error);
  }, [isCodewhaleProject]);

  const handleConnect = useCallback(async () => {
    if (!rootPath) return;
    if (connectedIntent) {
      await disconnectRuntime();
      return;
    }
    await connectRuntime(rootPath);
  }, [connectedIntent, connectRuntime, disconnectRuntime, rootPath]);

  const connectLabel = runtimeBusy
    ? runtimeAction === "disconnect"
      ? t("chat.disconnecting")
      : t("chat.connecting")
    : connectedIntent
      ? t("chat.disconnect")
      : t("chat.connect");

  const effectiveDefaultModel = resolveProjectPreferredModel(
    projectConfig,
    config,
  );

  const projectPermissions =
    projectConfig?.opencodePermissions ?? emptyOpencodePermissions();

  const updateProjectPermission = (
    key: keyof OpencodePermissionsView,
    value: string,
  ) => {
    setProjectOpencodePermissions({ [key]: value }).catch(console.error);
  };

  const projectMcpProviderId = isCodewhaleProject
    ? "codewhale"
    : isOpencodeProject
      ? "opencode"
      : null;

  const globalCodewhaleApprovalFallback =
    globalCodewhaleApprovalMode.trim() || "suggest";
  const effectiveCodewhaleApproval =
    resolveProjectCodewhaleApprovalMode(projectConfig, globalCodewhaleApprovalMode) ||
    globalCodewhaleApprovalFallback;

  if (!rootPath) {
    return <p className="preferences-hint">{t("preferences.projectNeedFolder")}</p>;
  }

  return (
    <div>
      <h3 className="preferences-label">{t("preferences.projectConfig")}</h3>
      <ConfigPathRow path={projectConfigPath} />

      <section className="preferences-section">
        <div className="preferences-field">
          <label>{t("preferences.projectProvider")}</label>
          <select
            className="preferences-select"
            value={projectConfig?.provider ?? providerId}
            disabled={runtimeBusy}
            onChange={(event) =>
              setProjectProvider(event.target.value).catch(console.error)
            }
          >
            {(config?.providers ?? []).map((provider) => (
              <option key={provider.id} value={provider.id}>
                {getProviderLabel(provider.id)}
              </option>
            ))}
          </select>
          <p className="preferences-hint">{t("preferences.projectProviderHint")}</p>
        </div>

        <div className="preferences-project-runtime-panel">
          <div className="preferences-runtime-status">
            {t("preferences.projectRuntimeStatus", {
              service: runtime.running
                ? t("preferences.runtimeRunning")
                : t("preferences.runtimeStopped"),
              link: connectedIntent
                ? t("preferences.projectLinked")
                : t("preferences.projectUnlinked"),
            })}
          </div>

          <div className="preferences-runtime-actions">
            <button
              type="button"
              className={`preferences-btn ${connectedIntent ? "" : "primary"}`}
              disabled={runtimeBusy}
              onClick={() => handleConnect().catch(console.error)}
            >
              {connectLabel}
            </button>
          </div>
          <p className="preferences-hint">{t("preferences.projectConnectHint")}</p>
        </div>

        <div className="preferences-field">
          <label>{t("preferences.defaultModel")}</label>
          <input
            className="preferences-input"
            value={defaultModelDraft}
            placeholder={config?.app.default_model || ""}
            disabled={runtimeBusy}
            onChange={(e) => setDefaultModelDraft(e.target.value)}
            onBlur={() => {
              if (defaultModelDraft === (projectConfig?.defaultModel ?? "")) return;
              setProjectDefaultModel(defaultModelDraft).catch(console.error);
            }}
          />
          <p className="preferences-hint">
            {t("preferences.projectDefaultModelHint", {
              fallback: config?.app.default_model || "—",
              effective: effectiveDefaultModel || "—",
            })}
          </p>
        </div>

        {projectSubTabs.length > 0 && (
          <PreferencesSubTabs<ProjectSubTab>
            tabs={projectSubTabs}
            activeTab={activeSubTab}
            onChange={setActiveSubTab}
          >
            {activeSubTab === "permissions" && isOpencodeProject && (
              <section className="preferences-section" style={{ marginTop: 0, paddingTop: 0 }}>
                <p className="preferences-hint">
                  {t("preferences.projectOpencodePermissionsHint")}
                </p>
                {(
                  [
                    ["edit", "preferences.permissionEdit"],
                    ["bash", "preferences.permissionBash"],
                    ["read", "preferences.permissionRead"],
                    ["webfetch", "preferences.permissionWebfetch"],
                  ] as const
                ).map(([key, labelKey]) => {
                  const fallback =
                    globalOpencodePermissions[key]?.trim() ||
                    t("preferences.permissionActionDefault");
                  const effective =
                    resolveProjectOpencodePermission(
                      key,
                      projectConfig,
                      globalOpencodePermissions,
                    ) || t("preferences.permissionActionDefault");
                  return (
                    <div key={key}>
                      <PermissionActionSelect
                        labelKey={labelKey}
                        value={projectPermissions[key] ?? ""}
                        disabled={runtimeBusy}
                        onChange={(value) => updateProjectPermission(key, value)}
                      />
                      <p className="preferences-hint">
                        {t("preferences.projectOpencodePermissionFieldHint", {
                          fallback,
                          effective,
                        })}
                      </p>
                    </div>
                  );
                })}
              </section>
            )}

            {activeSubTab === "permissions" && isCodewhaleProject && (
              <section className="preferences-section" style={{ marginTop: 0, paddingTop: 0 }}>
                <p className="preferences-hint">
                  {t("preferences.projectCodewhalePermissionsHint")}
                </p>
                <p className="preferences-hint">{t("preferences.codewhalePermissionsHint")}</p>
                <div className="preferences-field">
                  <label>{t("preferences.approvalMode")}</label>
                  <select
                    className="preferences-select"
                    value={projectConfig?.codewhaleApprovalMode ?? ""}
                    disabled={runtimeBusy}
                    onChange={(event) =>
                      setProjectCodewhaleApprovalMode(event.target.value).catch(console.error)
                    }
                  >
                    <option value="">{t("preferences.permissionActionDefault")}</option>
                    <option value="suggest">suggest</option>
                    <option value="auto">auto</option>
                    <option value="never">never</option>
                  </select>
                  <p className="preferences-hint">
                    {t("preferences.projectCodewhaleApprovalFieldHint", {
                      fallback: globalCodewhaleApprovalFallback,
                      effective: effectiveCodewhaleApproval,
                    })}
                  </p>
                </div>
              </section>
            )}

            {activeSubTab === "skills" && showProjectSkills && (
              <ProjectSkillsSection
                workspace={rootPath}
                providerId={effectiveProvider}
                disabled={runtimeBusy}
                embedded
              />
            )}

            {activeSubTab === "mcp" && showProjectMcp && projectMcpProviderId && (
              <ProjectMcpSection
                workspace={rootPath}
                providerId={projectMcpProviderId}
                disabled={runtimeBusy}
                embedded
              />
            )}

            {activeSubTab === "rules" && showProjectRules && (
              <ProjectRulesSection
                workspace={rootPath}
                providerId={effectiveProvider as "codewhale" | "opencode"}
                disabled={runtimeBusy}
                embedded
              />
            )}
          </PreferencesSubTabs>
        )}
      </section>
    </div>
  );
}
