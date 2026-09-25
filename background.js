// TabNest Background Service Worker
// Handles auto-snapshots, crash recovery, and alarm-based periodic saves

const SNAPSHOT_ALARM = 'tabnest-snapshot';
const SNAPSHOT_INTERVAL_MINUTES = 5;
const MAX_HISTORY_ENTRIES = 50;

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[TabNest] Extension installed/updated');
  await setupAlarms();
  await takeSnapshot('install');
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[TabNest] Browser started');
  await setupAlarms();
  await takeSnapshot('startup');
});

async function setupAlarms() {
  await chrome.alarms.clear(SNAPSHOT_ALARM);
  chrome.alarms.create(SNAPSHOT_ALARM, {
    periodInMinutes: SNAPSHOT_INTERVAL_MINUTES,
  });
}

// ── Alarm handler ─────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SNAPSHOT_ALARM) {
    await takeSnapshot('auto');
  }
});

// ── Tab / window event listeners ──────────────────────────────────────────────
chrome.tabs.onRemoved.addListener(() => scheduleSnapshot());
chrome.windows.onRemoved.addListener(() => scheduleSnapshot());

let snapshotTimeout = null;
function scheduleSnapshot() {
  if (snapshotTimeout) clearTimeout(snapshotTimeout);
  snapshotTimeout = setTimeout(() => takeSnapshot('event'), 2000);
}

// ── Core snapshot logic ───────────────────────────────────────────────────────
async function takeSnapshot(trigger = 'auto') {
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
});

// ── State restoration ─────────────────────────────────────────────────────────
// When a tab finishes loading, check if it has pending restore state and inject
// the restore script to seek the video / scroll to the saved position.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;

  try {
    const pageKey = tab.url.split('#')[0];
    const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
    if (!tabNestRestores[pageKey]) return;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/restore.js'],
    });
  } catch (err) {
    // Tab may have been closed or is a restricted page (chrome://, etc.)
    console.debug('[TabNest] Restore inject skipped:', err.message);
  }
});
