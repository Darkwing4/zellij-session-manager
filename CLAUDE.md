# Zellij Sessions Manager — GNOME Shell Extension

## Debug & Development

### Nested GNOME Shell (Wayland)

Запуск изолированной сессии GNOME Shell в окне — расширение тестируется без влияния на основной десктоп:

```bash
# GNOME 49+
dbus-run-session gnome-shell --devkit --wayland

# GNOME 48 и ранее
dbus-run-session gnome-shell --nested --wayland

# С расширенным debug-выводом
export G_MESSAGES_DEBUG=all
export SHELL_DEBUG=all
dbus-run-session gnome-shell --devkit --wayland
```

### Looking Glass (встроенный REPL)

`Alt+F2` → `lg` → Enter — открывает инспектор/консоль прямо в GNOME Shell. Вкладка Evaluator — JS REPL в контексте текущего процесса gnome-shell.

### Логи

```bash
# Стрим логов gnome-shell (console.log/warn/error из расширений)
journalctl /usr/bin/gnome-shell -f -o cat
```

### Установка расширения для разработки

```bash
# Симлинк в директорию расширений
ln -s "$(pwd)" ~/.local/share/gnome-shell/extensions/zellij-sessions-manager@darkwing4.dev
```

### Перезагрузка расширения

На Wayland нельзя перезапустить gnome-shell (`Alt+F2` → `restart` только X11). Варианты:
- Выключить/включить: `gnome-extensions disable zellij-sessions-manager@darkwing4.dev && gnome-extensions enable zellij-sessions-manager@darkwing4.dev`
- Использовать nested сессию (см. выше)
