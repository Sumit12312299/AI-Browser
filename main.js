const { app, BrowserWindow, session, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

// Allow file:// URLs to load local images from any drive (e.g. D:\, C:\)
app.commandLine.appendSwitch("allow-file-access-from-files");

let blockedAdsCount = 0;
let adBlockerEnabled = true;

// Custom download location: D:\Downloads
function getDownloadsDirectory() {
  const customPath = "D:\\Downloads";
  try {
    if (!fs.existsSync(customPath)) {
      fs.mkdirSync(customPath, { recursive: true });
    }
    return customPath;
  } catch (err) {
    console.warn("Could not create/access D:\\Downloads, falling back to default:", err);
    return app.getPath("downloads");
  }
}

// Valid Chromium Match Patterns for ad and tracker blocking
const AD_DOMAINS = [
  "*://*.doubleclick.net/*",
  "*://*.googleadservices.com/*",
  "*://*.googlesyndication.com/*",
  "*://*.google-analytics.com/*",
  "*://*.adservice.google.com/*",
  "*://*.pagead2.googlesyndication.com/*",
  "*://creative.ak.fbcdn.net/*",
  "*://*.adbrite.com/*",
  "*://*.exponential.com/*",
  "*://*.quantserve.com/*",
  "*://*.scorecardresearch.com/*",
  "*://*.zedo.com/*",
  "*://*.taboola.com/*",
  "*://*.outbrain.com/*",
  "*://*.criteo.com/*",
  "*://*.criteo.net/*",
  "*://*.adroll.com/*",
  "*://*.popads.net/*",
  "*://*.adsterra.com/*",
  "*://*.propellerads.com/*",
  "*://*.adnxs.com/*",
  "*://*.rubiconproject.com/*",
  "*://*.pubmatic.com/*",
  "*://*.advertising.com/*"
];

function setupAdBlocker(targetSession) {
  const sess = targetSession || session.defaultSession;
  const filter = { urls: AD_DOMAINS };

  sess.webRequest.onBeforeRequest(filter, (details, callback) => {
    if (adBlockerEnabled) {
      blockedAdsCount++;
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send("ad-blocked-update", {
            count: blockedAdsCount,
            url: details.url
          });
        }
      });
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });
}

const attachedSessions = new WeakSet();

function attachDownloadManager(targetSession) {
  const sess = targetSession || session.defaultSession;
  if (attachedSessions.has(sess)) return;
  attachedSessions.add(sess);

  sess.on("will-download", (event, item) => {
    const downloadId = Date.now().toString() + Math.random().toString(36).substr(2, 4);
    const fileName = item.getFilename();
    const downloadsFolder = getDownloadsDirectory();

    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let targetPath = path.join(downloadsFolder, fileName);
    let counter = 1;

    while (fs.existsSync(targetPath)) {
      targetPath = path.join(downloadsFolder, `${baseName} (${counter})${ext}`);
      counter++;
    }

    item.setSavePath(targetPath);

    function broadcast(channel, payload) {
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          win.webContents.send(channel, payload);
        }
      });
    }

    broadcast("download-started", {
      id: downloadId,
      fileName,
      totalBytes: item.getTotalBytes(),
      startTime: Date.now()
    });

    item.on("updated", (e, state) => {
      if (state === "progressing") {
        broadcast("download-progress", {
          id: downloadId,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes()
        });
      }
    });

    item.once("done", (e, state) => {
      broadcast("download-done", {
        id: downloadId,
        state,
        savePath: targetPath,
        fileName
      });
    });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
    show: true,
    title: "MR.SKY Browser",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#0b0d13",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  });

  win.loadFile("index.html");

  win.once("ready-to-show", () => {
    win.show();
    win.focus();
  });
}

app.whenReady().then(() => {
  setupAdBlocker(session.defaultSession);
  attachDownloadManager(session.defaultSession);
  createWindow();
});

app.on("web-contents-created", (event, contents) => {
  if (contents.session) {
    attachDownloadManager(contents.session);
    setupAdBlocker(contents.session);
  }
});

// IPC handlers for AdBlocker
ipcMain.on("toggle-adblocker", (event, enabled) => {
  adBlockerEnabled = enabled;
});

// IPC handlers for File Operations & Screenshots
ipcMain.handle("save-screenshot-dialog", async (event, { base64Data, defaultFilename }) => {
  const win = BrowserWindow.getFocusedWindow();
  const downloadsFolder = getDownloadsDirectory();
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save Webpage Screenshot",
    defaultPath: path.join(downloadsFolder, defaultFilename || `screenshot-${Date.now()}.png`),
    filters: [{ name: "PNG Images", extensions: ["png"] }]
  });

  if (!canceled && filePath) {
    const buffer = Buffer.from(base64Data, "base64");
    fs.writeFileSync(filePath, buffer);
    return { success: true, filePath };
  }
  return { success: false };
});

ipcMain.on("open-path", (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.openPath(filePath);
  }
});

ipcMain.on("show-item-in-folder", (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
  }
});

ipcMain.on("open-downloads-folder", () => {
  const folder = getDownloadsDirectory();
  shell.openPath(folder);
});

ipcMain.on("open-customize-sidebar", () => {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send("open-customize-sidebar");
    }
  });
});

// ── Shortcuts Persistence (JSON file in userData) ─────────────────────────
const SHORTCUTS_CONFIG_PATH = path.join(app.getPath("userData"), "shortcuts-config.json");

ipcMain.handle("save-shortcuts", (event, shortcuts) => {
  try {
    fs.writeFileSync(SHORTCUTS_CONFIG_PATH, JSON.stringify(shortcuts, null, 2), "utf8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-shortcuts", () => {
  try {
    if (fs.existsSync(SHORTCUTS_CONFIG_PATH)) {
      const data = fs.readFileSync(SHORTCUTS_CONFIG_PATH, "utf8");
      return JSON.parse(data);
    }
    return null;
  } catch (err) {
    return null;
  }
});

// ── Wallpaper Config Persistence (JSON file in userData) ──────────────────
const WALLPAPER_CONFIG_PATH = path.join(app.getPath("userData"), "wallpaper-config.json");

ipcMain.handle("save-wallpaper-config", (event, config) => {
  try {
    fs.writeFileSync(WALLPAPER_CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("wallpaper-updated", config);
      }
    });
    return { success: true };
  } catch (err) {
    console.error("Failed to save wallpaper config:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("get-wallpaper-config", (event) => {
  try {
    if (fs.existsSync(WALLPAPER_CONFIG_PATH)) {
      const data = fs.readFileSync(WALLPAPER_CONFIG_PATH, "utf8");
      return JSON.parse(data);
    }
    return null;
  } catch (err) {
    console.error("Failed to read wallpaper config:", err);
    return null;
  }
});

ipcMain.handle("clear-wallpaper-config", (event) => {
  try {
    if (fs.existsSync(WALLPAPER_CONFIG_PATH)) {
      fs.unlinkSync(WALLPAPER_CONFIG_PATH);
    }
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send("wallpaper-updated", null);
      }
    });
    return { success: true };
  } catch (err) {
    return { success: false };
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
