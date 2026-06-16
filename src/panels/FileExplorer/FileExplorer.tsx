import { useEffect, useRef, useState, useCallback } from "react";
import { useWorkspaceStore } from "../../stores/workspace";
import { useTranslation } from "../../i18n";
import { useDropZone } from "../../hooks/useDropZone";
import { isInternalPathDrag, hasExternalFilePayload } from "../../utils/externalFileDrop";
import type { ExplorerEditState } from "../../stores/workspace";
import type { FsEntry } from "../../types/fs";
import { parentPath, workspacesMatch } from "../../utils/path";
import { startExplorerDrag } from "../../utils/chatFileReference";

interface InlineNameInputProps {
  initialName: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

function pathsEqual(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right) return false;
  return workspacesMatch(left, right);
}

function resolveExplorerDropDir(
  event: React.DragEvent,
  rootPath: string,
): string | null {
  const item = (event.target as HTMLElement).closest<HTMLElement>(
    ".tree-item[data-path], .explorer-root[data-path]",
  );
  if (item?.dataset.path) {
    const isDir = item.dataset.isDir === "1";
    return isDir ? item.dataset.path : parentPath(item.dataset.path);
  }
  if ((event.target as HTMLElement).closest(".file-explorer")) {
    return rootPath;
  }
  return null;
}

function InlineNameInput({ initialName, onCommit, onCancel }: InlineNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialName);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = initialName.lastIndexOf(".");
    if (dot > 0) {
      input.setSelectionRange(0, dot);
    } else {
      input.select();
    }
  }, [initialName]);

  const commit = () => onCommit(value);

  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
  refreshKey: number;
  rootPath: string;
  siblingEntries: FsEntry[];
  isPathSelected: (path: string) => boolean;
  selectedPaths: string[];
  explorerEdit: ExplorerEditState | null;
  dropTargetDir: string | null;
  onSelect: (path: string, isDir: boolean, additive: boolean) => void;
  onRangeSelect: (entry: FsEntry, siblings: FsEntry[]) => void;
  onOpen: (entry: FsEntry) => void;
  onCommitEdit: (name: string) => void;
  onCancelEdit: () => void;
}

