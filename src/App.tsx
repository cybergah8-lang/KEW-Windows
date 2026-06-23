import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { KewLogo } from "./assets/Logo";
import { Intro } from "./components/Intro";
import { LANGS, makeT, isRTL, type Lang } from "./lib/i18n";
import { detect, isValidUrl, PLATFORM_META, type Platform } from "./lib/platform";
import { ytdlpDownload, ytdlpInfo, ytdlpPlaylist, ytdlpCancel, ytdlpSetBusy, ytdlpNotifyDone, ytdlpPlayKeklik, onYtdlpProgress, openFile, isNative, browserDownload, toPlayableSrc, type MediaInfo } from "./lib/native";
import {
  loadSettings,
  saveSettings,
  loadDownloads,
  saveDownloads,
  newId,
  type Settings,
  type DownloadRecord,
  DEFAULT_SETTINGS,
} from "./lib/store";

type Tab = "home" | "downloads" | "player" | "about";

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [intro, setIntro] = useState(true);
  const [tab, setTab] = useState<Tab>("home");
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [playing, setPlaying] = useState<DownloadRecord | null>(null);
  const [toast, setToast] = useState<string>("");
  const [kbOpen, setKbOpen] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  // download queue (one yt-dlp process at a time, so each item finishes & saves on its own)
  const queueRef = useRef<string[]>([]);
  const runningRef = useRef<string | null>(null);
  const intentRef = useRef<Record<string, "pause" | "cancel">>({});
  const metaRef = useRef<Record<string, { url: string; audioOnly: boolean; quality: string; title: string }>>({});
  const attemptsRef = useRef<Record<string, number>>({});
  const batchTitleRef = useRef<Record<string, string>>({});
  const settingsRef = useRef<Settings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const t = useMemo(() => makeT(settings.lang), [settings.lang]);

  // boot
  useEffect(() => {
    (async () => {
      const [s, d] = await Promise.all([loadSettings(), loadDownloads()]);
      setSettings(s);
      setDownloads(d);
      setReady(true);
      if (s.sound) ytdlpPlayKeklik(); // keklik call on launch
    })();
    const timer = window.setTimeout(() => setIntro(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  // apply language direction
  useEffect(() => {
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = isRTL(settings.lang) ? "rtl" : "ltr";
  }, [settings.lang]);

  // hide the bottom tab bar while a text field is focused (keyboard open)
  useEffect(() => {
    const isField = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    const onIn = (e: FocusEvent) => isField(e.target) && setKbOpen(true);
    const onOut = (e: FocusEvent) => isField(e.target) && setKbOpen(false);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  // persist downloads on change
  useEffect(() => {
    if (ready) saveDownloads(downloads);
  }, [downloads, ready]);

  // live progress from the native yt-dlp engine
  useEffect(() => {
    if (!isNative()) return;
    let handle: { remove: () => void } | undefined;
    onYtdlpProgress((e) => {
      setDownloads((list) =>
        list.map((d) =>
          d.id === e.taskId
            ? { ...d, progress: e.progress, statusLine: e.line }
            : d
        )
      );
    }).then((h) => (handle = h));
    return () => handle?.remove();
  }, []);

  function flash(msg: string) {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2200);
  }

  function patchSettings(p: Partial<Settings>) {
    setSettings((s) => {
      const ns = { ...s, ...p };
      saveSettings(ns);
      return ns;
    });
  }

  const MAX_RETRY = 3;

  function finishOk(id: string, files: { name: string; uri: string; path: string }[]) {
    attemptsRef.current[id] = 0;
    let doneTitle = "";
    setDownloads((list) => {
      const base = list.find((d) => d.id === id);
      if (!base) return list;
      doneTitle = base.title;
      const recs: DownloadRecord[] = files.map((f, i) => ({
        ...base,
        id: i === 0 ? id : newId(),
        filename: f.name,
        title: files.length === 1 && base.title ? base.title : f.name.replace(/\.[a-z0-9]+$/i, ""),
        status: "completed",
        progress: 100,
        localUri: f.uri,
        playUri: toPlayableSrc(f.path),
      }));
      return list.flatMap((d) => (d.id === id ? recs : [d]));
    });
    // completion sound + notification are fired natively in the download thread
    // (works in the background too) — see KewYtdlpPlugin.
  }

  // A failed/empty item is retried automatically a few times before giving up.
  function failOrRetry(id: string, err?: string) {
    const a = (attemptsRef.current[id] || 0) + 1;
    attemptsRef.current[id] = a;
    if (a < MAX_RETRY) {
      setDownloads((list) => list.map((d) => (d.id === id ? { ...d, status: "queued", progress: -1, statusLine: `retry ${a}/${MAX_RETRY}` } : d)));
      queueRef.current.unshift(id); // retry this one before moving on
    } else {
      const msg = (err || "").replace(/\s+/g, " ").trim().slice(0, 180);
      setDownloads((list) => list.map((d) => (d.id === id ? { ...d, status: "failed", statusLine: msg || undefined } : d)));
    }
  }

  // Process the queue: download one item, save it on completion, then move on.
  function pump() {
    if (runningRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      ytdlpSetBusy(false);
      return;
    }
    const meta = metaRef.current[next];
    if (!meta) {
      pump();
      return;
    }
    runningRef.current = next;
    const title = (meta.title || "").slice(0, 40);
    ytdlpSetBusy(true, title ? `↧ ${title}` : "Kew");
    setDownloads((list) => list.map((d) => (d.id === next ? { ...d, status: "running", progress: -1 } : d)));

    ytdlpDownload({
      url: meta.url,
      audioOnly: meta.audioOnly,
      quality: meta.quality,
      taskId: next,
      title: meta.title,
      notify: settingsRef.current.notify,
      sound: settingsRef.current.sound,
    })
      .then((res) => {
        const files = res.files || [];
        if (files.length === 0) failOrRetry(next);
        else finishOk(next, files);
      })
      .catch((e: any) => {
        const intent = intentRef.current[next];
        delete intentRef.current[next];
        if (intent === "pause") {
          setDownloads((list) => list.map((d) => (d.id === next ? { ...d, status: "paused" } : d)));
        } else if (intent === "cancel") {
          setDownloads((list) => list.filter((d) => d.id !== next));
          delete metaRef.current[next];
        } else {
          failOrRetry(next, e?.message || String(e));
        }
      })
      .finally(() => {
        runningRef.current = null;
        if (queueRef.current.length === 0) ytdlpSetBusy(false);
        pump();
      });
  }

  function enqueue(rec: DownloadRecord, meta: { url: string; audioOnly: boolean; quality: string; title: string }) {
    metaRef.current[rec.id] = meta;
    queueRef.current.push(rec.id);
    pump();
  }

  function pauseItem(id: string) {
    if (runningRef.current === id) {
      intentRef.current[id] = "pause";
      ytdlpCancel(id);
    }
  }

  function resumeItem(id: string) {
    setDownloads((list) => list.map((d) => (d.id === id ? { ...d, status: "queued" } : d)));
    queueRef.current.push(id);
    pump();
  }

  function cancelItem(id: string) {
    if (runningRef.current === id) {
      intentRef.current[id] = "cancel";
      ytdlpCancel(id);
    } else {
      queueRef.current = queueRef.current.filter((x) => x !== id);
      delete metaRef.current[id];
      setDownloads((list) => list.filter((d) => d.id !== id));
    }
  }

  // ----- whole-playlist (batch) controls -----
  function pauseBatch(batchId: string) {
    const recs = downloads.filter((d) => d.batchId === batchId);
    recs.forEach((d) => {
      if (d.status === "running") {
        intentRef.current[d.id] = "pause";
        ytdlpCancel(d.id);
      }
    });
    const ids = new Set(recs.filter((d) => d.status === "queued").map((d) => d.id));
    queueRef.current = queueRef.current.filter((id) => !ids.has(id));
    setDownloads((list) => list.map((d) => (d.batchId === batchId && d.status === "queued" ? { ...d, status: "paused" } : d)));
  }

  function resumeBatch(batchId: string) {
    const ids = downloads.filter((d) => d.batchId === batchId && (d.status === "paused" || d.status === "failed")).map((d) => d.id);
    setDownloads((list) => list.map((d) => (ids.includes(d.id) ? { ...d, status: "queued", progress: -1 } : d)));
    ids.forEach((id) => {
      if (!queueRef.current.includes(id)) queueRef.current.push(id);
    });
    pump();
  }

  function cancelBatch(batchId: string) {
    const recs = downloads.filter((d) => d.batchId === batchId);
    recs.forEach((d) => {
      if (d.status === "running") {
        intentRef.current[d.id] = "cancel";
        ytdlpCancel(d.id);
      }
    });
    const removeIds = new Set(recs.filter((d) => d.status !== "completed" && d.status !== "running").map((d) => d.id));
    queueRef.current = queueRef.current.filter((id) => !removeIds.has(id));
    removeIds.forEach((id) => delete metaRef.current[id]);
    setDownloads((list) => list.filter((d) => !removeIds.has(d.id)));
  }

  async function handleDownload(opts: {
    url: string;
    platform: Platform;
    audioOnly: boolean;
    quality: string;
    info?: MediaInfo | null;
    isPlaylist?: boolean;
  }) {
    flash(t("started"));
    setTab("downloads");

    const niceName = opts.info?.title || opts.url.replace(/^https?:\/\//, "").slice(0, 60);

    if (!isNative()) {
      const id = newId();
      setDownloads((list) => [
        { id, managerId: -1, url: opts.url, filename: niceName, title: niceName, platform: opts.platform, audioOnly: opts.audioOnly, createdAt: Date.now(), status: "completed", progress: 100, thumbnail: opts.info?.thumbnail },
        ...list,
      ]);
      browserDownload(opts.url, niceName);
      return;
    }

    // Show a card IMMEDIATELY — no waiting for extraction.
    const id0 = newId();
    const placeholder: DownloadRecord = {
      id: id0, managerId: -1, url: opts.url, filename: niceName, title: niceName,
      platform: opts.platform, audioOnly: opts.audioOnly, createdAt: Date.now(),
      status: "queued", progress: -1, thumbnail: opts.info?.thumbnail,
    };
    setDownloads((list) => [placeholder, ...list]);

    // Single link: start downloading right away (no enumeration delay).
    if (!opts.isPlaylist) {
      enqueue(placeholder, { url: opts.url, audioOnly: opts.audioOnly, quality: opts.quality, title: niceName });
      return;
    }

    // Playlist: enumerate in the background, then replace the placeholder with
    // one card per video.
    let entries: { url: string; title: string; thumbnail?: string }[] = [];
    let plTitle: string | undefined;
    try {
      const r = await ytdlpPlaylist(opts.url);
      entries = r.entries && r.entries.length ? r.entries : [];
      plTitle = r.title;
    } catch {
      entries = [];
    }
    if (entries.length <= 1) {
      // not actually a playlist (or failed) — just download the single link
      enqueue(placeholder, { url: opts.url, audioOnly: opts.audioOnly, quality: opts.quality, title: niceName });
      return;
    }

    const batchId = newId();
    batchTitleRef.current[batchId] = plTitle || `${t("playlist")} · ${entries.length}`;
    const recs: DownloadRecord[] = entries.map((e) => ({
      id: newId(), managerId: -1, url: e.url, filename: e.title, title: e.title,
      platform: opts.platform, audioOnly: opts.audioOnly, createdAt: Date.now(),
      status: "queued", progress: -1, thumbnail: e.thumbnail, batchId,
    }));
    setDownloads((list) => [...recs, ...list.filter((d) => d.id !== id0)]);
    recs.forEach((r) => enqueue(r, { url: r.url, audioOnly: opts.audioOnly, quality: opts.quality, title: r.title }));
  }

  if (intro) {
    return <Intro tagline={t("app_tagline")} onSkip={() => setIntro(false)} />;
  }

  if (!ready) {
    return (
      <div className="app" style={{ display: "grid", placeItems: "center" }}>
        <div className="glow"><KewLogo size={110} /></div>
      </div>
    );
  }

  return (
    <div className="app">
      <Header lang={settings.lang} t={t} onLang={(l) => patchSettings({ lang: l })} />

      <div className="content">
        {tab === "home" && <HomeScreen t={t} settings={settings} onDownload={handleDownload} flash={flash} />}
        {tab === "downloads" && (
          <DownloadsScreen
            t={t}
            downloads={downloads}
            onPlay={(d) => { setPlaying(d); setTab("player"); }}
            onOpen={(d) => d.localUri && openFile(d.localUri, d.audioOnly ? "audio/*" : "video/*")}
            onDelete={(id) => setDownloads((l) => l.filter((x) => x.id !== id))}
            onPause={pauseItem}
            onResume={resumeItem}
            onCancel={cancelItem}
            onPauseBatch={pauseBatch}
            onResumeBatch={resumeBatch}
            onCancelBatch={cancelBatch}
            batchTitle={(id) => batchTitleRef.current[id] || t("playlist")}
          />
        )}
        {tab === "player" && (
          <PlayerScreen
            t={t}
            item={playing}
            onOpen={(d) => d.localUri && openFile(d.localUri, d.audioOnly ? "audio/*" : "video/*")}
          />
        )}
        {tab === "about" && <AboutScreen t={t} settings={settings} patchSettings={patchSettings} />}
      </div>

      {toast && <div className="toast">{toast}</div>}

      <nav className={"tabs" + (kbOpen ? " hidden" : "")}>
        <TabBtn ico="⌂" label={t("nav_home")} on={tab === "home"} onClick={() => setTab("home")} />
        <TabBtn ico="↧" label={t("nav_downloads")} on={tab === "downloads"} onClick={() => setTab("downloads")} />
        <TabBtn ico="▶" label={t("nav_player")} on={tab === "player"} onClick={() => setTab("player")} />
        <TabBtn ico="✶" label={t("nav_about")} on={tab === "about"} onClick={() => setTab("about")} />
      </nav>
    </div>
  );
}

/* ---------------- Header ---------------- */
function Header({ lang, t, onLang }: { lang: Lang; t: (k: string) => string; onLang: (l: Lang) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="header">
      <div className="brand">
        <KewLogo size={44} />
        <div>
          <h1>KEW</h1>
          <div className="tag">{t("app_tagline")}</div>
        </div>
      </div>
      <div className="spacer" />
      <div style={{ position: "relative" }}>
        <button className="lang-pill" onClick={() => setOpen((o) => !o)}>
          🌐 {LANGS.find((l) => l.code === lang)?.label}
        </button>
        {open && (
          <div className="card" style={{ position: "absolute", right: 0, top: 44, zIndex: 30, minWidth: 150, padding: 8 }}>
            {LANGS.map((l) => (
              <div
                key={l.code}
                className={"lang-opt" + (l.code === lang ? " on" : "")}
                style={{ marginBottom: 6 }}
                onClick={() => { onLang(l.code); setOpen(false); }}
              >
                <span>{l.flag}</span> {l.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function TabBtn({ ico, label, on, onClick }: { ico: string; label: string; on: boolean; onClick: () => void }) {
  return (
    <button className={"tab" + (on ? " on" : "")} onClick={onClick}>
      <span className="ico">{ico}</span>
      <span>{label}</span>
    </button>
  );
}

/* ---------------- Home ---------------- */
function HomeScreen({
  t,
  settings,
  onDownload,
  flash,
}: {
  t: (k: string) => string;
  settings: Settings;
  onDownload: (opts: { url: string; platform: Platform; audioOnly: boolean; quality: string; info?: MediaInfo | null; isPlaylist?: boolean }) => void;
  flash: (m: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [audioOnly, setAudioOnly] = useState(settings.audioOnly);
  const [quality, setQuality] = useState(settings.quality);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  const det = url ? detect(url) : null;
  const meta = det ? PLATFORM_META[det.platform] : null;

  // Fetch a preview (title + thumbnail) shortly after a valid link is entered.
  useEffect(() => {
    setInfo(null);
    if (!isNative() || !url.trim() || !isValidUrl(url) || det?.platform === "unknown") {
      setInfoLoading(false);
      return;
    }
    let cancelled = false;
    setInfoLoading(true);
    const handle = window.setTimeout(async () => {
      try {
        const i = await ytdlpInfo(url.trim());
        if (!cancelled) setInfo(i);
      } catch {
        if (!cancelled) setInfo(null);
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [url]);

  const fmtDur = (s?: number) => {
    if (!s || s <= 0) return "";
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, "0");
    return `${m}:${ss}`;
  };

  async function paste() {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) setUrl(txt.trim());
    } catch {
      flash(t("paste_first"));
    }
  }

  function go() {
    if (!url.trim()) return flash(t("paste_first"));
    if (!isValidUrl(url)) return flash(t("invalid_url"));
    setBusy(true);
    onDownload({ url: url.trim(), platform: det?.platform ?? "unknown", audioOnly, quality, info, isPlaylist: det?.isPlaylist });
    setUrl("");
    setInfo(null);
    window.setTimeout(() => setBusy(false), 600);
  }

  return (
    <>
      <div className="hero">
        <div className="glow"><KewLogo size={92} /></div>
        <h2>{t("app_tagline")}</h2>
        <p>YouTube · X · TikTok · Instagram</p>
      </div>

      <div className="card">
        <div className="url-row">
          <input
            className="url-input"
            placeholder={t("paste_hint")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button className="btn btn-ghost" onClick={paste}>{t("paste_btn")}</button>
        </div>

        {meta && det && det.platform !== "unknown" && (
          <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="platform-badge" style={{ background: meta.color }}>
              {meta.icon} {meta.name}
            </span>
            {det.isPlaylist && <span className="chip active">≡ {t("playlist")}</span>}
            <span className="chip active">✓ {t("detected")}</span>
          </div>
        )}

        {(infoLoading || info) && det && det.platform !== "unknown" && (
          <div className="preview">
            <div className="preview-thumb">
              {info?.thumbnail ? (
                <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="shimmer">{meta?.icon}</span>
              )}
              {info && fmtDur(info.duration) && <span className="dur">{fmtDur(info.duration)}</span>}
            </div>
            <div className="preview-meta">
              {infoLoading && !info ? (
                <>
                  <div className="line w70" />
                  <div className="line w40" />
                </>
              ) : (
                <>
                  <div className="preview-title">{info?.title}</div>
                  {info?.uploader && <div className="preview-sub">{info.uploader}</div>}
                </>
              )}
            </div>
          </div>
        )}

        <div className="opt-row">
          <div className={"toggle" + (audioOnly ? " on" : "")} onClick={() => setAudioOnly((a) => !a)}>
            <span>{audioOnly ? "♪" : "▦"}</span> {audioOnly ? t("audio_only") : t("video")}
          </div>
          {!audioOnly && (
            <div className="seg">
              {["max", "1080", "720", "480"].map((q) => (
                <button key={q} className={q === quality ? "on" : ""} onClick={() => setQuality(q)}>
                  {q === "max" ? "Max" : q + "p"}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-gold btn-block" onClick={go} disabled={busy}>
          {busy ? t("analyzing") : det?.isPlaylist ? `↧ ${t("download_all")}` : `↧ ${t("download_btn")}`}
        </button>
      </div>

      <div className="card" style={{ fontSize: 12, color: "var(--muted)" }}>
        📁 {t("save_location")}
      </div>
    </>
  );
}

/* ---------------- Downloads ---------------- */
function DownloadsScreen({
  t,
  downloads,
  onPlay,
  onOpen,
  onDelete,
  onPause,
  onResume,
  onCancel,
  onPauseBatch,
  onResumeBatch,
  onCancelBatch,
  batchTitle,
}: {
  t: (k: string) => string;
  downloads: DownloadRecord[];
  onPlay: (d: DownloadRecord) => void;
  onOpen: (d: DownloadRecord) => void;
  onDelete: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onPauseBatch: (batchId: string) => void;
  onResumeBatch: (batchId: string) => void;
  onCancelBatch: (batchId: string) => void;
  batchTitle: (batchId: string) => string;
}) {
  if (downloads.length === 0) {
    return (
      <div className="empty">
        <div className="big">↧</div>
        <h3>{t("no_downloads")}</h3>
        <p>{t("no_downloads_hint")}</p>
      </div>
    );
  }
  const statusText = (d: DownloadRecord) => {
    switch (d.status) {
      case "running":
        return (d.progress != null && d.progress >= 0 ? `${Math.round(d.progress)}% · ` : "") + t("progress");
      case "queued":
        return t("queued");
      case "paused":
        return (d.progress != null && d.progress >= 0 ? `${Math.round(d.progress)}% · ` : "") + t("paused");
      case "completed":
        return t("completed");
      default:
        return t("failed");
    }
  };
  const renderItem = (d: DownloadRecord) => {
        const meta = PLATFORM_META[d.platform];
        const active = d.status === "running" || d.status === "queued" || d.status === "paused";
        return (
          <div className="card" key={d.id}>
            <div className="dl">
              <div className="thumb" style={{ color: meta.color, overflow: "hidden" }}>
                {d.thumbnail && !d.audioOnly ? (
                  <img src={d.thumbnail} alt="" referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  d.audioOnly ? "♪" : meta.icon
                )}
              </div>
              <div className="meta">
                <div className="name">{d.title}</div>
                <div className="sub">
                  <span className={"status-dot " + d.status} /> {statusText(d)}
                  {" · "}{meta.name}
                </div>
              </div>
              <div className="acts">
                {d.status === "completed" && !d.audioOnly && (
                  <button className="icon-btn" title={t("play")} onClick={() => onPlay(d)}>▶</button>
                )}
                {d.status === "completed" && (
                  <button className="icon-btn" title={t("open")} onClick={() => onOpen(d)}>⇲</button>
                )}
                {d.status === "running" && (
                  <button className="icon-btn" title={t("pause")} onClick={() => onPause(d.id)}>⏸</button>
                )}
                {(d.status === "paused" || d.status === "failed") && (
                  <button className="icon-btn" title={d.status === "failed" ? t("retry") : t("resume")} onClick={() => onResume(d.id)}>
                    {d.status === "failed" ? "↻" : "▶"}
                  </button>
                )}
                {active ? (
                  <button className="icon-btn danger" title={t("cancel")} onClick={() => onCancel(d.id)}>✕</button>
                ) : (
                  <button className="icon-btn danger" title={t("delete")} onClick={() => onDelete(d.id)}>✕</button>
                )}
              </div>
            </div>
            {(d.status === "running" || d.status === "paused") && (
              <div className="bar">
                <i style={{ width: d.progress != null && d.progress >= 0 ? `${d.progress}%` : "15%" }} />
              </div>
            )}
            {d.status === "failed" && d.statusLine && (
              <div style={{ marginTop: 8, fontSize: 11, color: "var(--red)", wordBreak: "break-word" }}>
                {d.statusLine}
              </div>
            )}
          </div>
        );
  };

  // group contiguous items belonging to the same playlist batch
  const groups: { batchId?: string; items: DownloadRecord[] }[] = [];
  for (const d of downloads) {
    const last = groups[groups.length - 1];
    if (d.batchId && last && last.batchId === d.batchId) last.items.push(d);
    else groups.push({ batchId: d.batchId, items: [d] });
  }

  return (
    <>
      {groups.map((g) => {
        if (!g.batchId || g.items.length < 2) return <Fragment key={g.items[0].id}>{g.items.map(renderItem)}</Fragment>;
        const done = g.items.filter((x) => x.status === "completed").length;
        const anyActive = g.items.some((x) => x.status === "running" || x.status === "queued");
        const anyPaused = g.items.some((x) => x.status === "paused");
        return (
          <div key={g.batchId} className="batch">
            <div className="batch-head">
              <div className="batch-meta">
                <div className="batch-title">≡ {batchTitle(g.batchId)}</div>
                <div className="batch-sub">{done}/{g.items.length} · {t("completed")}</div>
              </div>
              <div className="acts">
                {anyActive && (
                  <button className="icon-btn" title={t("pause")} onClick={() => onPauseBatch(g.batchId!)}>⏸</button>
                )}
                {anyPaused && (
                  <button className="icon-btn" title={t("resume")} onClick={() => onResumeBatch(g.batchId!)}>▶</button>
                )}
                <button className="icon-btn danger" title={t("cancel")} onClick={() => onCancelBatch(g.batchId!)}>✕</button>
              </div>
            </div>
            {g.items.map(renderItem)}
          </div>
        );
      })}
    </>
  );
}

/* ---------------- Player ---------------- */
function PlayerScreen({
  t,
  item,
  onOpen,
}: {
  t: (k: string) => string;
  item: DownloadRecord | null;
  onOpen: (d: DownloadRecord) => void;
}) {
  const src = item?.playUri || item?.localUri;
  if (!item || !src) {
    return (
      <div className="empty">
        <div className="big">▶</div>
        <h3>{t("nav_player")}</h3>
        <p>{t("no_downloads_hint")}</p>
      </div>
    );
  }
  return (
    <div className="card">
      {item.audioOnly ? (
        <div className="thumb" style={{ width: "100%", height: 160, fontSize: 56 }}>♪</div>
      ) : (
        <video src={src} poster={item.thumbnail} controls autoPlay playsInline />
      )}
      <div style={{ marginTop: 10, fontWeight: 600 }}>{item.title}</div>
      <div className="sub" style={{ color: "var(--muted)", fontSize: 12 }}>{PLATFORM_META[item.platform].name}</div>
      <button className="btn btn-ghost btn-block" onClick={() => onOpen(item)}>
        ⇲ {t("open")}
      </button>
    </div>
  );
}

/* ---------------- About / Settings ---------------- */
function AboutScreen({
  t,
  settings,
  patchSettings,
}: {
  t: (k: string) => string;
  settings: Settings;
  patchSettings: (p: Partial<Settings>) => void;
}) {
  return (
    <>
      <div className="card" style={{ textAlign: "center" }}>
        <div className="glow"><KewLogo size={80} /></div>
        <h2 style={{ margin: "12px 0 2px" }}>Kew</h2>
        <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>{t("about_title")}</p>
        <p style={{ fontSize: 14, lineHeight: 1.6, marginTop: 12 }}>{t("about_body")}</p>
        <span className="badge-foss">⚑ {t("open_source")}</span>
      </div>

      <div className="card">
        <div className="manifesto">
          <h3 style={{ margin: "0 0 8px", color: "var(--gold-soft)" }}>⚑ {t("manifesto_title")}</h3>
          <p style={{ margin: 0, lineHeight: 1.7, fontSize: 14 }}>{t("manifesto_body")}</p>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>⚙ {t("settings")}</h3>
        <div className="row">
          <label>⚙ yt-dlp · on-device</label>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            {t("engine_note")}
          </div>
        </div>
        <div className="row">
          <label>{t("notifications")}</label>
          <div className="opt-row">
            <div
              className={"toggle" + (settings.notify ? " on" : "")}
              onClick={() => patchSettings({ notify: !settings.notify })}
            >
              <span>{settings.notify ? "🔔" : "🔕"}</span> {t("notifications")}
            </div>
            <div
              className={"toggle" + (settings.sound ? " on" : "")}
              onClick={() => patchSettings({ sound: !settings.sound })}
            >
              <span>🐦</span> {t("keklik_sound")}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>{t("notif_note")}</div>
        </div>
        <div className="row">
          <label>{t("language")}</label>
          <div className="lang-grid">
            {LANGS.map((l) => (
              <div
                key={l.code}
                className={"lang-opt" + (l.code === settings.lang ? " on" : "")}
                onClick={() => patchSettings({ lang: l.code })}
              >
                <span>{l.flag}</span> {l.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sig">
        <div className="glow" style={{ display: "inline-block" }}><KewLogo size={36} /></div>
        <div>{t("by_cybergah")}</div>
        <div><strong>Cybergah Group</strong> · <a href="https://cybergah.com" target="_blank" rel="noreferrer">cybergah.com</a></div>
        <div>info@cybergah.com</div>
        <div style={{ opacity: 0.6, marginTop: 6 }}>Kew v1.0.0 · GPL-3.0 · © 2026</div>
      </div>
    </>
  );
}
