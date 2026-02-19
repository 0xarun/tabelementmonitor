(() => {
  const monitorState = {
    active: false,
    url: '',
    selector: '',
    mode: 'live',
    observer: null,
    retryCount: 0,
    retryTimer: null,
    debounceTimer: null,
    audio: null
  };

  function cleanup() {
    if (monitorState.observer) {
      monitorState.observer.disconnect();
      monitorState.observer = null;
    }
    if (monitorState.retryTimer) {
      clearTimeout(monitorState.retryTimer);
      monitorState.retryTimer = null;
    }
    if (monitorState.debounceTimer) {
      clearTimeout(monitorState.debounceTimer);
      monitorState.debounceTimer = null;
    }
  }

  function normalizeValue(rawText) {
    const trimmed = String(rawText || '').trim();
    const numeric = trimmed.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return numeric ? numeric[0] : trimmed;
  }

  function getNormalizedValue(selector) {
    let element;
    try {
      element = document.querySelector(selector);
    } catch {
      return { ok: false, reason: 'invalid-selector' };
    }

    if (!element) {
      return { ok: false, reason: 'not-found' };
    }

    return {
      ok: true,
      value: normalizeValue(element.innerText)
    };
  }

  async function postValue() {
    if (!monitorState.active || window.location.href !== monitorState.url) {
      await chrome.runtime.sendMessage({ type: 'PAGE_MISMATCH' });
      return;
    }

    const result = getNormalizedValue(monitorState.selector);
    if (!result.ok) {
      await retryElementSearch();
      return;
    }

    monitorState.retryCount = 0;
    await chrome.runtime.sendMessage({
      type: 'ELEMENT_VALUE',
      payload: {
        value: result.value
      }
    });
  }

  async function retryElementSearch() {
    if (monitorState.retryCount >= 5) {
      await chrome.runtime.sendMessage({ type: 'ELEMENT_NOT_FOUND' });
      return;
    }

    monitorState.retryCount += 1;
    monitorState.retryTimer = setTimeout(() => {
      postValue();
    }, 5000);
  }

  function startObserver() {
    const result = getNormalizedValue(monitorState.selector);
    if (!result.ok) {
      retryElementSearch();
      return;
    }

    postValue();

    const element = document.querySelector(monitorState.selector);
    const parent = element?.parentElement || document.body;
    if (!parent) {
      retryElementSearch();
      return;
    }

    monitorState.observer = new MutationObserver(() => {
      if (monitorState.debounceTimer) {
        clearTimeout(monitorState.debounceTimer);
      }
      monitorState.debounceTimer = setTimeout(() => {
        postValue();
      }, 500);
    });

    monitorState.observer.observe(parent, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function startMonitoring(payload) {
    cleanup();

    monitorState.active = true;
    monitorState.url = payload.url;
    monitorState.selector = payload.selector;
    monitorState.mode = payload.mode;
    monitorState.retryCount = 0;

    if (window.location.href !== payload.url) {
      chrome.runtime.sendMessage({ type: 'PAGE_MISMATCH' });
      return;
    }

    if (monitorState.mode === 'live') {
      startObserver();
    } else {
      postValue();
    }
  }

  function stopMonitoring() {
    monitorState.active = false;
    cleanup();
  }

  async function playSound() {
    try {
      if (!monitorState.audio) {
        monitorState.audio = new Audio(chrome.runtime.getURL('sound.mp3'));
      }
      monitorState.audio.currentTime = 0;
      await monitorState.audio.play();
      return;
    } catch {
      // Placeholder/missing audio is expected in some builds; fallback below.
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        return;
      }
      const context = new AudioCtx();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.03;
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.12);
      setTimeout(() => {
        context.close().catch(() => {});
      }, 200);
    } catch {
      // Audio may be blocked by browser policy.
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      switch (message?.type) {
        case 'START_MONITOR':
          startMonitoring(message.payload || {});
          sendResponse({ ok: true });
          break;
        case 'CHECK_NOW':
          monitorState.url = message.payload?.url || monitorState.url;
          monitorState.selector = message.payload?.selector || monitorState.selector;
          monitorState.active = true;
          await postValue();
          sendResponse({ ok: true });
          break;
        case 'STOP_MONITOR':
          stopMonitoring();
          sendResponse({ ok: true });
          break;
        case 'PLAY_SOUND':
          await playSound();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'Unsupported message.' });
      }
    })();

    return true;
  });
})();
