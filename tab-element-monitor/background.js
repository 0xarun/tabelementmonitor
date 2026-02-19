const STORAGE_KEYS = {
  config: 'monitorConfig',
  state: 'monitorState',
  lastValue: 'lastValue',
  lastError: 'lastError'
};

const DEFAULTS = {
  mode: 'live',
  refreshIntervalSeconds: 60,
  notificationRepeatCount: 1,
  notificationDelaySeconds: 5,
  increaseOnly: false,
  soundEnabled: true
};

let runtimeState = {
  monitoring: false,
  tabId: null,
  exactUrl: '',
  mode: DEFAULTS.mode,
  refreshTimerId: null,
  lastNotificationAt: 0
};

async function getFromStorage(keys) {
  return chrome.storage.local.get(keys);
}

async function setInStorage(data) {
  return chrome.storage.local.set(data);
}

function toOriginPattern(rawUrl) {
  const parsed = new URL(rawUrl);
  return `${parsed.protocol}//${parsed.host}/*`;
}

function normalizeConfig(input) {
  const url = String(input.url || '').trim();
  const selector = String(input.selector || '').trim();
  const mode = input.mode === 'refresh' ? 'refresh' : 'live';
  const refreshIntervalSeconds = Math.max(60, Number(input.refreshIntervalSeconds) || 60);
  const notificationRepeatCount = Math.min(5, Math.max(1, Number(input.notificationRepeatCount) || 1));
  const notificationDelaySeconds = Math.max(1, Number(input.notificationDelaySeconds) || 5);

  if (!url || !selector) {
    throw new Error('URL and CSS selector are required.');
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Please enter a valid full URL (including protocol).');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are supported.');
  }

  return {
    url: parsed.href,
    selector,
    mode,
    refreshIntervalSeconds,
    notificationRepeatCount,
    notificationDelaySeconds,
    increaseOnly: Boolean(input.increaseOnly),
    soundEnabled: Boolean(input.soundEnabled)
  };
}

function clearRefreshTimer() {
  if (runtimeState.refreshTimerId) {
    clearTimeout(runtimeState.refreshTimerId);
    runtimeState.refreshTimerId = null;
  }
}

async function updateMonitoringState(patch) {
  const current = (await getFromStorage(STORAGE_KEYS.state))[STORAGE_KEYS.state] || {};
  const next = { ...current, ...patch };
  await setInStorage({ [STORAGE_KEYS.state]: next });
}

async function setError(message) {
  await setInStorage({ [STORAGE_KEYS.lastError]: message || '' });
}

async function withNotificationDebounce(fn) {
  const now = Date.now();
  if (now - runtimeState.lastNotificationAt < 5000) {
    return;
  }
  runtimeState.lastNotificationAt = now;
  await fn();
}

function isIncreaseOnlyChange(oldValue, newValue) {
  const oldNum = Number(oldValue);
  const newNum = Number(newValue);
  if (Number.isFinite(oldNum) && Number.isFinite(newNum)) {
    return newNum > oldNum;
  }
  return newValue !== oldValue;
}

