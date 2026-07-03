# AUR package for Awake & Power Timer

This directory contains the `PKGBUILD` for installing `awake-power-timer` from the Arch User Repository (AUR).

## Install with an AUR helper

```bash
yay -S awake-power-timer-bin
# or
paru -S awake-power-timer-bin
```

## Build and install manually

```bash
git clone https://aur.archlinux.org/awake-power-timer-bin.git
cd awake-power-timer-bin
makepkg -si
```

## Update

```bash
cd awake-power-timer-bin
git pull
makepkg -si
```

## Notes

- The binary package is built from the official `.deb` release artifacts published on GitHub Releases.
- For the first AUR submission, create the package repository on https://aur.archlinux.org and upload the `PKGBUILD` and `.SRCINFO`.
- You can generate `.SRCINFO` with `makepkg --printsrcinfo > .SRCINFO`.