function TreeNode({
  entry,
  depth,
  refreshKey,
  rootPath,
  siblingEntries,
  isPathSelected,
  selectedPaths,
  explorerEdit,
  dropTargetDir,
  onSelect,
  onRangeSelect,
  onOpen,
  onCommitEdit,
  onCancelEdit,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { listDirectory } = useWorkspaceStore();

  const isRenaming =
    explorerEdit?.mode === "rename" && explorerEdit.targetPath === entry.path;
  const isCreatingHere =
    explorerEdit?.mode === "create" && explorerEdit.parentDir === entry.path;
  const isSelected = isPathSelected(entry.path);
  const itemDropDir = entry.is_dir ? entry.path : parentPath(entry.path);
  const isDropTarget = pathsEqual(dropTargetDir, itemDropDir);
  const dragPaths =
    isSelected && selectedPaths.length > 0 ? selectedPaths : [entry.path];

  const loadChildren = async (expand = true) => {
    if (!entry.is_dir) return;
    setLoading(true);
    try {
      const items = await listDirectory(entry.path);
      setChildren(items);
      if (expand) setExpanded(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) {
      loadChildren(false).catch(console.error);
    }
  }, [refreshKey]);

  useEffect(() => {
    if (isCreatingHere && entry.is_dir) {
      loadChildren().catch(console.error);
    }
  }, [isCreatingHere, entry.is_dir, entry.path]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      onRangeSelect(entry, siblingEntries);
      return;
    }
    const additive = e.ctrlKey || e.metaKey;
    onSelect(entry.path, entry.is_dir, additive);
    if (entry.is_dir && !additive) {
      if (expanded) {
        setExpanded(false);
      } else {
        await loadChildren();
      }
      return;
    }
    if (!entry.is_dir && !additive) {
      await onOpen(entry);
    }
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={`tree-item ${isSelected ? "selected" : ""} ${isDropTarget ? "drop-target" : ""}`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        data-path={entry.path}
        data-is-dir={entry.is_dir ? "1" : "0"}
        draggable={!isRenaming}
        onDragStart={(event) => startExplorerDrag(event, dragPaths, rootPath)}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void handleClick(event as unknown as React.MouseEvent);
          }
        }}
      >
        <span className="tree-icon">
          {entry.is_dir ? (expanded ? "▾" : "▸") : "·"}
        </span>
        {isRenaming ? (
          <InlineNameInput
            initialName={explorerEdit.initialName}
            onCommit={onCommitEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <span className="tree-name">{entry.name}</span>
        )}
        {loading && <span className="tree-loading">…</span>}
      </div>
      {expanded && (
        <>
          {children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              refreshKey={refreshKey}
              rootPath={rootPath}
              siblingEntries={children}
              isPathSelected={isPathSelected}
              selectedPaths={selectedPaths}
              explorerEdit={explorerEdit}
              dropTargetDir={dropTargetDir}
              onSelect={onSelect}
              onRangeSelect={onRangeSelect}
              onOpen={onOpen}
              onCommitEdit={onCommitEdit}
              onCancelEdit={onCancelEdit}
            />
          ))}
          {isCreatingHere && (
            <div
              className="tree-item create-row"
              style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
            >
              <span className="tree-icon">·</span>
              <InlineNameInput
                initialName={explorerEdit.initialName}
                onCommit={onCommitEdit}
                onCancel={onCancelEdit}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FileExplorer() {
  const {
    rootPath,
    listDirectory,
    explorerRefreshKey,
    explorerSelectedPath,
    explorerSelectedPaths,
    explorerEdit,
    explorerError,
    setExplorerSelectedPath,
    selectExplorerEntry,
    selectExplorerRange,
    isExplorerPathSelected,
    beginExplorerRename,
    cancelExplorerEdit,
    commitExplorerEdit,
    deleteExplorerEntries,
    openFile,
    importPathsIntoExplorer,
    movePathsInExplorer,
  } = useWorkspaceStore();
  const { t } = useTranslation();
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const explorerRef = useRef<HTMLDivElement>(null);

  const resolveDropDir = useCallback(
    (event: React.DragEvent) => {
      if (!rootPath) return null;
      return resolveExplorerDropDir(event, rootPath);
    },
    [rootPath],
  );

  const explorerDrop = useDropZone({
    enabled: Boolean(rootPath),
    accept: (event) => {
      const transfer = event.dataTransfer;
      if (!transfer) return false;
      return isInternalPathDrag(transfer) || hasExternalFilePayload(transfer);
    },
    getDropEffect: (event) =>
      event.dataTransfer && isInternalPathDrag(event.dataTransfer)
        ? "move"
        : "copy",
    onDrop: async (paths, event) => {
      if (!rootPath) return;
      const targetDir = resolveDropDir(event) ?? rootPath;
      if (event.dataTransfer && isInternalPathDrag(event.dataTransfer)) {
        await movePathsInExplorer(targetDir, paths);
      } else {
        await importPathsIntoExplorer(targetDir, paths);
      }
      setDropTargetDir(null);
    },
  });

  const handleExplorerDragEnter = (event: React.DragEvent) => {
    explorerDrop.handleDragEnter(event);
    setDropTargetDir(resolveDropDir(event));
  };

  const handleExplorerDragOver = (event: React.DragEvent) => {
    explorerDrop.handleDragOver(event);
    setDropTargetDir(resolveDropDir(event));
  };

  const handleExplorerDragLeave = (event: React.DragEvent) => {
    explorerDrop.handleDragLeave(event);
    const next = event.relatedTarget as Node | null;
    if (!next || !explorerRef.current?.contains(next)) {
      setDropTargetDir(null);
    }
  };

  const handleExplorerDrop = (event: React.DragEvent) => {
    setDropTargetDir(resolveDropDir(event));
    explorerDrop.handleDrop(event);
  };

  useEffect(() => {
    if (!rootPath) {
      setEntries([]);
      return;
    }
    listDirectory(rootPath).then(setEntries).catch(console.error);
  }, [rootPath, explorerRefreshKey, listDirectory]);

  const handleExplorerRangeSelect = useCallback(
    (entry: FsEntry, siblings: FsEntry[]) => {
      selectExplorerRange(entry.path, siblings);
    },
    [selectExplorerRange],
  );

  const handleExplorerSelect = useCallback(
    (path: string, isDir: boolean, additive: boolean) => {
      selectExplorerEntry(path, isDir, { additive });
    },
    [selectExplorerEntry],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!rootPath || explorerSelectedPaths.length === 0 || explorerEdit) return;
      if (
        (e.target as HTMLElement).closest(
          "input, textarea, .monaco-editor, .rich-chat-composer, .chat-input-area",
        )
      ) {
        return;
      }
      if (!explorerRef.current?.contains(document.activeElement)) {
        const focusedInExplorer = (e.target as HTMLElement).closest(".file-explorer");
        if (!focusedInExplorer) return;
      }

      if (e.key === "F2" && explorerSelectedPaths.length === 1 && explorerSelectedPath) {
        e.preventDefault();
        beginExplorerRename(explorerSelectedPath);
      }
      if (e.key === "Delete") {
        e.preventDefault();
        deleteExplorerEntries(explorerSelectedPaths).catch(console.error);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    rootPath,
    explorerSelectedPath,
    explorerSelectedPaths,
    explorerEdit,
    beginExplorerRename,
    deleteExplorerEntries,
  ]);

  const handleOpen = async (entry: FsEntry) => {
    if (!entry.is_dir) {
      await openFile(entry.path);
    }
  };

  const isCreatingAtRoot =
    explorerEdit?.mode === "create" && explorerEdit.parentDir === rootPath;

  const isRootDropTarget = pathsEqual(dropTargetDir, rootPath);

  if (!rootPath) {
    return (
      <div className="file-explorer empty">
        <p>{t("explorer.empty")}</p>
        <style>{explorerStyles}</style>
      </div>
    );
  }

  return (
    <div
      ref={explorerRef}
      className={`file-explorer ${explorerDrop.active ? "drop-active" : ""}`}
      data-zone="explorer"
      tabIndex={0}
      onClick={(event) => {
        explorerRef.current?.focus();
        const target = event.target as HTMLElement;
        if (
          target.closest(".tree-item") ||
          target.closest(".tree-rename-input")
        ) {
          return;
        }
        setExplorerSelectedPath(null);
      }}
      onDragEnter={handleExplorerDragEnter}
      onDragOver={handleExplorerDragOver}
      onDragLeave={handleExplorerDragLeave}
      onDrop={handleExplorerDrop}
    >
      <div
        className={`explorer-root ${isRootDropTarget ? "drop-target" : ""}`}
        title={rootPath}
        data-path={rootPath}
        data-is-dir="1"
        onClick={() => setExplorerSelectedPath(null)}
      >
        {rootPath.split(/[\\/]/).pop()}
      </div>
      {explorerError && <div className="explorer-error">{explorerError}</div>}
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          refreshKey={explorerRefreshKey}
          rootPath={rootPath}
          siblingEntries={entries}
          isPathSelected={isExplorerPathSelected}
          selectedPaths={explorerSelectedPaths}
          explorerEdit={explorerEdit}
          dropTargetDir={dropTargetDir}
          onSelect={handleExplorerSelect}
          onRangeSelect={handleExplorerRangeSelect}
          onOpen={handleOpen}
          onCommitEdit={(name) => commitExplorerEdit(name).catch(console.error)}
          onCancelEdit={cancelExplorerEdit}
        />
      ))}
      {isCreatingAtRoot && (
        <div className="tree-item create-row" style={{ paddingLeft: "8px" }}>
          <span className="tree-icon">·</span>
          <InlineNameInput
            initialName={explorerEdit.initialName}
            onCommit={(name) => commitExplorerEdit(name).catch(console.error)}
            onCancel={cancelExplorerEdit}
          />
        </div>
      )}
      <style>{explorerStyles}</style>
    </div>
  );
}

