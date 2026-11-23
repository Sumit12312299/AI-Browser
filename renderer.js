const { ipcRenderer, clipboard } = require("electron");
const path = require("path");

let tabCount = 0;
let activeTabId = null;
let urlInput;
let tabsBar;
let webviewsContainer;
let reloadBtn;

// AdBlocker State
let isAdBlockerActive = true;
let totalBlockedAds = 0;

// Downloads State
let downloads = [];
let isDownloadsTrayOpen = false;

function getActiveWebview() {
  return activeTabId ? document.getElementById(activeTabId) : null;
}

function getHomepagePath() {
  return `file://${path.join(__dirname, "homepage.html")}`;
}

function getHistoryPath() {
  return `file://${path.join(__dirname, "history.html")}`;
}

// ══════════════════════════════════════════════════════════════════
// 🔍 NAVIGATION CONTROLS
// ══════════════════════════════════════════════════════════════════
function go() {
  const activeWv = getActiveWebview();
  if (!activeWv) return;

  let url = urlInput.value.trim();
  if (!url) return;

  if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("file://")) {
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(url)) {
      url = "https://" + url;
    } else {
      url = "https://www.google.com/search?q=" + encodeURIComponent(url);
    }
  }

  activeWv.loadURL(url);
}

function back() {
  const wv = getActiveWebview();
  if (wv && wv.canGoBack()) wv.goBack();
}

function forward() {
  const wv = getActiveWebview();
  if (wv && wv.canGoForward()) wv.goForward();
}

function reload() {
  const wv = getActiveWebview();
  if (!wv) return;

  if (typeof wv.isLoading === "function" && wv.isLoading()) {
    wv.stop();
  } else {
    wv.reload();
  }
}

function home() {
  const wv = getActiveWebview();
  if (wv) wv.loadURL(getHomepagePath());
}

function showHistory() {
  const wv = getActiveWebview();
  if (wv) wv.loadURL(getHistoryPath());
}

// ══════════════════════════════════════════════════════════════════
// 📸 USEFUL TOOL 1: SCREENSHOT TOOL
// ══════════════════════════════════════════════════════════════════
async function takePageScreenshot() {
  const wv = getActiveWebview();
  if (!wv) return;

  try {
    const image = await wv.capturePage();
    if (image.isEmpty()) {
      showToast("Could not capture screenshot", "error");
      return;
    }

    clipboard.writeImage(image);

    const base64Data = image.toPNG().toString("base64");
    const activeTitle = (document.getElementById("btn-" + activeTabId)?.querySelector(".tab-title")?.innerText || "page")
      .toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 20);

    const defaultFilename = `screenshot-${activeTitle}-${Date.now()}.png`;

    showToast("📸 Screenshot copied to clipboard!", "success", [
      {
        label: "Save PNG",
        action: async () => {
          const res = await ipcRenderer.invoke("save-screenshot-dialog", { base64Data, defaultFilename });
          if (res.success) {
            showToast("Saved screenshot successfully!", "success");
          }
        }
      }
    ]);
  } catch (err) {
    console.error("Screenshot capture failed:", err);
    showToast("Failed to capture screenshot", "error");
  }
}

// ══════════════════════════════════════════════════════════════════
// 🛠️ USEFUL TOOL 2: DEVELOPER TOOLS (F12)
// ══════════════════════════════════════════════════════════════════
function toggleDevTools() {
  const wv = getActiveWebview();
  if (!wv) return;

  if (typeof wv.isDevToolsOpened === "function" && wv.isDevToolsOpened()) {
    wv.closeDevTools();
  } else if (typeof wv.openDevTools === "function") {
    wv.openDevTools();
  }
}

// ══════════════════════════════════════════════════════════════════
// ⬇️ USEFUL TOOL 3: DOWNLOAD MANAGER TRAY
// ══════════════════════════════════════════════════════════════════
function toggleDownloadsTray() {
  isDownloadsTrayOpen = !isDownloadsTrayOpen;
  const tray = document.getElementById("downloads-tray");
  if (tray) {
    tray.classList.toggle("open", isDownloadsTrayOpen);
  }
}

