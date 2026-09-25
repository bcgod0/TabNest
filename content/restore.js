// TabNest – content/restore.js
// Injected by background.js after a tab finishes loading.
// Reads pending restore state from storage and applies it to the page.

(async () => {
  try {
    const pageKey = location.href.split('#')[0];
    const { tabNestRestores = {} } = await chrome.storage.local.get('tabNestRestores');
    const state = tabNestRestores[pageKey];
    if (!state) return;

    // Clean up immediately so it doesn't fire again on refresh
    delete tabNestRestores[pageKey];
    await chrome.storage.local.set({ tabNestRestores });

    // ── Restore video playback time ──────────────────────────────────────────
    if (state.videoTime && state.videoTime > 1) {
      const seekVideo = (attemptsLeft = 30) => {
        const video = document.querySelector('video');
        if (video) {
          const doSeek = () => {
            // Only seek if the saved time is meaningfully ahead of current pos
            if (Math.abs(video.currentTime - state.videoTime) > 2) {
              video.currentTime = state.videoTime;
            }
          };
          if (video.readyState >= 1) {
            doSeek();
          } else {
            video.addEventListener('loadedmetadata', doSeek, { once: true });
          }
        } else if (attemptsLeft > 0) {
          // Video element may not exist yet (SPAs, lazy loading)
          setTimeout(() => seekVideo(attemptsLeft - 1), 300);
        }
      };
      seekVideo();
    }

    // ── Restore scroll position ──────────────────────────────────────────────
    // Only restore if scroll is significant (avoid minor scrolls)
    if (state.scrollY && state.scrollY > 200) {
      // Small delay so the page layout has time to settle
      setTimeout(() => {
        window.scrollTo({ top: state.scrollY, left: state.scrollX || 0, behavior: 'instant' });
      }, 400);
    }

  } catch (err) {
    // Silently fail – never break the page
    console.debug('[TabNest restore]', err);
  }
})();
