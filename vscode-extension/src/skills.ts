import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

function skillRoots(providerId: string) {
  if (providerId === "opencode") {
    return [".opencode/skills", ".agents/skills", ".claude/skills"];
  }
  return [".agents/skills"];
}

function parseFrontmatter(content: string) {
  const trimmed = content.replace(/^\s+/, "");
  if (!trimmed.startsWith("---")) {
    return { name: "", description: "" };
  }
  const rest = trimmed.slice(3).replace(/^\s+/, "");
  const end = rest.indexOf("\n---");
  if (end < 0) return { name: "", description: "" };
  const block = rest.slice(0, end);
  let name = "";
  let description = "";
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("name:")) {
      name = line
        .slice("name:".length)
        .trim()
        .replace(/^"(.*)"$/, "$1");
    } else if (line.startsWith("description:")) {
      description = line
        .slice("description:".length)
        .trim()
        .replace(/^"(.*)"$/, "$1");
    }
  }
  return { name, description };
}

export function loadSkillCatalog(
  extensionRoot: string,
): SkillCatalog {
  const filePath = path.join(extensionRoot, "media", "skill-catalog.json");
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as SkillCatalog;
  return {
    directoryUrl: parsed.directoryUrl || "https://skills.sh",
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  };
}

export function listProjectSkills(
  workspace: string,
  providerId: string,
): ProjectSkillInfo[] {
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error("Workspace not found");
  }
  const skills: ProjectSkillInfo[] = [];
  const seen = new Set<string>();
  for (const root of skillRoots(providerId)) {
    const dir = path.join(workspace, root);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(dir, entry.name);
      const skillMd = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) continue;
      const content = fs.readFileSync(skillMd, "utf8");
      const frontmatter = parseFrontmatter(content);
      const name = frontmatter.name || entry.name;
      if (seen.has(name)) continue;
      seen.add(name);
      skills.push({
        name,
        description: frontmatter.description,
        path: skillDir,
        location: root,
      });
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function resolveNpx() {
  if (process.platform === "win32") {
    const candidates = [
      process.env.APPDATA
        ? path.join(process.env.APPDATA, "npm", "npx.cmd")
        : "",
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "npm", "npx.cmd")
        : "",
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return "npx.cmd";
  }
  return "npx";
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({ code: code ?? 1, output: `${stdout}${stderr}`.trim() });
    });
  });
}

export async function installProjectSkill(
  workspace: string,
  providerId: string,
  source: string,
  skillName: string,
) {
  const trimmedSource = source.trim();
  const trimmedName = skillName.trim();
  if (!trimmedSource || !trimmedName) {
    throw new Error("Skill source and name are required");
  }
  const result = await runCommand(
    resolveNpx(),
    [
      "skills",
      "add",
      trimmedSource,
      "--skill",
      trimmedName,
      "-a",
      "opencode",
      "--copy",
      "-y",
    ],
    workspace,
  );
  if (result.code !== 0) {
    throw new Error(`Failed to install skill: ${result.output}`);
  }
}

export async function removeProjectSkill(
  workspace: string,
  providerId: string,
  skillName: string,
) {
  const trimmed = skillName.trim();
  if (!trimmed) throw new Error("Skill name is required");

  try {
    const result = await runCommand(
      resolveNpx(),
      ["skills", "remove", trimmed, "-y"],
      workspace,
    );
    if (result.code === 0) return;
  } catch {
    // fall through to direct directory removal
  }

  for (const root of skillRoots(providerId)) {
    const dir = path.join(workspace, root, trimmed);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    }
  }
  throw new Error(`Skill not found: ${trimmed}`);
}
