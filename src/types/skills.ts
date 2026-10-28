export interface SkillCatalogEntry {
  name: string;
  description: string;
}

export interface SkillCatalogSource {
  id: string;
  label: string;
  skills: SkillCatalogEntry[];
}

export interface SkillCatalog {
  directoryUrl: string;
  sources: SkillCatalogSource[];
}

export interface ProjectSkillInfo {
  name: string;
  description: string;
  path: string;
  location: string;
}

export interface CatalogSkillOption extends SkillCatalogEntry {
  sourceId: string;
  sourceLabel: string;
}

export function flattenSkillCatalog(catalog: SkillCatalog): CatalogSkillOption[] {
  return catalog.sources.flatMap((source) =>
    source.skills.map((skill) => ({
      ...skill,
      sourceId: source.id,
      sourceLabel: source.label,
    })),
  );
}
