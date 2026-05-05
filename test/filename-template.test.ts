import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { applyFilenameTemplate, sanitizeForFilename, DEFAULT_CHAT_NAME_TEMPLATE, DEFAULT_ARTIFACT_NAME_TEMPLATE } from "../packages/converter/filename-template.ts";

describe("applyFilenameTemplate", () => {
  it("substitutes a single variable", () => {
    const out = applyFilenameTemplate("{{title}}", { title: "My Chat" });
    assert.equal(out, "My Chat");
  });

  it("preserves case and spaces", () => {
    const out = applyFilenameTemplate("{{created}} {{title}}", {
      created: "2026-01-15",
      title: "Project Roadmap",
    });
    assert.equal(out, "2026-01-15 Project Roadmap");
  });

  it("substitutes the same variable multiple times", () => {
    const out = applyFilenameTemplate("{{title}}-{{title}}", { title: "x" });
    assert.equal(out, "x-x");
  });

  it("leaves unknown variables literal so typos surface", () => {
    const out = applyFilenameTemplate("{{title}}_{{typo}}", { title: "chat" });
    assert.ok(out.includes("{{typo}}"), `expected unknown var to survive, got "${out}"`);
  });

  it("falls back to 'untitled' when result is empty after cleanup", () => {
    const out = applyFilenameTemplate("{{empty}}", { empty: "" });
    assert.equal(out, "untitled");
  });

  it("falls back to 'untitled' when template is empty", () => {
    const out = applyFilenameTemplate("", {});
    assert.equal(out, "untitled");
  });

  it("strips filesystem-unsafe characters", () => {
    const out = applyFilenameTemplate("{{title}}", { title: 'a/b\\c:d?e*f"g<h>i|j' });
    assert.equal(out, "abcdefghij");
  });

  it("normalizes runs of whitespace to a single space", () => {
    const out = applyFilenameTemplate("{{title}}", { title: "a  b   c" });
    assert.equal(out, "a b c");
  });

  it("trims surrounding whitespace", () => {
    const out = applyFilenameTemplate("  {{title}}  ", { title: "chat" });
    assert.equal(out, "chat");
  });

  it("does NOT lowercase output", () => {
    const out = applyFilenameTemplate("{{title}}", { title: "MyChat" });
    assert.equal(out, "MyChat");
  });

  it("does NOT collapse underscores (user-chosen separators are preserved)", () => {
    const out = applyFilenameTemplate("{{a}}__{{b}}", { a: "x", b: "y" });
    assert.equal(out, "x__y");
  });

  it("does NOT truncate long output", () => {
    const long = "a".repeat(200);
    const out = applyFilenameTemplate("{{title}}", { title: long });
    assert.equal(out.length, 200);
  });

  it("exposes both {{title}} and {{titleSanitized}}", () => {
    const out = applyFilenameTemplate("{{title}} - {{titleSanitized}}", {
      title: "My Chat",
      titleSanitized: "my_chat",
    });
    assert.equal(out, "My Chat - my_chat");
  });

  it("default chat template produces Obsidian-style 'YYYY-MM-DD Title' output", () => {
    const out = applyFilenameTemplate(DEFAULT_CHAT_NAME_TEMPLATE, {
      title: "My Chat",
      created: "2026-01-15",
    });
    assert.equal(out, "2026-01-15 My Chat");
  });

  it("default artifact template produces 'NN Title' output", () => {
    const out = applyFilenameTemplate(DEFAULT_ARTIFACT_NAME_TEMPLATE, {
      seqNum: "01",
      title: "Setup Guide",
    });
    assert.equal(out, "01 Setup Guide");
  });
});

describe("sanitizeForFilename", () => {
  it("strips filesystem-unsafe characters", () => {
    assert.equal(sanitizeForFilename('a/b:c"d'), "abcd");
  });

  it("preserves case", () => {
    assert.equal(sanitizeForFilename("MyChat"), "MyChat");
  });

  it("normalizes whitespace runs", () => {
    assert.equal(sanitizeForFilename("a  b   c"), "a b c");
  });

  it("trims surrounding whitespace", () => {
    assert.equal(sanitizeForFilename("  a  "), "a");
  });

  it("returns empty string for empty input", () => {
    assert.equal(sanitizeForFilename(""), "");
  });
});
