import { useState } from "react";
import { useTranslation, localeLabel } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";
import { APP_LOCALES, type AppLocale } from "../../i18n/types";
import { CodewhaleConfigTab } from "./CodewhaleConfigTab";
import { OpenCodeConfigTab } from "./OpenCodeConfigTab";
import { GeneralConfigTab } from "./GeneralConfigTab";
import { ProjectConfigTab } from "./ProjectConfigTab";
import { preferencesStyles } from "./preferencesStyles";
import { useWorkspaceStore } from "../../stores/workspace";

type PreferencesTab = "general" | "project" | "codewhale" | "opencode";

export function PreferencesPanel() {
  const { t } = useTranslation();
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const [activeTab, setActiveTab] = useState<PreferencesTab>("general");
  const rootPath = useWorkspaceStore((state) => state.rootPath);

  return (
    <div className="preferences-panel">
      <h2 className="preferences-title">{t("preferences.title")}</h2>

      <div className="preferences-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`preferences-tab ${activeTab === "general" ? "active" : ""}`}
          onClick={() => setActiveTab("general")}
        >
          {t("preferences.tabGeneral")}
        </button>
        {rootPath && (
          <button
            type="button"
            role="tab"
            className={`preferences-tab ${activeTab === "project" ? "active" : ""}`}
            onClick={() => setActiveTab("project")}
          >
            {t("preferences.tabProject")}
          </button>
        )}
        <button
          type="button"
          role="tab"
          className={`preferences-tab ${activeTab === "codewhale" ? "active" : ""}`}
          onClick={() => setActiveTab("codewhale")}
        >
          {t("preferences.tabCodewhale")}
        </button>
        <button
          type="button"
          role="tab"
          className={`preferences-tab ${activeTab === "opencode" ? "active" : ""}`}
          onClick={() => setActiveTab("opencode")}
        >
          {t("preferences.tabOpencode")}
        </button>
      </div>

      {activeTab === "general" && (
        <div role="tabpanel">
          <section className="preferences-section">
            <label className="preferences-label" htmlFor="locale-select">
              {t("preferences.language")}
            </label>
            <p className="preferences-hint">{t("preferences.languageHint")}</p>
            <select
              id="locale-select"
              className="preferences-select"
              value={locale}
              onChange={(event) => setLocale(event.target.value as AppLocale)}
            >
              {APP_LOCALES.map((item) => (
                <option key={item} value={item}>
                  {localeLabel(item)}
                </option>
              ))}
            </select>
          </section>

          <GeneralConfigTab />
        </div>
      )}

      {activeTab === "project" && rootPath && (
        <div role="tabpanel">
          <ProjectConfigTab key={rootPath} />
        </div>
      )}

      {activeTab === "codewhale" && (
        <div role="tabpanel">
          <CodewhaleConfigTab />
        </div>
      )}

      {activeTab === "opencode" && (
        <div role="tabpanel">
          <OpenCodeConfigTab />
        </div>
      )}

      <style>{preferencesStyles}</style>
    </div>
  );
}
