// TabNest Popup JS
// Main controller for all UI views and interactions

import { Storage } from '../utils/storage.js';

// ── State ──────────────────────────────────────────────────────────────────────
let currentView = 'sessions';
let allOpenWindows = [];
let allSessions = [];
let allHistory = [];
let sessionOpenTabs = {}; // Map of sessionId -> array of { tabId, tabIndex, originalUrl }
let selectMode = false;
let selectedTabIds = new Set(); // Set of tab IDs (numbers)

// ── DOM References ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const windowsList      = $('windows-list');
const sessionsList     = $('sessions-list');
const historyList      = $('history-list');
const openCount        = $('open-count');
const sessionsCount    = $('sessions-count');
const footerInfo       = $('footer-info');
const modalOverlay     = $('modal-overlay');
const toast            = $('toast');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  bindEvents();
  switchView('sessions');
  await loadAll();
  renderCurrentView();
  updateFooter();
}

async function loadAll() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TABS' });
    allOpenWindows = resp?.windows || [];
  } catch (e) {
    allOpenWindows = [];
  }
  allSessions    = await Storage.getSessions();
  allHistory     = await Storage.getHistory();
  const stored   = await chrome.storage.local.get('sessionOpenTabs');
  sessionOpenTabs = stored?.sessionOpenTabs || {};
  updateCounts();
}

// ── Event Binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Nav
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      switchView(view);
    });
  });


  // Header buttons
  $('btn-snapshot').addEventListener('click', takeManualSnapshot);

  // Open tabs – selection mode
  $('btn-select-mode').addEventListener('click', toggleSelectMode);
  $('btn-cancel-select').addEventListener('click', exitSelectMode);
  $('btn-select-all').addEventListener('click', selectAllTabs);
  $('btn-deselect-all').addEventListener('click', deselectAllTabs);
  $('btn-save-selected').addEventListener('click', () => openSaveModal(null, true));

  // Sessions
  $('btn-new-session').addEventListener('click', () => openSaveModal());

  // History
  $('btn-clear-history').addEventListener('click', clearHistory);

  // Modals – Save
  $('modal-save-close').addEventListener('click', closeModal);
  $('modal-save-cancel').addEventListener('click', closeModal);
  $('modal-save-confirm').addEventListener('click', confirmSaveSession);

  // Modals – Rename
  $('modal-rename-close').addEventListener('click', closeModal);
  $('modal-rename-cancel').addEventListener('click', closeModal);
  $('modal-rename-confirm').addEventListener('click', confirmRename);
  $('modal-rename-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmRename();
  });

  // Modals – Customize Links
  $('modal-links-close').addEventListener('click', closeModal);
  $('modal-links-cancel').addEventListener('click', closeModal);
  $('modal-links-save').addEventListener('click', confirmCustomizeLinks);
  $('btn-add-link').addEventListener('click', addCustomizeLinkRow);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Export / Import
  $('btn-export').addEventListener('click', exportData);
  $('btn-import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', importData);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// ── View Switching ─────────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;

  document.querySelectorAll('.nav-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === view);
  });

  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('active', v.id === `view-${view}`);
  });

  renderCurrentView();
}

function renderCurrentView() {
  switch (currentView) {
    case 'open':        renderOpenTabs(); break;
    case 'sessions':    renderSessions(); break;
    case 'history':     renderHistory(); break;
  }
}

// ── Render: Open Tabs ─────────────────────────────────────────────────────────
function renderOpenTabs() {
  const totalTabs = allOpenWindows.reduce((acc, w) => acc + (w.tabs?.length || 0), 0);
  $('open-tabs-title').textContent = `${allOpenWindows.length} Window${allOpenWindows.length !== 1 ? 's' : ''} · ${totalTabs} Tab${totalTabs !== 1 ? 's' : ''}`;

  if (!allOpenWindows.length) {
    windowsList.innerHTML = '<div class="empty-state"><p>No open windows found</p></div>';
    return;
  }

  windowsList.innerHTML = allOpenWindows.map((win, wi) => `
    <div class="window-group" id="wg-${win.id}">
      <div class="window-header" data-wid="${win.id}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
        Window ${wi + 1}${win.focused ? ' <span style="color:#a78bfa;font-weight:400;font-size:10px">(current)</span>' : ''}
        <span style="margin-left:auto;margin-right:6px;font-size:10px;font-weight:500;color:var(--text-muted)">${win.tabs?.length || 0} tabs</span>
        <svg class="window-header-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div class="window-tab-list">
        ${(win.tabs || []).map((tab) => renderTabItem(tab, 'open')).join('')}
      </div>
    </div>
  `).join('');

  // Window toggle collapse
  document.querySelectorAll('.window-header').forEach((hdr) => {
    hdr.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      const wg = hdr.closest('.window-group');
      wg.classList.toggle('collapsed');
    });
  });

  // Tab click: focus tab OR toggle checkbox in select mode
  document.querySelectorAll('.tab-item[data-tab-id]').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tab-action-btn')) return;
      const tabId = parseInt(item.dataset.tabId);
      if (selectMode) {
        toggleTabSelection(tabId, item);
        return;
      }
      const winId = parseInt(item.dataset.winId);
      chrome.tabs.update(tabId, { active: true });
      chrome.windows.update(winId, { focused: true });
      window.close();
    });
  });

  // Checkbox click
  document.querySelectorAll('[data-chk]').forEach((chk) => {
    chk.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectMode) return;
      const tabId = parseInt(chk.dataset.chk);
      const item = chk.closest('.tab-item');
      toggleTabSelection(tabId, item);
    });
  });

  // Close tab
  document.querySelectorAll('[data-action="close-tab"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.tabId);
      await chrome.tabs.remove(tabId);
      await loadAll();
      renderOpenTabs();
    });
  });

}

