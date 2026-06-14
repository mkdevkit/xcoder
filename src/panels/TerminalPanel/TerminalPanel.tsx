import { useSettingsStore } from "../../stores/settings";
import { useTerminalStore } from "../../stores/terminal";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import { TerminalInstance } from "./TerminalInstance";

export function TerminalPanel() {
  const { terminalVisible } = useSettingsStore();
  const { tabs, activeId, closeTerminal, createTerminal, setActiveTerminal } =
    useTerminalStore();
  const { rootPath } = useWorkspaceStore();
  const { t } = useTranslation();

  const handleCloseActive = async () => {
    if (!activeId) return;
    await closeTerminal(activeId);
  };

  const handleNewTerminal = () => {
    createTerminal(rootPath ?? undefined).catch(console.error);
  };

  if (!terminalVisible) {
    return null;
  }

  const showSidebar = tabs.length > 1;

  return (
    <div className="terminal-panel" data-zone="terminal">
      <div className="terminal-header">
        <span className="panel-title">{t("terminal.title")}</span>
        <div className="terminal-header-actions">
          <button
            className="terminal-action-btn"
            title={t("terminal.new")}
            onClick={handleNewTerminal}
          >
            +
          </button>
          <button
            className="terminal-action-btn terminal-close-btn"
            title={t("terminal.close")}
            disabled={!activeId}
            onClick={() => handleCloseActive()}
          >
            ×
          </button>
        </div>
      </div>

      <div className={`terminal-content ${showSidebar ? "with-sidebar" : ""}`}>
        <div className="terminal-viewport">
          {tabs.map((tab) => (
            <TerminalInstance
              key={tab.id}
              id={tab.id}
              active={tab.id === activeId}
            />
          ))}
        </div>

        {showSidebar && (
          <aside className="terminal-sidebar">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`terminal-tab ${tab.id === activeId ? "active" : ""}`}
                onClick={() => setActiveTerminal(tab.id)}
              >
                <span className="terminal-tab-title">{tab.title}</span>
                {tab.exited && <span className="terminal-tab-badge">{t("terminal.exited")}</span>}
              </button>
            ))}
          </aside>
        )}
      </div>

      <style>{`
        .terminal-panel {
          display: flex;
          flex-direction: column;
          border-top: 1px solid var(--border);
          background: var(--bg-base);
          min-height: 0;
        }
        .terminal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 32px;
          padding: 0 8px 0 12px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-panel);
        }
        .terminal-header-actions {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .terminal-action-btn {
          width: 24px;
          height: 24px;
          padding: 0;
          border-radius: 4px;
          font-size: 16px;
          line-height: 1;
        }
        .terminal-close-btn {
          font-size: 16px;
        }
        .terminal-content {
          flex: 1;
          min-height: 0;
          display: flex;
        }
        .terminal-content.with-sidebar .terminal-viewport {
          border-right: 1px solid var(--border);
        }
        .terminal-viewport {
          flex: 1;
          min-width: 0;
          position: relative;
          padding: 4px 0 0 4px;
        }
        .terminal-instance,
        .terminal-instance .xterm {
          width: 100%;
          height: 100%;
        }
        .terminal-sidebar {
          width: 140px;
          flex-shrink: 0;
          overflow: auto;
          background: var(--bg-panel);
          padding: 4px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .terminal-tab {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          width: 100%;
          text-align: left;
          border: none;
          background: transparent;
          padding: 6px 8px;
          border-radius: 4px;
        }
        .terminal-tab:hover,
        .terminal-tab.active {
          background: var(--bg-hover);
        }
        .terminal-tab-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
        }
        .terminal-tab-badge {
          flex-shrink: 0;
          font-size: 10px;
          color: var(--warning);
        }
      `}</style>
    </div>
  );
}