function setupDownloadsListener() {
  ipcRenderer.on("download-started", (event, item) => {
    downloads.unshift({
      id: item.id,
      fileName: item.fileName,
      totalBytes: item.totalBytes,
      receivedBytes: 0,
      state: "progressing",
      startTime: item.startTime
    });
    updateDownloadsUI();
    showToast(`⬇ Download started: ${item.fileName}`, "info");
  });

  ipcRenderer.on("download-progress", (event, data) => {
    const item = downloads.find(d => d.id === data.id);
    if (item) {
      item.receivedBytes = data.receivedBytes;
      item.totalBytes = data.totalBytes || item.totalBytes;
      updateDownloadsUI();
    }
  });

  ipcRenderer.on("download-done", (event, data) => {
    const item = downloads.find(d => d.id === data.id);
    if (item) {
      item.state = data.state;
      item.savePath = data.savePath;
      updateDownloadsUI();

      if (data.state === "completed") {
        showToast(`✅ Downloaded: ${data.fileName}`, "success", [
          {
            label: "Open File",
            action: () => ipcRenderer.send("open-path", data.savePath)
          },
          {
            label: "Folder",
            action: () => ipcRenderer.send("show-item-in-folder", data.savePath)
          }
        ]);
      } else {
        showToast(`❌ Download ${data.state}: ${data.fileName}`, "error");
      }
    }
  });
}

function updateDownloadsUI() {
  const list = document.getElementById("downloads-list");
  const badge = document.getElementById("download-badge");
  if (!list) return;

  const activeCount = downloads.filter(d => d.state === "progressing").length;
  if (badge) {
    if (activeCount > 0) {
      badge.style.display = "inline-flex";
      badge.innerText = activeCount;
    } else {
      badge.style.display = "none";
    }
  }

  if (downloads.length === 0) {
    list.innerHTML = `<div class="empty-downloads">No recent downloads</div>`;
    return;
  }

  list.innerHTML = downloads.map(item => {
    const pct = item.totalBytes > 0 ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0;
    const sizeStr = item.totalBytes > 0 
      ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
      : formatBytes(item.receivedBytes);

    let statusText = `${pct}% • ${sizeStr}`;
    if (item.state === "completed") statusText = `Completed • ${formatBytes(item.receivedBytes || item.totalBytes)}`;
    if (item.state === "interrupted" || item.state === "cancelled") statusText = `Cancelled`;

    const actionsHtml = item.state === "completed" && item.savePath ? `
      <div class="download-item-actions">
        <button class="download-action-btn" onclick="openDownloadedFile('${encodeURIComponent(item.savePath)}')">Open</button>
        <button class="download-action-btn" onclick="showDownloadedFolder('${encodeURIComponent(item.savePath)}')">Show in Folder</button>
      </div>
    ` : "";

    return `
      <div class="download-item">
        <div class="download-item-top">
          <span class="download-item-name" title="${escapeHTML(item.fileName)}">${escapeHTML(item.fileName)}</span>
          <span class="download-item-status">${item.state}</span>
        </div>
        ${item.state === "progressing" ? `
          <div class="download-progress-bar">
            <div class="download-progress-fill" style="width: ${pct}%"></div>
          </div>
        ` : ""}
        <div class="download-item-meta">${statusText}</div>
        ${actionsHtml}
      </div>
    `;
  }).join("");
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

function openDownloadedFile(encodedPath) {
  ipcRenderer.send("open-path", decodeURIComponent(encodedPath));
}

function showDownloadedFolder(encodedPath) {
  ipcRenderer.send("show-item-in-folder", decodeURIComponent(encodedPath));
}

function clearDownloadsHistory() {
  downloads = downloads.filter(d => d.state === "progressing");
  updateDownloadsUI();
}

function openDownloadsFolder() {
  ipcRenderer.send("open-downloads-folder");
}

// ══════════════════════════════════════════════════════════════════
// 🍞 TOAST NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════════════
function showToast(message, type = "info", actions = []) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const textSpan = document.createElement("span");
  textSpan.className = "toast-text";
  textSpan.innerHTML = message;
  toast.appendChild(textSpan);

  if (actions && actions.length > 0) {
    const actionWrap = document.createElement("div");
    actionWrap.className = "toast-actions";
    actions.forEach(act => {
      const btn = document.createElement("button");
      btn.className = "toast-btn";
      btn.innerText = act.label;
      btn.onclick = () => {
        act.action();
        toast.remove();
      };
      actionWrap.appendChild(btn);
    });
    toast.appendChild(actionWrap);
  }

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-fade-out");
    setTimeout(() => toast.remove(), 250);
  }, 4500);
}

