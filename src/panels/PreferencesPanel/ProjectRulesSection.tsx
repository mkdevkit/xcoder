import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { tauriInvoke } from "../../utils/tauri";
import { ConfigPathRow } from "./ConfigPathRow";
import type { ProjectRulesView } from "../../types/projectRules";

interface ProjectRulesSectionProps {
  workspace: string;
  providerId: "codewhale" | "opencode";
  disabled?: boolean;
  embedded?: boolean;
}

function emptyRules(providerId: "codewhale" | "opencode"): ProjectRulesView {
  return {
    provider: providerId,
    agentsPath: "",
    agentsInstalled: false,
    agentsContent: "",
    instructionsPath: "",
    instructions: [],
  };
}

export function ProjectRulesSection({
  workspace,
  providerId,
  disabled = false,
  embedded = false,
}: ProjectRulesSectionProps) {
  const { t } = useTranslation();
  const [rules, setRules] = useState<ProjectRulesView>(() => emptyRules(providerId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setStatus("idle");
    try {
      const data = await tauriInvoke<ProjectRulesView>("load_project_rules_cmd", {
        workspace,
        provider: providerId,
      });
      setRules(data);
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setLoading(false);
    }
  }, [providerId, workspace]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const updateInstruction = (index: number, value: string) => {
    setRules((prev) => ({
      ...prev,
      instructions: prev.instructions.map((item, i) => (i === index ? value : item)),
    }));
  };

  const addInstruction = () => {
    setRules((prev) => ({
      ...prev,
      instructions: [...prev.instructions, ""],
    }));
  };

  const removeInstruction = (index: number) => {
    setRules((prev) => ({
      ...prev,
      instructions: prev.instructions.filter((_, i) => i !== index),
    }));
  };

  const save = async () => {
    setSaving(true);
    setStatus("idle");
    try {
      const data = await tauriInvoke<ProjectRulesView>("save_project_rules_cmd", {
        workspace,
        provider: providerId,
        agentsContent: rules.agentsContent,
        instructions: rules.instructions,
      });
      setRules(data);
      setStatus("ok");
      setStatusMessage(t("preferences.saved"));
    } catch (error) {
      setStatus("err");
      setStatusMessage(String(error));
    } finally {
      setSaving(false);
    }
  };

  const hintKey =
    providerId === "opencode"
      ? "preferences.projectRulesOpencodeHint"
      : "preferences.projectRulesCodewhaleHint";

  if (loading) {
    return <p className="preferences-hint">{t("preferences.loading")}</p>;
  }

  const content = (
    <>
      <p className="preferences-hint">{t(hintKey)}</p>

      <div className="preferences-field">
        <label>{t("preferences.projectRulesAgents")}</label>
        <ConfigPathRow path={rules.agentsPath} />
        <textarea
          className="preferences-textarea"
          rows={12}
          value={rules.agentsContent}
          disabled={disabled || saving}
          placeholder={t("preferences.projectRulesAgentsPlaceholder")}
          onChange={(event) =>
            setRules((prev) => ({ ...prev, agentsContent: event.target.value }))
          }
        />
      </div>

      <div className="preferences-field" style={{ marginTop: 16 }}>
        <label>{t("preferences.projectRulesInstructions")}</label>
        <ConfigPathRow path={rules.instructionsPath} />
        <p className="preferences-hint">{t("preferences.projectRulesInstructionsHint")}</p>
        {rules.instructions.length === 0 && (
          <p className="preferences-hint">{t("preferences.projectRulesInstructionsEmpty")}</p>
        )}
        {rules.instructions.map((instruction, index) => (
          <div key={`instruction-${index}`} className="preferences-mcp-kv-row">
            <input
              className="preferences-input"
              value={instruction}
              disabled={disabled || saving}
              placeholder={t("preferences.projectRulesInstructionPlaceholder")}
              onChange={(event) => updateInstruction(index, event.target.value)}
            />
            <button
              type="button"
              className="preferences-link-btn"
              disabled={disabled || saving}
              onClick={() => removeInstruction(index)}
            >
              {t("preferences.remove")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="preferences-link-btn"
          style={{ marginTop: 8 }}
          disabled={disabled || saving}
          onClick={addInstruction}
        >
          {t("preferences.projectRulesAddInstruction")}
        </button>
      </div>

      <div className="preferences-runtime-actions" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="preferences-btn primary"
          disabled={disabled || saving}
          onClick={() => save().catch(console.error)}
        >
          {saving ? t("preferences.savingProjectRules") : t("preferences.saveProjectRules")}
        </button>
      </div>

      {status !== "idle" && (
        <p
          className={`preferences-status ${status === "ok" ? "ok" : "err"}`}
          style={{ marginTop: 8 }}
        >
          {statusMessage}
        </p>
      )}
    </>
  );

  if (embedded) {
    return content;
  }

  return <section className="preferences-section">{content}</section>;
}
