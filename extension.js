import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const TITLE_SEPARATORS = [' | ', ' — ', ' - ', ': '];

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

        this._sessions = [];
        this._searchText = '';
        this._searchHistory = [];

        this._addDisabledItem('Loading...');
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._resetSearch();
                this._refreshSessions();
            } else {
                this._endDrag();
                this._cancelRename?.();
            }
        });
        const onKeyPress = (_actor, event) => this._onMenuKeyPress(event);
        this.menu.actor.connect('key-press-event', onKeyPress);
        this.connect('key-press-event', onKeyPress);
    }

    _onMenuKeyPress(event) {
        if (!this.menu.isOpen) return Clutter.EVENT_PROPAGATE;

        if (this._searchEntry && global.stage.get_key_focus() === this._searchEntry.clutter_text)
            return Clutter.EVENT_PROPAGATE;

        const state = event.get_state();
        const controlHeld = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const altHeld = (state & Clutter.ModifierType.MOD1_MASK) !== 0;

        if (controlHeld && !altHeld && event.get_key_symbol() === Clutter.KEY_z) {
            if (this._searchHistory.length === 0) return Clutter.EVENT_PROPAGATE;

            this._showSearch(this._searchHistory.pop());
            return Clutter.EVENT_STOP;
        }

        if (controlHeld || altHeld) return Clutter.EVENT_PROPAGATE;

        const unicode = event.get_unicode_value();
        if (unicode < 32 || unicode === 127) return Clutter.EVENT_PROPAGATE;

        this._showSearch(this._searchText + String.fromCodePoint(unicode));
        return Clutter.EVENT_STOP;
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
        this._searchItem = null;
        this._searchEntry = null;

        this._sessions = this._parseSessions(output);
        this._listSection = this._addScrollableSection();
        this._renderSessions();

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const newItem = new PopupMenu.PopupMenuItem('New Session…');
        newItem.connect('activate', () => this._openFolderPicker());
        this.menu.addMenuItem(newItem);

        if (this._searchText) this._showSearch(this._searchText);
    }

    _renderSessions() {
        this._listSection.removeAll();

        const filter = this._searchText.toLowerCase();
        const matching = filter
            ? this._sessions.filter(s => s.name.toLowerCase().includes(filter))
            : this._sessions;

        const pinnedNames = this._settings.get_strv('pinned-sessions');
        const byName = new Map(matching.map(s => [s.name, s]));
        const pinned = pinnedNames.map(name => byName.get(name)).filter(s => s !== undefined);
        const others = matching
            .filter(s => !pinnedNames.includes(s.name))
            .sort((a, b) => {
                if (a.isExited !== b.isExited) return a.isExited ? 1 : -1;
                return a.name.localeCompare(b.name);
            });

        this._pinnedSection = new PopupMenu.PopupMenuSection();
        this._listSection.addMenuItem(this._pinnedSection);
        for (const session of pinned)
            this._addSessionItem(this._pinnedSection, session, true, !filter);

        if (pinned.length > 0 && others.length > 0)
            this._listSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const otherSection = new PopupMenu.PopupMenuSection();
        this._listSection.addMenuItem(otherSection);
        for (const session of others)
            this._addSessionItem(otherSection, session, false, false);

        if (matching.length === 0)
            this._addDisabledItem(filter ? 'No matches' : 'No sessions', this._listSection);
    }

    _parseSessions(output) {
        const sessions = [];

        for (const line of output.split('\n')) {
            const trimmed = line.trimEnd();
            if (!trimmed) continue;

            const bracketIdx = trimmed.search(/\s\[/);
            const name = bracketIdx > 0 ? trimmed.slice(0, bracketIdx) : trimmed;

            sessions.push({
                name,
                isCurrent: trimmed.includes('(current)'),
                isExited: trimmed.includes('EXITED'),
            });
        }
        return sessions;
    }

    _resetSearch() {
        this._searchText = '';
        this._searchHistory = [];
        this._searchEditKind = null;
    }

    _showSearch(text) {
        if (!text) return;

        if (!this._searchEntry) this._createSearchItem();

        this._searchItem.show();
        this._setSearchText(text);

        const clutterText = this._searchEntry.clutter_text;
        global.stage.set_key_focus(clutterText);
        clutterText.set_selection(text.length, text.length);
    }

    _createSearchItem() {
        const item = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            reactive: false,
            can_focus: false,
            hover: false,
        });

        const entry = new St.Entry({
            x_expand: true,
            can_focus: true,
            reactive: true,
            style_class: 'zellij-search-entry',
            primary_icon: new St.Icon({icon_name: 'edit-find-symbolic', icon_size: 14}),
        });

        item.add_child(entry);
        this.menu.addMenuItem(item, 0);

        entry.clutter_text.connect('text-changed', () => this._onSearchChanged());
        entry.clutter_text.connect('key-press-event', (_actor, event) => {
            const controlHeld = (event.get_state() & Clutter.ModifierType.CONTROL_MASK) !== 0;
            if (controlHeld && event.get_key_symbol() === Clutter.KEY_z) {
                this._undoSearch();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._searchItem = item;
        this._searchEntry = entry;
    }

    _setSearchText(text) {
        this._applyingSearchText = true;
        this._searchEntry.set_text(text);
        this._applyingSearchText = false;

        this._searchText = text;
        this._renderSessions();
    }

    _onSearchChanged() {
        if (this._applyingSearchText) return;

        const text = this._searchEntry.get_text();
        const kind = text.length >= this._searchText.length ? 'insert' : 'delete';

        if (kind !== this._searchEditKind) {
            this._searchHistory.push(this._searchText);
            this._searchEditKind = kind;
        }

        this._searchText = text;

        if (text) this._renderSessions();
        else this._hideSearch();
    }

    _hideSearch() {
        this._searchText = '';
        this._searchEditKind = null;

        this._searchItem?.hide();
        this._renderSessions();
        global.stage.set_key_focus(this.menu.actor);
    }

    _undoSearch() {
        if (this._searchHistory.length === 0) return;

        const text = this._searchHistory.pop();
        this._searchEditKind = null;

        if (!text) {
            this._setSearchText('');
            this._hideSearch();
            return;
        }

        this._setSearchText(text);
        this._searchEntry.clutter_text.set_selection(text.length, text.length);
    }

    _addScrollableSection() {
        const scrollView = new St.ScrollView({y_expand: true});
        scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);

        const listSection = new PopupMenu.PopupMenuSection();
        scrollView.set_child(listSection.actor);

        const monitor = Main.layoutManager.findMonitorForActor(this) ?? Main.layoutManager.primaryMonitor;
        scrollView.style = `max-height: ${Math.round(monitor.height * 0.6)}px;`;

        const wrapper = new PopupMenu.PopupMenuSection();
        wrapper.actor.add_child(scrollView);
        this.menu.addMenuItem(wrapper);

        return listSection;
    }

    _iconButton(iconName, styleClass, extraProps = {}) {
        return new St.Button({
            child: new St.Icon({icon_name: iconName, icon_size: 14, y_align: Clutter.ActorAlign.CENTER}),
            style_class: styleClass,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
            ...extraProps,
        });
    }

    _addSessionItem(section, {name, isCurrent, isExited}, isPinned, isReorderable) {
        const item = new PopupMenu.PopupBaseMenuItem();
        item._sessionName = name;

        if (isReorderable) {
            const dragHandle = this._iconButton('list-drag-handle-symbolic', 'zellij-drag-handle', {can_focus: false});
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

        const pinClass = isPinned ? 'zellij-pin-button zellij-pin-button-active' : 'zellij-pin-button';
        const pinBtn = this._iconButton('view-pin-symbolic', pinClass);
        pinBtn.connect('clicked', () => this._togglePin(name));
        item.add_child(pinBtn);

        const editBtn = this._iconButton('document-edit-symbolic', 'zellij-edit-button');
        editBtn.connect('clicked', () => this._startRenaming(item, label, name, isExited));
        item.add_child(editBtn);

        const deleteBtn = this._iconButton('user-trash-symbolic', 'zellij-delete-button');
        deleteBtn.connect('clicked', () => this._deleteSession(name, isExited ? 'delete-session' : 'kill-session'));
        item.add_child(deleteBtn);

        item.connect('activate', () => this._openSession(name));
        section.addMenuItem(item);
    }

    _updatePinned(update) {
        const pinned = this._settings.get_strv('pinned-sessions');
        this._settings.set_strv('pinned-sessions', update(pinned));
    }

    _togglePin(name) {
        this._updatePinned(pinned => pinned.includes(name)
            ? pinned.filter(n => n !== name)
            : [...pinned, name]);
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

        this._updatePinned(pinned => [...shown, ...pinned.filter(name => !shown.includes(name))]);
    }

    _addDisabledItem(text, menu = this.menu) {
        const item = new PopupMenu.PopupMenuItem(text);
        item.setSensitive(false);
        menu.addMenuItem(item);
    }

    _openSession(name) {
        const win = this._findSessionWindow(name);
        if (win) {
            Main.activateWindow(win);
            return;
        }

        this._spawnTerminal(['zellij', 'attach', name, '-c'], name);
    }

    _runZellij(args) {
        try {
            const proc = Gio.Subprocess.new(['zellij', ...args], Gio.SubprocessFlags.NONE);
            proc.wait_async(null, () => this._refreshSessions());
        } catch (e) {
            console.error(`ZellijSessions: failed to run "zellij ${args.join(' ')}": ${e.message}`);
        }
    }

    _deleteSession(name, cmd) {
        this._updatePinned(pinned => pinned.filter(n => n !== name));
        this._runZellij([cmd, name]);
    }

    _renameSession(oldName, newName, isExited) {
        this._updatePinned(pinned => pinned.map(n => n === oldName ? newName : n));

        if (isExited) {
            this._renameExitedSession(oldName, newName);
            this._refreshSessions();
            return;
        }

        this._runZellij(['-s', oldName, 'action', 'rename-session', newName]);
    }

    _renameExitedSession(oldName, newName) {
        const moves = this._findStoredSessions(oldName, newName);

        if (moves.length === 0) {
            console.error(`ZellijSessions: no stored data found for exited session "${oldName}"`);
            return;
        }

        if (moves.some(({target}) => target.query_exists(null))) {
            console.error(`ZellijSessions: cannot rename "${oldName}", session "${newName}" already exists`);
            return;
        }

        for (const {source, target} of moves) {
            try {
                source.move(target, Gio.FileCopyFlags.NONE, null, null);
            } catch (e) {
                console.error(`ZellijSessions: failed to rename exited session "${oldName}" to "${newName}": ${e.message}`);
                return;
            }
        }
    }

    _findStoredSessions(oldName, newName) {
        const cacheDir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_cache_dir(), 'zellij']));
        const moves = [];

        try {
            const versions = cacheDir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);

            let info;
            while ((info = versions.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.DIRECTORY) continue;

                const sessionInfo = cacheDir.get_child(info.get_name()).get_child('session_info');
                const source = sessionInfo.get_child(oldName);
                if (source.query_exists(null))
                    moves.push({source, target: sessionInfo.get_child(newName)});
            }
        } catch (e) {
            console.error(`ZellijSessions: failed to read the zellij cache: ${e.message}`);
        }

        return moves;
    }

    _startRenaming(item, label, name, isExited) {
        this._cancelRename?.();
        item.hide();

        const section = item._parent;
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

        const confirmBtn = this._iconButton('object-select-symbolic', 'zellij-confirm-button');
        const cancelBtn = this._iconButton('process-stop-symbolic', 'zellij-cancel-button');

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
            this._cancelRename = null;

            renameItem.destroy();
            item.show();

            if (newName && newName !== name) {
                label.text = newName;
                this._renameSession(name, newName, isExited);
            }
        };
        this._cancelRename = () => finish(null);

        clutterText.connect('activate', () => finish(entry.get_text().trim()));
        clutterText.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        confirmBtn.connect('clicked', () => finish(entry.get_text().trim()));
        cancelBtn.connect('clicked', () => finish(null));
    }

    destroy() {
        this._endDrag();
        super.destroy();
    }

    _findSessionWindow(sessionName) {
        const terminalClasses = this._settings.get_strv('terminal-wm-classes');

        for (const actor of global.get_window_actors()) {
            const win = actor.meta_window;
            const wmClass = (win.get_wm_class() || '').toLowerCase();
            if (terminalClasses.length > 0 && !terminalClasses.some(cls => wmClass.includes(cls)))
                continue;

            if (this._titleMatchesSession(win.get_title() || '', sessionName)) return win;
        }
        return null;
    }

    _titleMatchesSession(title, sessionName) {
        if (title === sessionName) return true;
        if (title.includes(`Zellij (${sessionName})`)) return true;

        for (const separator of TITLE_SEPARATORS) {
            const index = title.indexOf(separator);
            if (index > 0 && title.slice(0, index) === sessionName) return true;
        }
        return false;
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
        if (template.length === 0) {
            this._spawnInDefaultTerminal(args, workingDirectory);
            return;
        }

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

    _spawnInDefaultTerminal(args, workingDirectory) {
        const xdgTerminal = GLib.find_program_in_path('xdg-terminal-exec');

        if (xdgTerminal) {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            if (workingDirectory) launcher.set_cwd(workingDirectory);

            try {
                launcher.spawnv([xdgTerminal, ...args]);
                return;
            } catch (e) {
                console.error(`ZellijSessions: xdg-terminal-exec failed: ${e.message}`);
            }
        }

        const commandLine = args.map(arg => GLib.shell_quote(arg)).join(' ');

        try {
            const appInfo = Gio.AppInfo.create_from_commandline(
                commandLine,
                null,
                Gio.AppInfoCreateFlags.NEEDS_TERMINAL
            );
            appInfo.launch([], null);
        } catch (e) {
            console.error(`ZellijSessions: failed to launch default terminal: ${e.message}`);
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
