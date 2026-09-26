// TabNest Storage Utilities
// Wraps chrome.storage.local with convenience methods

export const Storage = {
  async get(keys) {
    return new Promise((resolve) =>
      chrome.storage.local.get(keys, resolve)
    );
  },

  async set(data) {
    return new Promise((resolve) =>
      chrome.storage.local.set(data, resolve)
    );
  },

  async remove(keys) {
    return new Promise((resolve) =>
      chrome.storage.local.remove(keys, resolve)
    );
  },

  // ── Sessions ────────────────────────────────────────────────────────────────
  async getSessions() {
    const { sessions = [] } = await this.get('sessions');
    return sessions;
  },

  async saveSession(session) {
    const sessions = await this.getSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      sessions[idx] = session;
    } else {
      sessions.unshift(session);
    }
    await this.set({ sessions });
    return session;
  },

  async setSessions(sessions) {
    await this.set({ sessions });
    return sessions;
  },

  async deleteSession(id) {
    const sessions = await this.getSessions();
    await this.set({ sessions: sessions.filter((s) => s.id !== id) });
  },

  // ── Collections ─────────────────────────────────────────────────────────────
  async getCollections() {
    const { collections = [] } = await this.get('collections');
    return collections;
  },

  async saveCollection(col) {
    const collections = await this.getCollections();
    const idx = collections.findIndex((c) => c.id === col.id);
    if (idx >= 0) {
      collections[idx] = col;
    } else {
      collections.unshift(col);
    }
    await this.set({ collections });
    return col;
  },

  async deleteCollection(id) {
    const collections = await this.getCollections();
    await this.set({ collections: collections.filter((c) => c.id !== id) });
  },

  // ── History ─────────────────────────────────────────────────────────────────
  async getHistory() {
    const { tabHistory = [] } = await this.get('tabHistory');
    return tabHistory;
  },

  async setHistory(tabHistory) {
    await this.set({ tabHistory, lastSnapshot: tabHistory[0] || null });
    return tabHistory;
  },

  async deleteHistoryItem(id) {
    const history = await this.getHistory();
    const updated = history.filter((h) => h.id !== id);
    await this.set({ tabHistory: updated, lastSnapshot: updated[0] || null });
    return updated;
  },

  async clearHistory() {
    await this.set({ tabHistory: [], lastSnapshot: null });
  },
};