// ══════════════════════════════════════════════════════════════════
// 🗂️ MULTI-TAB MANAGEMENT (EDGE-STYLE VERTICAL TABS)
// ══════════════════════════════════════════════════════════════════
function createTab(startURL = getHomepagePath()) {
  tabCount++;
  const tabId = "tab-" + tabCount;

  // Vertical Tab Row
  const tabBtn = document.createElement("div");
  tabBtn.className = "vertical-tab";
  tabBtn.id = "btn-" + tabId;
  tabBtn.title = "New tab";
  tabBtn.onclick = () => switchTab(tabId);

  // Tab Icon
  const iconSpan = document.createElement("span");
  iconSpan.className = "vtab-icon";
  iconSpan.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;

  // Tab Title
  const title = document.createElement("span");
  title.className = "vtab-title";
  title.innerText = "New tab";

  // Tab Close
  const closeBtn = document.createElement("span");
  closeBtn.className = "vtab-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close tab (Ctrl+W)";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  tabBtn.appendChild(iconSpan);
  tabBtn.appendChild(title);
  tabBtn.appendChild(closeBtn);
  tabsBar.appendChild(tabBtn);

  // Tab Webview
  const webview = document.createElement("webview");
  webview.id = tabId;
  webview.className = "tab-webview";
  webview.setAttribute("partition", "persist:main"); // ✅ Share persistent session for downloads & cookies
  webview.setAttribute("allowpopups", "true"); // ✅ Allow popup download dialogs
  webview.setAttribute("nodeintegration", "true");

  const initialUrl = (startURL.startsWith("http://") || startURL.startsWith("https://") || startURL.startsWith("file://"))
    ? startURL
    : `file://${path.join(__dirname, startURL)}`;

  webview.src = initialUrl;

  // Title update
  webview.addEventListener("page-title-updated", (e) => {
    const pageTitle = e.title || "Untitled";
    title.innerText = pageTitle;
    tabBtn.title = pageTitle;
  });

  // Favicon update
  webview.addEventListener("page-favicon-updated", (e) => {
    if (e.favicons && e.favicons.length > 0) {
      iconSpan.innerHTML = `<img src="${e.favicons[0]}" class="vtab-fav-img" onerror="this.remove()" />`;
    }
  });

  // Navigation sync with URL bar & History
  const onNavigate = (e) => {
    if (activeTabId === tabId) {
      const isLocal = e.url.startsWith("file://");
      urlInput.value = isLocal ? "" : e.url;
      if (!isLocal) {
        saveHistory(e.url);
      }
    }
  };

  webview.addEventListener("did-navigate", onNavigate);
  webview.addEventListener("did-navigate-in-page", onNavigate);

  // Sync wallpaper directly from homepage webview to top navbar & theme!
  webview.addEventListener("dom-ready", async () => {
    try {
      const url = await webview.executeJavaScript("localStorage.getItem('wallpaper_url')");
      if (url) {
        applyWallpaperTheme(url);
        ipcRenderer.invoke("save-wallpaper-config", { url, fit: "smart", dim: "50" });
      }
    } catch(e) {}
  });

  webview.addEventListener("console-message", (e) => {
    if (e.message === "MRSKY_OPEN_CUSTOMIZE") {
      toggleCustomizeSidebar(true);
      return;
    }
    if (e.message && e.message.startsWith("MRSKY_WALLPAPER:")) {
      const val = e.message.slice("MRSKY_WALLPAPER:".length).trim();
      if (val === "CLEAR") {
        applyWallpaperTheme(null);
        ipcRenderer.invoke("clear-wallpaper-config");
      } else if (val) {
        applyWallpaperTheme(val);
        ipcRenderer.invoke("save-wallpaper-config", { url: val, fit: "smart", dim: "50" });
      }
    }
  });

  // Loading animation indicator
  webview.addEventListener("did-start-loading", () => {
    if (activeTabId === tabId && reloadBtn) {
      reloadBtn.classList.add("is-loading");
      reloadBtn.title = "Stop";
    }
  });

  webview.addEventListener("did-stop-loading", () => {
    if (activeTabId === tabId && reloadBtn) {
      reloadBtn.classList.remove("is-loading");
      reloadBtn.title = "Reload";
    }
  });

  // Open links with target="_blank" in a new tab
  webview.addEventListener("new-window", (e) => {
    createTab(e.url);
  });

  webviewsContainer.appendChild(webview);
  switchTab(tabId);
}

