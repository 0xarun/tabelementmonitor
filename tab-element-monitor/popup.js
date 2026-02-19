const fields = {
  url: document.getElementById('url'),
  selector: document.getElementById('selector'),
  mode: document.getElementById('mode'),
  refreshIntervalSeconds: document.getElementById('refreshIntervalSeconds'),
  notificationRepeatCount: document.getElementById('notificationRepeatCount'),
  notificationDelaySeconds: document.getElementById('notificationDelaySeconds'),
  increaseOnly: document.getElementById('increaseOnly'),
  soundEnabled: document.getElementById('soundEnabled'),
  startBtn: document.getElementById('startBtn'),
  stopBtn: document.getElementById('stopBtn'),
  status: document.getElementById('status'),
  lastValue: document.getElementById('lastValue'),
  error: document.getElementById('error')
};

function showError(message = '') {
  fields.error.textContent = message;
}

function setStatus(active) {
  fields.status.textContent = active ? 'Active' : 'Stopped';
}

function readForm() {
  return {
    url: fields.url.value.trim(),
    selector: fields.selector.value.trim(),
    mode: fields.mode.value,
    refreshIntervalSeconds: Number(fields.refreshIntervalSeconds.value),
    notificationRepeatCount: Number(fields.notificationRepeatCount.value),
    notificationDelaySeconds: Number(fields.notificationDelaySeconds.value),
    increaseOnly: fields.increaseOnly.checked,
    soundEnabled: fields.soundEnabled.checked
  };
}

function fillForm(config = {}) {
  fields.url.value = config.url || '';
  fields.selector.value = config.selector || '';
  fields.mode.value = config.mode || 'live';
  fields.refreshIntervalSeconds.value = config.refreshIntervalSeconds || 60;
  fields.notificationRepeatCount.value = config.notificationRepeatCount || 1;
  fields.notificationDelaySeconds.value = config.notificationDelaySeconds || 5;
  fields.increaseOnly.checked = Boolean(config.increaseOnly);
  fields.soundEnabled.checked = config.soundEnabled !== false;
}

async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!response?.ok) {
      showError(response?.error || 'Failed to load extension status.');
      return;
    }

    const { monitorConfig, monitorState, lastValue, lastError } = response.data;
    fillForm(monitorConfig);
    setStatus(Boolean(monitorState?.active));
    fields.lastValue.textContent = typeof lastValue === 'string' ? lastValue : 'N/A';
    showError(lastError || '');
  } catch {
    showError('Could not communicate with background service worker.');
  }
}

fields.startBtn.addEventListener('click', async () => {
  showError('');
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'START_FROM_POPUP',
      payload: readForm()
    });

    if (!response?.ok) {
      showError(response?.error || 'Unable to start monitoring.');
      return;
    }

    await loadStatus();
  } catch {
    showError('Start failed. Ensure the target tab is active and URL is exact.');
  }
});

fields.stopBtn.addEventListener('click', async () => {
  showError('');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'STOP_FROM_POPUP' });
    if (!response?.ok) {
      showError(response?.error || 'Unable to stop monitoring.');
      return;
    }
    await loadStatus();
  } catch {
    showError('Stop failed.');
  }
});

loadStatus();
