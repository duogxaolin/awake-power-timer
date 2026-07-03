# Awake & Power Timer

A cross-platform native desktop app built with **Tauri v2** (Rust backend) and **React + Vite + TypeScript + Tailwind CSS**.

Keep your screen and system awake, schedule power actions (shutdown, restart, sleep, hibernate), and manage everything from a clean system tray / menu bar interface.

## Features

- **Keep Awake**: prevent display sleep, system sleep, or both. Timer presets (5m, 10m, 30m, 1h, custom, indefinite).
- **Power Timer**: schedule shutdown, restart, sleep, or hibernate after a countdown.
- **Schedule**: schedule a power action for a specific time of day.
- **System Tray / Menu Bar**: toggle keep awake, quick timers, open window, quit. Left-click shows/hides the window.
- **Notifications**: start, end, 1-minute warning, and cancellation notifications.
- **Global Hotkey**: `Ctrl+Shift+A` / `Cmd+Shift+A` toggles keep awake.
- **Autostart**: launch on login (desktop platforms).
- **Settings**: dark/light/system theme, language (English / Vietnamese), default keep-awake mode, notifications.
- **CI/CD**: GitHub Actions builds for Windows, macOS, and Linux.

## Platforms

- Windows (MSI, NSIS)
- macOS (DMG, App)
- Linux (AppImage, deb, rpm)
- AUR package instructions included for Arch / CachyOS.

## Tech Stack

- **Tauri v2** (`src-tauri/`)
- **React 19**, **Vite**, **TypeScript**
- **Tailwind CSS**, **Radix UI** primitives, **Lucide** icons
- **Rust crates**: `keepawake`, `system_shutdown`, `tokio`, `serde`, `zbus` (Linux D-Bus)
- **Tauri plugins**: `autostart`, `global-shortcut`, `notification`, `shell`, `store`, `log`

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/) (stable)
- Windows: [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- macOS: Xcode Command Line Tools
- Linux: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev` (Ubuntu/Debian)

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run tauri:dev
```

### Type-check / lint

```bash
npm run typecheck
npm run lint
```

### Rust checks

```bash
cd src-tauri
cargo check
cargo clippy
```

## Building

Build native packages for the current platform:

```bash
npm run tauri:build
```

Output bundles will be in `src-tauri/target/release/bundle/`.

## Packaging

### GitHub Actions

The included workflow (`.github/workflows/release.yml`) builds the app for Windows, macOS, and Linux on every push of a version tag `v*`. Artifacts and draft releases are created automatically using the official [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action).

To trigger a release:

```bash
git tag v0.1.0
git push origin v0.1.0
```

### AUR (Arch / CachyOS)

See [`aur/PKGBUILD`](./aur/PKGBUILD) and [`aur/README.md`](./aur/README.md) for building and installing from the Arch User Repository.

## Known Limitations

- **Scheduled power actions** currently use an in-app background timer that triggers `system_shutdown` when the countdown ends. This works on all platforms but is not yet OS-native scheduling (e.g., `shutdown /s /t` on Windows, `shutdown -h +m` on macOS, or `org.freedesktop.login1.Manager.ScheduleShutdown` on Linux). OS-native scheduling is planned for a future release.
- **Tray icon active state** is shown via tooltip updates. A dedicated active/inactive icon overlay is planned.
- **Linux sleep/hibernate** may require the user to be in the `power` group or have permission to call `system_shutdown`.

## License

[MIT](./LICENSE)

## Repository

https://github.com/duogxaolin/awake-power-timer