async function sendNotifications(tabId, config) {
  const repeats = config.notificationRepeatCount;
  const delayMs = config.notificationDelaySeconds * 1000;

  for (let i = 0; i < repeats; i += 1) {
    const notificationId = `tab-element-monitor-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
    try {
      await chrome.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: 'icon.svg',
        title: 'Tab Element Changed',
        message: 'Monitored element content has changed.'
      });
    } catch {
      await setError('Notification failed. Check extension notification permission.');
    }

    if (config.soundEnabled) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'PLAY_SOUND' });
      } catch {
        // Tab may be unavailable or script may not be ready.
      }
    }

    if (i < repeats - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function scheduleRefreshCycle(tabId, config) {
  clearRefreshTimer();

  if (!runtimeState.monitoring || runtimeState.mode !== 'refresh') {
    return;
  }

  const intervalMs = Math.max(60000, config.refreshIntervalSeconds * 1000);
  runtimeState.refreshTimerId = setTimeout(async () => {
    try {
      await chrome.tabs.reload(tabId);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      await chrome.tabs.sendMessage(tabId, {
        type: 'CHECK_NOW',
        payload: {
          url: config.url,
          selector: config.selector
        }
      });
    } catch {
      await stopMonitoring('Tab unavailable. Monitoring stopped.');
      return;
    }

    await scheduleRefreshCycle(tabId, config);
  }, intervalMs);
}

async function ensureTabMatchesUrl(tabId, exactUrl) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || tab.url !== exactUrl) {
    throw new Error('Active tab must match the exact URL before starting.');
  }
}

async function startMonitoring(rawConfig) {
  const config = normalizeConfig(rawConfig);

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab?.id) {
    throw new Error('Could not determine active tab.');
  }

  await ensureTabMatchesUrl(activeTab.id, config.url);

  try {
    await chrome.permissions.request({ origins: [toOriginPattern(config.url)] });
  } catch {
    // Permission request may be unavailable on some flows; activeTab still allows current-tab monitoring.
  }

  clearRefreshTimer();

  runtimeState.monitoring = true;
  runtimeState.tabId = activeTab.id;
  runtimeState.exactUrl = config.url;
  runtimeState.mode = config.mode;
  runtimeState.lastNotificationAt = 0;

  await setInStorage({
    [STORAGE_KEYS.config]: config,
    [STORAGE_KEYS.lastError]: '',
    [STORAGE_KEYS.state]: {
      active: true,
      tabId: activeTab.id,
      mode: config.mode,
      url: config.url
    }
  });

  await chrome.scripting.executeScript({
    target: { tabId: activeTab.id },
    files: ['content.js']
  });

  await chrome.tabs.sendMessage(activeTab.id, {
    type: 'START_MONITOR',
    payload: {
      url: config.url,
      selector: config.selector,
      mode: config.mode
    }
  });

  if (config.mode === 'refresh') {
    await scheduleRefreshCycle(activeTab.id, config);
  }
}

async function stopMonitoring(reason = '') {
  const tabId = runtimeState.tabId;
  clearRefreshTimer();

  runtimeState = {
    monitoring: false,
    tabId: null,
    exactUrl: '',
    mode: DEFAULTS.mode,
    refreshTimerId: null,
    lastNotificationAt: 0
  };

  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'STOP_MONITOR' });
    } catch {
      // No action required if the tab is gone.
    }
  }

  await updateMonitoringState({ active: false, tabId: null });
  if (reason) {
    await setError(reason);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message?.type) {
      sendResponse({ ok: false, error: 'Invalid message type.' });
      return;
    }

    switch (message.type) {
      case 'START_FROM_POPUP': {
        await startMonitoring(message.payload || {});
        sendResponse({ ok: true });
        return;
      }
      case 'STOP_FROM_POPUP': {
        await stopMonitoring('Stopped by user.');
        sendResponse({ ok: true });
        return;
      }
      case 'GET_STATUS': {
        const data = await getFromStorage([
          STORAGE_KEYS.config,
          STORAGE_KEYS.state,
          STORAGE_KEYS.lastValue,
          STORAGE_KEYS.lastError
        ]);
        sendResponse({ ok: true, data });
        return;
      }
      case 'ELEMENT_VALUE': {
        if (!runtimeState.monitoring || sender.tab?.id !== runtimeState.tabId) {
          sendResponse({ ok: true });
          return;
        }

        const config = (await getFromStorage(STORAGE_KEYS.config))[STORAGE_KEYS.config] || DEFAULTS;
        const previousValue = (await getFromStorage(STORAGE_KEYS.lastValue))[STORAGE_KEYS.lastValue];
        const newValue = message.payload?.value;

        if (typeof newValue !== 'string') {
          sendResponse({ ok: true });
          return;
        }

        const firstRun = typeof previousValue !== 'string';
        await setInStorage({ [STORAGE_KEYS.lastValue]: newValue });

        if (firstRun) {
          sendResponse({ ok: true });
          return;
        }

        const changed = config.increaseOnly
          ? isIncreaseOnlyChange(previousValue, newValue)
          : newValue !== previousValue;

        if (changed) {
          await withNotificationDebounce(async () => {
            await sendNotifications(runtimeState.tabId, config);
          });
        }

        sendResponse({ ok: true });
        return;
      }
      case 'ELEMENT_NOT_FOUND': {
        await setError('Element not found after 5 retries. Monitoring stopped.');
        await stopMonitoring();
        sendResponse({ ok: true });
        return;
      }
      case 'PAGE_MISMATCH': {
        await stopMonitoring('Tab navigated away from configured URL. Monitoring stopped.');
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false, error: 'Unsupported message type.' });
    }
  })().catch(async (error) => {
    await setError(error?.message || 'Unexpected error.');
    sendResponse({ ok: false, error: error?.message || 'Unexpected error.' });
  });

  return true;
});
