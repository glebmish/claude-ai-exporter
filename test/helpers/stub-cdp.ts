import type { SandboxFileList, SandboxFilePayload, SandboxFileMetadata } from "../../packages/chrome/index.ts";

export interface StubCdp {
  fetchConversation(id: string): Promise<unknown>;
  fetchImageAsDataUrl(url: string): Promise<string | null>;
  listSandboxFiles(id: string): Promise<SandboxFileList>;
  downloadSandboxFile(id: string, path: string): Promise<SandboxFilePayload | null>;
}

export interface StubSandboxFile {
  path: string;
  contentType?: string;
  /** Plain text content. The stub encodes it as base64 on the fly. */
  text?: string;
  /** Pre-encoded base64 payload (omit `data:...,` prefix). Use for binary fixtures. */
  base64?: string;
  size?: number;
  created_at?: string;
}

function utf8ToBase64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}

export function makeStubCdp(opts: {
  conversation: unknown;
  images?: Record<string, string>;
  sandboxFiles?: StubSandboxFile[];
}): StubCdp {
  const sandboxFiles = opts.sandboxFiles ?? [];
  const byPath = new Map<string, StubSandboxFile>();
  for (const f of sandboxFiles) byPath.set(f.path, f);

  return {
    async fetchConversation(_id: string) { return opts.conversation; },
    async fetchImageAsDataUrl(url: string) { return opts.images?.[url] ?? null; },

    async listSandboxFiles(_id: string): Promise<SandboxFileList> {
      const files = sandboxFiles.map((f) => f.path);
      const files_metadata: SandboxFileMetadata[] = sandboxFiles.map((f) => ({
        path: f.path,
        size: f.size ?? (f.text ? Buffer.byteLength(f.text, "utf8") : 0),
        content_type: f.contentType ?? "text/plain",
        created_at: f.created_at ?? "2026-01-01T00:00:00Z",
      }));
      return { success: true, files, files_metadata };
    },

    async downloadSandboxFile(_id: string, path: string): Promise<SandboxFilePayload | null> {
      const f = byPath.get(path);
      if (!f) return null;
      const ct = f.contentType ?? "text/plain";
      const b64 = f.base64 ?? (f.text !== undefined ? utf8ToBase64(f.text) : "");
      return { contentType: ct, dataUrl: `data:${ct};base64,${b64}` };
    },
  };
}