function switchTab(tabId) {
  document.querySelectorAll("#webviews webview").forEach((wv) => {
    wv.classList.remove("active-view");
  });
  document.querySelectorAll(".vertical-tab").forEach((btn) => {
    btn.classList.remove("active");
  });

  const activeWebview = document.getElementById(tabId);
  const activeBtn = document.getElementById("btn-" + tabId);
  if (!activeWebview) return;

  activeWebview.classList.add("active-view");
  activeTabId = tabId;
  if (activeBtn) activeBtn.classList.add("active");

  try {
    const curUrl = (typeof activeWebview.getURL === "function") ? activeWebview.getURL() : activeWebview.src;
    urlInput.value = (curUrl && !curUrl.startsWith("file://")) ? curUrl : "";
  } catch {
    urlInput.value = "";
  }

  if (reloadBtn && typeof activeWebview.isLoading === "function") {
    if (activeWebview.isLoading()) {
      reloadBtn.classList.add("is-loading");
    } else {
      reloadBtn.classList.remove("is-loading");
    }
  }
}

function toggleVerticalTabsCollapse() {
  const sidebar = document.getElementById("verticalTabsSidebar");
  if (!sidebar) return;
  sidebar.classList.toggle("collapsed");
  localStorage.setItem("vertical_tabs_collapsed", sidebar.classList.contains("collapsed") ? "true" : "false");
}

