import { useMemo, useState } from "react";
import type { PendingQuestion } from "../types/agent";
import { useTranslation } from "../i18n";

interface QuestionGateProps {
  pending: PendingQuestion;
  onSubmit: (answers: string[][]) => void;
  onDismiss: () => void;
}

export function QuestionGate({
  pending,
  onSubmit,
  onDismiss,
}: QuestionGateProps) {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<string[][]>(() =>
    pending.questions.map(() => []),
  );
  const [customTexts, setCustomTexts] = useState<string[]>(() =>
    pending.questions.map(() => ""),
  );

  const canSubmit = useMemo(
    () =>
      answers.every((selected, index) => {
        const question = pending.questions[index];
        if (!question) return false;
        if (selected.length > 0) return true;
        if (question.custom !== false && customTexts[index]?.trim()) {
          return true;
        }
        return false;
      }),
    [answers, customTexts, pending.questions],
  );

  const toggleOption = (questionIndex: number, label: string, multiple: boolean) => {
    setAnswers((prev) => {
      const next = prev.map((item) => [...item]);
      const current = next[questionIndex] ?? [];
      if (multiple) {
        next[questionIndex] = current.includes(label)
          ? current.filter((item) => item !== label)
          : [...current, label];
      } else {
        next[questionIndex] = [label];
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const payload = pending.questions.map((question, index) => {
      const selected = [...(answers[index] ?? [])];
      const custom = customTexts[index]?.trim();
      if (custom && question.custom !== false && !selected.includes(custom)) {
        selected.push(custom);
      }
      return selected;
    });
    onSubmit(payload);
  };

  return (
    <div className="question-gate">
      <div className="question-title">{t("question.title")}</div>
      {pending.questions.map((question, index) => (
        <div key={`${pending.id}:${index}`} className="question-block">
          {question.header ? (
            <div className="question-header">{question.header}</div>
          ) : null}
          <p className="question-text">{question.question}</p>
          <div className="question-options">
            {question.options.map((option) => {
              const selected = answers[index]?.includes(option.label) ?? false;
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`question-option${selected ? " selected" : ""}`}
                  onClick={() =>
                    toggleOption(index, option.label, Boolean(question.multiple))
                  }
                >
                  <span className="question-option-label">{option.label}</span>
                  {option.description ? (
                    <span className="question-option-desc">
                      {option.description}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {question.custom !== false ? (
            <input
              className="question-custom"
              type="text"
              placeholder={t("question.customPlaceholder")}
              value={customTexts[index] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setCustomTexts((prev) => {
                  const next = [...prev];
                  next[index] = value;
                  return next;
                });
              }}
            />
          ) : null}
        </div>
      ))}
      <div className="question-actions">
        <button
          className="primary"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {t("question.submit")}
        </button>
        <button onClick={onDismiss}>{t("question.dismiss")}</button>
      </div>
      <style>{`
        .question-gate {
          margin: 12px 0;
          padding: 12px;
          border: 1px solid var(--accent);
          background: rgba(120, 180, 255, 0.08);
          border-radius: 8px;
        }
        .question-title {
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--accent);
        }
        .question-block + .question-block {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
        }
        .question-header {
          font-weight: 600;
          margin-bottom: 4px;
        }
        .question-text {
          margin: 0 0 8px;
          color: var(--text-secondary);
        }
        .question-options {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .question-option {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
          padding: 8px 10px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px;
          background: transparent;
          cursor: pointer;
        }
        .question-option.selected {
          border-color: var(--accent);
          background: rgba(120, 180, 255, 0.12);
        }
        .question-option-label {
          font-weight: 600;
        }
        .question-option-desc {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 2px;
        }
        .question-custom {
          width: 100%;
          margin-top: 8px;
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: transparent;
          color: inherit;
        }
        .question-actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
        }
      `}</style>
    </div>
  );
}
