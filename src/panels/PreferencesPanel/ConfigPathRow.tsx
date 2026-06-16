import { useTranslation } from "../../i18n";
import { useWorkspaceStore } from "../../stores/workspace";

interface ConfigPathRowProps {
  path: string | null | undefined;
}

export function ConfigPathRow({ path }: ConfigPathRowProps) {
  const { t } = useTranslation();
  const openFile = useWorkspaceStore((state) => state.openFile);

  if (!path) return null;

  return (
    <div className="preferences-path-row">
      <span className="preferences-path">
        {t("preferences.configPath")}: {path}
      </span>
      <button
        type="button"
        className="preferences-link-btn preferences-open-config-btn"
        onClick={() => openFile(path).catch(console.error)}
      >
        {t("preferences.openConfigFile")}
      </button>
    </div>
  );
}
