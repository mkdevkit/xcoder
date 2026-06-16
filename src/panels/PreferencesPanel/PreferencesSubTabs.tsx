import type { ReactNode } from "react";
import type { TranslationKey } from "../../i18n/types";
import { useTranslation } from "../../i18n";

export interface PreferencesSubTabItem<T extends string> {
  id: T;
  labelKey: TranslationKey;
}

interface PreferencesSubTabsProps<T extends string> {
  tabs: PreferencesSubTabItem<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
  children: ReactNode;
}

export function PreferencesSubTabs<T extends string>({
  tabs,
  activeTab,
  onChange,
  children,
}: PreferencesSubTabsProps<T>) {
  const { t } = useTranslation();

  return (
    <div className="preferences-subtab-group">
      <div className="preferences-subtabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`preferences-subtab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>
      <div className="preferences-subtab-panel" role="tabpanel">
        {children}
      </div>
    </div>
  );
}

interface PreferencesConfigActionsProps {
  saving: boolean;
  status: "idle" | "ok" | "err";
  statusMessage: string;
  onSave: () => void;
}

export function PreferencesConfigActions({
  saving,
  status,
  statusMessage,
  onSave,
}: PreferencesConfigActionsProps) {
  const { t } = useTranslation();

  return (
    <div className="preferences-actions">
      <button
        type="button"
        className="preferences-btn primary"
        disabled={saving}
        onClick={onSave}
      >
        {saving ? t("preferences.saving") : t("preferences.save")}
      </button>
      {status !== "idle" && (
        <span className={`preferences-status ${status}`}>{statusMessage}</span>
      )}
    </div>
  );
}