function renderTabItem(tab, context = 'open') {
  const domain = getDomain(tab.url);
  const faviconUrl = tab.favIconUrl && !tab.favIconUrl.startsWith('chrome://') ? tab.favIconUrl : null;
  const faviconHtml = faviconUrl
    ? `<img class="tab-favicon" src="${escapeHtml(faviconUrl)}" onerror="this.style.display='none'" />`
    : `<div class="tab-favicon-fallback"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.5"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg></div>`;

  const isChecked = selectedTabIds.has(tab.id);
  const checkboxHtml = `<div class="tab-checkbox ${isChecked ? 'checked' : ''}" data-chk="${tab.id}"></div>`;

  const actionsHtml = context === 'open' ? `
    <div class="tab-actions">
      <button class="tab-action-btn close-btn" data-action="close-tab" data-tab-id="${tab.id}" title="Close Tab">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>` : '';

  return `
    <div class="tab-item ${tab.active ? 'active-tab' : ''} ${isChecked ? 'selected' : ''}" 
         data-tab-id="${tab.id || ''}" 
         data-win-id="${tab.windowId || ''}"
         title="${escapeHtml(tab.url || '')}">
      ${checkboxHtml}
      ${tab.pinned ? '<div class="tab-pin-dot" title="Pinned"></div>' : ''}
      ${faviconHtml}
      <div class="tab-info">
        <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
        <div class="tab-url">${escapeHtml(domain)}</div>
      </div>
      ${actionsHtml}
    </div>`;
}

// ── Render: Sessions ──────────────────────────────────────────────────────────
// Returns the set of URLs currently open across all windows
function getOpenUrlSet() {
  const urls = new Set();
  allOpenWindows.forEach((w) => (w.tabs || []).forEach((t) => t.url && urls.add(t.url)));
  return urls;
}

