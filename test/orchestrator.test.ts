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

// Helper: build an existing markdown file with a parseable TOC.
// Format must match what packages/toc/parseTocFromMarkdown expects (standard form).
function buildExistingMarkdown(opts: {
  title: string;
  lastCoveredMsg: number;
  topics: { heading: string; range: string; recap?: string }[];
  keyTopics?: string[];
  exportedDate?: string;
}): string {
  const ex = opts.exportedDate ?? "2026-01-15";
  const lines = [
    "---",
    `title: "${opts.title}"`,
    `source: https://claude.ai/chat/abc-123`,
    `model: claude-opus-4-6`,
    `created: 2026-01-15`,
    `updated: 2026-01-15`,
    `exported: ${ex}`,
    `messages: ${opts.lastCoveredMsg}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    "## Table of Contents",
    "",
  ];
  for (const t of opts.topics) {
    // Standard form: - [Heading *(msg N)* or *(msgs N–M)*](#anchor)
    const isRange = t.range.includes("–");
    const label = isRange ? `msgs ${t.range}` : `msg ${t.range}`;
    lines.push(`- [${t.heading} *(${label})*](#anchor)`);
    if (t.recap) lines.push(`  - ${t.recap}`);
  }
  lines.push("");
  if (opts.keyTopics) {
    lines.push("## Key Topics");
    lines.push("");
    for (const k of opts.keyTopics) lines.push(`- ${k}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

describe("runExport — refresh path", () => {
  it("case 11: --existing file unreadable → warning, no previousMessageCount", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport(
      { ...baseOpts, existingFilePath: "out/missing.md" },
      { fs, cdpOverride: cdp },
    );
    assert.equal(result.previousMessageCount, undefined);
    assert.ok(result.warnings.some((w) => w.includes("not found")));
  });

  it("case 12: --patch-in-progress patches default `exported` key mid-run", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 1,
      topics: [{ heading: "Greeting", range: "1", recap: "" }],
    }));

    let observedMidRun: string | null = null;
    await runExport(
      { ...baseOpts, existingFilePath: existingPath, patchInProgress: true },
      {
        fs, cdpOverride: cdp,
        onStatus: (m) => {
          if (m === "Writing files...") observedMidRun = fs.read(existingPath) as string;
        },
      },
    );
    // The patched-but-not-final state must show "exported: updating"
    assert.ok(observedMidRun !== null);
    assert.ok((observedMidRun as string).includes("exported: updating"));

    // After the run, the final write replaces the file with no "updating" marker
    const final = fs.read(existingPath) as string;
    assert.ok(!final.includes("exported: updating"));
  });

  it("case 13: --patch-in-progress with custom template key", async () => {
    const fs = new InMemoryFs();
    const tpl = "---\nrefreshed: {{exported}}\n---\n# {{title}}\n{{content}}\n";
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, [
      "---",
      `refreshed: 2026-01-10`,
      "---",
      "## Table of Contents",
      "",
      "- [Greeting *(msg 1)*](#anchor)",
      "",
    ].join("\n"));

    let observed: string | null = null;
    const cdp = makeStubCdp({ conversation: baseConversation });
    await runExport(
      { ...baseOpts, existingFilePath: existingPath, patchInProgress: true, templateText: tpl },
      {
        fs, cdpOverride: cdp,
        onStatus: (m) => {
          if (m === "Writing files...") observed = fs.read(existingPath) as string;
        },
      },
    );
    assert.ok(observed !== null && (observed as string).includes("refreshed: updating"));
    const final = fs.read(existingPath) as string;
    assert.match(final, /refreshed: 2026-/);
  });

  it("case 14: stale-attachment cleanup with --existing", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    fs.preset("out/2026-01-15 Test Chat/artifacts/old-stale.md", "stale");
    fs.preset("out/2026-01-15 Test Chat.md", buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 1,
      topics: [{ heading: "Greeting", range: "1" }],
    }));
    await runExport(
      { ...baseOpts, existingFilePath: "out/2026-01-15 Test Chat.md" },
      { fs, cdpOverride: cdp },
    );
    assert.equal(await fs.exists("out/2026-01-15 Test Chat/artifacts/old-stale.md"), false);
  });

  it("case 15: image fetch returning null is skipped without failure", async () => {
    const fs = new InMemoryFs();
    const conversationWithImage = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: "m1",
          sender: "human" as const,
          content: [{ type: "text", text: "see image" }],
          created_at: "2026-01-15T10:00:00Z",
          files: [{
            file_kind: "image",
            file_name: "img.png",
            preview_url: "https://example.com/img.png",
          }],
        },
      ],
    };
    const cdp = makeStubCdp({ conversation: conversationWithImage });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    assert.equal(result.imageCount, 0);
  });

  it("case 17: cancellation throws Cancelled", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => runExport(baseOpts, { fs, cdpOverride: cdp, signal: ac.signal }),
      /Cancelled/,
    );
  });

  it("validation: --patch-in-progress without --existing throws", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    await assert.rejects(
      () => runExport({ ...baseOpts, patchInProgress: true }, { fs, cdpOverride: cdp }),
      /requires/,
    );
  });
});

describe("runExport — discoverExistingByDatedTitle", () => {
  it("finds existing file when discover flag is true", async () => {
    const fs = new InMemoryFs();
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 1,
      topics: [{ heading: "Greeting", range: "1" }],
    }));
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport(
      { ...baseOpts, discoverExistingByDatedTitle: true },
      { fs, cdpOverride: cdp },
    );
    assert.equal(result.previousMessageCount, 1);
  });
});