function closeTab(tabId) {
  const tabBtn = document.getElementById("btn-" + tabId);
  const webview = document.getElementById(tabId);
  if (!tabBtn || !webview) return;

  const wasActive = activeTabId === tabId;
  tabBtn.remove();
  webview.remove();

  if (wasActive) {
    const remaining = document.querySelector("#webviews webview");
    if (remaining) {
      switchTab(remaining.id);
    } else {
      createTab();
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// 🛡️ BUILT-IN ADBLOCKER INTEGRATION
// ══════════════════════════════════════════════════════════════════
function toggleAdBlocker() {
  isAdBlockerActive = !isAdBlockerActive;
  ipcRenderer.send("toggle-adblocker", isAdBlockerActive);

  const btn = document.getElementById("adblock-toggle");
  if (isAdBlockerActive) {
    btn.classList.remove("disabled");
    btn.classList.add("active");
    btn.title = `AdBlocker Active (${totalBlockedAds} ads blocked)`;
  } else {
    btn.classList.remove("active");
    btn.classList.add("disabled");
    btn.title = "AdBlocker Paused: Click to enable";
  }
}

ipcRenderer.on("ad-blocked-update", (event, data) => {
  totalBlockedAds = data.count;
  const countBadge = document.getElementById("adblock-count");
  if (countBadge) {
    countBadge.innerText = totalBlockedAds > 999 ? "999+" : totalBlockedAds;
  }
});

// ══════════════════════════════════════════════════════════════════
// 🕘 HISTORY
// ══════════════════════════════════════════════════════════════════
function saveHistory(url) {
  if (!url || url.startsWith("file://")) return;
  let history = JSON.parse(localStorage.getItem("history")) || [];
  if (history.length && history[0].url === url) return;

  history.unshift({
    url,
    time: new Date().toLocaleString()
  });

  if (history.length > 200) {
    history = history.slice(0, 200);
  }

  localStorage.setItem("history", JSON.stringify(history));
}

// ══════════════════════════════════════════════════════════════════
// 🎨 DYNAMIC WALLPAPER THEME SYNC
// ══════════════════════════════════════════════════════════════════
function setupWallpaperSync() {
  ipcRenderer.on("wallpaper-updated", (event, config) => {
    applyWallpaperTheme(config ? config.url : null);
  });

  // Initial load on launch
  ipcRenderer.invoke("get-wallpaper-config").then(config => {
    if (config && config.url) {
      applyWallpaperTheme(config.url);
    }
  }).catch(() => {});
}

function applyWallpaperTheme(imageUrl) {
  const ambient = document.getElementById("topWallpaperAmbient");
  if (!ambient) return;

  if (!imageUrl) {
    ambient.style.display = "none";
    ambient.style.backgroundImage = "none";
    document.documentElement.style.removeProperty("--theme-accent");
    document.documentElement.style.removeProperty("--theme-glow");
    document.documentElement.style.removeProperty("--theme-tint");
    return;
  }

  // 1. Format URL cleanly with forward slashes for CSS compatibility
  const cleanUrl = imageUrl.replace(/\\/g, "/");
  ambient.style.backgroundImage = `url("${cleanUrl}")`;
  ambient.style.display = "block";

  // 2. Extract top dominant color to sync UI accents (active tab line, focus ring, buttons)
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 40;
      const ctx = canvas.getContext("2d");
      // Sample the top 20% slice of the image (closest to the navbar)
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight * 0.22, 0, 0, 40, 40);
      const data = ctx.getImageData(0, 0, 40, 40).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i+1] + data[i+2] > 20) {
          r += data[i];
          g += data[i+1];
          b += data[i+2];
          count++;
        }
      }
      if (count === 0) count = 1;
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      // Boost luminance so accent highlights pop vibrantly
      const maxVal = Math.max(r, g, b);
      let accentR = r;
      let accentG = g;
      let accentB = b;
      if (maxVal < 140) {
        const factor = 175 / (maxVal || 1);
        accentR = Math.min(255, Math.round(r * factor));
        accentG = Math.min(255, Math.round(g * factor));
        accentB = Math.min(255, Math.round(b * factor));
      }

      document.documentElement.style.setProperty("--theme-accent", `rgb(${accentR}, ${accentG}, ${accentB})`);
      document.documentElement.style.setProperty("--theme-glow", `rgba(${accentR}, ${accentG}, ${accentB}, 0.35)`);
      document.documentElement.style.setProperty("--theme-tint", `rgba(${r}, ${g}, ${b}, 0.3)`);
    } catch (err) {
      console.warn("Theme accent extraction failed:", err);
    }
  };
  img.src = cleanUrl;
}

// ══════════════════════════════════════════════════════════════════
// 🎨 CHROME-STYLE CUSTOMIZE RIGHT SIDEBAR & THEME ENGINE
// ══════════════════════════════════════════════════════════════════
let isCustomizeOpen = false;
let currentSidebarFit = "smart";
let currentSidebarDim = 50;

function toggleCustomizeSidebar(forceState) {
  const sidebar = document.getElementById("customizeSidebar");
  if (!sidebar) return;
  isCustomizeOpen = typeof forceState === "boolean" ? forceState : !isCustomizeOpen;
  if (isCustomizeOpen) {
    sidebar.classList.add("open");
  } else {
    sidebar.classList.remove("open");
  }
}

