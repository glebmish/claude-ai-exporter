import type { Formatter } from "./types.ts";

function escapeHtml(str: string): string {
  return str.replace(/</g, "\\<").replace(/>/g, "\\>");
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

// `filename` for these formatters is the path relative to the per-chat attachments dir
// (e.g. `02-shape.md` for an artifact, `uploads/IMG.png` for an upload). The standard
// formatter uses it as-is for the link URL; the obsidian formatter extracts the basename
// since wikilinks are basename-resolved.
const standardFormatter: Formatter = {
  imageLink(filename, prefix) {
    return prefix ? `![${basename(filename)}](${prefix}/${filename})` : `![${basename(filename)}](${filename})`;
  },

  artifactLink(filename, title, prefix) {
    const label = title || basename(filename);
    return prefix
      ? `**[Artifact: ${label}](${prefix}/${filename})**`
      : `**[Artifact: ${label}](${filename})**`;
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
    return `![[${basename(filename)}]]`;
  },

  artifactLink(filename, title, _prefix) {
    const target = basename(filename);
    const label = title || target;
    return target === label ? `**[[${target}]]**` : `**[[${target}|${label}]]**`;
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
