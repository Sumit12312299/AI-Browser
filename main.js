const { app, BrowserWindow } = require("electron");
const path = require("path");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 880,
    minHeight: 600,
    autoHideMenuBar: true, // 🚀 Hides the outdated menu bar for a modern borderless browser look
    show: true,
    title: "MR.SKY Browser",
    icon: path.join(__dirname, "icon.ico"),
    backgroundColor: "#0d0f17",
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

app.whenReady().then(createWindow);

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
