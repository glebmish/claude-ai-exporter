import type { FileSystem } from "../../packages/orchestrator/types.ts";

export class InMemoryFs implements FileSystem {
  private files = new Map<string, string | Buffer>();
  private dirs = new Set<string>();

  async readText(path: string): Promise<string | null> {
    const v = this.files.get(this.norm(path));
    if (v === undefined) return null;
    return typeof v === "string" ? v : v.toString("utf8");
  }
  async writeText(path: string, content: string): Promise<void> {
    const p = this.norm(path);
    this.ensureParents(p);
    this.files.set(p, content);
  }
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const p = this.norm(path);
    this.ensureParents(p);
    this.files.set(p, Buffer.from(data));
  }
  async exists(path: string): Promise<boolean> {
    const p = this.norm(path);
    return this.files.has(p) || this.dirs.has(p);
  }
  async deleteDir(path: string): Promise<void> {
    const p = this.norm(path);
    const prefix = p + "/";
    for (const k of [...this.files.keys()]) {
      if (k === p || k.startsWith(prefix)) this.files.delete(k);
    }
    for (const k of [...this.dirs]) {
      if (k === p || k.startsWith(prefix)) this.dirs.delete(k);
    }
  }
  async ensureDir(path: string): Promise<void> {
    const p = this.norm(path);
    if (!p) return;
    let acc = "";
    for (const part of p.split("/")) {
      if (!part) continue;
      acc = acc ? `${acc}/${part}` : part;
      this.dirs.add(acc);
    }
  }
  joinPath(...parts: string[]): string {
    return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
  }

  // Test helpers
  list(): string[] { return [...this.files.keys()].sort(); }
  read(path: string): string | Buffer | undefined { return this.files.get(this.norm(path)); }
  preset(path: string, content: string): void {
    const p = this.norm(path);
    this.ensureParents(p);
    this.files.set(p, content);
  }

  private norm(p: string): string {
    return p.replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  }
  private ensureParents(p: string): void {
    const idx = p.lastIndexOf("/");
    if (idx > 0) {
      let acc = "";
      for (const part of p.slice(0, idx).split("/")) {
        if (!part) continue;
        acc = acc ? `${acc}/${part}` : part;
        this.dirs.add(acc);
      }
    }
  }
}