function renderSessions() {
  if (!allSessions.length) {
    sessionsList.innerHTML = `<div class="empty-state" id="sessions-empty">
      <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/></svg></div>
      <p>No saved sessions yet</p>
      <span>Click "Save Current" to save your open tabs</span>
    </div>`;
    return;
  }

  const openUrls = getOpenUrlSet();

  sessionsList.innerHTML = allSessions.map((s) => {
    const favicons = (s.tabs || []).slice(0, 8).map((t) => {
      const furl = t.favIconUrl && !t.favIconUrl.startsWith('chrome://') ? t.favIconUrl : null;
      return furl
        ? `<img class="tab-favicon" src="${escapeHtml(furl)}" onerror="this.style.display='none'" />`
        : `<div class="tab-favicon-fallback" style="width:12px;height:12px"></div>`;
    }).join('');

    // Check how many of this session's tabs are currently open
    const currentOpenTabIdSet = new Set(allOpenWindows.flatMap((w) => w.tabs || []).map((t) => t.id));
    const trackedOpenCount = (sessionOpenTabs[s.id] || [])
      .map((item) => (typeof item === 'number' ? item : item.tabId))
      .filter((tabId) => currentOpenTabIdSet.has(tabId)).length;

    const sessionUrls = (s.tabs || []).map((t) => t.url).filter(Boolean);
    const urlMatchCount = sessionUrls.filter((u) => openUrls.has(u)).length;
    const openCount = Math.max(trackedOpenCount, urlMatchCount);
    const isPartiallyOpen = openCount > 0;
    const isFullyOpen = openCount >= (s.tabs?.length || 0) && (s.tabs?.length || 0) > 0;

    const indicator = isPartiallyOpen
      ? `<span class="session-open-indicator">${isFullyOpen ? 'Open' : `${openCount}/${sessionUrls.length} open`}</span>`
      : '';

    return `
      <div class="session-card" data-session-id="${s.id}" data-id="${s.id}">
        <div class="session-card-header">
          <div class="session-title-group">
            <span class="session-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
            <button class="card-icon-btn" data-action="rename-session" data-id="${s.id}" title="Rename session">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="card-icon-btn" data-action="customize-session-links" data-id="${s.id}" title="Customize links">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </button>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
            ${indicator}
            <button class="drag-handle" data-id="${s.id}" title="Drag to reorder" aria-label="Drag to reorder">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/></svg>
            </button>
          </div>
        </div>
        <div class="session-favicon-strip">${favicons}</div>
        <div class="session-card-footer">
          <div class="session-meta">
            <span class="session-badge">${s.tabs?.length || 0} tabs</span>
            <span class="session-date">${formatDate(s.savedAt)}</span>
          </div>
          <div class="session-actions" style="opacity:1">
            <button class="session-open-btn" data-action="open-session" data-id="${s.id}" title="Open tabs in this window">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Open
            </button>
            <button class="session-close-btn" data-action="close-session" data-id="${s.id}" title="Close open tabs from this session" ${!isPartiallyOpen ? 'disabled' : ''}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              Close
            </button>
            <button class="session-action-btn delete-btn" data-action="delete-session" data-id="${s.id}">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');

  document.querySelectorAll('[data-action="rename-session"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRenameModal('session', btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="customize-session-links"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCustomizeLinksModal('session', btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="open-session"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSessionInCurrentWindow(btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="close-session"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await closeSessionTabs(btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="delete-session"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await Storage.deleteSession(btn.dataset.id);
      allSessions = await Storage.getSessions();
      updateCounts();
      renderSessions();
      showToast('Session deleted');
    });
  });

  // Enable drag and drop reordering for session cards
  setupDragAndDrop(sessionsList, '.session-card', '.drag-handle', async (sourceId, targetId, dropAbove) => {
    const fromIdx = allSessions.findIndex((s) => s.id === sourceId);
    if (fromIdx === -1) return;

    const [moved] = allSessions.splice(fromIdx, 1);
    let insertIdx = allSessions.findIndex((s) => s.id === targetId);
    if (insertIdx === -1) {
      allSessions.push(moved);
    } else {
      if (!dropAbove) insertIdx += 1;
      allSessions.splice(insertIdx, 0, moved);
    }

    await Storage.setSessions(allSessions);
    renderSessions();
  });
}


// ── Render: History ───────────────────────────────────────────────────────────
function renderHistory() {
  if (!allHistory.length) {
    historyList.innerHTML = `<div class="empty-state">
      <div class="empty-icon"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5V16h4"/></svg></div>
      <p>No history yet</p><span>Snapshots appear here automatically</span>
    </div>`;
    return;
  }

  historyList.innerHTML = allHistory.map((snap) => {
    return `
      <div class="history-item" data-snap-id="${snap.id}" data-id="${snap.id}">
        <span class="history-trigger-badge ${snap.trigger}">${snap.trigger}</span>
        <div class="history-info">
          <div class="history-title-row">
            <span class="history-name" title="${escapeHtml(snap.name || formatDateTime(snap.timestamp))}">${escapeHtml(snap.name || formatDateTime(snap.timestamp))}</span>
            <button class="card-icon-btn" data-action="rename-snap" data-id="${snap.id}" title="Rename snapshot">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </button>
            <button class="card-icon-btn" data-action="customize-snap-links" data-id="${snap.id}" title="Customize links">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            </button>
          </div>
          <div class="history-stats">${snap.name ? formatDateTime(snap.timestamp) + ' · ' : ''}${snap.windowCount} window${snap.windowCount !== 1 ? 's' : ''} · ${snap.tabCount} tab${snap.tabCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="history-actions">
          <button class="history-restore-btn" data-action="restore-snap" data-snap-id="${snap.id}">Restore</button>
          <button class="history-delete-btn" data-action="delete-snap" data-snap-id="${snap.id}" title="Remove snapshot">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
          <button class="drag-handle" data-id="${snap.id}" title="Drag to reorder" aria-label="Drag to reorder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('[data-action="rename-snap"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openRenameModal('snapshot', btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="customize-snap-links"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openCustomizeLinksModal('snapshot', btn.dataset.id);
    });
  });

  document.querySelectorAll('[data-action="restore-snap"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      restoreSnapshot(btn.dataset.snapId);
    });
  });

  document.querySelectorAll('[data-action="delete-snap"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const snapId = btn.dataset.snapId;
      await Storage.deleteHistoryItem(snapId);
      allHistory = await Storage.getHistory();
      renderHistory();
      showToast('Snapshot removed ✓');
    });
  });

  // Enable drag and drop reordering for snapshot history items
  setupDragAndDrop(historyList, '.history-item', '.drag-handle', async (sourceId, targetId, dropAbove) => {
    const fromIdx = allHistory.findIndex((s) => s.id === sourceId);
    if (fromIdx === -1) return;

    const [moved] = allHistory.splice(fromIdx, 1);
    let insertIdx = allHistory.findIndex((s) => s.id === targetId);
    if (insertIdx === -1) {
      allHistory.push(moved);
    } else {
      if (!dropAbove) insertIdx += 1;
      allHistory.splice(insertIdx, 0, moved);
    }

    await Storage.setHistory(allHistory);
    renderHistory();
  });
}

// ── Rename Controller ─────────────────────────────────────────────────────────
let activeRenameTarget = null; // { type: 'session' | 'snapshot', id: string }

function openRenameModal(type, id) {
  activeRenameTarget = { type, id };
  if (type === 'session') {
    const session = allSessions.find((s) => s.id === id);
    if (!session) return;
    $('modal-rename-title').textContent = 'Rename Session';
    $('modal-rename-label').textContent = 'Session Name';
    $('modal-rename-input').value = session.name || '';
  } else {
    const snap = allHistory.find((s) => s.id === id);
    if (!snap) return;
    $('modal-rename-title').textContent = 'Rename Snapshot';
    $('modal-rename-label').textContent = 'Snapshot Name';
    $('modal-rename-input').value = snap.name || formatDateTime(snap.timestamp);
  }
  showModal('modal-rename');
  setTimeout(() => $('modal-rename-input').select(), 50);
}

