import type { SidebarView } from "../../stores/settings";

function FilesIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 4h6l2 2h4a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M14 4v3a1 1 0 0 0 1 1h3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="10.5" cy="10.5" r="5.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M15 15l4.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface SidebarActivityBarProps {
  activeView: SidebarView;
  explorerTitle: string;
  searchTitle: string;
  onSelect: (view: SidebarView) => void;
}

export function SidebarActivityBar({
  activeView,
  explorerTitle,
  searchTitle,
  onSelect,
}: SidebarActivityBarProps) {
  return (
    <nav className="sidebar-activity-bar" aria-label="Sidebar views">
      <button
        type="button"
        className={`sidebar-activity-item${activeView === "explorer" ? " active" : ""}`}
        title={explorerTitle}
        aria-label={explorerTitle}
        aria-current={activeView === "explorer" ? "page" : undefined}
        onClick={() => onSelect("explorer")}
      >
        <FilesIcon />
      </button>
      <button
        type="button"
        className={`sidebar-activity-item${activeView === "search" ? " active" : ""}`}
        title={searchTitle}
        aria-label={searchTitle}
        aria-current={activeView === "search" ? "page" : undefined}
        onClick={() => onSelect("search")}
      >
        <SearchIcon />
      </button>
      <style>{`
        .sidebar-activity-bar {
          width: 48px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 8px 0;
          gap: 4px;
          background: var(--bg-base);
          border-right: 1px solid var(--border);
        }
        .sidebar-activity-item {
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 0;
          background: transparent;
          color: var(--text-muted);
          padding: 0;
          position: relative;
        }
        .sidebar-activity-item:hover {
          color: var(--text);
          background: transparent;
        }
        .sidebar-activity-item.active {
          color: var(--text);
        }
        .sidebar-activity-item.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 8px;
          bottom: 8px;
          width: 2px;
          background: var(--text);
          border-radius: 0 1px 1px 0;
        }
      `}</style>
    </nav>
  );
}
