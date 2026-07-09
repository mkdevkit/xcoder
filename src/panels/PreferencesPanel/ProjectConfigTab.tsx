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
import {
  emptyOpencodePermissions,
  resolveProjectOpencodePermission,
  resolveProjectPreferredModel,
} from "../../utils/projectConfig";
import { tauriInvoke } from "../../utils/tauri";
import type {
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
    setProjectDefaultModel,
    setProjectOpencodePermissions,
  } = useChatStore();
  const [defaultModelDraft, setDefaultModelDraft] = useState("");
  const [activeSubTab, setActiveSubTab] = useState<ProjectSubTab>("permissions");
  const [globalOpencodePermissions, setGlobalOpencodePermissions] =
    useState<OpencodePermissionsView>(emptyOpencodePermissions());

  const projectSubTabs = useMemo((): PreferencesSubTabItem<ProjectSubTab>[] => {
    return [
      { id: "permissions", labelKey: "preferences.subTabProjectPermissions" },
      { id: "skills", labelKey: "preferences.projectSkills" },
      { id: "mcp", labelKey: "preferences.projectMcp" },
      { id: "rules", labelKey: "preferences.projectRules" },
    ];
  }, []);

  useEffect(() => {
    setDefaultModelDraft(projectConfig?.defaultModel ?? "");
  }, [projectConfig?.defaultModel]);

  useEffect(() => {
    tauriInvoke<OpencodeConfigView>("load_opencode_provider_config")
      .then((data) => {
        setGlobalOpencodePermissions(data.permissions ?? emptyOpencodePermissions());
      })
      .catch(console.error);
  }, []);

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

  if (!rootPath) {
    return <p className="preferences-hint">{t("preferences.projectNeedFolder")}</p>;
  }

  return (
    <div>
      <h3 className="preferences-label">{t("preferences.projectConfig")}</h3>
      <ConfigPathRow path={projectConfigPath} />

      <section className="preferences-section">
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

        <PreferencesSubTabs<ProjectSubTab>
          tabs={projectSubTabs}
          activeTab={activeSubTab}
          onChange={setActiveSubTab}
        >
          {activeSubTab === "permissions" && (
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

          {activeSubTab === "skills" && (
            <ProjectSkillsSection
              workspace={rootPath}
              providerId={providerId}
              disabled={runtimeBusy}
              embedded
            />
          )}

          {activeSubTab === "mcp" && (
            <ProjectMcpSection
              workspace={rootPath}
              providerId="opencode"
              disabled={runtimeBusy}
              embedded
            />
          )}

          {activeSubTab === "rules" && (
            <ProjectRulesSection
              workspace={rootPath}
              providerId="opencode"
              disabled={runtimeBusy}
              embedded
            />
          )}
        </PreferencesSubTabs>
      </section>
    </div>
  );
}
