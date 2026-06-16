import { useTranslation } from "../i18n";

export function StreamingIndicator() {
  const { t } = useTranslation();

  return (
    <div className="chat-streaming-indicator" role="status" aria-live="polite">
      <span className="chat-streaming-spinner" aria-hidden />
      <span className="chat-streaming-text">{t("chat.generating")}</span>
      <style>{`
        .chat-streaming-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 2px 8px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .chat-streaming-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(127, 127, 127, 0.25);
          border-top-color: var(--accent, #0078d4);
          border-radius: 50%;
          animation: chat-streaming-spin 0.8s linear infinite;
          flex-shrink: 0;
        }
        @keyframes chat-streaming-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
