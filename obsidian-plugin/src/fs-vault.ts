import { App, TFile, TFolder, normalizePath } from "obsidian";
import type { FileSystem } from "../../packages/orchestrator/types.ts";

export class VaultFs implements FileSystem {
  constructor(private app: App) {}

  async readText(path: string): Promise<string | null> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return null;
    return await this.app.vault.read(f);
  }

  async writeText(path: string, content: string): Promise<void> {
    const norm = normalizePath(path);
    await this.ensureDir(this.parentDir(norm));
    const existing = this.app.vault.getAbstractFileByPath(norm);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(norm, content);
    }
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    const norm = normalizePath(path);
    await this.ensureDir(this.parentDir(norm));
    const existing = this.app.vault.getAbstractFileByPath(norm);
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, data);
    } else {
      await this.app.vault.createBinary(norm, data);
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  async deleteDir(path: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (f instanceof TFolder) {
      await this.app.vault.delete(f, true);
    }
  }

  async ensureDir(path: string): Promise<void> {
    if (!path) return;
    const norm = normalizePath(path);
    if (this.app.vault.getAbstractFileByPath(norm)) return;
    const parts = norm.split("/");
    let current = "";
    for (const part of parts) {
      if (!part) continue;
      current = current ? `${current}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  joinPath(...parts: string[]): string {
    return normalizePath(parts.filter(Boolean).join("/"));
  }

  private parentDir(p: string): string {
    const idx = p.lastIndexOf("/");
    return idx <= 0 ? "" : p.slice(0, idx);
  }
}
