# Wiggle sandbox files

Reader: a contributor working on sandbox-file fetch, the path/basename
matching in the converter, or anything to do with artifact rendering. This
doc covers the `wiggle/list-files` and `wiggle/download-file` endpoints
that Claude.ai exposes for per-conversation file storage. For the
conversation API see [claude-ai-api.md](./claude-ai-api.md); for the
pipeline that consumes these see [architecture.md](./architecture.md).

Evidence convention (same as the API doc):

- `(live)` — observed on the wire on 2026-05-18.
- `(source)` — claimed by inline comments or code, not directly verified.
- `(inferred)` — behavior-derived guess.

## What "wiggle" is

A per-conversation file store on the Claude.ai backend. It holds two
classes of files (live):

- **Uploads** — user-uploaded files visible at sandbox path
  `/mnt/user-data/uploads/<name>`. Created when the user drops a file
  into a chat. Custom metadata is rich (account UUID, conversation UUID,
  org UUID, `purpose: "wiggle_vm"`, `wiggle_upload: "True"`).
- **Outputs** — files written by Claude's tools (`create_file`,
  `bash_tool`'s shell redirection, etc.) at `/mnt/user-data/outputs/<name>`.
  Custom metadata is minimal (`{ filename: <basename> }`).

What is **not** in wiggle (source — `packages/orchestrator/sandbox.ts:1–12`):

