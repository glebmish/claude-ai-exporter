import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { runExport } from "../packages/orchestrator/index.ts";
import { InMemoryFs } from "./helpers/in-memory-fs.ts";
import { makeStubCdp } from "./helpers/stub-cdp.ts";

const baseConversation = {
  uuid: "abc-123",
  name: "Test Chat",
  model: "claude-opus-4-6",
  created_at: "2026-01-15T10:00:00Z",
  updated_at: "2026-01-15T10:00:00Z",
  chat_messages: [
    {
      uuid: "m1",
      sender: "human" as const,
      content: [{ type: "text", text: "Hello" }],
      created_at: "2026-01-15T10:00:00Z",
    },
    {
      uuid: "m2",
      sender: "assistant" as const,
      content: [{ type: "text", text: "Hi there" }],
      created_at: "2026-01-15T10:00:01Z",
    },
  ],
};

const baseOpts = {
  conversationId: "abc-123",
  outputDir: "out",
  format: "standard" as const,
  includeArtifacts: true,
  includeThinking: false,
  includeToolCalls: false,
  includeImages: true,
  toc: false,
  tocRecap: false,
  topics: false,
  patchInProgress: false,
};

describe("runExport — basic export", () => {
  it("case 1: fresh export, no attachments → only the .md is written", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    assert.equal(result.attachmentsDir, null);
    assert.equal(result.artifactCount, 0);
    assert.equal(result.imageCount, 0);
    const files = fs.list();
    assert.equal(files.length, 1);
    assert.match(files[0], /\.md$/);
    assert.match(files[0], /^out\//);
  });

  it("case 7: chatName literal — no {{var}} substitution", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport({ ...baseOpts, chatName: "literal-name" }, { fs, cdpOverride: cdp });
    assert.equal(result.datedTitle, "literal-name");
    assert.equal(result.filePath, "out/literal-name.md");
  });

  it("case 8: chatName + chatNameTemplate → throws", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    await assert.rejects(
      () => runExport({ ...baseOpts, chatName: "x", chatNameTemplate: "{{title}}" }, { fs, cdpOverride: cdp }),
      /mutually exclusive/,
    );
  });
});

describe("runExport — attachments layout", () => {
  const conversationWithArtifact = {
    ...baseConversation,
    chat_messages: [
      ...baseConversation.chat_messages,
      {
        uuid: "m3",
        sender: "assistant" as const,
        content: [{
          type: "tool_use",
          name: "artifacts",
          input: { id: "art1", command: "create", title: "Plan", type: "text/markdown", content: "# Plan\nbody" },
        }],
        created_at: "2026-01-15T10:00:02Z",
      },
    ],
  };

  it("case 2: attachments → note at <output>/<datedTitle>.md, artifacts under <output>/<datedTitle>/artifacts/", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: conversationWithArtifact });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    assert.equal(result.artifactCount, 1);
    assert.match(result.filePath, /^out\/.+\.md$/);
    // The note must NOT be nested inside <datedTitle>/
    const noteSegments = result.filePath.split("/");
    assert.equal(noteSegments.length, 2, `expected note at depth 1 under out/, got ${result.filePath}`);
    assert.ok(result.attachmentsDir);
    assert.match(result.attachmentsDir!, /^out\//);
    const files = fs.list();
    const artFiles = files.filter((f) => f.includes("/artifacts/"));
    assert.equal(artFiles.length, 1);
  });

  it("case 3: --attachments-dir override puts attachments under override", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: conversationWithArtifact });
    const result = await runExport({ ...baseOpts, attachmentsDir: "att" }, { fs, cdpOverride: cdp });
    assert.match(result.filePath, /^out\/.+\.md$/);
    assert.match(result.attachmentsDir!, /^att\//);
    const files = fs.list();
    assert.ok(files.some((f) => f.startsWith("att/") && f.includes("/artifacts/")));
    assert.ok(!files.some((f) => f.startsWith("out/") && f.includes("/artifacts/")));
  });
});

describe("runExport — template + enrichment", () => {
  it("case 4: --template applies, {{content}} placeholder works", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const tpl = "# {{title}}\n\n{{content}}\n";
    const result = await runExport({ ...baseOpts, templateText: tpl }, { fs, cdpOverride: cdp });
    const note = fs.read(result.filePath) as string;
    assert.ok(note.startsWith("# Test Chat\n"));
    assert.ok(note.includes("Hello"));
  });

  it("case 5: TOC variable in template, no enrichment flag → warning, empty placeholder", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const tpl = "# {{title}}\n{{toc}}\n{{content}}\n";
    const result = await runExport({ ...baseOpts, templateText: tpl }, { fs, cdpOverride: cdp });
    assert.ok(result.warnings.some((w) => w.includes("TOC variables")));
    const note = fs.read(result.filePath) as string;
    assert.ok(!note.includes("{{toc}}"));
  });
});
