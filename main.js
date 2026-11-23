const { app, BrowserWindow, session, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let blockedAdsCount = 0;
let adBlockerEnabled = true;

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

// Attach download listener to a session
const attachedSessions = new WeakSet();

function attachDownloadManager(targetSession) {
  const sess = targetSession || session.defaultSession;
  if (attachedSessions.has(sess)) return;
  attachedSessions.add(sess);

  sess.on("will-download", (event, item) => {
    const downloadId = Date.now().toString() + Math.random().toString(36).substr(2, 4);
    const fileName = item.getFilename();
    const downloadsFolder = app.getPath("downloads");

    // Compute unique save path in user's Downloads folder
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    let targetPath = path.join(downloadsFolder, fileName);
    let counter = 1;

    while (fs.existsSync(targetPath)) {
      targetPath = path.join(downloadsFolder, `${baseName} (${counter})${ext}`);
      counter++;
    }

    // Set save path automatically so download never gets stuck or cancelled
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
        state, // 'completed', 'cancelled', 'interrupted'
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

// Intercept downloads for any webview guest contents created
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
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save Webpage Screenshot",
    defaultPath: defaultFilename || `screenshot-${Date.now()}.png`,
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
