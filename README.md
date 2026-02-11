# Jupyter ntfy

![License](https://img.shields.io/badge/license-MIT-green)

Get [ntfy.sh](https://ntfy.sh) push notifications when Jupyter notebook cells finish running. Useful for long-running cells — get notified on your phone, desktop, or any device.

---

## Preview

![Extension Preview](assets/screenshot.png)

---

## Features

- Bell icon in each cell's toolbar to toggle notifications
- Push notifications via [ntfy.sh](https://ntfy.sh) when cells complete or fail
- Markdown-formatted messages with cell input and output
- In-editor popup notifications with "Go to Cell" and "Disable Notifications" actions
- Persistent toggles — bell states are saved to notebook metadata and restored on reopen

---

## Requirements

- VS Code 1.74+
- [Jupyter](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) extension for VS Code

---

## Installation

### From the Marketplace

1. Open **Extensions** (`Ctrl+Shift+X`)
2. Search for **"Jupyter ntfy"**
3. Click **Install**

---

## Setup

1. Install the [ntfy app](https://ntfy.sh) on your phone or subscribe to a topic at [ntfy.sh](https://ntfy.sh)
2. Pick a unique, hard-to-guess topic name (e.g. `my-jupyter-x7k2m9`)
3. In VS Code, open **Settings** and search for `jupyter-ntfy`
4. Set your topic name
5. Open a Jupyter notebook, click the bell icon on a cell, and run it

---

## Settings

| Setting | Description | Default |
|---|---|---|
| `jupyter-ntfy.topic` | ntfy topic name | `""` |
| `jupyter-ntfy.priority` | Notification priority (1=min, 3=default, 5=max) | `3` |

---

## How it works

When a cell with notifications enabled finishes executing, the extension:

1. Shows a VS Code notification with the result
2. Sends a POST request to `https://ntfy.sh/<your-topic>` with:
   - **Title**: `filename.ipynb - Cell N finished` (or `failed`)
   - **Body**: Markdown-formatted cell input and output
   - **Tags**: checkmark or X emoji based on success/failure

---

## Privacy

- **No backend server** — notifications are sent directly from VS Code to ntfy.sh
- **No accounts or credentials** — ntfy.sh topics are open by default; pick a topic name that is hard to guess
- **No telemetry** — the extension does not collect or transmit any data beyond the ntfy notification itself

---

## License

MIT — forked from [Jupyter Cell Notifier](https://github.com/ckm3/jupyter-cell-notifier) by Kaiming Cui.
