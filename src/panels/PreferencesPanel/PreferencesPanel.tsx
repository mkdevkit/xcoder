import { useTranslation, localeLabel } from "../../i18n";
import { useSettingsStore } from "../../stores/settings";
import { APP_LOCALES, type AppLocale } from "../../i18n/types";
export function PreferencesPanel() {
  const { t } = useTranslation();
  const locale = useSettingsStore((state) => state.locale);
  const setLocale = useSettingsStore((state) => state.setLocale);

  return (
    <div className="preferences-panel">
      <h2 className="preferences-title">{t("preferences.title")}</h2>

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

      <section className="preferences-section">
        <div className="preferences-label">{t("preferences.appearance")}</div>
        <p className="preferences-hint">{t("preferences.appearanceHint")}</p>
      </section>

      <style>{`
        .preferences-panel {
          height: 100%;
          overflow: auto;
          padding: 24px 28px;
          color: var(--text);
        }
        .preferences-title {
          margin: 0 0 20px;
          font-size: 20px;
          font-weight: 600;
        }
        .preferences-section + .preferences-section {
          margin-top: 28px;
        }
        .preferences-label {
          display: block;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .preferences-hint {
          margin: 0 0 10px;
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.5;
        }
        .preferences-select {
          min-width: 220px;
          padding: 8px 10px;
        }
      `}</style>
    </div>
  );
}
