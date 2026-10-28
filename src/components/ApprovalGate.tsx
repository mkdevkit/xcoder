import { useTranslation } from "../i18n";

interface ApprovalGateProps {
  description: string;
  onApprove: () => void;
  onDeny: () => void;
}

export function ApprovalGate({
  description,
  onApprove,
  onDeny,
}: ApprovalGateProps) {
  const { t } = useTranslation();

  return (
    <div className="approval-gate">
      <div className="approval-title">{t("approval.title")}</div>
      <p>{description}</p>
      <div className="approval-actions">
        <button className="primary" onClick={onApprove}>
          {t("approval.allow")}
        </button>
        <button onClick={onDeny}>{t("approval.deny")}</button>
      </div>
      <style>{`
        .approval-gate {
          margin: 12px 0;
          padding: 12px;
          border: 1px solid var(--warning);
          background: rgba(220, 220, 170, 0.08);
          border-radius: 8px;
        }
        .approval-title {
          font-weight: 600;
          margin-bottom: 6px;
          color: var(--warning);
        }
        .approval-actions {
          display: flex;
          gap: 8px;
          margin-top: 10px;
        }
      `}</style>
    </div>
  );
}
