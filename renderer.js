let webview;
let urlInput;

window.onload = () => {
  webview = document.getElementById('webview');
  urlInput = document.getElementById('url');

  console.log("Webview loaded:", webview);
};

// 🔍 GO
function go() {
  let url = urlInput.value.trim();
  if (!url) return;

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
  }

  webview.loadURL(url);
  saveHistory(url);

}

// ⬅
function back() {
  if (webview.canGoBack()) webview.goBack();
}

// ➡
function forward() {
  if (webview.canGoForward()) webview.goForward();
}

// 🔄
function reload() {
  webview.reload();
}

// 🏠 HOME — THIS MUST WORK
function home() {
  console.log("Home clicked");
  webview.loadURL('homepage.html');
}

  window.onload = () => {
    webview = document.getElementById('webview');
    urlInput = document.getElementById('url');
  
    // 🔥 AUTO-SAVE HISTORY (THIS IS THE KEY)
    webview.addEventListener('did-navigate', (e) => {
      saveHistory(e.url);
      urlInput.value = e.url; // optional: sync address bar
    });
  
    webview.addEventListener('did-navigate-in-page', (e) => {
      saveHistory(e.url);
      urlInput.value = e.url;
    });
  };
  function saveHistory(url) {
    if (!url || url.startsWith('file://')) return;
  
    let history = JSON.parse(localStorage.getItem('history')) || [];
  
    // prevent duplicates
    if (history.length && history[0].url === url) return;
  
    history.unshift({
      url,
      time: new Date().toLocaleString()
    });
  
    localStorage.setItem('history', JSON.stringify(history));
  }
  
  function showHistory() {
    webview.loadFile('history.html');
  }//
 
  


  let tabCount = 0;
  let activeTabId = null;
  
  const tabsBar = document.getElementById("tabs");
  const webviews = document.getElementById("webviews");
  


  function createTab(startURL = "homepage.html") {
    tabCount++;
    const tabId = "tab-" + tabCount;
  
    // ---- TAB BUTTON ----
    const tabBtn = document.createElement("div");
    tabBtn.className = "tab";
    tabBtn.id = "btn-" + tabId;
  
    const title = document.createElement("span");
    title.innerText = "Tab " + tabCount;
    title.onclick = () => switchTab(tabId);
  
    const closeBtn = document.createElement("span");
    closeBtn.innerText = " ❌";
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeTab(tabId);
    };
  
    tabBtn.appendChild(title);
    tabBtn.appendChild(closeBtn);
    tabsBar.appendChild(tabBtn);
  
    // ---- WEBVIEW ----
    const webview = document.createElement("webview");
    webview.id = tabId;
    webview.style.display = "none";
    webview.style.width = "100%";
    webview.style.height = "100%";
  
    webview.src = startURL.startsWith("http")
      ? startURL
      : `file://${__dirname}/${startURL}`;
  
    // URL bar + history sync
    webview.addEventListener("did-navigate", (e) => {
      if (activeTabId === tabId) {
        urlInput.value = e.url;
        saveHistory(e.url);
      }
    });
  
    webview.addEventListener("did-navigate-in-page", (e) => {
      if (activeTabId === tabId) {
        urlInput.value = e.url;
        saveHistory(e.url);
      }
    });
  
    webviews.appendChild(webview);
  
    console.log("Webview created:", webview); // ✅ DEBUG LINE
  
    switchTab(tabId);
  }
  
  function switchTab(tabId) {
    document.querySelectorAll("webview").forEach(wv => {
      wv.style.display = "none";
    });
  
    const activeWebview = document.getElementById(tabId);
    if (!activeWebview) return;
  
    activeWebview.style.display = "block";
    activeTabId = tabId;
    urlInput.value = activeWebview.getURL() || "";
  }
  
  function closeTab(tabId) {
    const tabBtn = document.getElementById("btn-" + tabId);
    const webview = document.getElementById(tabId);
  
    if (!tabBtn || !webview) return;
  
    const wasActive = activeTabId === tabId;
  
    tabBtn.remove();
    webview.remove();
  
    if (wasActive) {
      const remaining = document.querySelector("webview");
      if (remaining) {
        switchTab(remaining.id);
      } else {
        activeTabId = null;
        urlInput.value = "";
      }
    }
  }
  window.addEventListener("DOMContentLoaded", () => {
    createTab("homepage.html"); // default first tab
  });