async function confirmRename() {
  if (!activeRenameTarget) return;
  const newName = $('modal-rename-input').value.trim();
  if (!newName) {
    showToast('Name cannot be empty');
    return;
  }

  if (activeRenameTarget.type === 'session') {
    const session = allSessions.find((s) => s.id === activeRenameTarget.id);
    if (session) {
      session.name = newName;
      await Storage.saveSession(session);
      allSessions = await Storage.getSessions();
      renderSessions();
      showToast('Session renamed ✓');
    }
  } else if (activeRenameTarget.type === 'snapshot') {
    const snap = allHistory.find((s) => s.id === activeRenameTarget.id);
    if (snap) {
      snap.name = newName;
      await Storage.setHistory(allHistory);
      renderHistory();
      showToast('Snapshot renamed ✓');
    }
  }

  closeModal();
}

// ── Customize Links Controller ────────────────────────────────────────────────
let activeCustomizeTarget = null; // { type: 'session' | 'snapshot', id: string, tabs: Array }

function openCustomizeLinksModal(type, id) {
  if (type === 'session') {
    const session = allSessions.find((s) => s.id === id);
    if (!session) return;
    activeCustomizeTarget = {
      type: 'session',
      id,
      tabs: (session.tabs || []).map((t) => ({ ...t })),
    };
    $('customize-links-subtitle').textContent = `Session: "${session.name}"`;
  } else {
    const snap = allHistory.find((s) => s.id === id);
    if (!snap) return;
    const flatTabs = snap.windows ? snap.windows.flatMap((w) => w.tabs || []) : (snap.tabs || []);
    activeCustomizeTarget = {
      type: 'snapshot',
      id,
      tabs: flatTabs.map((t) => ({ ...t })),
    };
    $('customize-links-subtitle').textContent = `Snapshot: "${snap.name || formatDateTime(snap.timestamp)}"`;
  }

  renderCustomizeLinkRows();
  showModal('modal-customize-links');
}

function renderCustomizeLinkRows() {
  const container = $('links-edit-list');
  const countEl = $('customize-links-count');
  if (!activeCustomizeTarget) return;

  countEl.textContent = `${activeCustomizeTarget.tabs.length} link${activeCustomizeTarget.tabs.length !== 1 ? 's' : ''}`;

  if (!activeCustomizeTarget.tabs.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 10px;color:var(--text-muted);font-size:12px">
        No links yet. Click "Add Link" to add one.
      </div>`;
    return;
  }

  container.innerHTML = activeCustomizeTarget.tabs.map((tab, idx) => `
    <div class="link-edit-row" data-idx="${idx}">
      <div class="link-edit-inputs">
        <input class="form-input link-title-input" placeholder="Page Title (optional)" value="${escapeHtml(tab.title || '')}" />
        <input class="form-input link-url-input" placeholder="https://..." value="${escapeHtml(tab.url || '')}" />
      </div>
      <div class="link-edit-actions">
        <button class="link-pin-btn ${tab.pinned ? 'active' : ''}" data-action="toggle-pin" data-idx="${idx}" title="${tab.pinned ? 'Pinned tab' : 'Pin tab'}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="${tab.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
        </button>
        <button class="link-remove-btn" data-action="remove-link" data-idx="${idx}" title="Remove link">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  // Pin toggle
  container.querySelectorAll('[data-action="toggle-pin"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      syncCurrentLinkInputs();
      activeCustomizeTarget.tabs[idx].pinned = !activeCustomizeTarget.tabs[idx].pinned;
      renderCustomizeLinkRows();
    });
  });

  // Remove link
  container.querySelectorAll('[data-action="remove-link"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      syncCurrentLinkInputs();
      activeCustomizeTarget.tabs.splice(idx, 1);
      renderCustomizeLinkRows();
    });
  });
}

function syncCurrentLinkInputs() {
  const container = $('links-edit-list');
  if (!container || !activeCustomizeTarget) return;
  const rows = container.querySelectorAll('.link-edit-row');
  rows.forEach((row, i) => {
    if (activeCustomizeTarget.tabs[i]) {
      const titleInput = row.querySelector('.link-title-input');
      const urlInput = row.querySelector('.link-url-input');
      if (titleInput) activeCustomizeTarget.tabs[i].title = titleInput.value;
      if (urlInput) activeCustomizeTarget.tabs[i].url = urlInput.value;
    }
  });
}

function addCustomizeLinkRow() {
  if (!activeCustomizeTarget) return;
  syncCurrentLinkInputs();
  activeCustomizeTarget.tabs.push({ url: '', title: '', pinned: false });
  renderCustomizeLinkRows();

  const rows = $('links-edit-list').querySelectorAll('.link-edit-row');
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    const urlInput = lastRow.querySelector('.link-url-input');
    if (urlInput) urlInput.focus();
  }
}

