// Kew — URL platform detection.

export type Platform = "youtube" | "x" | "tiktok" | "instagram" | "unknown";

export interface Detected {
  platform: Platform;
  isPlaylist: boolean;
  url: string;
}

const PATTERNS: { p: Platform; re: RegExp }[] = [
  { p: "youtube", re: /(youtube\.com|youtu\.be|youtube-nocookie\.com)/i },
  { p: "x", re: /(twitter\.com|x\.com|t\.co)/i },
  { p: "tiktok", re: /(tiktok\.com|vm\.tiktok\.com)/i },
  { p: "instagram", re: /(instagram\.com|instagr\.am)/i },
];

export function detect(raw: string): Detected {
  const url = raw.trim();
  let platform: Platform = "unknown";
  for (const { p, re } of PATTERNS) {
    if (re.test(url)) {
      platform = p;
      break;
    }
  }
  const isPlaylist =
    platform === "youtube" && /[?&]list=/.test(url) && !/[?&]v=/.test(url)
      ? true
      : platform === "youtube" && /[?&]list=/.test(url);
  return { platform, isPlaylist, url };
}

export function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export const PLATFORM_META: Record<Platform, { name: string; color: string; icon: string }> = {
  youtube: { name: "YouTube", color: "#ff0033", icon: "▶" },
  x: { name: "X", color: "#1d1d1f", icon: "𝕏" },
  tiktok: { name: "TikTok", color: "#00f2ea", icon: "♪" },
  instagram: { name: "Instagram", color: "#e1306c", icon: "◎" },
  unknown: { name: "Link", color: "#7a8a7f", icon: "↧" },
};
