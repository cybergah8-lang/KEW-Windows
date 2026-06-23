// Kew — extraction client.
//
// Kew resolves direct media URLs through a Cobalt-compatible API
// (https://github.com/imputnet/cobalt). The instance is configurable in
// Settings so users can self-host for full anonymity — no third party
// required. If a URL is already a direct media file we skip extraction.

export interface ResolveOptions {
  server: string; // base API url, e.g. https://my-cobalt.example
  audioOnly?: boolean;
  quality?: string; // "1080", "720", "max", ...
}

export interface ResolvedItem {
  url: string;
  filename: string;
  thumb?: string;
  title?: string;
}

export interface ResolveResult {
  items: ResolvedItem[];
  kind: "single" | "playlist" | "picker";
}

const DIRECT_RE = /\.(mp4|mkv|webm|mov|mp3|m4a|wav|jpg|jpeg|png|gif)(\?|$)/i;

function guessName(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").filter(Boolean).pop() || fallback;
    return decodeURIComponent(base).slice(0, 80);
  } catch {
    return fallback;
  }
}

export async function resolve(input: string, opts: ResolveOptions): Promise<ResolveResult> {
  const url = input.trim();

  // Direct media link — no extraction needed.
  if (DIRECT_RE.test(url)) {
    return {
      kind: "single",
      items: [{ url, filename: guessName(url, `kew-${Date.now()}.mp4`) }],
    };
  }

  const api = opts.server.replace(/\/+$/, "");
  const body: Record<string, unknown> = {
    url,
    videoQuality: opts.quality && opts.quality !== "max" ? opts.quality : "1080",
    downloadMode: opts.audioOnly ? "audio" : "auto",
    filenameStyle: "basic",
  };

  const res = await fetch(`${api}/`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`server ${res.status}`);
  }
  const data: any = await res.json();

  // Cobalt status values: tunnel | redirect | stream | picker | error
  const status = data.status as string;

  if (status === "error" || data.error) {
    throw new Error(data?.error?.code || data?.text || "extraction error");
  }

  if (status === "picker" && Array.isArray(data.picker)) {
    const items: ResolvedItem[] = data.picker.map((p: any, i: number) => ({
      url: p.url,
      thumb: p.thumb,
      filename: guessName(p.url, `kew-${Date.now()}-${i + 1}.mp4`),
    }));
    return { kind: "picker", items };
  }

  // tunnel | redirect | stream  -> single direct url
  const mediaUrl = data.url as string;
  if (!mediaUrl) throw new Error("no media url returned");
  return {
    kind: "single",
    items: [
      {
        url: mediaUrl,
        filename: (data.filename as string) || guessName(mediaUrl, `kew-${Date.now()}.mp4`),
      },
    ],
  };
}
