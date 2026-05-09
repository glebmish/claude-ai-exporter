import type { Formatter } from "./types.ts";

function escapeHtml(str: string): string {
  return str.replace(/</g, "\\<").replace(/>/g, "\\>");
}

const standardFormatter: Formatter = {
  imageLink(filename, prefix) {
    return prefix ? `![${filename}](${prefix}/${filename})` : `![${filename}](${filename})`;
  },

  artifactLink(filename, _title, prefix) {
    return prefix
      ? `**[Artifact: ${filename}](${prefix}/${filename})**`
      : `**[Artifact: ${filename}](${filename})**`;
  },

  thinkingBlock(parts) {
    const lines: string[] = [];
    for (const part of parts) {
      for (const line of part.split("\n")) {
        lines.push(`> ${line}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  },

  toolUseBlock(calls) {
    const lines: string[] = [];
    lines.push("```");
    for (const tc of calls) {
      lines.push(tc);
    }
    lines.push("```");
    return lines.join("\n");
  },
};

const obsidianFormatter: Formatter = {
  imageLink(filename, _prefix) {
    return `![[${filename}]]`;
  },

  artifactLink(filename, title, _prefix) {
    return `**[[${filename}|${title}]]**`;
  },

  thinkingBlock(parts) {
    const lines: string[] = [];
    lines.push("> [!quote]- thinking");
    const merged = parts.join("\n\n");
    for (const line of merged.split("\n")) {
      lines.push(`> ${line}`);
    }
    return lines.join("\n");
  },

  toolUseBlock(calls) {
    const lines: string[] = [];
    lines.push(`> [!todo]- tool use (${calls.length})`);
    for (const tc of calls) {
      lines.push(`> ${escapeHtml(tc)}`);
    }
    return lines.join("\n");
  },
};

const formatters: Record<string, Formatter> = {
  standard: standardFormatter,
  obsidian: obsidianFormatter,
};

export function getFormatter(format: string = "standard"): Formatter {
  const f = formatters[format];
  if (!f) throw new Error(`Unknown format: ${format}`);
  return f;
}
