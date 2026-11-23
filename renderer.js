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

// AI Copilot State
let isCopilotOpen = false;

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
// 🗂️ MULTI-TAB MANAGEMENT
// ══════════════════════════════════════════════════════════════════
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
  webview.setAttribute("partition", "persist:main"); // ✅ Share persistent session for downloads & cookies
  webview.setAttribute("allowpopups", "true"); // ✅ Allow popup download dialogs

  const initialUrl = (startURL.startsWith("http://") || startURL.startsWith("https://") || startURL.startsWith("file://"))
    ? startURL
    : `file://${path.join(__dirname, startURL)}`;

  webview.src = initialUrl;

  // Title update
  webview.addEventListener("page-title-updated", (e) => {
    const pageTitle = e.title || "Untitled";
    title.innerText = pageTitle.length > 18 ? pageTitle.slice(0, 18) + "..." : pageTitle;
    title.title = pageTitle;

    if (activeTabId === tabId) {
      updateCopilotContext(pageTitle, webview.getURL ? webview.getURL() : "");
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
      updateCopilotContext(title.innerText, e.url);
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
    updateCopilotContext(activeBtn.querySelector(".tab-title")?.innerText || "Page", curUrl);
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
// 🤖 AI COPILOT SIDEBAR
// ══════════════════════════════════════════════════════════════════
function toggleCopilot() {
  isCopilotOpen = !isCopilotOpen;
  const sidebar = document.getElementById("ai-sidebar");
  const toggleBtn = document.getElementById("copilot-toggle-btn");

  if (isCopilotOpen) {
    sidebar.classList.add("open");
    toggleBtn.classList.add("active");
    setTimeout(() => document.getElementById("copilot-input")?.focus(), 250);
  } else {
    sidebar.classList.remove("open");
    toggleBtn.classList.remove("active");
  }
}

function updateCopilotContext(title, url) {
  const contextEl = document.getElementById("copilot-context-title");
  if (!contextEl) return;
  const displayTitle = (title && title !== "Untitled") ? title : (url ? new URL(url).hostname : "Homepage");
  contextEl.innerText = displayTitle;
  contextEl.title = `${displayTitle} (${url})`;
}

async function extractActivePageContent() {
  const wv = getActiveWebview();
  if (!wv) return { title: "", text: "" };

  try {
    const data = await wv.executeJavaScript(`
      (() => {
        const title = document.title || "";
        const clone = document.body ? document.body.cloneNode(true) : null;
        if (!clone) return { title, text: "" };

        const removeSelectors = ['script', 'style', 'nav', 'footer', 'noscript', 'svg', 'iframe', '.ad', '[class*="ad-"]'];
        removeSelectors.forEach(sel => clone.querySelectorAll(sel).forEach(el => el.remove()));

        const text = clone.innerText ? clone.innerText.replace(/\\s+/g, ' ').trim().slice(0, 8000) : "";
        return { title, text };
      })()
    `);
    return data;
  } catch (err) {
    return { title: "", text: "" };
  }
}

function appendCopilotMessage(sender, htmlContent) {
  const container = document.getElementById("copilot-messages");
  if (!container) return;

  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${sender}-message`;

  if (sender === "ai") {
    msgDiv.innerHTML = `
      <div class="msg-avatar">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      </div>
      <div class="msg-content">${htmlContent}</div>
    `;
  } else {
    msgDiv.innerHTML = `
      <div class="msg-content">${escapeHTML(htmlContent)}</div>
    `;
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

async function copilotSummarize() {
  if (!isCopilotOpen) toggleCopilot();
  appendCopilotMessage("user", "Summarize this page");

  appendCopilotMessage("ai", `<em>Reading page content...</em>`);
  const { title, text } = await extractActivePageContent();

  const messages = document.querySelectorAll(".copilot-messages .message.ai-message");
  const lastMsg = messages[messages.length - 1]?.querySelector(".msg-content");

  if (!text || text.length < 50) {
    if (lastMsg) lastMsg.innerHTML = "This page doesn't have enough readable text to summarize (or it's a local homepage). Open a webpage or article to test!";
    return;
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const cleanSentences = sentences
    .map(s => s.trim())
    .filter(s => s.length > 35 && s.length < 220)
    .slice(0, 5);

  const summaryBullets = cleanSentences.map(s => `<li>${escapeHTML(s)}</li>`).join("");

  if (lastMsg) {
    lastMsg.innerHTML = `
      <strong>Summary for "${escapeHTML(title || 'Current Page')}":</strong>
      <ul>${summaryBullets || '<li>' + escapeHTML(text.slice(0, 250)) + '...</li>'}</ul>
    `;
  }
}

async function copilotKeyTakeaways() {
  if (!isCopilotOpen) toggleCopilot();
  appendCopilotMessage("user", "What are the key takeaways?");

  appendCopilotMessage("ai", `<em>Extracting highlights...</em>`);
  const { title, text } = await extractActivePageContent();

  const messages = document.querySelectorAll(".copilot-messages .message.ai-message");
  const lastMsg = messages[messages.length - 1]?.querySelector(".msg-content");

  if (!text || text.length < 50) {
    if (lastMsg) lastMsg.innerHTML = "Cannot extract key takeaways from this view. Open an article or documentation page first!";
    return;
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const takeaways = sentences
    .map(s => s.trim())
    .filter(s => s.length > 40 && /(is|are|provides|allows|designed|key|important|feature|help)/i.test(s))
    .slice(0, 4);

  const bullets = takeaways.length > 0 
    ? takeaways.map(t => `<li><strong>Highlight:</strong> ${escapeHTML(t)}</li>`).join("")
    : `<li>${escapeHTML(text.slice(0, 200))}...</li>`;

  if (lastMsg) {
    lastMsg.innerHTML = `
      <strong>Key Takeaways:</strong>
      <ul>${bullets}</ul>
    `;
  }
}

async function copilotExplainSimple() {
  if (!isCopilotOpen) toggleCopilot();
  appendCopilotMessage("user", "Explain this in simple words");

  appendCopilotMessage("ai", `<em>Analyzing context...</em>`);
  const { title, text } = await extractActivePageContent();

  const messages = document.querySelectorAll(".copilot-messages .message.ai-message");
  const lastMsg = messages[messages.length - 1]?.querySelector(".msg-content");

  if (!text || text.length < 40) {
    if (lastMsg) lastMsg.innerHTML = "Please open a website or document first so I can explain it!";
    return;
  }

  const snippet = text.slice(0, 400);

  if (lastMsg) {
    lastMsg.innerHTML = `
      <strong>In Simple Terms:</strong><br>
      This page discusses <strong>${escapeHTML(title || "this topic")}</strong>.<br><br>
      Key context:<br>
      <em>"${escapeHTML(snippet)}..."</em><br><br>
      Ask any specific question below!
    `;
  }
}

async function handleCopilotSend() {
  const input = document.getElementById("copilot-input");
  if (!input) return;

  const query = input.value.trim();
  if (!query) return;

  input.value = "";
  appendCopilotMessage("user", query);

  appendCopilotMessage("ai", `<em>Thinking...</em>`);
  const { title, text } = await extractActivePageContent();

  const messages = document.querySelectorAll(".copilot-messages .message.ai-message");
  const lastMsg = messages[messages.length - 1]?.querySelector(".msg-content");

  const apiKey = localStorage.getItem("copilot_gemini_key");

  if (apiKey) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are MR.SKY Browser Copilot. The user is currently reading the webpage "${title}".\nWebpage text:\n${text.slice(0, 6000)}\n\nUser Question: ${query}\nProvide a direct, helpful, concise answer.`
            }]
          }]
        })
      });
      const data = await response.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply && lastMsg) {
        lastMsg.innerHTML = reply.replace(/\n/g, '<br>');
        return;
      }
    } catch (e) {
      console.warn("API call failed, falling back to local reasoning", e);
    }
  }

  setTimeout(() => {
    let answer = "";
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes("who") || lowerQuery.includes("what is") || lowerQuery.includes("meaning")) {
      const match = text.split('.').find(s => lowerQuery.split(' ').some(w => w.length > 3 && s.toLowerCase().includes(w)));
      answer = match ? `Based on the page: "${match.trim()}."` : `Based on "${title}", it covers subjects relevant to your query.`;
    } else if (text.length > 0) {
      const relevant = text.split('.').filter(s => lowerQuery.split(' ').some(w => w.length > 3 && s.toLowerCase().includes(w))).slice(0, 2);
      if (relevant.length > 0) {
        answer = `From the page content:<br><ul>${relevant.map(r => `<li>${escapeHTML(r.trim())}.</li>`).join('')}</ul>`;
      } else {
        answer = `I analyzed the page for <em>"${escapeHTML(query)}"</em>. The page primarily focuses on <strong>${escapeHTML(title)}</strong>. Ask to summarize or extract key points!`;
      }
    } else {
      answer = `You are currently on the local start page. Navigate to any website and ask me to analyze it!`;
    }

    if (lastMsg) lastMsg.innerHTML = answer;
  }, 350);
}

function openCopilotSettings() {
  const currentKey = localStorage.getItem("copilot_gemini_key") || "";
  const newKey = prompt("Optional: Enter your free Google Gemini API Key for deep cloud reasoning (Leave empty to use built-in local engine):", currentKey);
  if (newKey !== null) {
    if (newKey.trim()) {
      localStorage.setItem("copilot_gemini_key", newKey.trim());
      alert("✅ Gemini API Key saved! Copilot will now use full cloud LLM intelligence.");
    } else {
      localStorage.removeItem("copilot_gemini_key");
      alert("Switched back to built-in local intelligence engine.");
    }
  }
}

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

  // 1. Set ambient blurred background behind the top header
  ambient.style.backgroundImage = `url("${imageUrl}")`;
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
        // Skip completely black pixels if any
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
  img.src = imageUrl;
}

// ══════════════════════════════════════════════════════════════════
// INITIAL SETUP & GLOBAL SHORTCUTS
// ══════════════════════════════════════════════════════════════════
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

  document.getElementById("copilot-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleCopilotSend();
    }
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
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      toggleCopilot();
    }
    if (e.key === "Escape") {
      if (isCopilotOpen) toggleCopilot();
      if (isDownloadsTrayOpen) toggleDownloadsTray();
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
