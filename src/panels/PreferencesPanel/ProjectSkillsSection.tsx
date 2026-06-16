import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../i18n";
import { tauriInvoke } from "../../utils/tauri";
import {
  flattenSkillCatalog,
  type CatalogSkillOption,
  type ProjectSkillInfo,
  type SkillCatalog,
} from "../../types/skills";

interface ProjectSkillsSectionProps {
  workspace: string;
  providerId: string;
  disabled?: boolean;
  embedded?: boolean;
}

export function ProjectSkillsSection({
  workspace,
  providerId,
  disabled = false,
  embedded = false,
}: ProjectSkillsSectionProps) {
  const { t } = useTranslation();
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [installed, setInstalled] = useState<ProjectSkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySkill, setBusySkill] = useState<string | null>(null);
  const [selectedCatalogKey, setSelectedCatalogKey] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; message: string } | null>(
    null,
  );

  const isOpencode = providerId === "opencode";
  const isCodewhale = providerId === "codewhale";

  const load = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const [catalogData, installedSkills] = await Promise.all([
        tauriInvoke<SkillCatalog>("load_skill_catalog_cmd"),
        tauriInvoke<ProjectSkillInfo[]>("list_project_skills_cmd", {
          workspace,
          providerId,
        }),
      ]);
      setCatalog(catalogData);
      setInstalled(installedSkills);
    } catch (error) {
      setStatus({ kind: "err", message: String(error) });
    } finally {
      setLoading(false);
    }
  }, [providerId, workspace]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const catalogOptions = useMemo(() => {
    if (!catalog) return [] as CatalogSkillOption[];
    const installedNames = new Set(installed.map((item) => item.name));
    return flattenSkillCatalog(catalog).filter(
      (item) => !installedNames.has(item.name),
    );
  }, [catalog, installed]);

  useEffect(() => {
    if (catalogOptions.length === 0) {
      setSelectedCatalogKey("");
      return;
    }
    const exists = catalogOptions.some(
      (item) => skillOptionKey(item) === selectedCatalogKey,
    );
    if (!exists) {
      setSelectedCatalogKey(skillOptionKey(catalogOptions[0]));
    }
  }, [catalogOptions, selectedCatalogKey]);

  const selectedCatalogSkill = catalogOptions.find(
    (item) => skillOptionKey(item) === selectedCatalogKey,
  );

  const installSelected = async () => {
    if (!selectedCatalogSkill) return;
    setBusySkill(selectedCatalogSkill.name);
    setStatus(null);
    try {
      const next = await tauriInvoke<ProjectSkillInfo[]>("install_project_skill_cmd", {
        workspace,
        providerId,
        source: selectedCatalogSkill.sourceId,
        skillName: selectedCatalogSkill.name,
      });
      setInstalled(next);
      setStatus({ kind: "ok", message: t("preferences.projectSkillInstalled") });
    } catch (error) {
      setStatus({ kind: "err", message: String(error) });
    } finally {
      setBusySkill(null);
    }
  };

  const removeSkill = async (skillName: string) => {
    setBusySkill(skillName);
    setStatus(null);
    try {
      const next = await tauriInvoke<ProjectSkillInfo[]>("remove_project_skill_cmd", {
        workspace,
        providerId,
        skillName,
      });
      setInstalled(next);
      setStatus({ kind: "ok", message: t("preferences.projectSkillRemoved") });
    } catch (error) {
      setStatus({ kind: "err", message: String(error) });
    } finally {
      setBusySkill(null);
    }
  };

  if (loading) {
    return <p className="preferences-hint">{t("preferences.loading")}</p>;
  }

  return (
    <section
      className={`preferences-section project-skills-section${embedded ? " project-skills-embedded" : ""}`}
    >
      {!embedded && (
        <div className="preferences-label">{t("preferences.projectSkills")}</div>
      )}
      <p className="preferences-hint">
        {isOpencode
          ? t("preferences.projectSkillsOpencodeHint", {
              directory: catalog?.directoryUrl ?? "https://skills.sh",
            })
          : isCodewhale
            ? t("preferences.projectSkillsCodewhaleHint", {
                directory: catalog?.directoryUrl ?? "https://skills.sh",
              })
            : t("preferences.projectSkillsHint")}
      </p>

      <div className="preferences-field">
        <label>{t("preferences.projectSkillsInstalled")}</label>
        {installed.length === 0 ? (
          <p className="preferences-hint">{t("preferences.projectSkillsEmpty")}</p>
        ) : (
          <div className="project-skills-list">
            {installed.map((skill) => (
              <div key={`${skill.location}:${skill.name}`} className="project-skill-row">
                <div className="project-skill-meta">
                  <div className="project-skill-name">{skill.name}</div>
                  <div className="project-skill-description">
                    {skill.description || skill.location}
                  </div>
                </div>
                <button
                  type="button"
                  className="preferences-link-btn"
                  disabled={disabled || busySkill === skill.name}
                  onClick={() => removeSkill(skill.name).catch(console.error)}
                >
                  {t("preferences.remove")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="preferences-field">
        <label>{t("preferences.projectSkillsAdd")}</label>
        <div className="project-skills-add-row">
          <select
            className="preferences-select"
            value={selectedCatalogKey}
            disabled={disabled || catalogOptions.length === 0 || Boolean(busySkill)}
            onChange={(event) => setSelectedCatalogKey(event.target.value)}
          >
            {catalogOptions.length === 0 ? (
              <option value="">{t("preferences.projectSkillsCatalogEmpty")}</option>
            ) : (
              catalogOptions.map((item) => (
                <option key={skillOptionKey(item)} value={skillOptionKey(item)}>
                  {item.name} · {item.sourceLabel}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="preferences-btn"
            disabled={
              disabled ||
              !selectedCatalogSkill ||
              Boolean(busySkill)
            }
            onClick={() => installSelected().catch(console.error)}
          >
            {busySkill === selectedCatalogSkill?.name
              ? t("preferences.projectSkillsInstalling")
              : t("preferences.add")}
          </button>
        </div>
        {selectedCatalogSkill && (
          <p className="preferences-hint">{selectedCatalogSkill.description}</p>
        )}
      </div>

      {status && (
        <p className={`preferences-status ${status.kind}`}>{status.message}</p>
      )}

      <style>{`
        .project-skills-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .project-skill-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-elevated);
        }
        .project-skill-meta {
          min-width: 0;
        }
        .project-skill-name {
          font-size: 13px;
          font-weight: 600;
        }
        .project-skill-description {
          margin-top: 4px;
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.4;
          word-break: break-word;
        }
        .project-skills-add-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .project-skills-add-row .preferences-select {
          flex: 1;
          min-width: 0;
        }
        .project-skills-add-row .preferences-btn {
          flex-shrink: 0;
        }
      `}</style>
    </section>
  );
}

function skillOptionKey(item: CatalogSkillOption) {
  return `${item.sourceId}::${item.name}`;
}
