import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
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

        if (!output) {
            this._addDisabledItem('No sessions');
            return;
        }

        for (const line of output.split('\n')) {
            const name = line.split(' ')[0];
            if (!name) continue;

            const isCurrent = line.includes('(current)');
            const isExited = line.includes('EXITED');
            this._addSessionItem(name, {isCurrent, isExited});
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const newItem = new PopupMenu.PopupMenuItem('New Session\u2026');
        newItem.connect('activate', () => this._spawnTerminal(['zellij']));
        this.menu.addMenuItem(newItem);
    }

    _addSessionItem(name, {isCurrent, isExited}) {
        const item = new PopupMenu.PopupBaseMenuItem();

        const suffix = isExited ? '  (exited)' : isCurrent ? '  (current)' : '';
        const label = new St.Label({
            text: `${name}${suffix}`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        if (isExited) label.style_class = 'zellij-session-exited';
        else if (isCurrent) label.style_class = 'zellij-session-current';

        item.add_child(label);

        const editBtn = new St.Button({
            child: new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 14}),
            style_class: 'zellij-edit-button',
            reactive: true,
        });

        editBtn.connect('clicked', () => {
            this._startRenaming(item, label, name, editBtn, deleteBtn);
            return Clutter.EVENT_STOP;
        });

        item.add_child(editBtn);

        const deleteBtn = new St.Button({
            child: new St.Icon({icon_name: 'user-trash-symbolic', icon_size: 14}),
            style_class: 'zellij-delete-button',
            reactive: true,
        });

        deleteBtn.connect('clicked', () => {
            this._deleteSession(name, isExited ? 'delete-session' : 'kill-session');
            return Clutter.EVENT_STOP;
        });

        item.add_child(deleteBtn);
        item.connect('activate', () => this._openSession(name));
        this.menu.addMenuItem(item);
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

    _startRenaming(item, label, name, editBtn, deleteBtn) {
        item.hide();

        const menuItems = this.menu._getMenuItems();
        const position = menuItems.indexOf(item);

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
        this.menu.addMenuItem(renameItem, position);

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

    _spawnTerminal(args, title) {
        const cmd = ['ptyxis'];
        if (title) cmd.push('--title', title);
        cmd.push('--', ...args);

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
