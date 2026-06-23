// Kew for Windows — Electron main process. Cybergah Group · cybergah.com
const { app, BrowserWindow, ipcMain, shell, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

function findRes() {
  const cands = [
    path.join(__dirname, "..", "resources"),            // dev + manual package (resources/app/resources)
    path.join(process.resourcesPath || "", "resources"), // electron-builder extraResources
    process.resourcesPath || "",                          // electron-packager extra-resource
  ];
  for (const d of cands) {
    try { if (d && fs.existsSync(path.join(d, "yt-dlp.exe"))) return d; } catch {}
  }
  return path.join(__dirname, "..", "resources");
}
const RES = findRes();
const YTDLP = path.join(RES, "yt-dlp.exe");
const FFMPEG = path.join(RES, "ffmpeg.exe");
const ICON = path.join(RES, "icon.ico");

const children = new Map();

function downloadsDir() {
  const d = path.join(app.getPath("downloads"), "Kew");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 900,
    minWidth: 380,
    minHeight: 640,
    backgroundColor: "#0d1b13",
    icon: ICON,
    autoHideMenuBar: true,
    title: "Kew",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allow file:// playback of downloaded videos
      autoplayPolicy: "no-user-gesture-required",
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function runJson(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(YTDLP, args, { windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0 && !out) return reject(new Error((err || "yt-dlp error").trim().slice(-300)));
      try { resolve(JSON.parse(out)); } catch (e) { reject(new Error("parse: " + e.message)); }
    });
  });
}

// ---- metadata / preview ----
ipcMain.handle("kew:info", async (_e, url) => {
  const j = await runJson(["--no-warnings", "--no-playlist", "--dump-single-json", url]);
  return {
    title: j.title || j.fulltitle,
    thumbnail: j.thumbnail,
    duration: j.duration,
    uploader: j.uploader,
    extractor: j.extractor,
  };
});

// ---- playlist enumeration ----
ipcMain.handle("kew:playlist", async (_e, url) => {
  const root = await runJson(["--no-warnings", "--flat-playlist", "-J", url]);
  const toEntry = (en) => {
    let eurl = en.webpage_url || en.url || "";
    const id = en.id || "";
    if (!String(eurl).startsWith("http") && id) {
      const k = (en.ie_key || root.extractor_key || "").toLowerCase();
      eurl = k.includes("youtube") ? "https://www.youtube.com/watch?v=" + id : id;
    }
    let thumb = en.thumbnail;
    if (!thumb && Array.isArray(en.thumbnails) && en.thumbnails.length) thumb = en.thumbnails[en.thumbnails.length - 1].url;
    if (!thumb && id && String(id).length === 11) thumb = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
    return { url: eurl, title: en.title || eurl, thumbnail: thumb };
  };
  if (Array.isArray(root.entries)) return { entries: root.entries.filter(Boolean).map(toEntry), title: root.title };
  return { entries: [toEntry(root)] };
});

// ---- download (with live progress) ----
ipcMain.handle("kew:download", (e, opts) => {
  return new Promise((resolve, reject) => {
    const dir = downloadsDir();
    const start = Date.now() - 2000;
    const args = [
      "-o", path.join(dir, "%(title).80B [%(id)s].%(ext)s"),
      "--no-mtime", "--no-playlist", "--continue", "--restrict-filenames", "--newline",
      "--ffmpeg-location", FFMPEG,
    ];
    if (opts.audioOnly) args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    else {
      args.push("-f", "bv*+ba/b", "-S",
        opts.quality === "max" ? "res,vcodec:h264,ext:mp4" : "res:" + opts.quality + ",vcodec:h264,ext:mp4",
        "--merge-output-format", "mp4");
    }
    args.push(opts.url);

    const child = spawn(YTDLP, args, { windowsHide: true });
    children.set(opts.taskId, child);
    let err = "";
    child.stdout.on("data", (d) => {
      const s = d.toString();
      const m = s.match(/\[download\]\s+([\d.]+)%/);
      if (m) e.sender.send("kew:progress", { taskId: opts.taskId, progress: parseFloat(m[1]), line: s.trim().slice(0, 200) });
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (er) => { children.delete(opts.taskId); reject(er); });
    child.on("close", (code) => {
      const killed = child.killed;
      children.delete(opts.taskId);
      if (killed) return reject(new Error("cancelled"));
      let files = [];
      try {
        for (const f of fs.readdirSync(dir)) {
          const fp = path.join(dir, f); const st = fs.statSync(fp);
          if (st.isFile() && st.mtimeMs >= start && !/\.(part|ytdl|tmp)$/i.test(f))
            files.push({ name: f, path: fp, uri: "file:///" + fp.replace(/\\/g, "/"), mime: /\.(mp3|m4a|opus|wav|aac)$/i.test(f) ? "audio/*" : "video/*" });
        }
      } catch {}
      if (code !== 0 && files.length === 0)
        return reject(new Error((err.replace(/\s+/g, " ").trim() || "yt-dlp failed").slice(-300)));
      if (files.length > 0 && opts.notify) showDone(opts.title);
      resolve({ files });
    });
  });
});

ipcMain.handle("kew:cancel", (_e, taskId) => {
  const c = children.get(taskId);
  if (c) { try { c.kill(); } catch {} }
  return true;
});

ipcMain.handle("kew:openPath", async (_e, p) => {
  let fp = p;
  if (typeof fp === "string" && fp.startsWith("file:///")) fp = decodeURIComponent(fp.slice(8)).replace(/\//g, "\\");
  await shell.openPath(fp);
  return true;
});

ipcMain.handle("kew:notify", (_e, title) => { showDone(title); return true; });

function showDone(title) {
  try {
    if (Notification.isSupported())
      new Notification({ title: "Kew ✓", body: title || "İndirme tamamlandı", icon: ICON, silent: false }).show();
  } catch {}
}
