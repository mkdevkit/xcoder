export const preferencesStyles = `
  .preferences-panel {
    height: 100%;
    overflow: auto;
    padding: 24px 28px;
    color: var(--text);
  }
  .preferences-title {
    margin: 0 0 16px;
    font-size: 20px;
    font-weight: 600;
  }
  .preferences-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0;
  }
  .preferences-tab {
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-size: 13px;
  }
  .preferences-tab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .preferences-subtab-group {
    max-width: 720px;
    margin-top: 4px;
  }
  .preferences-subtabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0;
  }
  .preferences-subtab {
    padding: 8px 14px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    font-size: 13px;
  }
  .preferences-subtab.active {
    color: var(--text);
    border-bottom-color: var(--accent);
    font-weight: 600;
  }
  .preferences-subtab-panel {
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 8px 8px;
    padding: 16px 18px;
    background: var(--bg-panel);
  }
  .preferences-subtab-panel .preferences-section:first-child {
    margin-top: 0;
  }
  .preferences-subtab-panel .preferences-section:last-child {
    margin-bottom: 0;
  }
  .preferences-mcp-kv-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: end;
    margin-bottom: 8px;
  }
    margin: 12px 0 0;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    max-height: 280px;
    overflow: auto;
  }
  .preferences-section + .preferences-section {
    margin-top: 24px;
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
  .preferences-path {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    word-break: break-all;
    flex: 1;
    min-width: 0;
  }
  .preferences-path-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 16px;
    max-width: 720px;
  }
  .preferences-open-config-btn {
    flex-shrink: 0;
  }
  .preferences-not-installed {
    max-width: 720px;
  }
  .preferences-not-installed-status {
    margin: 0 0 12px;
    font-size: 14px;
    color: var(--text-muted);
  }
  .preferences-install-hint {
    margin: 0 0 16px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-panel);
    color: var(--text);
    font-size: 12px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .preferences-input,
  .preferences-select {
    width: 100%;
    max-width: 480px;
    padding: 8px 10px;
    box-sizing: border-box;
  }
  .preferences-input-readonly {
    cursor: default;
    opacity: 0.85;
  }
  .preferences-actions {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 20px;
  }
  .preferences-btn {
    padding: 8px 16px;
    cursor: pointer;
  }
  .preferences-btn.primary {
    background: var(--accent);
    color: #fff;
    border: none;
  }
  .preferences-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .preferences-status {
    font-size: 12px;
    color: var(--text-muted);
  }
  .preferences-status.ok {
    color: #4caf50;
  }
  .preferences-status.err {
    color: #f44336;
  }
  .preferences-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    margin-top: 12px;
    max-width: 720px;
  }
  .preferences-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }
  .preferences-card-title {
    font-weight: 600;
    font-size: 14px;
  }
  .preferences-field {
    margin-bottom: 12px;
  }
  .preferences-field label {
    display: block;
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .preferences-model-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: end;
    margin-bottom: 8px;
  }
  .preferences-model-compact-field {
    width: 240px;
    max-width: 50%;
    flex: 0 0 auto;
  }
  .preferences-model-compact-field .preferences-input {
    max-width: 100%;
  }
  .preferences-model-card {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    margin-bottom: 10px;
    background: var(--bg-elevated);
  }
  .preferences-model-limit-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 8px;
  }
  .preferences-modalities-row {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: flex-start;
  }
  .preferences-modality-field {
    margin-bottom: 0;
    flex: 0 0 auto;
  }
  .preferences-modality-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    margin-top: 4px;
  }
  .preferences-modality-option {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text);
    cursor: pointer;
  }
  .preferences-link-btn {
    padding: 4px 8px;
    font-size: 12px;
    cursor: pointer;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }
  .preferences-field-row {
    display: grid;
    grid-template-columns: 1fr 160px;
    gap: 12px;
    max-width: 720px;
  }
  .preferences-project-runtime-panel {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    margin: 12px 0 16px;
    max-width: 720px;
  }
  .preferences-project-runtime-panel .preferences-runtime-actions {
    margin-top: 10px;
  }
  .preferences-project-runtime-panel .preferences-hint {
    margin-top: 10px;
    margin-bottom: 0;
  }
  .preferences-runtime-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .preferences-runtime-status {
    font-size: 12px;
    color: var(--text-muted);
  }
`;
