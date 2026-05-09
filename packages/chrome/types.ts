export interface Cookie {
  name: string;
  value: string;
  domain: string;
}

export interface CookieJar {
  sessionKey: string;
  orgId: string;
}

export interface ChromeOptions {
  port?: number;
  profileDir?: string;
}

export interface SandboxFileMetadata {
  path: string;
  size: number;
  content_type: string;
  created_at: string;
  custom_metadata?: Record<string, unknown>;
}

export interface SandboxFileList {
  success?: boolean;
  files: string[];
  files_metadata: SandboxFileMetadata[];
}

/** Payload returned by `/wiggle/download-file`. `dataUrl` is a `data:<mime>;base64,...` URL. */
export interface SandboxFilePayload {
  contentType: string;
  dataUrl: string;
}
