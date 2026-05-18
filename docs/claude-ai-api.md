# Claude.ai conversation API

Reader: a contributor working on the converter or the fetch path who needs to
know what comes back from Claude.ai's undocumented conversation endpoint, what
the exporter actually uses, and what it ignores. For the pipeline that consumes
this data see [architecture.md](./architecture.md); for the sandbox-file
endpoints see [sandbox-files.md](./sandbox-files.md) (separate surface).

Evidence convention used throughout:

- `(live)` — observed on the wire from a real claude.ai session on 2026-05-18.
- `(source)` — claimed by inline comments or code in this repo, not directly
  verified against the wire.
- `(inferred)` — behavior-derived guess, neither in a live capture nor stated
  in source.

Live observation is stronger than source comments. Where the two disagree, the
live shape wins and the disagreement is called out.

## URL and authentication

```text
GET /api/organizations/<orgId>/chat_conversations/<convId>
        ?tree=true
        &rendering_mode=messages
        &render_all_tools=true
```

- Host: `https://claude.ai` (live)
- Response: `200 OK`, `application/json` (live). `404` when the conversation is
  deleted or never existed (source — handled as `not_found` stage in
  `packages/orchestrator/errors.ts`).
- Method: `GET` (live).

Authentication is cookie-based — there is no `Authorization` header. Two
cookies matter (source, `packages/chrome/index.ts: extractAuth`):

| Cookie | Purpose |
|---|---|
| `sessionKey` | Opaque session token. Required for every authenticated request. |
| `lastActiveOrg` | Current organization UUID. Used as `<orgId>` in the path. |

The exporter never reads `sessionKey` directly — the request is made page-side
via `fetch()` over CDP `Runtime.evaluate`, so the browser attaches the cookie
itself. `lastActiveOrg` is read explicitly to construct the URL.

### Query parameters

| Param | Observed value | Effect |
|---|---|---|
| `tree` | `true` | Populates `parent_message_uuid` on each message (live). Server still returns a flat `chat_messages` array; the tree shape is reconstructable from those pointers (inferred). |
| `rendering_mode` | `messages` | Returns the flat list shape under `chat_messages` (source). |
| `render_all_tools` | `true` | Includes every `tool_use` / `tool_result` block rather than collapsing them (source). |

The exporter walks the flat `chat_messages` array and ignores
`parent_message_uuid`. Branching conversations would currently render as a
single linear thread (inferred — no branching conversation was in the test
set).

## Top-level envelope

Observed keys on the response object (live):