async function confirmCustomizeLinks() {
  if (!activeCustomizeTarget) return;
  syncCurrentLinkInputs();

  const finalTabs = [];
  for (const t of activeCustomizeTarget.tabs) {
    let url = (t.url || '').trim();
    if (!url) continue;
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('chrome://') && !url.startsWith('edge://')) {
      url = 'https://' + url;
    }
    finalTabs.push({
      ...t,
      url,
      title: (t.title || '').trim() || getDomain(url),
      pinned: !!t.pinned,
    });
  }

  if (activeCustomizeTarget.type === 'session') {
    const session = allSessions.find((s) => s.id === activeCustomizeTarget.id);
    if (session) {
      session.tabs = finalTabs;
      await Storage.saveSession(session);
      allSessions = await Storage.getSessions();
      renderSessions();
      showToast(`Saved ${finalTabs.length} link${finalTabs.length !== 1 ? 's' : ''} ✓`);
    }
  } else if (activeCustomizeTarget.type === 'snapshot') {
    const snap = allHistory.find((s) => s.id === activeCustomizeTarget.id);
    if (snap) {
      if (snap.windows && snap.windows.length) {
        snap.windows[0].tabs = finalTabs;
        snap.windows.splice(1);
      } else {
        snap.windows = [{ id: 1, focused: true, tabs: finalTabs }];
      }
      snap.tabCount = finalTabs.length;
      snap.windowCount = 1;
      await Storage.setHistory(allHistory);
      renderHistory();
      showToast(`Saved ${finalTabs.length} link${finalTabs.length !== 1 ? 's' : ''} ✓`);
    }
  }

  closeModal();
}

// ── Generic Drag and Drop Reorder Controller ──────────────────────────────────
function setupDragAndDrop(containerEl, itemsSelector, handleSelector, onReorder) {
  let draggedEl = null;

  containerEl.querySelectorAll(itemsSelector).forEach((item) => {
    const handle = item.querySelector(handleSelector);
    if (!handle) return;

    // Enable HTML5 drag only when mouse is pressed on the drag handle
    handle.addEventListener('mousedown', () => {
      item.setAttribute('draggable', 'true');
    });

    handle.addEventListener('mouseup', () => {
      item.removeAttribute('draggable');
    });

    item.addEventListener('dragstart', (e) => {
      draggedEl = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.id || '');
      setTimeout(() => item.classList.add('is-dragging'), 0);
    });

    item.addEventListener('dragend', () => {
      item.removeAttribute('draggable');
      item.classList.remove('is-dragging');
      containerEl.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach((el) => {
        el.classList.remove('drag-over-top', 'drag-over-bottom');
      });
      draggedEl = null;
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!draggedEl || draggedEl === item) return;

      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const isAbove = e.clientY < midY;

      containerEl.querySelectorAll(itemsSelector).forEach((el) => {
        if (el !== item) el.classList.remove('drag-over-top', 'drag-over-bottom');
      });

      if (isAbove) {
        item.classList.add('drag-over-top');
        item.classList.remove('drag-over-bottom');
      } else {
        item.classList.add('drag-over-bottom');
        item.classList.remove('drag-over-top');
      }
    });

    item.addEventListener('dragleave', (e) => {
      const rect = item.getBoundingClientRect();
      if (
        e.clientY < rect.top ||
        e.clientY >= rect.bottom ||
        e.clientX < rect.left ||
        e.clientX >= rect.right
      ) {
        item.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });

    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over-top', 'drag-over-bottom');
      if (!draggedEl || draggedEl === item) return;

      const rect = item.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dropAbove = e.clientY < midY;

      const sourceId = draggedEl.dataset.id;
      const targetId = item.dataset.id;

      if (!sourceId || !targetId || sourceId === targetId) return;

      await onReorder(sourceId, targetId, dropAbove);
    });
  });
}


// ── Actions: Sessions ─────────────────────────────────────────────────────────
let pendingSessionTabs = null;

function openSaveModal(tabs = null, fromSelection = false) {
  if (fromSelection) {
    // Gather full tab objects for selected IDs
    const allTabs = allOpenWindows.flatMap((w) => w.tabs || []);
    pendingSessionTabs = allTabs.filter((t) => selectedTabIds.has(t.id));
  } else {
    pendingSessionTabs = tabs;
  }

  const defaultName = fromSelection && pendingSessionTabs?.length
    ? `${pendingSessionTabs.length} tabs – ${formatDate(Date.now())}`
    : `Session – ${formatDate(Date.now())}`;
  $('session-name-input').value = defaultName;

  showModal('modal-save-session');
  setTimeout(() => $('session-name-input').select(), 50);
}

async function confirmSaveSession() {
  const name = $('session-name-input').value.trim();
  if (!name) {
    $('session-name-input').focus();
    return;
  }

  let tabs = pendingSessionTabs;
  if (!tabs) {
    // Collect all current tabs
    tabs = allOpenWindows.flatMap((w) => w.tabs || []);
  }

  const session = {
    id: `sess_${Date.now()}`,
    name,
    savedAt: Date.now(),
    tabCount: tabs.length,
    tabs: tabs.map((t) => ({
      url: t.url,
      title: t.title,
      favIconUrl: t.favIconUrl,
      pinned: t.pinned,
    })),
  };

  await Storage.saveSession(session);
  allSessions = await Storage.getSessions();
  updateCounts();
  closeModal();
  switchView('sessions');
  showToast(`Session "${name}" saved ✓`);
}

