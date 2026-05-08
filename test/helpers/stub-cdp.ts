export interface StubCdp {
  fetchConversation(id: string): Promise<unknown>;
  fetchImageAsDataUrl(url: string): Promise<string | null>;
}

export function makeStubCdp(opts: {
  conversation: unknown;
  images?: Record<string, string>;
}): StubCdp {
  return {
    async fetchConversation(_id: string) { return opts.conversation; },
    async fetchImageAsDataUrl(url: string) { return opts.images?.[url] ?? null; },
  };
}
