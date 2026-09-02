import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const ZellijSessionsIndicator = GObject.registerClass(
class ZellijSessionsIndicator extends PanelMenu.Button {

    _init(extensionPath, settings) {
        this._settings = settings;
        super._init(0.5, 'Zellij Sessions');

        this.style_class = 'zellij-panel-button';

        const gicon = Gio.icon_new_for_string(`${extensionPath}/logo.png`);
        this.add_child(new St.Icon({
            gicon,
            style_class: 'zellij-panel-icon',
        }));

        this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Loading...'));
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) this._refreshSessions();
            else this._endDrag();
        });
    }

    _refreshSessions() {
        this.menu.removeAll();
        this._addDisabledItem('Loading...');

        try {
            const proc = Gio.Subprocess.new(
                ['zellij', 'list-sessions', '--no-formatting'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (_proc, result) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(result);
                    this._buildMenu(stdout.trim());
                } catch (e) {
                    this.menu.removeAll();
                    this._addDisabledItem('Failed to list sessions');
                }
            });
        } catch (e) {
            this.menu.removeAll();
            this._addDisabledItem('Zellij not found');
        }
    }

    _buildMenu(output) {
        this.menu.removeAll();

        const sessions = this._parseSessions(output);
        const pinnedNames = this._settings.get_strv('pinned-sessions');
        const byName = new Map(sessions.map(s => [s.name, s]));
        const pinned = pinnedNames.map(name => byName.get(name)).filter(s => s !== undefined);
        const others = sessions
            .filter(s => !pinnedNames.includes(s.name))
            .sort((a, b) => {
                if (a.isExited !== b.isExited) return a.isExited ? 1 : -1;
                return a.name.localeCompare(b.name);
            });

        const listSection = this._addScrollableSection();

        this._pinnedSection = new PopupMenu.PopupMenuSection();
        listSection.addMenuItem(this._pinnedSection);
        for (const session of pinned)
            this._addSessionItem(this._pinnedSection, session, true);

        if (pinned.length > 0 && others.length > 0)
            listSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const otherSection = new PopupMenu.PopupMenuSection();
        listSection.addMenuItem(otherSection);
        for (const session of others)
            this._addSessionItem(otherSection, session, false);

        if (sessions.length === 0) {
            const empty = new PopupMenu.PopupMenuItem('No sessions');
            empty.setSensitive(false);
            listSection.addMenuItem(empty);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const newItem = new PopupMenu.PopupMenuItem('New Session\u2026');
        newItem.connect('activate', () => this._openFolderPicker());
        this.menu.addMenuItem(newItem);
    }

    _parseSessions(output) {
        const sessions = [];
        if (!output) return sessions;

        for (const line of output.split('\n')) {
            const trimmed = line.replace(/\s+$/, '');
            if (!trimmed) continue;

            const bracketIdx = trimmed.search(/\s\[/);
            const name = bracketIdx > 0 ? trimmed.slice(0, bracketIdx) : trimmed;
            if (!name) continue;

            sessions.push({
                name,
                isCurrent: trimmed.includes('(current)'),
                isExited: trimmed.includes('EXITED'),
            });
        }
        return sessions;
    }

    _addScrollableSection() {
        const scrollView = new St.ScrollView({
            style_class: 'zellij-session-scroll',
            y_expand: true,
        });
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        const listSection = new PopupMenu.PopupMenuSection();
        scrollView.set_child(listSection.actor);

        const monitor = Main.layoutManager.findMonitorForActor(this);
        if (monitor)
            scrollView.style = `max-height: ${Math.round(monitor.height * 0.6)}px;`;

        const wrapper = new PopupMenu.PopupMenuSection();
        wrapper.actor.add_child(scrollView);
        this.menu.addMenuItem(wrapper);

        return listSection;
    }

    _addSessionItem(section, {name, isCurrent, isExited}, isPinned) {
        const item = new PopupMenu.PopupBaseMenuItem();
        item._sessionName = name;
        item._section = section;

        if (isPinned) {
            const dragHandle = new St.Button({
                child: new St.Icon({icon_name: 'list-drag-handle-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER}),
                style_class: 'zellij-drag-handle',
                reactive: true,
                can_focus: false,
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
            });

            dragHandle.connect('button-press-event', (_actor, event) => {
                this._beginDrag(item, dragHandle, event);
                return Clutter.EVENT_STOP;
            });

            item.add_child(dragHandle);
        }

        const suffix = isExited ? '  (exited)' : isCurrent ? '  (current)' : '';
        const label = new St.Label({
            text: `${name}${suffix}`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        if (isExited) label.style_class = 'zellij-session-exited';
        else if (isCurrent) label.style_class = 'zellij-session-current';

        item.add_child(label);

        const pinBtn = new St.Button({
            child: new St.Icon({icon_name: 'view-pin-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER}),
            style_class: isPinned ? 'zellij-pin-button zellij-pin-button-active' : 'zellij-pin-button',
            reactive: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        pinBtn.connect('clicked', () => {
            this._togglePin(name);
            return Clutter.EVENT_STOP;
        });

        item.add_child(pinBtn);

        const editBtn = new St.Button({
            child: new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER}),
            style_class: 'zellij-edit-button',
            reactive: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        editBtn.connect('clicked', () => {
            this._startRenaming(item, label, name);
            return Clutter.EVENT_STOP;
        });

        item.add_child(editBtn);

        const deleteBtn = new St.Button({
            child: new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER}),
            style_class: 'zellij-delete-button',
            reactive: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        deleteBtn.connect('clicked', () => {
            this._deleteSession(name, isExited ? 'delete-session' : 'kill-session');
            return Clutter.EVENT_STOP;
        });

        item.add_child(deleteBtn);
        item.connect('activate', () => this._openSession(name));
        section.addMenuItem(item);
    }

    _togglePin(name) {
        const pinned = this._settings.get_strv('pinned-sessions');
        const idx = pinned.indexOf(name);

        if (idx >= 0) pinned.splice(idx, 1);
        else pinned.push(name);

        this._settings.set_strv('pinned-sessions', pinned);
        this._refreshSessions();
    }

    _beginDrag(item, handle, event) {
        if (this._drag) return;

        const box = this._pinnedSection.box;
        if (box.get_children().length < 2) return;

        item.add_style_class_name('zellij-dragging');

        this._drag = {
            item,
            handle,
            grab: global.stage.grab(handle),
            motionId: handle.connect('motion-event', (_actor, motionEvent) => {
                this._updateDragPosition(item, motionEvent);
                return Clutter.EVENT_STOP;
            }),
            releaseId: handle.connect('button-release-event', () => {
                this._endDrag();
                return Clutter.EVENT_STOP;
            }),
        };
    }

    _updateDragPosition(item, event) {
        const box = this._pinnedSection.box;
        const [stageX, stageY] = event.get_coords();
        const [transformed, , localY] = box.transform_stage_point(stageX, stageY);
        if (!transformed) return;

        const children = box.get_children();
        let target = children.length - 1;
        for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (localY < child.y + child.height / 2) {
                target = i;
                break;
            }
        }

        if (children.indexOf(item) !== target)
            this._pinnedSection.moveMenuItem(item, target);
    }

    _endDrag() {
        if (!this._drag) return;

        const {item, handle, grab, motionId, releaseId} = this._drag;
        this._drag = null;

        handle.disconnect(motionId);
        handle.disconnect(releaseId);
        grab.dismiss();
        item.remove_style_class_name('zellij-dragging');

        this._savePinnedOrder();
    }

    _savePinnedOrder() {
        const shown = this._pinnedSection.box.get_children()
            .map(child => child._sessionName)
            .filter(name => name);
        const hidden = this._settings.get_strv('pinned-sessions')
            .filter(name => !shown.includes(name));

        this._settings.set_strv('pinned-sessions', [...shown, ...hidden]);
    }

    _addDisabledItem(text) {
        const item = new PopupMenu.PopupMenuItem(text);
        item.setSensitive(false);
        this.menu.addMenuItem(item);
    }

    _openSession(name) {
        const win = this._findSessionWindow(name);
        if (win) {
            const ws = win.get_workspace();
            if (ws) ws.activate(global.get_current_time());
            win.activate(global.get_current_time());
            return;
        }

        this._spawnTerminal(['zellij', 'attach', name, '-c'], name);
    }

    _deleteSession(name, cmd) {
        this._forgetPinned(name);

        try {
            const proc = Gio.Subprocess.new(
                ['zellij', cmd, name],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_async(null, () => this._refreshSessions());
        } catch (e) {
            console.error(`ZellijSessions: failed to ${cmd} "${name}": ${e.message}`);
        }
    }

    _startRenaming(item, label, name) {
        item.hide();

        const section = item._section;
        const position = section._getMenuItems().indexOf(item);

        const renameItem = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            reactive: false,
            can_focus: false,
            hover: false,
        });

        const entry = new St.Entry({
            text: name,
            x_expand: true,
            can_focus: true,
            reactive: true,
            style_class: 'zellij-rename-entry',
        });

        const confirmBtn = new St.Button({
            child: new St.Icon({icon_name: 'object-select-symbolic', icon_size: 14}),
            style_class: 'zellij-confirm-button',
            reactive: true,
        });

        const cancelBtn = new St.Button({
            child: new St.Icon({icon_name: 'process-stop-symbolic', icon_size: 14}),
            style_class: 'zellij-cancel-button',
            reactive: true,
        });

        renameItem.add_child(entry);
        renameItem.add_child(confirmBtn);
        renameItem.add_child(cancelBtn);
        section.addMenuItem(renameItem, position);

        const clutterText = entry.clutter_text;
        clutterText.activatable = true;
        global.stage.set_key_focus(clutterText);
        clutterText.set_selection(0, entry.get_text().length);

        let finished = false;
        const finish = (newName) => {
            if (finished) return;
            finished = true;

            if (this._menuCloseId) {
                this.menu.disconnect(this._menuCloseId);
                this._menuCloseId = null;
            }

            renameItem.destroy();
            item.show();

            if (newName && newName !== name) {
                label.text = newName;
                this._renameSession(name, newName);
            }
        };

        clutterText.connect('activate', () => {
            finish(entry.get_text().trim());
        });

        clutterText.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        confirmBtn.connect('clicked', () => {
            finish(entry.get_text().trim());
            return Clutter.EVENT_STOP;
        });

        cancelBtn.connect('clicked', () => {
            finish(null);
            return Clutter.EVENT_STOP;
        });

        this._menuCloseId = this.menu.connect('open-state-changed', (_menu, open) => {
            if (!open) finish(null);
        });
    }

    _renameSession(oldName, newName) {
        const pinned = this._settings.get_strv('pinned-sessions');
        const idx = pinned.indexOf(oldName);
        if (idx >= 0) {
            pinned[idx] = newName;
            this._settings.set_strv('pinned-sessions', pinned);
        }

        try {
            const proc = Gio.Subprocess.new(
                ['zellij', '-s', oldName, 'action', 'rename-session', newName],
                Gio.SubprocessFlags.NONE
            );
            proc.wait_async(null, () => this._refreshSessions());
        } catch (e) {
            console.error(`ZellijSessions: failed to rename "${oldName}" to "${newName}": ${e.message}`);
        }
    }

    _forgetPinned(name) {
        const pinned = this._settings.get_strv('pinned-sessions');
        const idx = pinned.indexOf(name);
        if (idx < 0) return;

        pinned.splice(idx, 1);
        this._settings.set_strv('pinned-sessions', pinned);
    }

    _findSessionWindow(sessionName) {
        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            const wmClass = (win.get_wm_class() || '').toLowerCase();

            const terminalClasses = this._settings.get_strv('terminal-wm-classes');
            if (!terminalClasses.some(cls => wmClass.includes(cls))) continue;

            const title = win.get_title() || '';
            if (title.includes(`Zellij (${sessionName})`)) return win;
            if (title === sessionName) return win;
        }
        return null;
    }

    _openFolderPicker() {
        try {
            const proc = Gio.Subprocess.new(
                ['zenity', '--file-selection', '--directory', '--title=Select Session Folder'],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );

            proc.communicate_utf8_async(null, null, (_proc, result) => {
                try {
                    const [, stdout] = proc.communicate_utf8_finish(result);
                    if (proc.get_exit_status() !== 0) return;

                    const folderPath = stdout.trim();
                    if (!folderPath) return;

                    const folderName = GLib.path_get_basename(folderPath);
                    this._spawnTerminal(['zellij', 'attach', folderName, '-c'], folderName, folderPath);
                } catch (e) {
                    console.error(`ZellijSessions: folder picker error: ${e.message}`);
                }
            });
        } catch (e) {
            console.error(`ZellijSessions: failed to open folder picker: ${e.message}`);
        }
    }

    _spawnTerminal(args, title, workingDirectory) {
        const template = this._settings.get_strv('terminal-argv');
        const cmd = [];

        for (const part of template) {
            if (part === '{cmd}') {
                cmd.push(...args);
                continue;
            }
            let s = part;
            if (s.includes('{cwd}')) {
                if (!workingDirectory) continue;
                s = s.replaceAll('{cwd}', workingDirectory);
            }
            if (s.includes('{title}')) {
                if (!title) continue;
                s = s.replaceAll('{title}', title);
            }
            cmd.push(s);
        }

        try {
            Gio.Subprocess.new(cmd, Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.error(`ZellijSessions: failed to spawn terminal: ${e.message}`);
        }
    }
});

export default class ZellijSessionsExtension extends Extension {

    enable() {
        this._settings = this.getSettings();
        this._indicator = new ZellijSessionsIndicator(this.path, this._settings);
        Main.panel.addToStatusArea('zellij-sessions-manager', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}
