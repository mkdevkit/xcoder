import { useSettingsStore } from "../../stores/settings";
import { useTranslation } from "../../i18n";
import { FileExplorer } from "../FileExplorer/FileExplorer";
import { SearchPanel } from "../SearchPanel/SearchPanel";
import { SidebarActivityBar } from "./SidebarActivityBar";

export function SidebarPanel() {
  const { sidebarView, setSidebarView } = useSettingsStore();
  const { t } = useTranslation();

  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <SidebarActivityBar
          activeView={sidebarView}
          explorerTitle={t("panel.explorer")}
          searchTitle={t("panel.search")}
          onSelect={setSidebarView}
        />
        <div className="sidebar-main">
          <div className="panel-header">
            <span className="panel-title">
              {sidebarView === "explorer" ? t("panel.explorer") : t("panel.search")}
            </span>
          </div>
          <div className="sidebar-panel-body">
            {sidebarView === "explorer" ? <FileExplorer /> : <SearchPanel />}
          </div>
        </div>
      </div>
      <style>{`
        .sidebar {
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border);
        }
        .sidebar-inner {
          height: 100%;
          display: flex;
          min-height: 0;
        }
        .sidebar-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .sidebar-panel-body {
          flex: 1;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .panel-header {
          padding: 10px 12px 6px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-sidebar);
          flex-shrink: 0;
        }
      `}</style>
    </aside>
  );
}
