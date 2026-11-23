const path = require("path");

let tabCount = 0;
let activeTabId = null;
let urlInput;
let tabsBar;
let webviewsContainer;
let reloadBtn;

function getActiveWebview() {
  return activeTabId ? document.getElementById(activeTabId) : null;
}

function getHomepagePath() {
  return `file://${path.join(__dirname, "homepage.html")}`;
}

function getHistoryPath() {
  return `file://${path.join(__dirname, "history.html")}`;
}

// 🔍 Navigation Controls
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

// 🗂️ Multi-Tab Management
function createTab(startURL = getHomepagePath()) {
  tabCount++;
  const tabId = "tab-" + tabCount;

  // Tab Header Button
  const tabBtn = document.createElement("div");
  tabBtn.className = "tab";
  tabBtn.id = "btn-" + tabId;

  const title = document.createElement("span");
  title.className = "tab-title";
  title.innerText = "New Tab";
  title.onclick = () => switchTab(tabId);

  const closeBtn = document.createElement("span");
  closeBtn.className = "tab-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close Tab (Ctrl+W)";
  closeBtn.onclick = (e) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  tabBtn.appendChild(title);
  tabBtn.appendChild(closeBtn);
  tabsBar.appendChild(tabBtn);

  // Tab Webview
  const webview = document.createElement("webview");
  webview.id = tabId;
  webview.className = "tab-webview";

  const initialUrl = (startURL.startsWith("http://") || startURL.startsWith("https://") || startURL.startsWith("file://"))
    ? startURL
    : `file://${path.join(__dirname, startURL)}`;

  webview.src = initialUrl;

  // Title update
  webview.addEventListener("page-title-updated", (e) => {
    const pageTitle = e.title || "Untitled";
    title.innerText = pageTitle.length > 18 ? pageTitle.slice(0, 18) + "..." : pageTitle;
    title.title = pageTitle;
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
  document.querySelectorAll(".tab").forEach((btn) => {
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
      createTab(); // Always keep at least one tab open
    }
  }
}

// 🕘 History
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

// Initial Setup & Keyboard Shortcuts
window.addEventListener("DOMContentLoaded", () => {
  urlInput = document.getElementById("url");
  tabsBar = document.getElementById("tabs");
  webviewsContainer = document.getElementById("webviews");
  reloadBtn = document.getElementById("reload-btn");

  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      go();
    }
  });

  urlInput.addEventListener("focus", () => {
    urlInput.select();
  });

  // Global Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    // Ctrl + T : New Tab
    if (e.ctrlKey && e.key.toLowerCase() === "t") {
      e.preventDefault();
      createTab();
    }
    // Ctrl + W : Close Tab
    if (e.ctrlKey && e.key.toLowerCase() === "w") {
      e.preventDefault();
      if (activeTabId) closeTab(activeTabId);
    }
    // Ctrl + R or F5 : Reload
    if ((e.ctrlKey && e.key.toLowerCase() === "r") || e.key === "F5") {
      e.preventDefault();
      reload();
    }
    // Ctrl + H : History
    if (e.ctrlKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      showHistory();
    }
    // Ctrl + L : Focus Address Bar
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
      e.preventDefault();
      urlInput.focus();
    }
    // Alt + Left : Back
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      back();
    }
    // Alt + Right : Forward
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      forward();
    }
  });

  createTab();
});