// Open session tabs in the CURRENT window
async function openSessionInCurrentWindow(id) {
  const session = allSessions.find((s) => s.id === id);
  if (!session?.tabs?.length) return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentWindowId = activeTab?.windowId;

  // Pre-seed tabNestRestores with saved scroll/video state
  const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
  for (const t of session.tabs) {
    if (t.url && (t.scrollY > 20 || t.videoTime > 1)) {
      const rawKey = t.url.split('#')[0];
      const normKey = rawKey.replace(/\/+$/, '');
      const stateObj = {
        scrollX: t.scrollX || 0,
        scrollY: t.scrollY || 0,
        videoTime: t.videoTime || 0,
        savedAt: Date.now(),
      };
      tabNestRestores[rawKey] = stateObj;
      tabNestRestores[normKey] = stateObj;
    }
  }
  await chrome.storage.local.set({ tabNestRestores });

  // Pinned tabs must be created before unpinned ones (Chrome requirement)
  const sortedWithIndex = session.tabs
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => (b.tab.pinned ? 1 : 0) - (a.tab.pinned ? 1 : 0));

  const trackedTabs = [];
  for (const item of sortedWithIndex) {
    if (item.tab.url) {
      const createdTab = await chrome.tabs.create({
        url: item.tab.url,
        windowId: currentWindowId,
        active: false,
        pinned: !!item.tab.pinned,
      });
      trackedTabs.push({
        tabId: createdTab.id,
        tabIndex: item.index,
        originalUrl: item.tab.url,
      });
    }
  }

  // Update sessionOpenTabs in storage
  const stored = await chrome.storage.local.get('sessionOpenTabs');
  const currentSessionOpenTabs = stored.sessionOpenTabs || {};
  currentSessionOpenTabs[id] = trackedTabs;
  await chrome.storage.local.set({ sessionOpenTabs: currentSessionOpenTabs });
  sessionOpenTabs = currentSessionOpenTabs;

  showToast(`Opened ${session.tabs.length} tab${session.tabs.length !== 1 ? 's' : ''} ✓`);
  await loadAll();
  renderSessions();
}

// Close any currently-open tabs that belong to a session and save their progress
async function closeSessionTabs(id) {
  const session = allSessions.find((s) => s.id === id);
  if (!session?.tabs?.length) return;

  // 1. Get tracked tabs from storage
  const stored = await chrome.storage.local.get('sessionOpenTabs');
  const allTracked = stored.sessionOpenTabs || {};
  const trackedList = allTracked[id] || [];

  // 2. Fetch fresh list of all current tabs across all windows
  const resp = await chrome.runtime.sendMessage({ type: 'GET_CURRENT_TABS' });
  const openWindows = resp?.windows || allOpenWindows || [];
  const allCurrentTabs = openWindows.flatMap((w) => w.tabs || []);
  const currentTabsMap = new Map(allCurrentTabs.map((t) => [t.id, t]));

  // 3. Determine which tabs belong to this session
  const matchedTabs = [];
  const usedTabIds = new Set();
  const matchedIndices = new Set();

  for (const item of trackedList) {
    const tabId = typeof item === 'number' ? item : item.tabId;
    const tabIndex = typeof item === 'object' && item.tabIndex !== undefined ? item.tabIndex : -1;
    if (currentTabsMap.has(tabId) && !usedTabIds.has(tabId)) {
      matchedTabs.push({
        tab: currentTabsMap.get(tabId),
        tabIndex: tabIndex >= 0 && tabIndex < session.tabs.length ? tabIndex : null,
      });
      usedTabIds.add(tabId);
      if (tabIndex >= 0) matchedIndices.add(tabIndex);
    }
  }

  // Fallback: match by URL for any tabs not found by ID tracking
  const sessionUrls = session.tabs.map((t, i) => ({ url: t.url, index: i })).filter((x) => x.url);
  for (const sUrl of sessionUrls) {
    if (matchedIndices.has(sUrl.index)) continue;
    const foundTab = allCurrentTabs.find((t) => t.url === sUrl.url && !usedTabIds.has(t.id));
    if (foundTab) {
      matchedTabs.push({ tab: foundTab, tabIndex: sUrl.index });
      usedTabIds.add(foundTab.id);
      matchedIndices.add(sUrl.index);
    }
  }

  if (!matchedTabs.length) {
    showToast('No open tabs to close');
    return;
  }

  // 4. Capture live state (scroll, video timestamp, updated URL & title) for each tab
  const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
  let hasSessionUpdates = false;

  for (const { tab, tabIndex } of matchedTabs) {
    let pageState = { scrollX: 0, scrollY: 0, videoTime: 0, href: tab.url };

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const video = document.querySelector('video');
          return {
            scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
            scrollY: Math.round(window.scrollY || window.pageYOffset || 0),
            videoTime: video && !isNaN(video.currentTime) ? Math.round(video.currentTime) : 0,
            href: window.location.href,
          };
        },
      });
      if (results?.[0]?.result) {
        pageState = results[0].result;
      }
    } catch (e) {
      // Non-scriptable tabs (e.g. chrome://) will silently skip
    }

    let freshTab = tab;
    try {
      freshTab = await chrome.tabs.get(tab.id);
    } catch (e) {}

    const finalUrl = pageState.href || freshTab.url || tab.url;
    const finalTitle = freshTab.title || tab.title || '';
    const finalPinned = freshTab.pinned !== undefined ? freshTab.pinned : tab.pinned;
    const finalFavIcon = freshTab.favIconUrl || tab.favIconUrl || '';

    // Cache in tabNestRestores
    if (finalUrl && (pageState.scrollY > 20 || pageState.videoTime > 1)) {
      const rawKey = finalUrl.split('#')[0];
      const normKey = rawKey.replace(/\/+$/, '');
      const stateObj = {
        scrollX: pageState.scrollX,
        scrollY: pageState.scrollY,
        videoTime: pageState.videoTime,
        savedAt: Date.now(),
      };
      tabNestRestores[rawKey] = stateObj;
      tabNestRestores[normKey] = stateObj;
    }

    // Update session tab record so reopening opens latest URL, pinned state & scroll
    if (tabIndex !== null && session.tabs[tabIndex]) {
      session.tabs[tabIndex].url = finalUrl;
      session.tabs[tabIndex].title = finalTitle;
      session.tabs[tabIndex].pinned = finalPinned;
      session.tabs[tabIndex].favIconUrl = finalFavIcon;
      session.tabs[tabIndex].scrollX = pageState.scrollX;
      session.tabs[tabIndex].scrollY = pageState.scrollY;
      session.tabs[tabIndex].videoTime = pageState.videoTime;
      hasSessionUpdates = true;
    }
  }

  // 5. Persist restore state & session updates
  await chrome.storage.local.set({ tabNestRestores });

  if (hasSessionUpdates) {
    session.updatedAt = Date.now();
    await Storage.saveSession(session);
    allSessions = await Storage.getSessions();
  }

  // 6. Clean up closed tabs from sessionOpenTabs
  allTracked[id] = (allTracked[id] || []).filter((item) => {
    const tabId = typeof item === 'number' ? item : item.tabId;
    return !usedTabIds.has(tabId);
  });
  await chrome.storage.local.set({ sessionOpenTabs: allTracked });
  sessionOpenTabs = allTracked;

  // 7. Remove tabs from Chrome
  const tabIdsToClose = Array.from(usedTabIds);
  await chrome.tabs.remove(tabIdsToClose);
  showToast(`Closed ${tabIdsToClose.length} tab${tabIdsToClose.length !== 1 ? 's' : ''} & saved progress ✓`);

  // 8. Refresh open tabs state and re-render
  await loadAll();
  renderSessions();
}