| Field | Type | Modeled by code? | Notes |
|---|---|---|---|
| `uuid` | string (UUID) | yes | Conversation ID. |
| `name` | string | yes | Subject to Chat Archive plugin pollution — see [Known quirks](#known-quirks). |
| `model` | string | yes | E.g. `"claude-<family>-<version>"`. Reflects the model at conversation creation; per-message model is not exposed. |
| `created_at` | string (ISO 8601, microsecond, `Z`) | yes | E.g. `"2026-03-15T10:00:00.000000Z"`. |
| `updated_at` | string (ISO 8601) | yes | |
| `chat_messages` | `Message[]` | yes | See [Message](#message). The orchestrator filters this array to the active-leaf lineage via `selectActiveLineage` before downstream phases see it — see [Branching](#branching). |
| `current_leaf_message_uuid` | string (UUID) | yes | Used to filter `chat_messages` to the active branch. |
| `is_starred` | boolean | no | UI flag. |
| `is_temporary` | boolean | no | Likely the "Temporary chat" toggle (inferred). |
| `platform` | string | no | Probably the originating client (inferred — value not captured). |
| `settings` | object | no | Per-conversation settings (inferred). |
| `summary` | string | no | Server-side summary (inferred — distinct from the message-level `compaction_summary`). |

The code's `ConversationData` interface
(`packages/converter/types.ts`) covers only the `yes`-modeled rows.

## Message

`chat_messages[]` element keys (live):

| Field | Type | Modeled? | Notes |
|---|---|---|---|
| `uuid` | string | yes | |
| `sender` | `"human"` \| `"assistant"` | yes | Only these two values observed (live). The `types.ts` union matches. |
| `content` | `MessageBlock[]` | yes | See [Block](#block). |
| `created_at` | string (ISO 8601) | yes | |
| `attachments` | array | yes | See [Attachments](#attachments). |
| `files` | array | yes | See [Files](#files). Empty `[]` in the captured chat — schema below is from source. |
| `compaction_summary` | unknown | no | Set when this message was summarised by Claude's context-compaction pass (inferred — no compacted conversation in the test set, so the shape is unknown). Known omission — see [Known quirks](#known-quirks). |
| `parent_message_uuid` | string (UUID) \| null | yes | Tree pointer used by `selectActiveLineage` to walk from the active leaf to the root. |
| `index` | number | no | Position hint. Exporter uses array order instead. |
| `input_mode` | string | no | Human input modality — likely `text` / `voice` (inferred). |
| `stop_reason` | string | no | Assistant-side stop reason. |
| `truncated` | boolean | no | |
| `text` | string | no | Top-level concatenated text. The exporter renders from `content[]` blocks instead. |
| `updated_at` | string (ISO 8601) | no | |
| `sync_sources` | array | no | |

### Attachments

`message.attachments[]` element keys (live):

| Field | Modeled? | Notes |
|---|---|---|
| `id` | no | |
| `file_name` | yes | |
| `file_size` | yes | |
| `file_type` | yes | |
| `extracted_content` | yes | Server-extracted text — what the converter inlines. |
| `created_at` | no | |

These are pasted/uploaded files whose text the server has already extracted.
Image uploads go through `files[]` instead, not here.

### Files

`message.files[]` was an empty array in the captured chat (live). The shape
below is from `packages/converter/types.ts` (source) and is exercised by
image-bearing conversations in production:

| Field | Notes |
|---|---|
| `file_uuid` | |
| `file_kind` | |
| `file_name` | |
| `preview_url` | |
| `preview_asset.url` | The exporter prefers this over `preview_url` when both are present (source). |

If you need to verify the full `files[]` shape against the wire, capture a
conversation containing an image upload — the test capture had none.

## Block

`message.content[]` elements. Block types observed (live): `text`, `thinking`,
`tool_result`, `tool_use`.

(The codebase has a second, *post-processing* block shape — `EnrichmentBlock`
in `packages/converter/types.ts` — whose `type` field is a union including
`"artifact"`. That is not a wire shape; it's synthesised by
`buildEnrichmentInput` to feed the toc agent, with `tool_use` blocks named
`"artifacts"` being flattened to `type: "artifact"`. Don't confuse the two.)

All-keys union across observed wire blocks (live):

| Field | On which type(s) | Modeled? | Notes |
|---|---|---|---|
| `type` | all | yes | Discriminator. |
| `text` | `text`, sometimes `tool_result` | yes | |
| `thinking` | `thinking` | yes | |
| `name` | `tool_use` | yes | Tool name. See [Tool taxonomy](#tool-taxonomy). |
| `input` | `tool_use` | yes (as `Record<string, unknown>`) | Tool-call arguments. Shape is tool-specific; only `artifacts` is deeply parsed. |
| `content` | `tool_result` | yes (as `Array<{ text?: string }>`) | |
| `is_error` | `tool_result` | yes | |
| `display_content` | `tool_result` | yes (as `{ content: unknown[] }`) | Pre-rendered display form. |
| `citations` | `text` | yes | See [Citation](#citation). |
| `id` | `tool_use`, `tool_result` | yes | Block ID. On `tool_use`, used as the key for pairing with `tool_result.tool_use_id`. |
| `tool_use_id` | `tool_result` | yes | Joins back to the matching `tool_use.id`. The exporter pairs them by id; falls back to last-call adjacency when either id is missing. |
| `integration_name` | `tool_use` | yes | MCP integration name when the tool comes from an external integration. Rendered as `<integration>/<tool>` in the callout label. |
| `integration_icon_url` | `tool_use` | no | |
| `icon_name` | `tool_use` | no | |
| `start_timestamp` | `tool_use`, `tool_result` | yes (on `tool_use`) | ISO 8601. Paired with `stop_timestamp` to compute a duration tag in the tool callout. Unused on `tool_result`. |
| `stop_timestamp` | `tool_use`, `tool_result` | yes (on `tool_use`) | See `start_timestamp`. |
| `cut_off` | `tool_result` | no | Output-truncation flag (inferred). |
| `truncated` | `tool_result` | no | |
| `message` | various | no | Likely error context (inferred). |
| `summaries` | occasional | no | Shape not captured. |

If you add new block-type rendering, the discriminator is `block.type`. The
four live values above are the only ones the exporter has been observed to
encounter.

## Citation

`text` blocks may carry a `citations[]` array. Observed keys (live):

| Field | Modeled? | Notes |
|---|---|---|
| `url` | yes | |
| `title` | yes | Optional in the type, present in the live capture. |
| `start_index` | yes | Offset into the block's `text`. |
| `end_index` | yes | |
| `uuid` | no | Citation ID. |
| `origin_tool_name` | yes | Which tool produced the citation — `web_search`, `web_fetch`, etc. Rendered as ` — via <tool>` annotations in the consolidated Links section. Multiple distinct origins for the same URL accumulate. |
| `sources` | no | Likely a list when one citation aggregates multiple source URLs (inferred). |
| `metadata` | no | Shape not captured. |

The consolidated `## Links` section the converter emits is built from
`{ url, title, origin_tool_name }`; offsets are unused at render time.

## Tool taxonomy

`tool_use.name` values observed in the live capture:

```text
artifacts
bash_tool
conversation_search
create_file
present_files
str_replace
view
web_fetch
web_search
```

The converter renders each tool call generically via `toolCallSummary`
(`packages/converter/index.ts`). Two names get special-case treatment
(source):

- **`artifacts`** — research-artifact replay. The block's
  `input.content` becomes a synthetic sandbox file so the rendered note
  links to a real file on disk. See [Research artifacts](#research-artifacts).
- **`present_files`** — skipped from the rendered tool-callout list.
  Treated as visual chrome rather than a meaningful call.

Names not in this list are passed through as-is — the exporter doesn't gate
on a known-tool allowlist.

## Research artifacts

Long-form report outputs (the things rendered as a clickable artifact in the
claude.ai UI) are not exposed via the wiggle sandbox listing. Their bodies
arrive inline on `tool_use` blocks with `name: "artifacts"` (source —
`packages/converter/index.ts: replayResearchArtifacts`).

`tool_use.input` keys for `artifacts` calls (live):

| Field | Used by code? | Notes |
|---|---|---|
| `id` | yes | Prefix `compass_artifact_wf-…` (underscores between `compass`, `artifact`, `wf`, then a hyphen before the hash). Used as the `artifactId` join key when linking the wikilink (source — `SandboxFileContent.artifactId` in `packages/orchestrator/sandbox.ts`). |
| `command` | yes | Observed values: `"create"`. The code also recognizes `"update"` and `"rewrite"` but emits a warning and drops them (source). |
| `title` | yes | Used as the artifact filename stem and link title. |
| `type` | yes | E.g. `"text/markdown"`. Drives the file extension (inferred). |
| `content` | yes | The full artifact body. ~18 KB in one captured case. |
| `language` | no | |
| `md_citations` | no | Citation references for the artifact body (inferred). |
| `source` | no | |
| `version_uuid` | no | UUID — strong hint that `update` / `rewrite` reference this for diffing (inferred). |

Only `command="create"` is replayed because the exporter has no `update`-side
state — it sees one conversation snapshot at a time, and there is no
preceding "version" to apply a diff against. If `update` or `rewrite`
support is added, `version_uuid` is the likely join key.

The id prefix matters: the code distinguishes research artifacts from
hypothetical "canvas"-style artifacts by checking for `compass_artifact_wf-`
on the id (source). No non-`compass_artifact_wf-` artifact id was observed
in the test set — the canvas case is speculative.

## Branching

`chat_messages` returns the **union of every branch the user explored**, not just
the active conversation. Whenever the user edits a previous message and retries,
the server keeps both the abandoned branch and the new one in the same array,
linked by `parent_message_uuid`. The top-level `current_leaf_message_uuid`
points at the leaf of the currently-active branch.

Live capture on 2026-05-18 confirmed this is universal: every conversation in
the test set (4/4) had at least one branch point, with 1–5 abandoned-branch
messages contributing to the flat array beyond the active lineage.

The exporter filters the array down to only the messages reachable from
`current_leaf_message_uuid` via `parent_message_uuid` pointers
(`selectActiveLineage` in `packages/converter/index.ts`), then operates on the
filtered list for every downstream phase (image-fetch, rendering, enrichment).

Fallback: when the server doesn't populate `current_leaf_message_uuid`, or when
the leaf isn't present in `chat_messages`, the filter returns the full array
unchanged — "render everything" is preferred over "render nothing" if the
assumption breaks.

## Known omissions

These wire-level features are observed but **deliberately unhandled** by the
exporter. They're worth documenting so a contributor knows the gap exists.

### `compaction_summary`

When Claude's context-compaction pass summarises older messages, the affected
message carries a `compaction_summary` field. The exporter ignores this field
— a compacted message will render with its original `content[]` (which may
itself have been replaced by the server with a stub) rather than the summary.
No compacted conversation was in the live test set, so the shape of
`compaction_summary` is unknown. **Known omission.**

## Known quirks

### Chat Archive plugin pollution on `name`

The third-party "Chat Archive" browser extension rewrites the conversation
`name` field on the server, appending a suffix like:

```text
"<original name>Last message N <unit> ago ^archived"
```

with a U+00A0 (NBSP) between `"message"` and the digit (live — confirmed
2026-05-18 by inspecting a tab title returned by claude.ai). This is
**data pollution baked into the server-side `name`**, not a rendering bug.

The converter strips it in `stripArchivePluginMarkers`
(`packages/converter/index.ts`, source). Don't relax that scrubber without
re-checking whether the plugin's marker format has changed — the NBSP and
the `^archived` sentinel are both load-bearing.

### `text` exists at message level *and* block level

A message has a top-level `text` field that is roughly the concatenation
of its `text`-type block texts (inferred — not byte-compared). The
exporter ignores the top-level field and renders from `content[]`. If you
ever need a fast plain-text summary without walking blocks, the top-level
`text` is probably what you want — but verify it survives `thinking`
removal first.

## Verification

This document was last grounded against the live API on **2026-05-18**
using two real conversations from the user's logged-in claude.ai session:

- One conversation with **68 messages**, containing all four observed
  block types (`text`, `thinking`, `tool_result`, `tool_use`), all nine
  observed tool names, `artifacts` calls with `command="create"`, and
  Chat Archive plugin pollution on the `name` field.
- One additional conversation used to cross-check envelope and message
  keys.

Not exercised by the live capture:

- Image uploads (`message.files[]` was empty — `Files` table is from source).
- Context-compacted messages (`compaction_summary` shape unknown).
- Canvas-style artifacts (no non-`compass_artifact_wf-` artifact id).
- `artifacts` calls with `command="update"` or `"rewrite"`.

Behaviours newly exercised and verified by the live capture:

- Branching is universal — every chat in the test set had at least one branch
  point. The exporter's `selectActiveLineage` filter is what makes the
  rendered output match the user's last-seen thread.

This document is invalidated, in whole or in part, when:

- A new top-level envelope key appears, or an existing key changes type.
- A new `tool_use.name` value appears in production traffic.
- A new `block.type` discriminator appears.
- The `artifacts` tool's `input` shape changes — in particular if
  `version_uuid` semantics are confirmed or a new `command` value appears.
- The cookie pair (`sessionKey`, `lastActiveOrg`) changes name or role.
- The Chat Archive plugin's marker format changes (NBSP, `^archived`
  sentinel).
- A live capture contradicts any `(source)` or `(inferred)` claim above —
  flip it to `(live)` and update the table.

Re-run grounding by capturing the conversation response over CDP against a
real account and diffing the key sets against the tables above.
