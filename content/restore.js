// TabNest – content/restore.js
// Injected by background.js after a tab finishes loading.
// Reads pending restore state from storage and applies it to the page.

(async () => {
  try {
    const rawKey = location.href.split('#')[0];
    const normKey = rawKey.replace(/\/+$/, '');
    const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
    const state = tabNestRestores[normKey] || tabNestRestores[rawKey] || tabNestRestores[location.href];
    if (!state) return;

    // Clean up so it doesn't fire again on manual refresh
    delete tabNestRestores[normKey];
    delete tabNestRestores[rawKey];
    delete tabNestRestores[location.href];
    await chrome.storage.local.set({ tabNestRestores });

    // ── Restore video playback time ──────────────────────────────────────────
    if (state.videoTime && state.videoTime > 1) {
      const seekVideo = (attemptsLeft = 30) => {
        const video = document.querySelector('video');
        if (video) {
          const doSeek = () => {
            if (Math.abs(video.currentTime - state.videoTime) > 2) {
              video.currentTime = state.videoTime;
            }
          };
          if (video.readyState >= 1) {
            doSeek();
          } else {
            video.addEventListener('loadedmetadata', doSeek, { once: true });
          }
          video.addEventListener('play', doSeek, { once: true });
          video.addEventListener('playing', doSeek, { once: true });
        } else if (attemptsLeft > 0) {
          setTimeout(() => seekVideo(attemptsLeft - 1), 300);
        }
      };
      seekVideo();
    }

    // ── Restore scroll position ──────────────────────────────────────────────
    if ((state.scrollY && state.scrollY > 20) || (state.scrollX && state.scrollX > 20)) {
      const targetY = state.scrollY || 0;
      const targetX = state.scrollX || 0;
      const doScroll = (attemptsLeft = 15) => {
        window.scrollTo({ top: targetY, left: targetX, behavior: 'instant' });
        // If document height is still expanding (lazy load / dynamic content), retry briefly
        if (
          attemptsLeft > 0 &&
          Math.abs(window.scrollY - targetY) > 30 &&
          document.documentElement.scrollHeight < targetY + window.innerHeight
        ) {
          setTimeout(() => doScroll(attemptsLeft - 1), 250);
        }
      };
      setTimeout(() => doScroll(), 250);
    }
  } catch (err) {
    console.debug('[TabNest restore]', err);
  }
})();
