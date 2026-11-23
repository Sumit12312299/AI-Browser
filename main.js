const { app, BrowserWindow, session, ipcMain } = require("electron");
const path = require("path");

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

function setupAdBlocker() {
  const filter = { urls: AD_DOMAINS };

  session.defaultSession.webRequest.onBeforeRequest(filter, (details, callback) => {
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
    backgroundColor: "#080a10",
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
  setupAdBlocker();
  createWindow();
});

// IPC handlers for AdBlocker toggle
ipcMain.on("toggle-adblocker", (event, enabled) => {
  adBlockerEnabled = enabled;
});

ipcMain.on("get-adblock-status", (event) => {
  event.returnValue = { enabled: adBlockerEnabled, count: blockedAdsCount };
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
