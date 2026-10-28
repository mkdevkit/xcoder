import { useTranslation } from "../../i18n";
import type { TranslationKey } from "../../i18n/types";

interface PermissionActionSelectProps {
  labelKey: TranslationKey;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function PermissionActionSelect({
  labelKey,
  value,
  onChange,
  disabled = false,
}: PermissionActionSelectProps) {
  const { t } = useTranslation();

  return (
    <div className="preferences-field">
      <label>{t(labelKey)}</label>
      <select
        className="preferences-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("preferences.permissionActionDefault")}</option>
        <option value="allow">{t("preferences.permissionAllow")}</option>
        <option value="ask">{t("preferences.permissionAsk")}</option>
        <option value="deny">{t("preferences.permissionDeny")}</option>
      </select>
    </div>
  );
}
