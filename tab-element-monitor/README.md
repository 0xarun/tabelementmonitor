# Tab Element Monitor

Tab Element Monitor is a Microsoft Edge (Chromium) extension that monitors one specific HTML element on one exact URL and alerts you when its text content changes.

## Features

- Manifest V3 architecture.
- Monitors only a user-defined exact URL.
- CSS selector-based element targeting.
- Value normalization (trim + numeric extraction when available).
- Two monitoring modes:
  - **Live Observer Mode** (MutationObserver, default).
  - **Auto Refresh Mode** (reload + delayed check).
- Optional **increase-only** notifications.
- Configurable notification repeat count and delay.
- Optional built-in sound alert (placeholder `sound.mp3` included; replace with real audio if desired).
- Read-only behavior (does not modify page DOM).
- Minimal extension permissions.

## Installation (Edge Developer Mode)

1. Open Microsoft Edge.
2. Go to `edge://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the `tab-element-monitor` folder.

## How to find a CSS selector (Inspect Element)

1. Open the target page in Edge.
2. Right-click the element to monitor.
3. Select **Inspect**.
4. In DevTools, right-click the highlighted node.
5. Choose **Copy > Copy selector**.
6. Paste selector into extension popup.

## Usage Workflow

1. Open your target page tab and ensure the URL exactly matches what you will enter.
2. Open the extension popup.
3. Enter:
   - Full URL
   - CSS selector
   - Mode (Live / Refresh)
   - Refresh interval (if Refresh mode; min 60s)
   - Notification repeat count and delay
   - Optional increase-only mode
   - Optional sound
4. Click **Start Monitoring**.
5. Keep the tab open. The popup can be closed; monitoring continues.
6. Click **Stop Monitoring** anytime to stop.

## Troubleshooting

- **"Active tab must match the exact URL"**
  - Make sure the active tab URL exactly equals the configured URL.
- **Element not found error**
  - Verify selector correctness.
  - The extension retries 5 times every 5 seconds, then stops gracefully.
- **No notification shown**
  - Check Edge notification settings and extension notification permission.
- **No sound played**
  - Browser autoplay policy may block audio in some cases.

## Safety Note

This extension is read-only:

- It does not alter page content.
- It does not inject DOM changes.
- It only reads `innerText` from the monitored element.

## Uninstall

1. Open `edge://extensions`.
2. Find **Tab Element Monitor**.
3. Click **Remove**.
