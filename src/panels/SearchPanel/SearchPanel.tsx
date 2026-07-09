import { useCallback, useEffect, useMemo } from "react";
import { useSearchStore } from "../../stores/search";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import type { WorkspaceSearchMatch } from "../../types/search";
import { isTauri } from "../../utils/tauri";

function SearchMatchPreview({
  text,
  matchStart,
  matchEnd,
}: {
  text: string;
  matchStart: number;
  matchEnd: number;
}) {
  const chars = [...text];
  const before = chars.slice(0, matchStart - 1).join("");
  const match = chars.slice(matchStart - 1, matchEnd - 1).join("");
  const after = chars.slice(matchEnd - 1).join("");

  return (
    <span className="search-match-preview">
      <span className="search-match-context">{before}</span>
      <span className="search-match-highlight">{match}</span>
      <span className="search-match-context">{after}</span>
    </span>
  );
}

function groupMatchesByFile(matches: WorkspaceSearchMatch[]) {
  const groups: { path: string; matches: WorkspaceSearchMatch[] }[] = [];
  const seen = new Map<string, WorkspaceSearchMatch[]>();

  for (const match of matches) {
    const list = seen.get(match.path);
    if (list) {
      list.push(match);
    } else {
      const next = [match];
      seen.set(match.path, next);
      groups.push({ path: match.path, matches: next });
    }
  }

  return groups;
}

function displayPath(path: string, rootPath: string | null) {
  if (!rootPath) return path;
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const prefix = normalizedRoot + (path.includes("\\") ? "\\" : "/");
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }
  return path.split(/[\\/]/).pop() ?? path;
}

