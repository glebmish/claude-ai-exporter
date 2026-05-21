import { spawn, ChildProcess, execFileSync } from "node:child_process";
import { get } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CookieJar, ChromeOptions } from "./types.ts";
import log from "./log.ts";
import { StageError } from "../orchestrator/errors.ts";

export type {
  Cookie,
  CookieJar,
  ChromeOptions,
  SandboxFileList,
  SandboxFileMetadata,
  SandboxFilePayload,
} from "./types.ts";
export { CdpClient, abortableSleep } from "./cdp.ts";
export { default as log } from "./log.ts";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function extractAuth(
  cookies: Array<{ name: string; value: string }>
): CookieJar | null {
  const sessionKey = cookies.find((c) => c.name === "sessionKey")?.value;
  const orgId = cookies.find((c) => c.name === "lastActiveOrg")?.value;
  if (!sessionKey || !orgId) return null;
  return { sessionKey, orgId };
}

// ---------------------------------------------------------------------------
// Chrome lifecycle
// ---------------------------------------------------------------------------

const DEFAULT_CDP_PORT = 9223;
const DEFAULT_PROFILE_DIR = join(homedir(), ".claude-exporter-chrome");

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
};

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

export function findChrome(customPath?: string): string {
  if (customPath) {
    log("Using custom Chrome path:", customPath);
    return customPath;
  }

  const platform = process.platform;
  log("Detecting Chrome on platform:", platform);
  const candidates = CHROME_PATHS[platform] || CHROME_PATHS.linux;
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { timeout: 3000, stdio: "pipe" });
      log("Found Chrome:", candidate);
      return candidate;
    } catch {
      log("Not found:", candidate);
    }
  }
  throw new StageError(
    "cdp",
    "Chrome not found. Install Chrome or set the path in plugin settings.",
  );
}

export function launchChrome(
  chromePath: string,
  url: string,
  opts?: ChromeOptions
): ChildProcess {
  const port = opts?.port ?? DEFAULT_CDP_PORT;
  const profileDir = opts?.profileDir ?? DEFAULT_PROFILE_DIR;
  const args = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    url,
  ];
  log("Launching Chrome:", chromePath, args.join(" "));
  const child = spawn(chromePath, args, { detached: true, stdio: "ignore" });
  child.on("error", (err) => log("Chrome spawn error:", err));
  child.on("exit", (code) => log("Chrome exited with code:", code));
  child.unref();
  return child;
}

export async function isAlreadyRunning(port?: number): Promise<boolean> {
  const cdpPort = port ?? DEFAULT_CDP_PORT;
  try {
    await httpGet(`http://localhost:${cdpPort}/json/version`);
    return true;
  } catch {
    return false;
  }
}

export async function waitForReady(opts?: { signal?: AbortSignal; port?: number; timeoutMs?: number }): Promise<void> {
  const port = opts?.port ?? DEFAULT_CDP_PORT;
  const signal = opts?.signal;
  const deadline = Date.now() + (opts?.timeoutMs ?? 30_000);
  let attempts = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Cancelled");
    attempts++;
    try {
      const data = await httpGet(`http://localhost:${port}/json/version`);
      log(`Chrome ready (attempt ${attempts}):`, data.substring(0, 100));
      return;
    } catch (e) {
      if (attempts <= 3 || attempts % 10 === 0) {
        log(`CDP not ready (attempt ${attempts}):`, e);
      }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new StageError("cdp", `Chrome did not become ready on port ${port} within ${opts?.timeoutMs ?? 30_000}ms`);
}

export function shutdownChrome(child: ChildProcess | null, profileDir?: string): void {
  if (!child) return;
  try {
    child.kill();
  } catch {
    // already exited
  }
  // Also kill any Chrome using our profile (covers orphaned child processes)
  const profile = profileDir ?? DEFAULT_PROFILE_DIR;
  try {
    execFileSync("pkill", ["-f", `user-data-dir=${profile}`], {
      timeout: 3000,
      stdio: "ignore",
    });
  } catch {
    // no matching process
  }
}

