import { workspacesMatch } from "./path";

const STORAGE_KEY = "xcoder:recent-projects";
export const MAX_RECENT_PROJECTS = 10;

export function readRecentProjects(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export function writeRecentProjects(projects: string[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(projects.slice(0, MAX_RECENT_PROJECTS)),
    );
  } catch {
    // ignore storage failures
  }
}

export function addRecentProject(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return readRecentProjects();

  const next = [
    trimmed,
    ...readRecentProjects().filter((item) => !workspacesMatch(item, trimmed)),
  ].slice(0, MAX_RECENT_PROJECTS);
  writeRecentProjects(next);
  return next;
}

export function removeRecentProject(path: string): string[] {
  const next = readRecentProjects().filter((item) => !workspacesMatch(item, path));
  writeRecentProjects(next);
  return next;
}

export function projectDisplayName(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const index = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (index < 0) return normalized;
  return normalized.slice(index + 1) || normalized;
}
