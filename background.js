// TabNest Background Service Worker
// Manages manual snapshots, crash recovery, session tab tracking, and restore state

const MAX_HISTORY_ENTRIES = 50;

// ── Init ──────────────────────────────────────────────────────────────────────
async function applySidePanelBehavior() {
  try {
    const { defaultActionTarget = 'popup' } = await chrome.storage.local.get('defaultActionTarget');
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({
        openPanelOnActionClick: defaultActionTarget === 'sidepanel',
      });
    }
  } catch (err) {
    console.debug('[TabNest] Could not set panel behavior:', err.message);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[TabNest] Extension installed/updated');
  await chrome.alarms.clearAll();
  await applySidePanelBehavior();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[TabNest] Browser started');
  await chrome.alarms.clearAll();
  await applySidePanelBehavior();
});

// ── Tab event listeners ───────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  cleanUpSessionOpenTabs(tabId);
});

async function cleanUpSessionOpenTabs(closedTabId) {
  try {
    const { sessionOpenTabs = {} } = await chrome.storage.local.get('sessionOpenTabs');
    let changed = false;
    for (const sid of Object.keys(sessionOpenTabs)) {
      const prevLen = sessionOpenTabs[sid].length;
      sessionOpenTabs[sid] = sessionOpenTabs[sid].filter((item) => {
        const id = typeof item === 'number' ? item : item.tabId;
        return id !== closedTabId;
      });
      if (sessionOpenTabs[sid].length !== prevLen) changed = true;
    }
    if (changed) {
      await chrome.storage.local.set({ sessionOpenTabs });
    }
  } catch (e) {}
}

// ── Core snapshot logic (Manual only) ─────────────────────────────────────────
async function takeSnapshot(trigger = 'manual') {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const snapshot = {
      id: `snap_${Date.now()}`,
      timestamp: Date.now(),
      trigger,
      windowCount: windows.length,
      tabCount: windows.reduce((acc, w) => acc + (w.tabs?.length || 0), 0),
      windows: windows.map((w) => ({
        id: w.id,
        focused: w.focused,
        tabs: (w.tabs || []).map((t) => ({
          id: t.id,
          url: t.url,
          title: t.title,
          favIconUrl: t.favIconUrl,
          pinned: t.pinned,
          active: t.active,
        })),
      })),
    };

    const { tabHistory = [] } = await chrome.storage.local.get('tabHistory');
    tabHistory.unshift(snapshot);
    if (tabHistory.length > MAX_HISTORY_ENTRIES) {
      tabHistory.splice(MAX_HISTORY_ENTRIES);
    }

    await chrome.storage.local.set({ tabHistory, lastSnapshot: snapshot });
    console.log(`[TabNest] Snapshot taken (${trigger}): ${snapshot.tabCount} tabs across ${snapshot.windowCount} windows`);
  } catch (err) {
    console.error('[TabNest] Snapshot failed:', err);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'TAKE_SNAPSHOT') {
    takeSnapshot('manual').then(() => sendResponse({ success: true }));
    return true;
  }
  if (msg.type === 'GET_CURRENT_TABS') {
    chrome.windows.getAll({ populate: true }).then((windows) => {
      sendResponse({ windows });
    });
    return true;
  }
  if (msg.type === 'OPEN_SIDEPANEL') {
    const windowId = msg.windowId;
    if (chrome.sidePanel?.open) {
      chrome.sidePanel.open({ windowId })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    sendResponse({ success: false, error: 'sidePanel API not available' });
    return true;
  }
  if (msg.type === 'SET_SIDEPANEL_BEHAVIOR') {
    if (chrome.sidePanel?.setPanelBehavior) {
      chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: !!msg.openPanelOnActionClick })
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }
    sendResponse({ success: false, error: 'sidePanel API not available' });
    return true;
  }
});

// ── State restoration ─────────────────────────────────────────────────────────
// When a tab finishes loading, check if it has pending restore state and inject
// the restore script to seek the video / scroll to the saved position.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  try {
    const rawKey = tab.url.split('#')[0];
    const normKey = rawKey.replace(/\/+$/, '');
    const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
    if (!tabNestRestores[rawKey] && !tabNestRestores[normKey] && !tabNestRestores[tab.url]) return;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/restore.js'],
    });
  } catch (err) {
    // Tab may have been closed or is a restricted page (chrome://, etc.)
    console.debug('[TabNest] Restore inject skipped:', err.message);
  }
});