// ── Actions: History ──────────────────────────────────────────────────────────
async function clearHistory() {
  await Storage.clearHistory();
  allHistory = [];
  renderHistory();
  showToast('History cleared');
}

async function restoreSnapshot(snapId) {
  const snap = allHistory.find((s) => s.id === snapId);
  if (!snap?.windows?.length) {
    showToast('Snapshot is empty');
    return;
  }

  // Target the current browser window
  const currentWindow = await chrome.windows.getCurrent();
  const currentWindowId = currentWindow?.id;

  // Record already opened tabs in this window so we can close them after restoration
  const existingTabs = await chrome.tabs.query({ windowId: currentWindowId });
  const existingTabIds = existingTabs.map((t) => t.id).filter(Boolean);

  // Prioritize focused window from snapshot if multi-window
  const sortedWindows = [...snap.windows].sort((a, b) => (b.focused ? 1 : 0) - (a.focused ? 1 : 0));

  // Separate pinned and unpinned tabs to preserve Chrome ordering constraints:
  // In Chrome, all pinned tabs must precede unpinned tabs in a window.
  // Within each category, the original order is strictly maintained.
  const pinnedTabs = [];
  const unpinnedTabs = [];

  for (const win of sortedWindows) {
    for (const tab of win.tabs || []) {
      if (!tab.url) continue;
      // Skip internal developer tool windows if any
      if (tab.url.startsWith('chrome-devtools://')) continue;

      const item = { tab, winFocused: !!win.focused };
      if (tab.pinned) {
        pinnedTabs.push(item);
      } else {
        unpinnedTabs.push(item);
      }
    }
  }

  const tabsToRestore = [...pinnedTabs, ...unpinnedTabs];
  if (!tabsToRestore.length) {
    showToast('No valid tabs in snapshot to restore');
    return;
  }

  // Pre-seed tabNestRestores if any scroll or video timestamps exist
  const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
  let hasRestores = false;
  for (const item of tabsToRestore) {
    const t = item.tab;
    if (t.url && (t.scrollY > 20 || t.videoTime > 1)) {
      const rawKey = t.url.split('#')[0];
      const normKey = rawKey.replace(/\/+$/, '');
      const stateObj = {
        scrollX: t.scrollX || 0,
        scrollY: t.scrollY || 0,
        videoTime: t.videoTime || 0,
        savedAt: Date.now(),
      };
      tabNestRestores[rawKey] = stateObj;
      tabNestRestores[normKey] = stateObj;
      hasRestores = true;
    }
  }
  if (hasRestores) {
    await chrome.storage.local.set({ tabNestRestores });
  }

  let activeTabIdToFocus = null;
  const createdTabIds = [];

  for (const item of tabsToRestore) {
    try {
      const createdTab = await chrome.tabs.create({
        url: item.tab.url,
        windowId: currentWindowId,
        active: false,
        pinned: !!item.tab.pinned,
      });

      createdTabIds.push(createdTab.id);

      // Track active tab: prioritize the active tab in the focused window
      if (item.tab.active && (!activeTabIdToFocus || item.winFocused)) {
        activeTabIdToFocus = createdTab.id;
      }
    } catch (err) {
      console.error('[TabNest] Failed to restore tab:', item.tab.url, err);
    }
  }

  // If no tab was explicitly marked active, focus the first restored tab
  if (!activeTabIdToFocus && createdTabIds.length) {
    activeTabIdToFocus = createdTabIds[0];
  }

  // Restore active focus to the target tab
  if (activeTabIdToFocus) {
    try {
      await chrome.tabs.update(activeTabIdToFocus, { active: true });
    } catch (_) {}
  }

  // Close the already opened tabs that were present before restoring
  if (createdTabIds.length && existingTabIds.length) {
    try {
      await chrome.tabs.remove(existingTabIds);
    } catch (err) {
      console.warn('[TabNest] Error closing pre-existing tabs:', err);
    }
  }

  showToast(`Restored ${createdTabIds.length} tab${createdTabIds.length !== 1 ? 's' : ''} in current window ✓`);
  setTimeout(() => window.close(), 500);
}