- **Research artifacts** — the long-form report bodies with
  `compass_artifact_wf-…` IDs are rendered Claude-side and arrive inline
  on `tool_use` blocks with `name: "artifacts"`. The orchestrator
  *synthesises* `SandboxFileContent` entries from those blocks
  (`researchArtifactsAsSandboxFiles`) so they participate in the same
  naming/writing/linking flow as wiggle files. See
  [claude-ai-api.md#research-artifacts](./claude-ai-api.md#research-artifacts).
- **Inline images** on user messages — those come from `message.files[]`
  via `preview_url` / `preview_asset.url`, fetched directly.

## Endpoints

Both endpoints share the auth and host of the main conversation API — see
[claude-ai-api.md#url-and-authentication](./claude-ai-api.md#url-and-authentication).
Cookies `sessionKey` and `lastActiveOrg` are required.

### `wiggle/list-files`

```text
GET /api/organizations/<orgId>/conversations/<convId>/wiggle/list-files
        ?prefix=<prefix>
```

- Response: `200 OK`, `application/json` (live).
- `prefix=""` returns the full listing (source — what the exporter uses).
- `prefix=/mnt/user-data/uploads/` filters to uploads (live — works as a
  literal-prefix filter; confirmed by running with a known-empty prefix
  on a chat with no uploads).

Note: the endpoint sits under `/conversations/`, not `/chat_conversations/`
— different path prefix from the main conversation API. Don't conflate.

Response envelope (live):

| Field | Type | Used? | Notes |
|---|---|---|---|
| `success` | boolean | no | Observed `true` on success; the exporter's stub returns `{ success: false, files: [], files_metadata: [] }` on non-OK (source — `packages/chrome/cdp.ts`), but no code reads `success`. |
| `files` | `string[]` | no | Redundant duplicate of `files_metadata[].path`. The exporter ignores it. |
| `files_metadata` | `SandboxFileMetadata[]` | yes | See below. |

`files_metadata[]` element keys (live):

| Field | Type | Modeled? | Notes |
|---|---|---|---|
| `path` | string | yes | Full sandbox path, e.g. `/mnt/user-data/outputs/02-shape.md`. |
| `size` | number | yes | Bytes. Matches the `content-length` on `download-file`. |
| `content_type` | string | yes | See [content_type quirks](#content_type-quirks). |
| `created_at` | string (ISO 8601, microsecond, `Z`) | yes | Used to compute deterministic `seqNum` ordering (source — `packages/orchestrator/sandbox.ts: fetchSandboxFiles` sorts ascending, ties broken by `path`). |
| `custom_metadata` | `Record<string, unknown>` | typed but unused | See [custom_metadata](#custom_metadata). |

### `wiggle/download-file`

```text
GET /api/organizations/<orgId>/conversations/<convId>/wiggle/download-file
        ?path=<urlencoded-sandbox-path>
```

- Response on success: `200 OK`, body is the **raw file bytes** (live).
  Not a JSON envelope.
- `content-type` header is **always `application/octet-stream`**
  regardless of the file's real MIME (live, confirmed across an
  `image/png` upload and several `text/plain` outputs). The
  authoritative type is the `content_type` field returned by
  `list-files`.
- `content-length` matches `files_metadata[].size` (live).
- `content-disposition` is present (live — the captured header value was
  redacted by the test harness, but its presence is confirmed).
- Response on 404: `{ "type": "error", "error": { "type":
  "not_found_error", "message": "File not found in container: <path>",
  "details": { "error_visibility": "user_facing" } }, "request_id":
  "req_..." }` (live). The exporter's CDP path returns `null` on non-OK
  (source — `packages/chrome/cdp.ts: downloadSandboxFile`), so the
  envelope is discarded.

The exporter reads the response body as a `Blob` and base64-encodes it
via `FileReader.readAsDataURL`, then decodes to text or `ArrayBuffer`
based on whether `content_type` from `list-files` starts with `text/`,
`application/json`, `application/xml`, or `application/javascript`
(source — `packages/orchestrator/sandbox.ts: isTextContentType`).

## Path roots and kinds

Two roots seen on the wire (live):

| Root | Kind in code | Meaning |
|---|---|---|
| `/mnt/user-data/uploads/` | `upload` | Files uploaded by the user. |
| `/mnt/user-data/outputs/` | `artifact` | Files written by Claude. |

`classifyKind` in `packages/orchestrator/sandbox.ts` does this with a
simple prefix check on `/mnt/user-data/uploads/`; anything else is an
`artifact`.

The kind affects three things:

- **Filename**: uploads keep their original basename — routed through
  `sanitizeUploadBasename` to strip `..`/`/`/`\` so a hostile sandbox
  response can't escape the attachments directory; artifacts run
  through the user's `artifactNameTemplate` (default
  `{{seqNum}} {{title}}`) (source — `computeFilename`,
  `sanitizeUploadBasename` in `packages/orchestrator/sandbox.ts`).
- **On-disk path**: uploads land under `<attachmentsDir>/uploads/`;
  artifacts land directly under `<attachmentsDir>/` (source —
  `relativeWritePathFor`).
- **Title source**: for artifacts, the converter extracts a `# H1` from
  the file body when present, falling back to the basename stem with
  separators converted to spaces; uploads aren't templated so their
  basename is used as-is (source — `computeFilename`).

### A third sandbox path the converter must handle: `/home/claude/...`

Wiggle does not list anything under `/home/claude/...`, but Claude's
tool calls (`create_file`, `view`, `str_replace`) can reference the
*same* files via that path (source — `sandboxFileByBasename` in
`packages/converter/index.ts`, with the comment explaining the
basename fallback). This is why the converter indexes sandbox files
by basename in addition to path: when a `tool_use` block says
`{ "command": "view", "path": "/home/claude/foo.md" }` and wiggle has
listed the file as `/mnt/user-data/outputs/foo.md`, the basename
fallback resolves the link.

If you add a fourth path root, extend the index — don't extend
`classifyKind`'s `upload` check unless the new root is actually a
user-upload destination.

## A real collision the basename index handles

Captured live on 2026-05-18:

| Path | `content_type` | `size` | `created_at` |
|---|---|---|---|
| `/mnt/user-data/uploads/notes.md` | `text/markdown` | 17082 | 2026-03-15T10:00:00.000000Z |
| `/mnt/user-data/outputs/notes.md` | `text/plain` | 17082 | 2026-03-15T10:06:00.000000Z |

Same basename, different roots, identical size — the user uploaded
`notes.md`, Claude immediately wrote a copy (or an edited version)
back to outputs six minutes later. Both files are listed independently;
both get their own `seqNum`; both are written to disk under distinct
relative paths (`uploads/notes.md` and the templated
`<seqNum> Notes.md` for the output).

A `tool_use` block referencing this file by either
`/mnt/user-data/uploads/notes.md` or
`/mnt/user-data/outputs/notes.md` or `/home/claude/notes.md`
resolves via the path index first, then the basename index. The first
basename match wins (source — the converter inserts into
`sandboxFileByBasename` only if the basename is unused), so a tie goes to
whichever the iteration order encountered first. In practice this is the
upload, because uploads precede outputs by `created_at`. Don't rely on
the order — the basename map is a best-effort fallback, not a guarantee.

## `content_type` quirks

Two flavours seen on the wire (live):

- **Uploads** carry the original MIME — `image/png`, `text/markdown` —
  whatever the browser said at upload time.
- **Outputs** are tagged `text/plain` *regardless of extension*. A `.md`
  file written by Claude's `create_file` comes back as `text/plain`, not
  `text/markdown`.

The exporter's `isTextContentType` treats both `text/plain` and
`text/markdown` as text (source). The visible consequence is that
`.md` outputs decode and write as UTF-8 text without issue. The
non-visible consequence is that `content_type` is a noisy signal for
"what kind of file is this" — prefer extension or content sniffing if
you need finer granularity than text-vs-binary.

## `custom_metadata`

The field has two distinct shapes depending on `kind` (live):

### Upload (`/mnt/user-data/uploads/...`)

```json
{
  "account_uuid": "<UUID>",
  "conversation_uuid": "<UUID>",
  "organization_uuid": "<UUID>",
  "filename": "<original-basename>",
  "purpose": "wiggle_vm",
  "wiggle_upload": "True"
}
```

### Output (`/mnt/user-data/outputs/...`)

```json
{
  "filename": "<basename>"
}
```

The exporter types this field as `Record<string, unknown>` and never
reads it. If you build something that does — e.g. preserving the
original upload filename when the user has renamed it locally — note
that uploads carry **identifiers that are PII** (`account_uuid`,
`organization_uuid`, `conversation_uuid`). Don't ship those into export
metadata, frontmatter, or filenames without explicit opt-in.

## Naming and seqNum

`fetchSandboxFiles` sorts the listing by `created_at` ascending (ties
broken by `path`) and assigns a 1-based `seqNum` (source). Research
artifacts replayed afterwards continue from the last wiggle `seqNum`
(source — `mergeResearchArtifacts` in `packages/orchestrator/index.ts`)
so templates like `{{seqNum}} {{title}}` produce unique filenames across
both sources.

When two different artifacts template to the same on-disk basename a
warning is emitted (source — `packages/orchestrator/sandbox.ts`); there
is no auto-deduplication. The documented failure mode is "only the last
write survives."

## Known quirks

### `success: false` is a known unexplored path

The response envelope has a `success: true` boolean but no consumer in
this repo reads it (source). The exporter relies on `r.ok` from the
fetch response and the presence of `files_metadata`. If the server ever
returned a 200 with `success: false` and `files: []`, nothing here would
distinguish it from an empty-but-successful listing. **This case has not
been observed live** — flagged as a known unexplored path. If you ever
catch one in the wild, decide whether to surface it as a warning or to
keep silently treating it as empty.

### `download-file` returns binary, type lives elsewhere

The body of `download-file` is the raw file content; the
`content-type` header is always `application/octet-stream` (live). The
real MIME is whatever `list-files` previously reported in
`content_type`. Code that fetches a wiggle file without first listing it
has no reliable way to know the MIME.

### Endpoint path is `/conversations/`, not `/chat_conversations/`

The conversation API uses `/api/organizations/<org>/chat_conversations/<id>`;
wiggle uses `/api/organizations/<org>/conversations/<id>/wiggle/...`. Same
`<id>` value, different path prefix. Don't refactor one URL builder to
serve both.

### 404 envelope is structured

When `download-file` is asked for a path not in the listing the response
is `404` with a JSON body shaped like
`{ type: "error", error: { type: "not_found_error", message, details }, request_id }`
(live). The exporter discards the envelope and surfaces a generic
"sandbox file no longer available" warning (source). If sandbox-file
errors ever need finer surfacing — distinguishing "deleted" from
"permission denied" from "transient" — `error.type` is the natural
discriminator.

## Verification

This document was grounded against the live wiggle endpoints on
**2026-05-18** using three real conversations from the user's logged-in
claude.ai session:

- One conversation with **8 wiggle files** covering both kinds
  (`uploads` and `outputs`), three content types (`image/png`,
  `text/markdown`, `text/plain`), and a same-basename collision
  (one file under both roots).
- Two additional conversations used to cross-check envelope shape, the
  `prefix` filter, and the 404 response body.

Not exercised by the live capture:

- A wiggle file with a content-type the exporter classifies as binary
  (the `image/png` capture confirmed binary handling end-to-end, but
  other binary types — `application/pdf`, `video/*` — were not seen).
- Concurrent modification (file deleted between `list-files` and
  `download-file`) — the exporter handles a `null` return as
  "no longer available," but the race was not reproduced live.
- The `success: false` path from the server.

This document is invalidated, in whole or in part, when:

- A third path root appears (anything not under `/mnt/user-data/uploads/`
  or `/mnt/user-data/outputs/`).
- The `content_type` for outputs changes from the `text/plain`-regardless-
  of-extension behaviour to something more accurate.
- The `custom_metadata` shape for either kind changes.
- The `download-file` body becomes JSON-wrapped instead of raw, or the
  `content-type` header becomes accurate.
- The endpoint URL structure changes (e.g. the `/conversations/` prefix).
- The 404 envelope's `error.type` taxonomy changes.

Re-run grounding by re-running the capture script against a real
conversation that has at least one upload and one output sharing a
basename — that single chat exercises path classification, the basename
index, naming-template differences, and the content-type quirk in one
shot.
