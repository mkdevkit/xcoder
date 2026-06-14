const TREE_MARKERS = /[├└│┴┬┼─]/;
const TREE_ROOT_LINE = /^[\w./\\-]+\/$/;
const PROSE_LINE =
  /^(?:使用|然后|启动|注意|说明|接下来|请|以下|如果|可以|需要|建议)|(?:[\u4e00-\u9fff].*(?:。|！|\?|？|：))|\*\*[^*]+\*\*/;
const COMMAND_LINE =
  /^(?:cd|npm|yarn|pnpm|npx|docker|git|curl|wget)\b|^[A-Z]:\\|^\/[\w/]/i;

function isTreeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (TREE_MARKERS.test(line)) return true;
  if (TREE_ROOT_LINE.test(trimmed)) return true;
  return false;
}

function isTreeRootLine(line: string): boolean {
  return TREE_ROOT_LINE.test(line.trim());
}

function isProseLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (isTreeLine(trimmed) || isCommandLine(trimmed)) return false;
  if (trimmed.startsWith("```")) return false;
  return PROSE_LINE.test(trimmed);
}

function isCommandLine(line: string): boolean {
  return COMMAND_LINE.test(line.trim());
}

function expandCollapsedTreeLines(text: string): string {
  if (!TREE_MARKERS.test(text)) return text;

  return text
    .replace(/([\w./\\-]+\/)\s+(?=[├└│])/g, "$1\n")
    .replace(/(?<!│)\s+(?=[├└]─{1,2})/g, "\n")
    .replace(/\s+(?=│\s+[├└]─{1,2})/g, "\n");
}

function splitInlineFenceOpeners(content: string): string {
  let text = content.replace(
    /([：:。！？)\]）>])\s*```([\w+-]*)\s+/g,
    (_, before, lang) => `${before}\n\n\`\`\`${lang || "text"}\n`,
  );

  text = text.replace(
    /(^|[^\n`])\s*```([\w+-]*)\s+(?=[\w./\\├└│])/gm,
    (_, before, lang) => `${before}\n\n\`\`\`${lang || "text"}\n`,
  );

  text = text.replace(
    /```(powershell|bash|sh|shell|cmd|zsh)\s+([^\n`]+)/gi,
    (_, lang, rest) => {
      const commands = rest
        .replace(/\s+(?=(?:cd|npm|yarn|pnpm|npx|docker|git)\b)/gi, "\n")
        .trim();
      return `\`\`\`${lang.toLowerCase()}\n${commands}`;
    },
  );

  return text;
}

function normalizeFenceBlocks(content: string): string {
  const lines = expandCollapsedTreeLines(content).split("\n");
  const output: string[] = [];
  let inFence = false;

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index];
    const trimmed = line.trim();

    if (/^```\s*$/.test(trimmed)) {
      if (inFence) {
        output.push("```");
        inFence = false;
      }
      continue;
    }

    const fenceOnly = trimmed.match(/^```([\w+-]*)$/);
    if (fenceOnly) {
      if (inFence) output.push("```");
      output.push(`\`\`\`${fenceOnly[1] || "text"}`);
      inFence = true;
      continue;
    }

    const inlineFence = trimmed.match(/^```([\w+-]*)\s+(.*)$/);
    if (inlineFence) {
      if (inFence) output.push("```");
      output.push(`\`\`\`${inlineFence[1] || "text"}`);
      output.push(inlineFence[2]);
      inFence = true;
      continue;
    }

    if (inFence && isProseLine(line)) {
      output.push("```");
      inFence = false;
      output.push("");
      output.push(line);
      continue;
    }

    if (!inFence && isTreeLine(line)) {
      const treeLines: string[] = [];
      let cursor = index;
      if (isTreeRootLine(line) && isTreeLine(lines[cursor + 1] ?? "")) {
        treeLines.push(line);
        cursor += 1;
      }
      while (cursor < lines.length) {
        const current = lines[cursor];
        if (!current.trim()) break;
        if (
          treeLines.length > 0 &&
          !isTreeLine(current) &&
          !isTreeRootLine(current)
        ) {
          break;
        }
        if (
          treeLines.length === 0 &&
          !isTreeLine(current) &&
          !isTreeRootLine(current)
        ) {
          break;
        }
        treeLines.push(current);
        cursor += 1;
      }
      if (treeLines.length > 0) {
        output.push("```text");
        output.push(...treeLines);
        output.push("```");
        output.push("");
        index = cursor - 1;
        continue;
      }
    }

    output.push(line);
  }

  if (inFence) {
    output.push("```");
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

export function preprocessAssistantMarkdown(content: string): string {
  const normalized = splitInlineFenceOpeners(content);
  return normalizeFenceBlocks(normalized);
}
