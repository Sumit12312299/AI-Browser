const { ipcRenderer } = require("electron");
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

// Listen for blocked ads from main process
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

        // Strip non-content tags
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00ffcc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
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

// 🪄 Summarize Page Action
async function copilotSummarize() {
  if (!isCopilotOpen) toggleCopilot();
  appendCopilotMessage("user", "Summarize this page");

  appendCopilotMessage("ai", `<em>Reading page content...</em>`);
  const { title, text } = await extractActivePageContent();

  const messages = document.querySelectorAll(".copilot-messages .message.ai-message");
  const lastMsg = messages[messages.length - 1]?.querySelector(".msg-content");

  if (!text || text.length < 50) {
    if (lastMsg) lastMsg.innerHTML = "This page doesn't have enough readable text to summarize (or it's a local homepage). Navigate to an article or website to try!";
    return;
  }

  // Extract key sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const cleanSentences = sentences
    .map(s => s.trim())
    .filter(s => s.length > 35 && s.length < 220)
    .slice(0, 5);

  const summaryBullets = cleanSentences.map(s => `<li>${escapeHTML(s)}</li>`).join("");

  if (lastMsg) {
    lastMsg.innerHTML = `
      <strong>📄 Summary for "${escapeHTML(title || 'Current Page')}":</strong>
      <ul>${summaryBullets || '<li>' + escapeHTML(text.slice(0, 250)) + '...</li>'}</ul>
    `;
  }
}

// 💡 Key Takeaways Action
async function copilotKeyTakeaways() {
  if (!isCopilotOpen) toggleCopilot();
  appendCopilotMessage("user", "What are the key takeaways?");

  appendCopilotMessage("ai", `<em>Extracting key highlights...</em>`);
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
      <strong>💡 Key Takeaways:</strong>
      <ul>${bullets}</ul>
    `;
  }
}

// 🧠 Explain Simple Action
async function copilotExplainSimple() {
  if (!isCopilotOpen) toggleCopilot();
  appendCopilotMessage("user", "Explain this in simple words");

  appendCopilotMessage("ai", `<em>Analyzing page context...</em>`);
  const { title, text } = await extractActivePageContent();

  const messages = document.querySelectorAll(".copilot-messages .message.ai-message");
  const lastMsg = messages[messages.length - 1]?.querySelector(".msg-content");

  if (!text || text.length < 40) {
    if (lastMsg) lastMsg.innerHTML = "Please open a website or document first so I can explain it in simple words!";
    return;
  }

  const snippet = text.slice(0, 400);

  if (lastMsg) {
    lastMsg.innerHTML = `
      <strong>🧠 In Simple Terms:</strong><br>
      This page is about <strong>${escapeHTML(title || "this topic")}</strong>.<br><br>
      In short, it explains:<br>
      <em>"${escapeHTML(snippet)}..."</em><br><br>
      👉 Feel free to ask me any specific question about any section!
    `;
  }
}

// Handle Custom User Chat Prompt
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

  // Check if user has configured an API key in localStorage
  const apiKey = localStorage.getItem("copilot_gemini_key");

  if (apiKey) {
    // Optional live cloud LLM call via Gemini API
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

  // Smart local contextual answer engine
  setTimeout(() => {
    let answer = "";
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes("who") || lowerQuery.includes("what is") || lowerQuery.includes("meaning")) {
      const match = text.split('.').find(s => lowerQuery.split(' ').some(w => w.length > 3 && s.toLowerCase().includes(w)));
      answer = match ? `Based on the page: "${match.trim()}."` : `Based on the current page (${title}), it discusses topics related to your query.`;
    } else if (text.length > 0) {
      const relevant = text.split('.').filter(s => lowerQuery.split(' ').some(w => w.length > 3 && s.toLowerCase().includes(w))).slice(0, 2);
      if (relevant.length > 0) {
        answer = `Here is what I found on this page:<br><ul>${relevant.map(r => `<li>${escapeHTML(r.trim())}.</li>`).join('')}</ul>`;
      } else {
        answer = `I analyzed the page for <em>"${escapeHTML(query)}"</em>. The page primarily focuses on <strong>${escapeHTML(title)}</strong>. Ask me to summarize or explain specific sections!`;
      }
    } else {
      answer = `You are currently on the local start page. Open any website and ask me to analyze it!`;
    }

    if (lastMsg) lastMsg.innerHTML = answer;
  }, 400);
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

  // Copilot input enter key
  document.getElementById("copilot-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleCopilotSend();
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener("keydown", (e) => {
    // Ctrl + Space : Toggle AI Copilot
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      toggleCopilot();
    }
    // Escape : Close Copilot if open
    if (e.key === "Escape" && isCopilotOpen) {
      e.preventDefault();
      toggleCopilot();
    }
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