function triggerWallpaperUpload() {
  document.getElementById("sidebarWallpaperInput")?.click();
}

function handleSidebarWallpaperFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  let fileUrl = "";
  if (file.path) {
    fileUrl = "file:///" + file.path.replace(/\\/g, "/");
  } else {
    fileUrl = URL.createObjectURL(file);
  }

  applyWallpaperTheme(fileUrl);
  ipcRenderer.invoke("save-wallpaper-config", {
    url: fileUrl,
    fit: currentSidebarFit,
    dim: currentSidebarDim.toString()
  });

  // Sync to all webviews so homepage updates in real time
  document.querySelectorAll("#webviews webview").forEach((wv) => {
    wv.executeJavaScript(`
      try {
        localStorage.setItem('wallpaper_url', '${fileUrl}');
        if (typeof renderWallpaper === 'function') renderWallpaper('${fileUrl}');
      } catch(e) {}
    `);
  });

  showToast("Wallpaper updated successfully", "success");
}

function setSidebarFitMode(mode) {
  currentSidebarFit = mode;
  document.querySelectorAll(".fit-pill").forEach(p => p.classList.remove("active"));
  document.getElementById("sidebar-fit-" + mode)?.classList.add("active");

  document.querySelectorAll("#webviews webview").forEach((wv) => {
    wv.executeJavaScript(`
      try {
        if (typeof setFitMode === 'function') setFitMode('${mode}');
      } catch(e) {}
    `);
  });

  ipcRenderer.invoke("get-wallpaper-config").then(cfg => {
    if (cfg && cfg.url) {
      cfg.fit = mode;
      ipcRenderer.invoke("save-wallpaper-config", cfg);
    }
  });
}

function handleSidebarDimChange(val) {
  currentSidebarDim = parseInt(val);
  const textEl = document.getElementById("sidebarDimText");
  if (textEl) textEl.innerText = `${val}%`;

  document.querySelectorAll("#webviews webview").forEach((wv) => {
    wv.executeJavaScript(`
      try {
        if (typeof updateDimness === 'function') updateDimness('${val}');
      } catch(e) {}
    `);
  });

  ipcRenderer.invoke("get-wallpaper-config").then(cfg => {
    if (cfg && cfg.url) {
      cfg.dim = val.toString();
      ipcRenderer.invoke("save-wallpaper-config", cfg);
    }
  });
}

// 16 Classic Chrome Two-Tone Color Swatches
const CHROME_PALETTES = [
  { name: "Default Blue",   color1: "#2563eb", color2: "#93c5fd" },
  { name: "Ocean Cyan",     color1: "#0284c7", color2: "#7dd3fc" },
  { name: "Teal Aqua",      color1: "#0d9488", color2: "#5eead4" },
  { name: "Emerald Green",  color1: "#059669", color2: "#6ee7b7" },
  { name: "Forest Green",   color1: "#16a34a", color2: "#86efac" },
  { name: "Sunny Gold",     color1: "#d97706", color2: "#fde047" },
  { name: "Amber Bronze",   color1: "#b45309", color2: "#fcd34d" },
  { name: "Sunset Orange",  color1: "#ea580c", color2: "#fdba74" },
  { name: "Crimson Red",    color1: "#dc2626", color2: "#fca5a5" },
  { name: "Rose Pink",      color1: "#db2777", color2: "#f9a8d4" },
  { name: "Fuchsia",        color1: "#c026d3", color2: "#f0abfc" },
  { name: "Purple Violet",  color1: "#7c3aed", color2: "#c4b5fd" },
  { name: "Deep Indigo",    color1: "#4f46e5", color2: "#a5b4fc" },
  { name: "Midnight",       color1: "#1e293b", color2: "#475569" },
  { name: "Slate Grey",     color1: "#475569", color2: "#94a3b8" },
  { name: "Cyberpunk Duo",  color1: "#ec4899", color2: "#8b5cf6" }
];