const explorerStyles = `
  .file-explorer {
    height: 100%;
    overflow: auto;
    padding: 8px 0;
    background: var(--bg-sidebar);
    outline: none;
  }
  .file-explorer.empty {
    padding: 16px;
    color: var(--text-muted);
  }
  .explorer-root {
    padding: 4px 12px 8px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 4px;
    margin: 0 4px 4px;
  }
  .explorer-root.drop-target {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-sidebar));
    outline: 1px dashed color-mix(in srgb, var(--accent) 65%, var(--border));
    outline-offset: -1px;
  }
  .explorer-error {
    margin: 0 8px 8px;
    padding: 6px 8px;
    font-size: 11px;
    color: #f48771;
    background: rgba(244, 135, 113, 0.1);
    border-radius: 4px;
  }
  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    padding-top: 3px;
    padding-bottom: 3px;
    padding-right: 8px;
    border-radius: 0;
    color: inherit;
    font: inherit;
    cursor: grab;
    user-select: none;
  }
  .tree-item:active {
    cursor: grabbing;
  }
  .tree-item:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  .tree-item:hover:not(.selected) {
    background: var(--bg-hover);
  }
  .tree-item.selected {
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-sidebar));
  }
  .tree-item.selected:hover {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-sidebar));
  }
  .tree-item.drop-target,
  .file-explorer.drop-active {
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-sidebar));
  }
  .tree-item.drop-target {
    outline: 1px dashed color-mix(in srgb, var(--accent) 65%, var(--border));
    outline-offset: -1px;
  }
  .tree-item.create-row {
    background: var(--bg-hover);
  }
  .tree-icon {
    width: 12px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .tree-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .tree-rename-input {
    flex: 1;
    min-width: 0;
    padding: 1px 4px;
    border: 1px solid var(--accent, #0078d4);
    border-radius: 2px;
    background: var(--bg-editor);
    color: inherit;
    font: inherit;
    font-size: 12px;
  }
  .tree-loading {
    color: var(--text-muted);
    margin-left: auto;
  }
`;
