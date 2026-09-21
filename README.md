# TimeCheck Attendance Reminder
Work schedule check-in/check-out reminder application built with Wails v3, featuring system tray integration and GNOME Shell lock/logout interception.

---

## System Requirements & Dependencies

Because TimeCheck uses native Linux GUI toolkits, the required libraries depend on your Ubuntu version:

### 🟢 Ubuntu 24.04 LTS (Noble) & Newer (GTK 4)

Ubuntu 24.04+ includes GTK 4.14+ and WebKitGTK 6.0.

#### 1. Runtime Dependencies (To run the app / release binary):
```bash
sudo apt update
sudo apt install libgtk-4-1 libwebkitgtk-6.0-4 libnotify-bin
```

#### 2. Build Dependencies (To build from source):
```bash
sudo apt update
sudo apt install build-essential pkg-config libgtk-4-dev libwebkitgtk-6.0-dev libnotify-dev
```

---

### 🟡 Ubuntu 22.04 LTS (Jammy) & Debian 12 (GTK 3)

Ubuntu 22.04 includes GTK 4.6 (which lacks newer GTK 4.14+ symbols). Use the **GTK 3** build (`timecheck-22` or `timecheck-ubuntu-22.04-amd64`).

#### 1. Runtime Dependencies (To run the app / release binary):
```bash
sudo apt update
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libnotify-bin
```

#### 2. Build Dependencies (To build from source):
```bash
sudo apt update
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libnotify-dev
```

---

## Running Release Binaries

Download the appropriate binary for your system from the [Releases](../../releases) page:

* **For Ubuntu 24.04+**: `timecheck-ubuntu-24.04-amd64` (or `timecheck-24`)
* **For Ubuntu 22.04 / Debian**: `timecheck-ubuntu-22.04-amd64` (or `timecheck-22`)

Make it executable and run:
```bash
chmod +x timecheck-*
./timecheck-*
```

---

## Development & Building from Source

### Prerequisites
- [Go 1.24+](https://go.dev/doc/install)
- [Node.js 20+](https://nodejs.org/) & npm
- [Task](https://taskfile.dev/installation/) (`go install github.com/go-task/task/v3/cmd/task@latest`)
- [Wails v3 CLI](https://wails.io/) (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`)

### Commands

* **Live Development Mode**:
  ```bash
  task dev
  ```
  *(Starts hot-reload Vite server and Wails backend)*

* **Build for Ubuntu 24.04+ (GTK 4)**:
  ```bash
  task build:ubuntu-24
  # Output: bin/timecheck-24
  ```

* **Build for Ubuntu 22.04 / Debian 12 (GTK 3)**:
  ```bash
  task build:ubuntu-22
  # Output: bin/timecheck-22
  ```

* **Default Build**:
  ```bash
  task build
  # Output: bin/timecheck
  ```

