// Kew for Windows — persistent records + settings via localStorage.
import type { Lang } from "./i18n";
import type { Platform } from "./platform";

export interface DownloadRecord {
  id: string;
  managerId: number;
  url: string;
  filename: string;
  title: string;
  platform: Platform;
  audioOnly: boolean;
  createdAt: number;
  status: "queued" | "running" | "paused" | "completed" | "failed";
  localUri?: string;
  playUri?: string;
  thumbnail?: string;
  bytesTotal?: number;
  progress?: number;
  statusLine?: string;
  batchId?: string;
}

export interface Settings {
  lang: Lang;
  server: string;
  quality: string;
  audioOnly: boolean;
  notify: boolean;
  sound: boolean;
}

const K_DOWNLOADS = "kew.downloads";
const K_SETTINGS = "kew.settings";

export const DEFAULT_SETTINGS: Settings = {
  lang: "ku",
  server: "",
  quality: "1080",
  audioOnly: false,
  notify: true,
  sound: true,
};

export async function loadSettings(): Promise<Settings> {
  try {
    const v = localStorage.getItem(K_SETTINGS);
    return v ? { ...DEFAULT_SETTINGS, ...JSON.parse(v) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export async function saveSettings(s: Settings) {
  localStorage.setItem(K_SETTINGS, JSON.stringify(s));
}
export async function loadDownloads(): Promise<DownloadRecord[]> {
  try {
    const v = localStorage.getItem(K_DOWNLOADS);
    return v ? (JSON.parse(v) as DownloadRecord[]) : [];
  } catch {
    return [];
  }
}
export async function saveDownloads(list: DownloadRecord[]) {
  localStorage.setItem(K_DOWNLOADS, JSON.stringify(list));
}
export function newId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}
