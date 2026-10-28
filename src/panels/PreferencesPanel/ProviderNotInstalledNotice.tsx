import type { TranslationKey } from "../../i18n/types";
import { useTranslation } from "../../i18n";

interface ProviderNotInstalledNoticeProps {
  titleKey: TranslationKey;
  hintKey: TranslationKey;
  configPath: string;
  onReload: () => void;
  reloading?: boolean;
}

export function ProviderNotInstalledNotice({
  titleKey,
  hintKey,
  configPath,
  onReload,
  reloading = false,
}: ProviderNotInstalledNoticeProps) {
  const { t } = useTranslation();

  return (
    <div className="preferences-not-installed">
      <h3 className="preferences-label">{t(titleKey)}</h3>
      <p className="preferences-not-installed-status">
        {t("preferences.providerNotInstalled")}
      </p>
      {configPath && (
        <p className="preferences-path">
          {t("preferences.configPath")}: {configPath}
        </p>
      )}
      <pre className="preferences-install-hint">{t(hintKey)}</pre>
      <div className="preferences-actions">
        <button
          type="button"
          className="preferences-btn"
          disabled={reloading}
          onClick={onReload}
        >
          {reloading ? t("preferences.loading") : t("preferences.reload")}
        </button>
      </div>
    </div>
  );
}
