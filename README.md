# Zellij Sessions Manager

GNOME Shell extension for managing [Zellij](https://github.com/zellij-org/zellij) terminal sessions from the top panel.

![GNOME 49](https://img.shields.io/badge/GNOME-49-blue)
![License GPL-2.0](https://img.shields.io/badge/License-GPL--2.0-green)

![Screenshot](https://github.com/user-attachments/assets/c72066ed-d91a-424e-bc77-b21d7f8650ec)

## Features

- **Session list** — see all Zellij sessions (active, exited, current) in a dropdown menu
- **Smart open** — click a session to focus its existing window, or open a new terminal if none found
- **Delete sessions** — trash icon to kill active or remove exited sessions
- **New session** — quick action to start a fresh Zellij session
- **Auto-refresh** — menu updates every time you open it

## Requirements

- GNOME Shell 49+
- [Zellij](https://github.com/zellij-org/zellij) installed and in `$PATH`
- [Ptyxis](https://gitlab.gnome.org/chergert/ptyxis) terminal (default in GNOME 47+)

## Install

### From GNOME Extensions

Coming soon.

### Manual

```bash
git clone https://github.com/USER/zellij-sessions-manager.git
cd zellij-sessions-manager
mkdir -p ~/.local/share/gnome-shell/extensions/zellij-sessions-manager@darkwing4.dev
cp extension.js metadata.json stylesheet.css LICENSE \
   ~/.local/share/gnome-shell/extensions/zellij-sessions-manager@darkwing4.dev/
```

Restart GNOME Shell (log out/in on Wayland) and enable:

```bash
gnome-extensions enable zellij-sessions-manager@darkwing4.dev
```

## How it works

The extension adds a terminal icon to the panel. Clicking it runs `zellij list-sessions --no-formatting` and builds a popup menu from the output. Clicking a session searches open windows for a matching title (`Zellij (<name>)`) — if found, it focuses that window; otherwise it spawns `ptyxis -- zellij attach <name> -c`.

## License

[GPL-2.0](LICENSE)
