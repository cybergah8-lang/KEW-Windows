// Kew for Windows — bridge to the Electron main process (yt-dlp.exe).
// Same exported API as the Android build, so App.tsx is unchanged.
import keklikUrl from "../assets/keklik.wav";

const kew: any = (window as any).kew || {};

export interface YtFile { name: string; path: string; uri: string; mime: string }
export interface ProgressEvent { taskId: string; progress: number; eta?: number; line: string }
export interface MediaInfo { title: string; thumbnail?: string; duration?: number; uploader?: string; extractor?: string }
export interface PlaylistEntry { url: string; title: string; thumbnail?: string }

export const isNative = () => true; // desktop has the native engine

export function ytdlpInfo(url: string): Promise<MediaInfo> {
  return kew.info(url);
}
export function ytdlpPlaylist(url: string): Promise<{ entries: PlaylistEntry[]; title?: string }> {
  return kew.playlist(url);
}

export async function ytdlpDownload(opts: {
  url: string; audioOnly: boolean; quality: string; taskId: string;
  title?: string; notify?: boolean; sound?: boolean;
}): Promise<{ files: YtFile[] }> {
  const r = await kew.download(opts);
  // completion sound is played here (notification is shown by the main process)
  if (r && r.files && r.files.length > 0 && opts.sound) ytdlpPlayKeklik();
  return r;
}

export function ytdlpCancel(taskId: string) {
  return kew.cancel(taskId);
}

export function ytdlpSetBusy(_active: boolean, _text?: string) {
  return Promise.resolve(); // no foreground service needed on desktop
}

export function ytdlpNotifyDone(title: string, _sound: boolean) {
  return kew.notify(title);
}

export function ytdlpPlayKeklik() {
  try {
    const a = new Audio(keklikUrl);
    a.volume = 0.9;
    a.play().catch(() => {});
  } catch {}
  return Promise.resolve();
}

export function onYtdlpProgress(cb: (e: ProgressEvent) => void) {
  const remove = kew.onProgress ? kew.onProgress(cb) : () => {};
  return Promise.resolve({ remove });
}

export async function openFile(uri: string, _mime?: string) {
  await kew.openPath(uri);
}

export function browserDownload(url: string, _filename: string) {
  window.open(url, "_blank");
}

// Convert a filesystem path / file-uri into a <video>-playable src.
export function toPlayableSrc(pathOrUri: string): string {
  if (!pathOrUri) return pathOrUri;
  if (pathOrUri.startsWith("file:")) return pathOrUri;
  return "file:///" + pathOrUri.replace(/\\/g, "/");
}