export function SearchPanel() {
  const { t } = useTranslation();
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openFileAtLocation = useWorkspaceStore((state) => state.openFileAtLocation);
  const bumpExplorerRefresh = useWorkspaceStore(
    (state) => state.bumpExplorerRefresh,
  );

  const {
    query,
    replaceWith,
    caseSensitive,
    wholeWord,
    useRegex,
    includePattern,
    excludePattern,
    showReplace,
    searching,
    replacing,
    error,
    matches,
    fileCount,
    matchCount,
    truncated,
    collapsedFiles,
    setQuery,
    setReplaceWith,
    setCaseSensitive,
    setWholeWord,
    setUseRegex,
    setIncludePattern,
    setExcludePattern,
    setShowReplace,
    toggleFileCollapsed,
    runSearch,
    replaceAll,
    clearResults,
  } = useSearchStore();

  const grouped = useMemo(() => groupMatchesByFile(matches), [matches]);

  useEffect(() => {
    if (!query.trim()) {
      clearResults();
      return;
    }
    const timer = window.setTimeout(() => {
      runSearch(rootPath).catch(console.error);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    query,
    caseSensitive,
    wholeWord,
    useRegex,
    includePattern,
    excludePattern,
    rootPath,
    runSearch,
    clearResults,
  ]);

  const handleOpenMatch = useCallback(
    (match: WorkspaceSearchMatch) => {
      openFileAtLocation(`${match.path}:${match.line}:${match.column}`).catch(
        console.error,
      );
    },
    [openFileAtLocation],
  );

  const handleReplaceAll = async () => {
    const result = await replaceAll(rootPath);
    if (result && result.filesChanged > 0) {
      bumpExplorerRefresh();
    }
  };

  if (!isTauri()) {
    return <div className="search-panel empty">{t("search.desktopOnly")}</div>;
  }

  if (!rootPath) {
    return <div className="search-panel empty">{t("search.openProject")}</div>;
  }

  return (
    <div className="search-panel">
      <div className="search-controls">
        <div className="search-toolbar">
          <button
            type="button"
            className={`search-toggle${showReplace ? " active" : ""}`}
            title={t("search.toggleReplace")}
            aria-label={t("search.toggleReplace")}
            onClick={() => setShowReplace(!showReplace)}
          >
            <span className="search-toggle-icon">▾</span>
          </button>
          <div className="search-options">
            <button
              type="button"
              className={`search-option${caseSensitive ? " active" : ""}`}
              title={t("search.matchCase")}
              aria-pressed={caseSensitive}
              onClick={() => setCaseSensitive(!caseSensitive)}
            >
              Aa
            </button>
            <button
              type="button"
              className={`search-option${wholeWord ? " active" : ""}`}
              title={t("search.matchWholeWord")}
              aria-pressed={wholeWord}
              onClick={() => setWholeWord(!wholeWord)}
            >
              ab
            </button>
            <button
              type="button"
              className={`search-option${useRegex ? " active" : ""}`}
              title={t("search.useRegex")}
              aria-pressed={useRegex}
              onClick={() => setUseRegex(!useRegex)}
            >
              .*
            </button>
          </div>
        </div>

        <div className="search-input-row">
          <input
            className="search-input"
            type="text"
            value={query}
            placeholder={t("search.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                runSearch(rootPath).catch(console.error);
              }
            }}
          />
        </div>

        {showReplace && (
          <div className="search-input-row replace-row">
            <input
              className="search-input"
              type="text"
              value={replaceWith}
              placeholder={t("search.replacePlaceholder")}
              onChange={(event) => setReplaceWith(event.target.value)}
            />
            <button
              type="button"
              className="search-action-btn"
              disabled={!query.trim() || replacing}
              onClick={() => handleReplaceAll().catch(console.error)}
            >
              {replacing ? t("search.replacing") : t("search.replaceAll")}
            </button>
          </div>
        )}

        <input
          className="search-filter-input"
          type="text"
          value={includePattern}
          placeholder={t("search.filesToInclude")}
          onChange={(event) => setIncludePattern(event.target.value)}
        />
        <input
          className="search-filter-input"
          type="text"
          value={excludePattern}
          placeholder={t("search.filesToExclude")}
          onChange={(event) => setExcludePattern(event.target.value)}
        />
      </div>

      <div className="search-results-header">
        {searching
          ? t("search.searching")
          : query.trim()
            ? t("search.summary", {
                count: String(matchCount),
                files: String(fileCount),
              })
            : t("search.hint")}
        {truncated && !searching && (
          <span className="search-truncated">{t("search.truncated")}</span>
        )}
      </div>

      {error && <div className="search-error">{error}</div>}

      <div className="search-results">
        {!searching && query.trim() && matchCount === 0 && !error && (
          <div className="search-no-results">{t("search.noResults")}</div>
        )}

        {grouped.map((group) => {
          const collapsed = collapsedFiles[group.path] ?? false;
          const relative = displayPath(group.path, rootPath);
          return (
            <div key={group.path} className="search-file-group">
              <button
                type="button"
                className="search-file-header"
                onClick={() => toggleFileCollapsed(group.path)}
              >
                <span className={`search-file-chevron${collapsed ? " collapsed" : ""}`}>
                  ▾
                </span>
                <span className="search-file-path" title={group.path}>
                  {relative}
                </span>
                <span className="search-file-count">{group.matches.length}</span>
              </button>
              {!collapsed &&
                group.matches.map((match) => (
                  <button
                    key={`${match.path}:${match.line}:${match.column}`}
                    type="button"
                    className="search-result-item"
                    onClick={() => handleOpenMatch(match)}
                    title={group.path}
                  >
                    <span className="search-result-line">{match.line}</span>
                    <SearchMatchPreview
                      text={match.preview}
                      matchStart={match.matchStart}
                      matchEnd={match.matchEnd}
                    />
                  </button>
                ))}
            </div>
          );
        })}
      </div>

      <style>{searchPanelStyles}</style>
    </div>
  );
}

const searchPanelStyles = `
  .search-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--bg-sidebar);
  }
  .search-panel.empty {
    padding: 16px 12px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .search-controls {
    padding: 8px 10px 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .search-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .search-toggle {
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .search-toggle:hover {
    background: var(--bg-hover);
  }
  .search-toggle-icon {
    display: inline-block;
    transition: transform 0.15s;
    font-size: 11px;
  }
  .search-toggle:not(.active) .search-toggle-icon {
    transform: rotate(-90deg);
  }
  .search-options {
    display: flex;
    gap: 2px;
    margin-left: auto;
  }
  .search-option {
    min-width: 26px;
    height: 22px;
    padding: 0 4px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-family: var(--font-mono);
  }
  .search-option:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .search-option.active {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .search-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .search-input,
  .search-filter-input {
    width: 100%;
    min-width: 0;
    height: 26px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--bg-editor);
    color: var(--text);
    font-size: 12px;
  }
  .search-input:focus,
  .search-filter-input:focus {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .search-filter-input {
    font-size: 11px;
    color: var(--text-muted);
  }
  .search-action-btn {
    flex-shrink: 0;
    height: 26px;
    padding: 0 8px;
    font-size: 11px;
    white-space: nowrap;
  }
  .search-results-header {
    padding: 6px 12px;
    font-size: 11px;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .search-truncated {
    color: var(--warning);
  }
  .search-error {
    margin: 8px 10px 0;
    padding: 6px 8px;
    font-size: 11px;
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    border-radius: 4px;
    flex-shrink: 0;
  }
  .search-results {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 4px 0 8px;
  }
  .search-no-results {
    padding: 12px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .search-file-group {
    margin-bottom: 2px;
  }
  .search-file-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px 4px 6px;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 12px;
  }
  .search-file-header:hover {
    background: var(--bg-hover);
  }
  .search-file-chevron {
    width: 12px;
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-muted);
    transition: transform 0.15s;
  }
  .search-file-chevron.collapsed {
    transform: rotate(-90deg);
  }
  .search-file-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }
  .search-file-count {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-elevated);
    border-radius: 10px;
    padding: 0 6px;
    min-width: 18px;
    text-align: center;
  }
  .search-result-item {
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 2px 8px 2px 22px;
    border: none;
    background: transparent;
    color: var(--text);
    text-align: left;
    font-size: 12px;
    font-family: var(--font-mono);
    line-height: 1.45;
  }
  .search-result-item:hover {
    background: var(--bg-hover);
  }
  .search-result-line {
    flex-shrink: 0;
    width: 28px;
    text-align: right;
    color: var(--text-muted);
    user-select: none;
  }
  .search-match-preview {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .search-match-context {
    color: var(--text-muted);
  }
  .search-match-highlight {
    color: var(--text);
    background: color-mix(in srgb, var(--warning) 35%, transparent);
    border-radius: 2px;
    padding: 0 1px;
  }
`;