function initColorPalettes() {
  const grid = document.getElementById("colorPaletteGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const savedColor = localStorage.getItem("theme_custom_accent") || "#2563eb";

  CHROME_PALETTES.forEach((p) => {
    const circle = document.createElement("div");
    circle.className = "color-swatch-circle";
    circle.style.background = `linear-gradient(135deg, ${p.color1} 50%, ${p.color2} 50%)`;
    circle.title = p.name;
    if (p.color1.toLowerCase() === savedColor.toLowerCase()) {
      circle.classList.add("active");
    }

    circle.onclick = () => {
      document.querySelectorAll(".color-swatch-circle").forEach(c => c.classList.remove("active"));
      circle.classList.add("active");
      applyThemePalette(p.color1);
    };

    grid.appendChild(circle);
  });
}

function applyThemePalette(accentColor) {
  document.documentElement.style.setProperty("--theme-accent", accentColor);
  document.documentElement.style.setProperty("--theme-glow", `${accentColor}55`);
  document.documentElement.style.setProperty("--theme-tint", `${accentColor}28`);
  localStorage.setItem("theme_custom_accent", accentColor);
}

function setThemeMode(mode) {
  document.querySelectorAll(".mode-tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("theme-mode-" + mode)?.classList.add("active");
  localStorage.setItem("theme_mode_pref", mode);
}

function resetToDefaultTheme() {
  if (confirm("Reset theme and wallpaper to default?")) {
    ipcRenderer.invoke("clear-wallpaper-config");
    localStorage.removeItem("wallpaper_url");
    localStorage.removeItem("theme_custom_accent");
    applyWallpaperTheme(null);
    document.querySelectorAll("#webviews webview").forEach(wv => {
      wv.executeJavaScript(`
        try {
          if (typeof resetWallpaper === 'function') resetWallpaper();
        } catch(e) {}
      `);
    });
    toggleCustomizeSidebar(false);
    showToast("Theme reset to default", "info");
  }
}

// ══════════════════════════════════════════════════════════════════
// INITIAL SETUP & GLOBAL SHORTCUTS
// ══════════════════════════════════════════════════════════════════
window.addEventListener("DOMContentLoaded", () => {
  urlInput = document.getElementById("url");
  tabsBar = document.getElementById("tabs");
  webviewsContainer = document.getElementById("webviews");
  reloadBtn = document.getElementById("reload-btn");

  // Restore vertical tabs collapsed state
  if (localStorage.getItem("vertical_tabs_collapsed") === "true") {
    document.getElementById("verticalTabsSidebar")?.classList.add("collapsed");
  }

  // Restore custom accent color if saved
  const customAccent = localStorage.getItem("theme_custom_accent");
  if (customAccent) {
    applyThemePalette(customAccent);
  }

  // Initialize Chrome color swatches
  initColorPalettes();

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      go();
    }
  });

  urlInput.addEventListener("focus", () => {
    urlInput.select();
  });

  document.addEventListener("click", (e) => {
    const tray = document.getElementById("downloads-tray");
    const btn = document.getElementById("downloads-btn");
    if (isDownloadsTrayOpen && tray && !tray.contains(e.target) && !btn.contains(e.target)) {
      toggleDownloadsTray();
    }
  });

  setupDownloadsListener();
  setupWallpaperSync();

  window.addEventListener("keydown", (e) => {
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
      e.preventDefault();
      toggleDevTools();
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      takePageScreenshot();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "j") {
      e.preventDefault();
      toggleDownloadsTray();
    }
    if (e.key === "Escape") {
      if (isDownloadsTrayOpen) toggleDownloadsTray();
      if (isCustomizeOpen) toggleCustomizeSidebar(false);
    }
    if (e.ctrlKey && e.key.toLowerCase() === "t") {
      e.preventDefault();
      createTab();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }
    if ((e.ctrlKey && e.key.toLowerCase() === "r") || e.key === "F5") {
      e.preventDefault();
      reload();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      showHistory();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      urlInput.focus();
    }
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      forward();
    }
  });

  createTab();
});