// ── Selection Mode ────────────────────────────────────────────────────────────
function toggleSelectMode() {
  selectMode ? exitSelectMode() : enterSelectMode();
}

function enterSelectMode() {
  selectMode = true;
  selectedTabIds.clear();
  $('btn-select-mode').classList.add('active');
  $('selection-bar').classList.add('visible');
  windowsList.classList.add('select-mode');
  updateSelectionBar();
  renderOpenTabs();
}

function exitSelectMode() {
  selectMode = false;
  selectedTabIds.clear();
  $('btn-select-mode').classList.remove('active');
  $('selection-bar').classList.remove('visible');
  windowsList.classList.remove('select-mode');
  renderOpenTabs();
}

function toggleTabSelection(tabId, itemEl) {
  if (selectedTabIds.has(tabId)) {
    selectedTabIds.delete(tabId);
    itemEl?.classList.remove('selected');
    itemEl?.querySelector('[data-chk]')?.classList.remove('checked');
  } else {
    selectedTabIds.add(tabId);
    itemEl?.classList.add('selected');
    itemEl?.querySelector('[data-chk]')?.classList.add('checked');
  }
  updateSelectionBar();
}

function selectAllTabs() {
  allOpenWindows.forEach((w) => (w.tabs || []).forEach((t) => selectedTabIds.add(t.id)));
  renderOpenTabs(); // re-render so checkboxes reflect
  updateSelectionBar();
}

function deselectAllTabs() {
  selectedTabIds.clear();
  renderOpenTabs();
  updateSelectionBar();
}

function updateSelectionBar() {
  const n = selectedTabIds.size;
  $('selection-count').textContent = n === 0 ? 'Select tabs to save' : `${n} tab${n !== 1 ? 's' : ''} selected`;
  const saveBtn = $('btn-save-selected');
  saveBtn.disabled = n === 0;
  saveBtn.textContent = n > 0 ? `Save ${n} Tab${n !== 1 ? 's' : ''}` : 'Save Selected';
}

// ── Actions: Snapshot ─────────────────────────────────────────────────────────
async function takeManualSnapshot() {
  const btn = $('btn-snapshot');
  btn.style.color = '#67e8f9';
  await chrome.runtime.sendMessage({ type: 'TAKE_SNAPSHOT' });
  allHistory = await Storage.getHistory();
  if (currentView === 'history') renderHistory();
  showToast('Snapshot saved ✓');
  setTimeout(() => { btn.style.color = ''; }, 1500);
}

// ── Export / Import ───────────────────────────────────────────────────────────
async function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: allSessions,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `tabnest-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported ✓');
}

async function importData(e) {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (data.sessions) {
      for (const s of data.sessions) {
        await Storage.saveSession(s);
      }
    }

    await loadAll();
    renderCurrentView();
    showToast(`Imported ${data.sessions?.length || 0} sessions ✓`);
  } catch (err) {
    showToast('Import failed – invalid file');
  }

  e.target.value = '';
}

// ── Modal Helpers ─────────────────────────────────────────────────────────────
function showModal(id) {
  document.querySelectorAll('.modal').forEach((m) => {
    m.style.display = m.id === id ? '' : 'none';
  });
  modalOverlay.classList.add('open');
}

function closeModal() {
  modalOverlay.classList.remove('open');
  pendingSessionTabs = null;
  activeRenameTarget = null;
  activeCustomizeTarget = null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimeout;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function updateCounts() {
  const totalTabs = allOpenWindows.reduce((acc, w) => acc + (w.tabs?.length || 0), 0);
  openCount.textContent     = totalTabs;
  sessionsCount.textContent = allSessions.length;
}

function updateFooter() {
  const totalSavedTabs = allSessions.reduce((acc, s) => acc + (s.tabs?.length || 0), 0);
  footerInfo.textContent = `${allSessions.length} sessions · ${totalSavedTabs} tabs saved`;
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url || '';
  }
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function escapeHtml(str) {
  if (!str) return '';
  // If contains mark tags from highlighting, return raw (already processed)
  if (str.includes('<mark>')) return str;
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Start ─────────────────────────────────────────────────────────────────────
init();
