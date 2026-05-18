export interface Citation {
  title?: string;
  url: string;
  start_index: number;
  end_index: number;
  /** Tool that produced this citation (e.g. "web_search", "web_fetch", "conversation_search"). */
  origin_tool_name?: string;
}

export interface MessageBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ text?: string }>;
  is_error?: boolean;
  display_content?: { content: unknown[] };
  citations?: Citation[];
  /** Block ID; on tool_use blocks this is what tool_result.tool_use_id points back to. */
  id?: string;
  /** Present on tool_result blocks. Joins back to the matching tool_use.id. */
  tool_use_id?: string;
  /** MCP integration name when a tool_use comes from an external integration. */
  integration_name?: string;
  /** ISO 8601 timestamps bracketing tool execution. */
  start_timestamp?: string;
  stop_timestamp?: string;
}

export interface Message {
  uuid: string;
  sender: "human" | "assistant";
  content: MessageBlock[];
  created_at: string;
  /** Parent in the message tree. Set when the conversation API was called with `tree=true`. */
  parent_message_uuid?: string | null;
  attachments?: Array<{ file_name?: string; file_size?: number; file_type?: string; extracted_content?: string }>;
  files?: Array<{
    file_uuid?: string;
    file_kind?: string;
    file_name?: string;
    preview_url?: string;
    preview_asset?: { url?: string };
  }>;
}

export interface ConversationData {
  uuid: string;
  name: string;
  model: string;
  created_at: string;
  updated_at: string;
  chat_messages: Message[];
  /** UUID of the leaf of the active conversation branch. Used to filter chat_messages
   * down to the lineage the user last saw; abandoned branches share this array. */
  current_leaf_message_uuid?: string;
}

export interface BuildMarkdownOptions {
  format?: "standard" | "obsidian";
  includeArtifacts?: boolean;
  includeThinking?: boolean;
  includeToolCalls?: boolean;
}

/** Linkable sandbox file. `path` is the wiggle absolute path; `filename` is the basename (used as the visible link label and the Obsidian wikilink target); `relativeWritePath` is where the file sits on disk relative to the per-chat attachments dir (e.g. `foo.md` for artifacts, `uploads/foo.png` for uploads) and is what the standard formatter uses to build the link URL. `artifactId` is set for research artifacts replayed from `artifacts` tool_use blocks; matched against `tool_use.input.id` to emit a wikilink (since those blocks have no `path` to match by). */
export interface SandboxFileLink {
  path: string;
  filename: string;
  relativeWritePath: string;
  artifactId?: string;
}

export interface BuildMarkdownContext {
  conversationId?: string;
  /** Override the relative link prefix used for artifact and image links. Defaults to datedTitle (so links resolve to <datedTitle>/<filename> from the note's directory). Ignored by the obsidian formatter, which always emits basename-only wikilinks. */
  attachmentLinkPrefix?: string;
  imageFilenames?: Array<{ msgIndex: number; filename: string }>;
  /** Sandbox files available for linking from the conversation markdown. The converter never reads file content — the orchestrator fetches and writes the bodies separately. */
  sandboxFiles?: SandboxFileLink[];
  /** Literal chat filename — when set, no {{var}} substitution is performed. Takes precedence over chatNameTemplate. */
  chatName?: string;
  chatNameTemplate?: string;
}

export interface RenderedMessage {
  role: "human" | "assistant";
  timestamp?: string;       // human only — "Mar 15, 2026, 1:02 PM" — used for TOC timestamp matching
  humanIndex?: number;      // 1-based count among human messages — used for section ranges
  header: string;           // e.g. "### You · Mar 15, 2026, 1:02 PM" or "### Claude Sonnet 4.6"
  body: string;             // rendered body — no leading/trailing newlines
  sectionHeading?: string;  // set by enrichWithToc — section label text
  sectionRange?: string;    // set by enrichWithToc — e.g. "1–3" (human message 1-based indices)
}

export interface ConversationResult {
  title: string;
  url: string;
  model: string;
  created: string;
  updated: string;
  exported: string;
  createdTimestamp: string;
  updatedTimestamp: string;
  messageCount: number;       // human messages only
  artifacts: number;          // count of sandbox files attached
  messages: RenderedMessage[];
  linksSection?: string;      // rendered "## Links\n\n1. [title](url)" block, or undefined
  toc?: string;
  tocWithRecap?: string;
  keyTopics?: string;
  keyTopicsFlat?: string;
  datedTitle: string;
}

export interface BuildMarkdownResult {
  markdown: string;
  datedTitle: string;
}

export interface ImageMeta {
  msgIndex: number;
  fileName: string;
  url: string;
}

export interface EnrichmentBlock {
  type: "text" | "tool_use" | "artifact";
  text?: string;
  name?: string;
  summary?: string;
}

export interface EnrichmentMessage {
  role: "human" | "assistant";
  timestamp?: string;
  blocks: EnrichmentBlock[];
}

export interface EnrichmentInput {
  messages: EnrichmentMessage[];
}

export interface Formatter {
  imageLink(filename: string, prefix: string | undefined): string;
  artifactLink(filename: string, title: string, prefix: string | undefined): string;
  thinkingBlock(parts: string[]): string;
  toolUseBlock(calls: string[]): string;
}
