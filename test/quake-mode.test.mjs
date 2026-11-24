/*
 * SPDX-FileCopyrightText: 2026 Quake Terminal contributors
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { TextEncoder } from "node:util";

const setting = "maximize-and-hide-panel";
const monitorFrames = [
    { x: 0, y: 0, width: 1600, height: 900 },
    { x: 1600, y: 0, width: 1280, height: 800 },
];
const shellMain = "resource:///org/gnome/shell/ui/main.js";
const shellConfig = "resource:///org/gnome/shell/misc/config.js";
const shellExtension = "resource:///org/gnome/shell/extensions/extension.js";
const hostProxy = `
const proxy = name => new Proxy({}, {
    get(_, property) {
        const target = globalThis.shellFixture[name];
        const value = target[property];
        return typeof value === "function" && typeof value.prototype === "undefined"
            ? value.bind(target) : value;
    },
    set(_, property, value) {
        globalThis.shellFixture[name][property] = value;
        return true;
    },
});
`;
const imports = {
    "gi://Clutter": "export default { AnimationMode: {} }",
    "gi://Gio": `${hostProxy} export default proxy("gio")`,
    "gi://GLib": `${hostProxy} export default proxy("glib")`,
    "gi://Shell": `export default {
        Global: { get: () => globalThis.shellFixture.shell },
        AppSystem: { get_default: () => globalThis.shellFixture.appSystem },
        ActionMode: { NORMAL: 1, OVERVIEW: 2, POPUP: 4 },
    }`,
    "gi://Meta": `export default { WindowType: { NORMAL: 0 }, MaximizeFlags: { BOTH: 3 },
        WindowClientType: { WAYLAND: 1 }, KeyBindingFlags: { IGNORE_AUTOREPEAT: 1 },
        is_wayland_compositor: () => true }`,
    [shellMain]: `${hostProxy}
        export const wm = proxy("wm"), layoutManager = proxy("layoutManager"),
            overview = proxy("overview"), sessionMode = proxy("sessionMode");
        export const activateWindow = window => globalThis.shellFixture.activateWindow(window);`,
    [shellConfig]: "export const PACKAGE_VERSION = '48.0'",
    [shellExtension]: `export class Extension {
        getSettings() { return globalThis.shellFixture.settings; }
    }
    export const gettext = text => text;`,
};
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
    const imports = ${JSON.stringify(imports)};
    let source = imports[specifier];
    const version = context.parentURL?.split("?shell=")[1];
    if (version) {
        if (specifier === "./quake-mode.js")
            return next(specifier + "?shell=" + version, context);
        if (specifier === ${JSON.stringify(shellConfig)})
            source = "export const PACKAGE_VERSION = " + JSON.stringify(version + ".0");
    }
    return source === undefined
        ? next(specifier, context)
        : { url: "data:text/javascript," + encodeURIComponent(source), shortCircuit: true };
}
`)}`, import.meta.url);

class Signals {
    #handlers = new Map();
    #next = 0;

    connect(signal, callback) {
        const id = ++this.#next;
        this.#handlers.set(id, { signal, callback });
        return id;
    }

    disconnect(id) {
        assert.ok(this.#handlers.delete(id));
    }

    listenerCount(signal) {
        return [...this.#handlers.values()].filter(handler => handler.signal === signal).length;
    }

    emit(signal, ...args) {
        for (const { signal: name, callback } of [...this.#handlers.values()]) {
            if (name === signal) callback(this, ...args);
        }
    }
}

function fixture(version, frames = monitorFrames) {
    const display = Object.assign(new Signals(), {
        focus_window: null,
        get_n_monitors: () => frames.length,
        get_primary_monitor: () => 0,
    });
    const workspace = {};
    const shell = {
        display,
        workspace_manager: Object.assign(new Signals(), {
            get_active_workspace: () => workspace,
        }),
        window_manager: new Signals(),
        window_group: { visible: true },
    };
    const foreign = { affectsStruts: true, actor: {} };
    const panel = Object.assign(new Signals(), { visible: true });
    const tracked = { affectsStruts: true, trackFullscreen: true, actor: panel };
    const primaryMonitor = { index: 0, inFullscreen: false };
    let workAreaTop = 24;
    const layoutManager = Object.assign(new Signals(), {
        panelBox: panel,
        primaryMonitor,
        _trackedActors: [foreign, tracked],
        findMonitorForActor: () => primaryMonitor,
        _updateRegions() {
            workAreaTop = tracked.affectsStruts ? 24 : 0;
        },
    });
    const pending = new Map();
    let sequence = 0;
    const schedule = (priority, callback, delay) => {
        pending.set(++sequence, { priority, callback, delay });
        return sequence;
    };
    const flush = (priority, delay) => {
        for (const [id, job] of [...pending]) {
            if (job.priority === priority && (delay === undefined || job.delay === delay) && pending.delete(id)) {
                job.callback();
            }
        }
    };
    const focus = window => {
        display.focus_window = window;
        display.emit("notify::focus-window");
    };
    const showWindow = window => {
        if (!window.hidden) return;
        window.hidden = false;
        window.emit("shown");
    };
    const mapWindow = window => {
        const actor = window.get_compositor_private();
        if (actor.mapped) return;
        actor.mapped = true;
        actor.emit("notify::mapped");
    };
    const revealWindow = window => {
        window.unminimize();
        showWindow(window);
        mapWindow(window);
        focus(window);
    };
    let launch = () => {};
    let launches = 0;
    const overview = Object.assign(new Signals(), { visible: false });
    const sessionMode = Object.assign(new Signals(), { hasWindows: true, isLocked: false });
    const keybindings = new Map();
    const closingActors = new Set();
    const wm = {
        _shouldAnimateActor() {},
        skipNextEffect(actor) {
            assert.ok(actor && !actor.destroyed);
            actor.skipEffectCalls++;
        },
        addKeybinding(name, _settings, _flags, _modes, callback) {
            keybindings.set(name, callback);
        },
        removeKeybinding(name) {
            keybindings.delete(name);
        },
        ["_destroyWindow@"](actor) {
            if (!this._shouldAnimateActor(actor, [0])) return;
            closingActors.add(actor);
            actor.ease({
                opacity: 0,
                duration: 100,
                onStopped: () => this._destroyWindowDone(null, actor),
            });
        },
        _destroyWindowDone(_shellwm, actor) {
            if (!closingActors.delete(actor)) return;
            actor.closeCompletions++;
            if (!actor.meta_window.get_compositor_private()) actor.destroy();
        },
    };
    const host = {
        shell, layoutManager, overview, sessionMode, wm,
        activateWindow(window) {
            window.activations++;
            revealWindow(window);
        },
        glib: {
            PRIORITY_DEFAULT: 0,
            PRIORITY_DEFAULT_IDLE: 200,
            SOURCE_REMOVE: false,
            Source: { remove: id => pending.delete(id) },
            timeout_add: (priority, delay, callback) => schedule(priority, callback, delay),
            timeout_add_seconds: (priority, delay, callback) => schedule(priority, callback, delay * 1000),
            idle_add: schedule,
            shell_parse_argv: () => [true, ["foot"]],
            path_get_basename: path => path.split("/").at(-1),
        },
        gio: {
            Cancellable: class extends Signals { cancel() {} },
            SubprocessFlags: { NONE: 0 },
            Subprocess: class {
                init() {
                    launches++;
                    void Promise.resolve().then(launch);
                }
                async wait_check_async() { return true; }
            },
            File: {
                new_for_path: () => ({
                    load_contents_async: async () => [new TextEncoder().encode("wl-paste\0")],
                }),
            },
        },
    };
    const values = new Map([
        [setting, false], ["horizontal-size", 60], ["vertical-size", 50],
        ["horizontal-alignment", 2], ["monitor-screen", 0], ["animation-time", 125],
    ]);
    const settings = Object.assign(new Signals(), {
        get_boolean: key => values.get(key) === true,
        get_int: key => values.get(key),
        get_string: key => values.get(key),
        get_value: () => ({ deep_unpack: () => ({}) }),
        set(key, value) {
            values.set(key, value);
            this.emit(`changed::${key}`);
        },
    });
    const windows = [];
    const applications = new Map();
    const createApp = (id, appWindows) => {
        const name = id.slice(0, -".desktop".length);
        const app = Object.assign(new Signals(), {
            get_id: () => id,
            get_name: () => name,
            get_windows: () => [...appWindows],
            get_app_info: () => ({
                get_name: () => name, get_id: () => id, get_string: () => name,
            }),
        });
        applications.set(id, app);
        return app;
    };
    const app = createApp("foot.desktop", windows);
    host.appSystem = { lookup_app: id => applications.get(id) ?? null };
    host.settings = settings;
    const createWindow = name => {
        let compositorActor;
        let translationY = 0;
        let transition = null;
        let clip = null;
        let fullscreenRestore;
        let above = false;
        const window = Object.assign(new Signals(), {
            monitor: 0,
            title: name,
            fullscreen: false,
            is_alive: version !== 45,
            hidden: false,
            minimized: false,
            maximized_horizontally: false,
            maximized_vertically: false,
            geometry: { x: 320, y: 24, width: 960, height: 438 },
            moves: 0,
            activations: 0,
            minimizeCalls: 0,
            get_client_type: () => 1,
            get_window_type: () => 0,
            get_transient_for: () => null,
            get_compositor_private: () => compositorActor,
            is_above: () => above,
            make_above() { above = true; },
            unmake_above() { above = false; },
            is_skip_taskbar: () => false,
            get_monitor() { return this.monitor; },
            is_hidden() { return this.hidden; },
            has_focus() { return display.focus_window === this; },
            showing_on_its_workspace() { return !this.hidden; },
            located_on_workspace: candidate => candidate === workspace,
            get_frame_rect() { return this.geometry; },
            get_work_area_for_monitor(index) {
                const frame = frames[index];
                const top = index === primaryMonitor.index ? workAreaTop : 0;
                return { ...frame, y: frame.y + top, height: frame.height - top };
            },
            move_to_monitor(index) {
                this.monitor = index;
                this.moves++;
                if (this.fullscreen) this.geometry = { ...frames[index] };
                else if (this.is_maximized()) this.geometry = this.get_work_area_for_monitor(index);
            },
            move_resize_frame(_userOp, x, y, width, height) {
                if (this.fullscreen) {
                    this.geometry = { ...frames[this.monitor] };
                    return;
                }
                const area = this.get_work_area_for_monitor(this.monitor);
                if (this.maximized_horizontally) ({ x, width } = area);
                if (this.maximized_vertically) ({ y, height } = area);
                this.geometry = { x, y, width, height };
            },
            make_fullscreen() {
                if (this.fullscreen) return;
                fullscreenRestore = { monitor: this.monitor, frame: { ...this.geometry } };
                this.fullscreen = true;
                this.geometry = { ...frames[this.monitor] };
                this.emit("notify::fullscreen");
            },
            unmake_fullscreen() {
                if (!this.fullscreen) return;
                assert.ok(fullscreenRestore);
                this.fullscreen = false;
                this.monitor = fullscreenRestore.monitor;
                this.geometry = fullscreenRestore.frame;
                fullscreenRestore = undefined;
                this.emit("notify::fullscreen");
            },
            get_maximized() {
                return Number(this.maximized_horizontally) + 2 * Number(this.maximized_vertically);
            },
            is_maximized() { return this.get_maximized() === 3; },
            maximize(...args) {
                assert.deepEqual(args, version >= 49 ? [] : [3]);
                this.maximized_horizontally = true;
                this.maximized_vertically = true;
                this.geometry = this.get_work_area_for_monitor(this.monitor);
            },
            unmaximize(...args) {
                assert.deepEqual(args, version >= 49 ? [] : [3]);
                this.maximized_horizontally = false;
                this.maximized_vertically = false;
            },
            stick() {},
            minimize() {
                this.minimizeCalls++;
                if (this.hidden) return;
                this.minimized = true;
                this.hidden = true;
                actor.mapped = false;
                this.emit("notify::minimized");
                if (this.has_focus()) focus(null);
            },
            unminimize() {
                if (!this.minimized) return;
                this.minimized = false;
                this.emit("notify::minimized");
            },
            close(animate) {
                if (animate) wm["_destroyWindow@"](actor);
                compositorActor = null;
                if (!closingActors.has(actor)) actor.destroy();
                this.is_alive = false;
                this.emit("unmanaged");
            },
        });
        Object.defineProperty(window, "skip_taskbar", {
            get() { return this.is_skip_taskbar(); },
            configurable: true,
        });
        const actor = Object.assign(new Signals(), {
            mapped: true,
            meta_window: window,
            name,
            height: 438,
            width: 960,
            y: 24,
            showAnimations: 0,
            hideAnimations: 0,
            skipEffectCalls: 0,
            closeCompletions: 0,
            destroyed: false,
            deferAnimations: false,
            has_clip: false,
            get_name() { return this.name; },
            set_name(value) { this.name = value; },
            is_mapped() { return this.mapped; },
            get_parent: () => ({ set_child_above_sibling() {} }),
            get_clip: () => clip,
            set_clip(...bounds) {
                assert.equal(this.destroyed, false);
                clip = bounds;
                this.has_clip = true;
            },
            remove_clip() {
                assert.equal(this.destroyed, false);
                clip = null;
                this.has_clip = false;
            },
            get_transition(name) {
                assert.equal(this.destroyed, false);
                return name === "translation-y" ? transition : null;
            },
            remove_transition(name) {
                const stopped = this.get_transition(name);
                if (!stopped) return;
                transition = null;
                stopped.finish(false);
            },
            ease(options) {
                this.lastDuration = options.duration;
                const target = options.translation_y;
                if (target === 0) this.showAnimations++;
                if (target < 0) this.hideAnimations++;
                const finish = finished => {
                    options.onStopped?.(finished);
                    if (finished) options.onComplete?.();
                };
                if (target !== undefined) this.remove_transition("translation-y");
                if (target !== undefined && this.deferAnimations && options.duration > 0 && this.mapped) {
                    transition = { start: translationY, target, finish };
                    return;
                }
                if (target !== undefined) this.translation_y = target;
                if (options.opacity !== undefined) this.opacity = options.opacity;
                finish(true);
            },
            advanceAnimation(progress) {
                if (!transition) return;
                const { start, target, finish } = transition;
                this.translation_y = start + (target - start) * progress;
                if (progress === 1) {
                    transition = null;
                    finish(true);
                }
            },
            destroy() {
                this.destroyed = true;
                this.mapped = false;
                this.emit("destroy");
                transition = null;
            },
        });
        Object.defineProperty(actor, "translation_y", {
            get() { return translationY; },
            set(value) {
                assert.equal(this.destroyed, false);
                translationY = value;
                this.emit("notify::translation-y");
            },
        });
        compositorActor = actor;
        return window;
    };
    return {
        host, panel, tracked, foreign, app, settings, windows, primaryMonitor,
        focus, showWindow, mapWindow, revealWindow, createWindow, createApp, flush,
        get launches() { return launches; },
        onLaunch: callback => { launch = callback; },
        pressShortcut: () => keybindings.get("terminal-shortcut")(),
    };
}

function showStarts(window) {
    return [window.activations, window.get_compositor_private().showAnimations];
}

function windowShape(window) {
    return {
        axes: [window.maximized_horizontally, window.maximized_vertically],
        fullscreen: window.fullscreen,
        frame: { ...window.get_frame_rect() },
    };
}

function assertMaximizedOnMonitor(window, monitor) {
    assert.equal(window.get_monitor(), monitor, "logical monitor after applying geometry");
    assert.deepEqual(windowShape(window), {
        axes: [true, true],
        fullscreen: false,
        frame: monitor === 0 ? { x: 0, y: 24, width: 1600, height: 876 } : monitorFrames[1],
    });
}

function readSavedGeometry(settings) {
    return ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => settings.get_int(key));
}

async function launchManagedWindow(f, terminal) {
    f.onLaunch(() => {
        f.windows.push(terminal);
        f.app.emit("windows-changed");
    });
    await f.pressShortcut();
    f.flush(0, 500);
    assert.equal(f.launches, 1);
    assert.deepEqual(showStarts(terminal), [1, 1]);
}

test("changing the mode updates the same window and defers hidden-window changes until recall", async t => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const window = f.createWindow("quake-terminal");
    f.windows.push(window);
    f.settings.set("terminal-id", "foot.desktop");
    const extension = new Extension();
    extension.enable();
    t.after(() => extension.disable());
    const initialSavedGeometry = readSavedGeometry(f.settings);

    await f.pressShortcut();
    assert.equal(window.has_focus(), true);
    assert.equal(f.panel.visible, true);
    f.settings.set(setting, true);
    assert.equal(window.hidden, false);
    assert.equal(window.is_maximized(), true);
    assert.equal(window.fullscreen, false);
    assert.deepEqual(readSavedGeometry(f.settings), initialSavedGeometry);
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);

    f.settings.set("vertical-size", 60);
    assert.equal(window.is_maximized(), true);
    const editedSavedGeometry = readSavedGeometry(f.settings);
    f.settings.set(setting, false);
    assert.deepEqual(window.geometry, { x: 320, y: 24, width: 960, height: 526 });
    assert.equal(window.hidden, false);
    assert.equal(window.is_maximized(), false);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
    assert.deepEqual(readSavedGeometry(f.settings), editedSavedGeometry);

    await f.pressShortcut();
    assert.equal(window.hidden, true);
    const savedFrame = { ...window.get_frame_rect() };
    f.settings.set(setting, true);
    assert.equal(window.hidden, true);
    assert.equal(window.is_maximized(), false);
    assert.deepEqual(window.get_frame_rect(), savedFrame);
    assert.deepEqual(readSavedGeometry(f.settings), editedSavedGeometry);
    await f.pressShortcut();
    f.flush(0);
    f.flush(200);
    assert.equal(window.hidden, false);
    assert.equal(window.is_maximized(), true);
    assert.equal(window.get_compositor_private().lastDuration, 125);
    assert.equal(window.has_focus(), true);
    assert.equal(f.launches, 0);
    assert.deepEqual(readSavedGeometry(f.settings), editedSavedGeometry);

    const maximizedFrame = { x: 0, y: 0, width: 1600, height: 900 };
    window.geometry = { ...maximizedFrame };
    await f.pressShortcut();
    f.settings.set(setting, false);
    assert.equal(window.hidden, true);
    assert.equal(window.is_maximized(), true);
    assert.deepEqual(window.get_frame_rect(), maximizedFrame);
    assert.deepEqual(readSavedGeometry(f.settings), editedSavedGeometry);
    await f.pressShortcut();
    assert.equal(window.hidden, false);
    assert.equal(window.is_maximized(), false);
    assert.deepEqual(window.get_frame_rect(), { x: 320, y: 24, width: 960, height: 526 });
    assert.deepEqual(readSavedGeometry(f.settings), editedSavedGeometry);
});

for (const version of [48, 49]) {
    for (const enabled of [true, false]) {
        for (const shortcut of [true, false]) {
            const entry = shortcut ? "shortcut" : "Shell redisplay";
            test(`Shell ${version}: switching ${enabled ? "on" : "off"} while hidden takes effect on ${entry}`, async t => {
                const f = fixture(version);
                globalThis.shellFixture = f.host;
                const { default: Extension } = version === 49
                    ? await import("../src/extension.js?shell=49")
                    : await import("../src/extension.js");
                const terminal = f.createWindow("quake-terminal");
                const actor = terminal.get_compositor_private();
                const secondArea = monitorFrames[1];
                if (enabled) {
                    terminal.make_fullscreen();
                } else if (version === 49) {
                    terminal.maximized_vertically = true;
                    terminal.geometry = { x: 70, y: 24, width: 850, height: 876 };
                } else {
                    terminal.maximize(3);
                }
                terminal.minimize();
                f.windows.push(terminal);
                f.settings.set("terminal-id", "foot.desktop");
                f.settings.set(setting, !enabled);
                const extension = new Extension();
                extension.enable();
                t.after(() => extension.disable());
                const readSaved = () => ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => f.settings.get_int(key));
                const initialShape = windowShape(terminal);
                const initialSaved = readSaved();

                f.settings.set(setting, enabled);
                assert.equal(terminal.is_alive, true);
                assert.equal(terminal.hidden, true);
                assert.equal(actor.mapped, false);
                assert.deepEqual(showStarts(terminal), [0, 0]);
                assert.deepEqual(windowShape(terminal), initialShape, "switching alone");
                assert.deepEqual(readSaved(), initialSaved);

                if (shortcut) {
                    await f.pressShortcut();
                    terminal.emit("size-changed");
                    f.flush(0, 500);
                } else {
                    if (version === 49) {
                        extension.disable();
                        assert.equal(terminal.listenerCount("shown"), 0);
                        assert.equal(actor.listenerCount("notify::mapped"), 0);
                        assert.equal(terminal.is_alive, true);
                        assert.equal(terminal.hidden, true);
                        assert.deepEqual(windowShape(terminal), initialShape, "while disabled");
                        extension.enable();
                    }
                    terminal.unminimize();
                    f.focus(terminal);
                    assert.equal(terminal.hidden, true);
                    assert.equal(actor.mapped, false);
                    assert.deepEqual(windowShape(terminal), initialShape, "unminimize and focus are not redisplay");
                    const [first, last] = version === 49 ? [f.mapWindow, f.showWindow] : [f.showWindow, f.mapWindow];
                    first(terminal);
                    assert.deepEqual(windowShape(terminal), initialShape, "only one visibility condition met");
                    if (version === 49) terminal.move_to_monitor(1);
                    last(terminal);
                }

                const expectedMonitor = !shortcut && version === 49 ? 1 : 0;
                const maximizedFrame = expectedMonitor === 1 ? secondArea : { x: 0, y: 24, width: 1600, height: 876 };
                const savedFrame = expectedMonitor === 1
                    ? { x: 1856, y: 0, width: 768, height: 400 }
                    : { x: 320, y: 24, width: 960, height: 438 };
                assert.equal(terminal.get_monitor(), expectedMonitor);
                assert.equal(terminal.hidden, false);
                assert.equal(terminal.is_alive, true);
                assert.equal(actor.mapped, true);
                assert.deepEqual(windowShape(terminal), {
                    axes: [enabled, enabled],
                    fullscreen: false,
                    frame: enabled ? maximizedFrame : savedFrame,
                }, "geometry on redisplay");
                assert.deepEqual(readSaved(), initialSaved);
                assert.deepEqual(showStarts(terminal), shortcut ? [1, 1] : [0, 0]);
                assert.equal(f.launches, 0);

                terminal.maximized_horizontally = true;
                terminal.maximized_vertically = false;
                terminal.geometry = { x: 10, y: 90, width: 850, height: 500 };
                const manualShape = windowShape(terminal);
                terminal.emit("shown");
                actor.emit("notify::mapped");
                f.focus(f.createWindow("other"));
                f.settings.set(setting, enabled);
                f.focus(terminal);
                assert.deepEqual(windowShape(terminal), manualShape, "notification and focus after application");
                terminal.minimize();
                f.revealWindow(terminal);
                assert.deepEqual(windowShape(terminal), manualShape, "a later redisplay without a mode change");
                assert.deepEqual(showStarts(terminal), shortcut ? [1, 1] : [0, 0]);
            });
        }
    }
}

for (const version of [48, 49]) {
    for (const shortcut of [true, false]) {
        for (const switchOff of [true, false]) {
            const entry = shortcut ? "shortcut" : "Shell redisplay";
            test(`Shell ${version}: fullscreen recall by ${entry} ${switchOff ? "after switching off while hidden" : "with the mode still off"}`, async t => {
                const f = fixture(version);
                globalThis.shellFixture = f.host;
                const { default: Extension } = version === 49
                    ? await import("../src/extension.js?shell=49")
                    : await import("../src/extension.js");
                const terminal = f.createWindow("quake-terminal");
                const actor = terminal.get_compositor_private();
                const [primaryFrame, secondFrame] = monitorFrames;
                terminal.monitor = 1;
                f.windows.push(terminal);
                f.settings.set("terminal-id", "foot.desktop");
                f.settings.set("skip-taskbar", false);
                f.settings.set(setting, switchOff);
                const extension = new Extension();
                extension.enable();
                t.after(() => extension.disable());

                terminal.maximize(...(version === 49 ? [] : [3]));
                terminal.make_fullscreen();
                terminal.minimize();
                const initialShape = windowShape(terminal);
                const readSaved = () => ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => f.settings.get_int(key));
                const saved = readSaved();

                f.settings.set(setting, false);
                assert.equal(terminal.is_alive, true);
                assert.equal(terminal.minimized, true);
                assert.equal(terminal.hidden, true);
                assert.equal(actor.mapped, false);
                assert.deepEqual(showStarts(terminal), [0, 0]);
                assert.deepEqual(windowShape(terminal), initialShape, "switching alone");
                assert.deepEqual(readSaved(), saved);

                if (shortcut) await f.pressShortcut();
                else f.revealWindow(terminal);

                const savedFrame = shortcut
                    ? { x: 320, y: 24, width: 960, height: 438 }
                    : { x: 1856, y: 0, width: 768, height: 400 };
                const fullscreenFrame = shortcut ? primaryFrame : secondFrame;
                assert.equal(terminal.get_monitor(), shortcut ? 0 : 1);
                assert.equal(terminal.is_alive, true);
                assert.equal(terminal.minimized, false);
                assert.equal(terminal.hidden, false);
                assert.equal(actor.mapped, true);
                assert.deepEqual(terminal.get_frame_rect(), switchOff ? savedFrame : fullscreenFrame, "frame after redisplay");
                assert.equal(terminal.fullscreen, !switchOff);
                const stillMaximized = !switchOff && !shortcut;
                assert.deepEqual(windowShape(terminal).axes, [stillMaximized, stillMaximized]);
                assert.deepEqual(readSaved(), saved);
                assert.deepEqual(showStarts(terminal), shortcut ? [1, 1] : [0, 0]);
                assert.equal(f.launches, 0);
            });
        }
    }
}

for (const [completion, wasMaximized] of [
    ["size notification", false],
    ["500 ms timeout", false],
    ["size notification", true],
]) {
    for (const monitor of [0, 1]) {
        const state = wasMaximized ? "previously maximized" : "previously unmaximized";
        test(`Shell 48: fullscreen shortcut recall on monitor ${monitor} after ${completion} (${state})`, async t => {
            const f = fixture(48);
            globalThis.shellFixture = f.host;
            const { default: Extension } = await import("../src/extension.js");
            const terminal = f.createWindow("quake-terminal");
            const actor = terminal.get_compositor_private();
            const other = f.createWindow("other app");
            f.windows.push(terminal);
            f.settings.set("terminal-id", "foot.desktop");
            const extension = new Extension();
            extension.enable();
            t.after(() => extension.disable());

            f.focus(terminal);
            if (wasMaximized) terminal.maximize(3);
            terminal.make_fullscreen();
            const fullscreenShape = windowShape(terminal);
            await f.pressShortcut();
            const saved = readSavedGeometry(f.settings);
            f.settings.set("monitor-screen", monitor);
            f.settings.set(setting, true);
            assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [true, true, false]);
            assert.equal(terminal.get_monitor(), 0);
            assert.deepEqual(windowShape(terminal), fullscreenShape, "switching alone");
            assert.deepEqual(readSavedGeometry(f.settings), saved);
            assert.deepEqual(showStarts(terminal), [0, 0]);

            await f.pressShortcut();
            assert.equal(terminal.hidden, true);
            assert.deepEqual(showStarts(terminal), [0, 0]);
            if (completion === "size notification") terminal.emit("size-changed");
            else f.flush(0, 500);
            assert.deepEqual(showStarts(terminal), [1, 1]);
            f.flush(0, 500);
            assert.deepEqual(showStarts(terminal), [1, 1]);
            assertMaximizedOnMonitor(terminal, monitor);
            assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [false, false, true]);
            assert.equal(terminal.has_focus(), true);
            assert.equal(terminal.get_compositor_private(), actor);
            assert.deepEqual(f.app.get_windows(), [terminal]);
            assert.equal(f.launches, 0);
            assert.deepEqual(readSavedGeometry(f.settings), saved);

            f.flush(200);
            const panelVisible = monitor !== 0;
            assert.deepEqual(
                [f.panel.visible, f.tracked.affectsStruts, f.foreign.affectsStruts],
                [panelVisible, panelVisible, true]
            );
            assert.equal(terminal.get_work_area_for_monitor(0).y, panelVisible ? 24 : 0);
            f.focus(other);
            f.flush(200);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts, f.foreign.affectsStruts], [true, true, true]);
            assert.equal(terminal.get_work_area_for_monitor(0).y, 24);
        });
    }
}

for (const monitor of [0, 1]) {
    test(`Shell 48: fullscreen shortcut activation on monitor ${monitor}`, async t => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("quake-terminal");
        f.windows.push(terminal);
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("monitor-screen", monitor);
        f.settings.set(setting, true);
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());

        f.focus(terminal);
        terminal.make_fullscreen();
        f.focus(f.createWindow("other app"));
        await f.pressShortcut();

        assertMaximizedOnMonitor(terminal, monitor);
        assert.equal(terminal.has_focus(), true);
        assert.equal(terminal.hidden, false);
        assert.equal(terminal.minimizeCalls, 0);
        assert.deepEqual(showStarts(terminal), [1, 0]);
        assert.equal(f.launches, 0);
    });

    for (const redisplay of [true, false]) {
        const entry = redisplay ? "Shell redisplay after switching on" : "switching on while shown";
        test(`Shell 48: fullscreen on monitor ${monitor} at ${entry}`, async t => {
            const f = fixture(48);
            globalThis.shellFixture = f.host;
            const { default: Extension } = await import("../src/extension.js");
            const terminal = f.createWindow("quake-terminal");
            const actor = terminal.get_compositor_private();
            f.windows.push(terminal);
            f.settings.set("terminal-id", "foot.desktop");
            f.settings.set("monitor-screen", monitor);
            const extension = new Extension();
            extension.enable();
            t.after(() => extension.disable());

            terminal.make_fullscreen();
            f.focus(f.createWindow("other app"));
            await f.pressShortcut();
            assert.equal(terminal.fullscreen, true);
            assert.equal(terminal.get_monitor(), monitor);
            assert.deepEqual(terminal.get_frame_rect(), monitorFrames[monitor]);
            assert.deepEqual(showStarts(terminal), [1, 0]);
            if (redisplay) await f.pressShortcut();

            const fullscreenShape = windowShape(terminal);
            const saved = readSavedGeometry(f.settings);
            f.settings.set("monitor-screen", 0);
            f.settings.set(setting, true);
            if (redisplay) {
                assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [true, true, false]);
                assert.equal(terminal.get_monitor(), monitor);
                assert.deepEqual(windowShape(terminal), fullscreenShape, "switching alone");
                assert.deepEqual(readSavedGeometry(f.settings), saved);
                terminal.unminimize();
                f.showWindow(terminal);
                assert.deepEqual(windowShape(terminal), fullscreenShape, "not mapped yet");
                f.mapWindow(terminal);
            }

            assertMaximizedOnMonitor(terminal, monitor);
            assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [false, false, true]);
            assert.equal(terminal.get_compositor_private(), actor);
            assert.deepEqual(f.app.get_windows(), [terminal]);
            assert.deepEqual(showStarts(terminal), [1, 0]);
            assert.deepEqual(readSavedGeometry(f.settings), saved);
            assert.equal(f.launches, 0);
        });
    }
}

for (const [monitor, savedFrame] of [
    [0, { x: 320, y: 24, width: 960, height: 438 }],
    [1, { x: 1856, y: 0, width: 768, height: 400 }],
]) {
    test(`Shell 48: switching off while fullscreen restores saved geometry on monitor ${monitor}`, async t => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("quake-terminal");
        const actor = terminal.get_compositor_private();
        f.windows.push(terminal);
        f.focus(terminal);
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("monitor-screen", 0);
        f.settings.set("auto-hide-window", false);
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());
        const saved = readSavedGeometry(f.settings);

        f.settings.set(setting, true);
        assertMaximizedOnMonitor(terminal, 0);
        terminal.make_fullscreen();
        if (monitor !== 0) terminal.move_to_monitor(monitor);
        assert.equal(terminal.get_monitor(), monitor);
        assert.deepEqual(windowShape(terminal), {
            axes: [true, true],
            fullscreen: true,
            frame: monitorFrames[monitor],
        });
        assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [false, false, true]);
        assert.deepEqual(showStarts(terminal), [0, 0]);

        f.settings.set(setting, false);
        assert.deepEqual({ monitor: terminal.get_monitor(), ...windowShape(terminal) }, {
            monitor,
            axes: [false, false],
            fullscreen: false,
            frame: savedFrame,
        });
        assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [false, false, true]);
        assert.equal(terminal.get_compositor_private(), actor);
        assert.deepEqual(f.app.get_windows(), [terminal]);
        assert.deepEqual(readSavedGeometry(f.settings), saved);
        assert.deepEqual(showStarts(terminal), [0, 0]);
        assert.equal(f.launches, 0);
    });
}

for (const [version, redisplay, completion, expectedStarts] of [
    [["showWindow", "mapWindow"], "size notification", [0, 0]],
    [["mapWindow", "showWindow"], "timeout", [0, 0]],
    [[], "size notification", [1, 1]],
    [[], "timeout", [1, 1]],
    [["showWindow"], "size notification", [1, 1]],
    [["mapWindow"], "size notification", [1, 1]],
].flatMap(scenario => [45, 48].map(version => [version, ...scenario]))) {
    const first = redisplay.length ? redisplay.join(" then ") : "no Shell redisplay";
    test(`Shell ${version}: recall after switching on: ${first} before ${completion}`, async t => {
        const f = fixture(version);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import(`../src/extension.js?shell=${version}`);
        const terminal = f.createWindow(version === 45 ? "new terminal" : "quake-terminal");
        const actor = terminal.get_compositor_private();
        if (version !== 45) f.windows.push(terminal);
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("skip-taskbar", false);
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());
        if (version === 45) await launchManagedWindow(f, terminal);
        const initialStarts = showStarts(terminal);
        const recallStarts = () => showStarts(terminal).map((count, index) => count - initialStarts[index]);
        terminal.minimize();

        f.settings.set(setting, true);
        assert.equal(terminal.hidden, true);
        assert.equal(terminal.is_maximized(), false);
        await f.pressShortcut();
        assert.equal(terminal.hidden, true);
        assert.equal(terminal.is_maximized(), true);
        assert.deepEqual(recallStarts(), [0, 0]);
        assert.equal(terminal.listenerCount("size-changed"), 1);

        if (redisplay.length) terminal.unminimize();
        for (const step of redisplay) f[step](terminal);
        if (redisplay.length === 2) f.focus(terminal);
        assert.equal(terminal.hidden, !redisplay.includes("showWindow"));
        assert.equal(actor.mapped, redisplay.includes("mapWindow"));
        assert.deepEqual(recallStarts(), [0, 0]);
        const waitListeners = terminal.listenerCount("size-changed");

        if (completion === "size notification") terminal.emit("size-changed");
        else f.flush(0, 500);
        assert.deepEqual(recallStarts(), expectedStarts, `after ${completion}`);
        assert.equal(waitListeners, redisplay.length === 2 ? 0 : 1);
        f.flush(0, 500);
        assert.deepEqual(recallStarts(), expectedStarts, "after the timeout");
        assert.equal(terminal.listenerCount("size-changed"), 0);
        assert.equal(terminal.hidden, false);
        assert.deepEqual(f.app.get_windows(), [terminal]);
        assert.equal(terminal.get_compositor_private(), actor);
        assert.equal(terminal.has_focus(), true);
        assert.equal(actor.mapped, true);
        assert.deepEqual(windowShape(terminal), {
            axes: [true, true],
            fullscreen: false,
            frame: { x: 0, y: 24, width: 1600, height: 876 },
        });
        assert.equal(f.launches, version === 45 ? 1 : 0);
    });
}

for (const [startEnabled, switchMode, shortcut] of [
    [false, true, true],
    [false, true, false],
    [false, false, true],
    [false, false, false],
    [true, true, true],
    [true, true, false],
    [true, false, true],
    [true, false, false],
]) {
    const entry = shortcut ? "shortcut" : "Shell redisplay";
    const change = switchMode ? `switching ${startEnabled ? "off" : "on"}` : `leaving the mode ${startEnabled ? "on" : "off"}`;
    test(`Shell 45: ${change} while hidden, then ${entry}`, async t => {
        const f = fixture(45);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js?shell=45");
        const terminal = f.createWindow("new terminal");
        const actor = terminal.get_compositor_private();
        const secondFrame = monitorFrames[1];
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("skip-taskbar", false);
        f.settings.set(setting, startEnabled);
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());
        await launchManagedWindow(f, terminal);

        terminal.monitor = 1;
        const manualFrame = { x: 1700, y: 60, width: 800, height: 500 };
        if (startEnabled) {
            terminal.geometry = { ...secondFrame };
            terminal.make_fullscreen();
        } else terminal.geometry = { ...manualFrame };
        terminal.minimize();
        const originalShape = windowShape(terminal);
        const readSaved = () => ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => f.settings.get_int(key));
        const saved = readSaved();
        if (switchMode) f.settings.set(setting, !startEnabled);

        assert.deepEqual(f.app.get_windows(), [terminal]);
        assert.equal(terminal.get_compositor_private(), actor);
        assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [true, true, false]);
        assert.deepEqual(windowShape(terminal), originalShape);
        assert.deepEqual(readSaved(), saved);
        assert.deepEqual(showStarts(terminal), [1, 1], "switching alone does not show the terminal");

        if (shortcut) {
            await f.pressShortcut();
            terminal.emit("size-changed");
            f.flush(0, 500);
        } else {
            terminal.unminimize();
            f.showWindow(terminal);
            assert.deepEqual(windowShape(terminal), originalShape, "not mapped yet");
            f.mapWindow(terminal);
            f.focus(terminal);
        }

        const maximized = switchMode ? !startEnabled : startEnabled;
        const maximizedFrame = shortcut ? terminal.get_work_area_for_monitor(0) : secondFrame;
        const savedFrame = shortcut
            ? { x: 320, y: 24, width: 960, height: 438 }
            : { x: 1856, y: 0, width: 768, height: 400 };
        assert.equal(terminal.monitor, shortcut ? 0 : 1);
        assert.deepEqual([terminal.minimized, terminal.hidden, actor.mapped], [false, false, true]);
        assert.deepEqual(windowShape(terminal), shortcut || switchMode ? {
            axes: [maximized, maximized],
            fullscreen: false,
            frame: maximized ? maximizedFrame : savedFrame,
        } : originalShape, "geometry on redisplay");
        assert.deepEqual(readSaved(), saved);
        assert.deepEqual(showStarts(terminal), shortcut ? [2, 2] : [1, 1]);
        assert.equal(f.launches, 1);

        if (switchMode) {
            terminal.maximized_horizontally = false;
            terminal.maximized_vertically = false;
            terminal.geometry = { ...manualFrame };
            const manualShape = windowShape(terminal);
            terminal.minimize();
            f.revealWindow(terminal);
            assert.deepEqual(windowShape(terminal), manualShape, "a later redisplay does not apply the switch again");
            assert.deepEqual(showStarts(terminal), shortcut ? [2, 2] : [1, 1]);
        }
    });
}

test("Shell redisplay uses the latest switch if shortcut resize work is still pending", async t => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const terminal = f.createWindow("quake-terminal");
    terminal.minimize();
    f.windows.push(terminal);
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set(setting, true);
    const extension = new Extension();
    extension.enable();
    t.after(() => extension.disable());

    await f.pressShortcut();
    assert.equal(terminal.hidden, true);
    assert.deepEqual(showStarts(terminal), [0, 0]);
    f.settings.set(setting, false);
    f.revealWindow(terminal);
    assert.deepEqual(windowShape(terminal), {
        axes: [false, false],
        fullscreen: false,
        frame: { x: 320, y: 24, width: 960, height: 438 },
    });
    terminal.emit("size-changed");
    f.flush(0, 500);
    assert.deepEqual(showStarts(terminal), [0, 0]);
});

test("Shell redisplay does not apply an old switch on after switching modes with a different terminal managed", async t => {
    const f = fixture(49);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js?shell=49");
    const original = f.createWindow("quake-terminal");
    const originalActor = original.get_compositor_private();
    original.minimize();
    f.windows.push(original);
    const next = f.createWindow("quake-terminal");
    const nextId = "org.gnome.Console.desktop";
    f.createApp(nextId, [next]);
    f.settings.set("terminal-id", "foot.desktop");
    const extension = new Extension();
    extension.enable();
    t.after(() => extension.disable());

    const initialShape = windowShape(original);
    f.settings.set(setting, true);
    f.settings.set("terminal-id", nextId);
    f.focus(next);
    await f.pressShortcut();
    assert.equal(next.hidden, true);
    assert.equal(original.listenerCount("shown"), 0);
    assert.equal(originalActor.listenerCount("notify::mapped"), 0);
    const nextShape = windowShape(next);
    f.revealWindow(next);
    assert.deepEqual(windowShape(next), nextShape, "the switch belongs to the original window only");
    next.minimize();
    f.settings.set(setting, false);
    f.settings.set(setting, true);
    f.settings.set("terminal-id", "foot.desktop");
    extension.disable();
    extension.enable();
    f.revealWindow(original);
    assert.deepEqual(windowShape(original), initialShape, "the earlier switch must not revive");

    original.minimize();
    f.settings.set(setting, false);
    f.settings.set(setting, true);
    assert.deepEqual(windowShape(original), initialShape, "the latest switch remains deferred");
    f.revealWindow(original);
    assert.deepEqual(windowShape(original).axes, [true, true]);
    assert.deepEqual(showStarts(original), [0, 0]);
});

test("recall uses the latest mode when it changes while a hidden window is resizing", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const terminal = f.createWindow("quake-terminal");
    f.windows.push(terminal);
    terminal.minimize();
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set(setting, true);
    const extension = new Extension();
    extension.enable();

    try {
        await f.pressShortcut();
        assert.equal(terminal.hidden, true);
        assert.equal(terminal.is_maximized(), true);

        f.settings.set(setting, false);
        assert.equal(terminal.hidden, true);
        assert.equal(terminal.is_maximized(), true);
        terminal.geometry = { x: 0, y: 24, width: 1600, height: 876 };
        terminal.emit("size-changed");
        assert.equal(terminal.hidden, true);
        f.flush(0);
        f.flush(200);

        assert.equal(terminal.has_focus(), true);
        assert.equal(terminal.hidden, false);
        assert.equal(terminal.is_maximized(), false);
        assert.deepEqual(terminal.get_frame_rect(), { x: 320, y: 24, width: 960, height: 438 });
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
    } finally {
        extension.disable();
    }
});

for (const [axis, horizontal, vertical, frame] of [
    ["horizontal", true, false, { x: 0, y: 90, width: 1600, height: 500 }],
    ["vertical", false, true, { x: 70, y: 24, width: 850, height: 876 }],
]) {
    for (const acquisition of ["without restarting", "after early adoption", "after lazy adoption"]) {
        test(`Shell 49 restores saved dimensions for a ${axis}-only maximized terminal ${acquisition}`, async () => {
            const f = fixture(49);
            globalThis.shellFixture = f.host;
            const { default: Extension } = await import("../src/extension.js?shell=49");
            const terminal = f.createWindow("quake-terminal");
            terminal.maximized_horizontally = horizontal;
            terminal.maximized_vertically = vertical;
            terminal.geometry = { ...frame };
            f.windows.push(terminal);
            f.createApp("org.gnome.Console.desktop", []);
            f.focus(terminal);
            f.settings.set("terminal-id", "foot.desktop");
            f.settings.set(setting, true);
            const readSaved = () =>
                ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => f.settings.get_int(key));
            const snapshot = () => ({
                alive: terminal.is_alive,
                hidden: terminal.hidden,
                axes: [terminal.maximized_horizontally, terminal.maximized_vertically],
                frame: terminal.get_frame_rect(),
                saved: readSaved(),
            });
            const hiddenState = { alive: true, hidden: true, axes: [horizontal, vertical], frame, saved: readSaved() };
            const savedFrame = { x: 320, y: 24, width: 960, height: 438 };
            const extension = new Extension();
            extension.enable();

            try {
                await f.pressShortcut();
                assert.deepEqual(snapshot(), hiddenState, "after hiding");
                f.settings.set(setting, false);
                assert.deepEqual(snapshot(), hiddenState, "after switching off");

                if (acquisition !== "without restarting") {
                    if (acquisition === "after lazy adoption")
                        f.settings.set("terminal-id", "org.gnome.Console.desktop");
                    extension.disable();
                    assert.deepEqual(snapshot(), hiddenState, "after disabling");
                    extension.enable();
                    assert.deepEqual(snapshot(), hiddenState, "after reenabling");
                    if (acquisition === "after lazy adoption")
                        f.settings.set("terminal-id", "foot.desktop");
                }

                await f.pressShortcut();
                assert.equal(terminal.has_focus(), true);
                assert.equal(f.launches, 0);
                assert.deepEqual(
                    snapshot(),
                    { ...hiddenState, hidden: false, axes: [false, false], frame: savedFrame },
                    "after recalling with a pending restore"
                );

                terminal.maximized_horizontally = horizontal;
                terminal.maximized_vertically = vertical;
                terminal.geometry = { ...frame };
                await f.pressShortcut();
                assert.deepEqual(snapshot(), hiddenState, "after hiding again");
                f.settings.set(setting, false);
                await f.pressShortcut();
                assert.equal(terminal.has_focus(), true);
                assert.deepEqual(snapshot(), {
                    ...hiddenState,
                    hidden: false,
                    frame: horizontal
                        ? { ...savedFrame, x: 0, width: 1600 }
                        : { ...savedFrame, height: 876 },
                }, "after recalling again without a mode change");
            } finally {
                extension.disable();
            }
        });
    }
}

for (const [axis, horizontal, vertical, frame, ordinaryFrame] of [
    ["horizontal", true, false, { x: 0, y: 90, width: 1600, height: 500 }, { x: 0, y: 24, width: 1600, height: 438 }],
    ["vertical", false, true, { x: 70, y: 24, width: 850, height: 876 }, { x: 320, y: 24, width: 960, height: 876 }],
]) {
    for (const manageNext of [true, false]) {
        for (const switchBackOn of [false, true]) {
            const route = manageNext ? "another terminal managed" : "no terminal managed";
            const change = switchBackOn ? "after switching on then off" : "without switching back on";
            test(`Shell 49 recalls the original ${axis}-only terminal with ${route} ${change}`, async () => {
                const f = fixture(49);
                globalThis.shellFixture = f.host;
                const { default: Extension } = await import("../src/extension.js?shell=49");
                const original = f.createWindow("quake-terminal");
                original.maximized_horizontally = horizontal;
                original.maximized_vertically = vertical;
                original.geometry = { ...frame };
                original.minimize();
                f.windows.push(original);
                const nextId = "org.gnome.Console.desktop";
                const next = manageNext ? f.createWindow("quake-terminal") : null;
                if (next) {
                    next.maximized_horizontally = true;
                    next.geometry = { x: 0, y: 90, width: 1600, height: 500 };
                    next.minimize();
                }
                f.createApp(nextId, next ? [next] : []);
                f.settings.set("terminal-id", "foot.desktop");
                f.settings.set(setting, true);
                const snapshot = () => ({
                    alive: original.is_alive,
                    hidden: original.hidden,
                    axes: [original.maximized_horizontally, original.maximized_vertically],
                    frame: { ...original.get_frame_rect() },
                    saved: ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => f.settings.get_int(key)),
                });
                const activity = () => [original.moves, original.activations, original.minimizeCalls];
                const originalState = snapshot();
                const originalActivity = activity();
                const extension = new Extension();
                extension.enable();

                try {
                    f.settings.set(setting, false);
                    assert.deepEqual(snapshot(), originalState, "after switching off with the original terminal managed");
                    f.settings.set("terminal-id", nextId);
                    if (next) {
                        await f.pressShortcut();
                        assert.equal(next.has_focus(), true);
                        assert.equal(next.hidden, false);
                        assert.deepEqual([next.maximized_horizontally, next.maximized_vertically], [true, false]);
                        assert.deepEqual(next.get_frame_rect(), { x: 0, y: 24, width: 1600, height: 438 });
                    } else {
                        extension.disable();
                        extension.enable();
                    }
                    assert.deepEqual(snapshot(), originalState, "after selecting another app");

                    if (switchBackOn) {
                        f.settings.set(setting, true);
                        f.settings.set(setting, false);
                    }
                    assert.deepEqual(snapshot(), originalState, "after the mode changes while the original is unmanaged");

                    f.settings.set("terminal-id", "foot.desktop");
                    if (next) {
                        extension.disable();
                        extension.enable();
                    }
                    assert.deepEqual(snapshot(), originalState, "before recalling the original");
                    assert.deepEqual(activity(), originalActivity);
                    await f.pressShortcut();

                    assert.equal(original.has_focus(), true);
                    assert.equal(f.launches, 0);
                    assert.deepEqual(snapshot(), {
                        ...originalState,
                        hidden: false,
                        axes: switchBackOn ? [horizontal, vertical] : [false, false],
                        frame: switchBackOn ? ordinaryFrame : { x: 320, y: 24, width: 960, height: 438 },
                    }, "after recalling the original");
                } finally {
                    extension.disable();
                }
            });
        }
    }
}

for (const switchOff of [false, true]) {
    const change = switchOff ? "then off" : "only";
    test(`Shell 49 recalls the newly managed hidden terminal after switching on ${change}`, async () => {
        const f = fixture(49);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js?shell=49");
        const original = f.createWindow("quake-terminal");
        original.maximized_vertically = true;
        original.geometry = { x: 70, y: 24, width: 850, height: 876 };
        original.minimize();
        f.windows.push(original);
        const next = f.createWindow("quake-terminal");
        next.maximized_horizontally = true;
        next.geometry = { x: 0, y: 90, width: 1600, height: 500 };
        next.minimize();
        const nextId = "org.gnome.Console.desktop";
        f.createApp(nextId, [next]);
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, true);
        const snapshot = window => ({
            alive: window.is_alive,
            hidden: window.hidden,
            axes: [window.maximized_horizontally, window.maximized_vertically],
            frame: { ...window.get_frame_rect() },
            activity: [window.moves, window.activations, window.minimizeCalls],
        });
        const originalState = snapshot(original);
        const extension = new Extension();
        extension.enable();

        try {
            f.settings.set(setting, false);
            f.settings.set("terminal-id", nextId);
            await f.pressShortcut();
            assert.equal(next.has_focus(), true);
            await f.pressShortcut();
            assert.equal(next.hidden, true);
            assert.deepEqual([next.maximized_horizontally, next.maximized_vertically], [true, false]);
            const nextState = snapshot(next);

            f.settings.set(setting, true);
            assert.deepEqual(snapshot(next), nextState);
            if (switchOff) {
                f.settings.set(setting, false);
                assert.deepEqual(snapshot(next), nextState);
            }

            await f.pressShortcut();
            f.flush(0, 500);
            f.flush(200);
            assert.equal(next.has_focus(), true);
            assert.equal(next.hidden, false);
            assert.equal(next.fullscreen, false);
            assert.deepEqual([next.maximized_horizontally, next.maximized_vertically], [!switchOff, !switchOff]);
            assert.deepEqual(snapshot(original), originalState);

            if (switchOff) {
                assert.deepEqual(next.get_frame_rect(), { x: 320, y: 24, width: 960, height: 438 });
                f.settings.set("terminal-id", "foot.desktop");
                extension.disable();
                extension.enable();
                assert.deepEqual(snapshot(original), originalState);
                await f.pressShortcut();
                assert.equal(original.has_focus(), true);
                assert.equal(original.hidden, false);
                assert.deepEqual([original.maximized_horizontally, original.maximized_vertically], [false, true]);
                assert.deepEqual(original.get_frame_rect(), { x: 320, y: 24, width: 960, height: 876 });
            }
            assert.equal(f.launches, 0);
        } finally {
            extension.disable();
        }
    });
}

for (const whileDisabled of [false, true]) {
    test(`a Shell 49 terminal closed while ${whileDisabled ? "disabled" : "managed"} does not pass its pending restore to a new window`, async () => {
        const f = fixture(49);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js?shell=49");
        const original = f.createWindow("quake-terminal");
        const originalActor = original.get_compositor_private();
        original.maximized_horizontally = true;
        original.geometry = { x: 0, y: 90, width: 1600, height: 500 };
        original.minimize();
        f.windows.push(original);
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, true);
        const extension = new Extension();
        extension.enable();

        try {
            f.settings.set(setting, false);
            if (whileDisabled) extension.disable();
            original.close();
            assert.equal(original.listenerCount("shown"), 0);
            assert.equal(originalActor.listenerCount("notify::mapped"), 0);
            f.windows.pop();
            if (whileDisabled) extension.enable();

            const next = f.createWindow("new terminal");
            next.maximized_horizontally = true;
            next.geometry = { x: 0, y: 90, width: 1600, height: 500 };
            f.onLaunch(() => {
                f.windows.push(next);
                f.app.emit("windows-changed");
            });
            await f.pressShortcut();
            f.flush(0, 500);

            assert.equal(f.launches, 1);
            assert.equal(next.has_focus(), true);
            assert.equal(next.hidden, false);
            assert.deepEqual([next.maximized_horizontally, next.maximized_vertically], [true, false]);
            assert.deepEqual(next.get_frame_rect(), { x: 0, y: 24, width: 1600, height: 438 });
            assert.deepEqual([original.is_alive, original.activations, original.moves, original.minimizeCalls], [false, 0, 0, 1]);
        } finally {
            extension.disable();
        }
    });
}

test("turning the mode back on before recall does not apply a pending saved geometry", async () => {
    const f = fixture(49);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js?shell=49");
    const terminal = f.createWindow("quake-terminal");
    terminal.maximize();
    terminal.minimize();
    f.windows.push(terminal);
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set(setting, true);
    const extension = new Extension();
    extension.enable();

    try {
        const frame = { ...terminal.get_frame_rect() };
        f.settings.set(setting, false);
        f.settings.set(setting, true);
        assert.equal(terminal.hidden, true);
        assert.deepEqual(terminal.get_frame_rect(), frame);
        await f.pressShortcut();
        f.flush(0, 500);
        f.flush(200);
        assert.equal(terminal.has_focus(), true);
        assert.equal(terminal.is_maximized(), true);
        assert.equal(terminal.fullscreen, false);
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
    } finally {
        extension.disable();
    }
});

for (const switchOff of [false, true]) {
    for (const pressAgain of [false, true]) {
        test(`recall size wait ${switchOff ? "after switching off" : "with mode on"}, ${pressAgain ? "second key" : "one key"}`, async () => {
            const f = fixture(48);
            globalThis.shellFixture = f.host;
            const { default: Extension } = await import("../src/extension.js");
            const terminal = f.createWindow("quake-terminal");
            terminal.minimize();
            f.windows.push(terminal);
            f.settings.set("terminal-id", "foot.desktop");
            f.settings.set(setting, true);
            const extension = new Extension();
            extension.enable();
            const snapshot = () => [terminal.hidden, ...showStarts(terminal)];

            try {
                await f.pressShortcut();
                assert.equal(terminal.is_maximized(), true);
                assert.deepEqual(snapshot(), [true, 0, 0]);
                if (switchOff) f.settings.set(setting, false);
                if (pressAgain) await f.pressShortcut();
                const beforeSize = snapshot();

                terminal.geometry = { x: 0, y: 24, width: 1600, height: 876 };
                terminal.emit("size-changed");
                const afterSize = snapshot();
                f.flush(0, 500);
                const afterTimeout = snapshot();
                terminal.emit("size-changed");
                f.flush(200);

                assert.deepEqual({ beforeSize, afterSize, afterTimeout, final: snapshot() }, {
                    beforeSize: [true, 0, 0],
                    afterSize: switchOff ? [true, 0, 0] : [false, 1, 1],
                    afterTimeout: [false, 1, 1],
                    final: [false, 1, 1],
                });
                assert.equal(terminal.has_focus(), true);
                assert.equal(terminal.is_maximized(), !switchOff);
                if (switchOff) {
                    assert.deepEqual(terminal.get_frame_rect(), { x: 320, y: 24, width: 960, height: 438 });
                    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
                }
            } finally {
                extension.disable();
            }
        });
    }
}

for (const [arrival, monitor] of [
    ["already mapped", 0], ["already mapped", 1],
    ["stage-view signal", 0], ["stage-view signal", 1],
    ["stage-view timeout", 0], ["stage-view timeout", 1],
]) {
    test(`first launch on monitor ${monitor} waits for size despite a second key after ${arrival}`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("new terminal");
        const actor = terminal.get_compositor_private();
        actor.mapped = arrival === "already mapped";
        f.onLaunch(() => {
            f.windows.push(terminal);
            f.app.emit("windows-changed");
        });
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("monitor-screen", monitor);
        f.settings.set(setting, true);
        const extension = new Extension();
        extension.enable();

        try {
            const first = f.pressShortcut();
            await f.pressShortcut();
            await first;
            assert.equal(f.launches, 1);
            if (!actor.mapped) {
                await f.pressShortcut();
                assert.deepEqual(showStarts(terminal), [0, 0]);
                assert.equal(actor.hideAnimations, 0);
                actor.mapped = true;
                f.host.shell.window_manager.emit("map", actor);
                if (arrival === "stage-view signal") actor.emit("stage-views-changed");
                else f.flush(0, 5000);
            }
            assert.equal(terminal.is_maximized(), true);
            assert.deepEqual(showStarts(terminal), [0, 0]);
            terminal.emit("shown");
            actor.emit("notify::mapped");
            assert.deepEqual(showStarts(terminal), [0, 0]);
            f.focus(terminal);
            await f.pressShortcut();
            assert.deepEqual(showStarts(terminal), [0, 0]);
            assert.equal(actor.hideAnimations, 0);

            if (arrival === "stage-view timeout") f.flush(0, 500);
            else terminal.emit("size-changed");
            assert.deepEqual(showStarts(terminal), [1, 1]);
            assertMaximizedOnMonitor(terminal, monitor);
            f.flush(0, 500);
            terminal.emit("size-changed");
            f.flush(200);
            assert.deepEqual(showStarts(terminal), [1, 1]);
            assert.equal(terminal.has_focus(), true);

            await f.pressShortcut();
            assert.equal(terminal.hidden, true);
            assert.equal(terminal.minimizeCalls, 1);
        } finally {
            extension.disable();
        }
    });
}

for (const [state, hideWithoutFocus, hides, starts] of [
    ["focused", false, true, [0, 0]],
    ["shown", true, true, [0, 0]],
    ["shown", false, false, [1, 0]],
    ["hidden", false, false, [1, 1]],
]) {
    test(`first launch while off: second key with a ${state} window (hide without focus: ${hideWithoutFocus})`, async t => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("quake-terminal");
        const actor = terminal.get_compositor_private();
        const savedFrame = { x: 320, y: 24, width: 960, height: 438 };
        terminal.geometry = { x: 50, y: 80, width: 780, height: 540 };
        f.onLaunch(() => {
            f.windows.push(terminal);
            f.app.emit("windows-changed");
        });
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("hide-on-toggle-without-focus", hideWithoutFocus);
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());

        await f.pressShortcut();
        assert.equal(terminal.listenerCount("size-changed"), 1);
        assert.deepEqual(showStarts(terminal), [0, 0]);
        if (state === "focused") f.focus(terminal);
        if (state === "hidden") terminal.minimize();
        const minimizesBeforeKey = terminal.minimizeCalls;
        f.settings.set(setting, false);
        actor.deferAnimations = hides;

        await f.pressShortcut();
        assert.equal(actor.hideAnimations, Number(hides));
        assert.deepEqual(showStarts(terminal), starts);
        assert.deepEqual(terminal.get_frame_rect(), savedFrame);
        if (hides) {
            assert.equal(terminal.minimizeCalls, minimizesBeforeKey);
            actor.advanceAnimation(1);
        } else {
            assert.equal(terminal.has_focus(), true);
            assert.equal(terminal.monitor, 0);
        }
        assert.equal(terminal.minimizeCalls, minimizesBeforeKey + Number(hides));
        assert.equal(terminal.hidden, hides);
        assert.equal(f.launches, 1);
    });
}

for (const switchDuring of ["launch before acquiring the window", "initial size wait"]) {
    test(`first launch preserves its size wait when mode ends off after a switch during ${switchDuring}`, async t => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("new terminal");
        const actor = terminal.get_compositor_private();
        const initialEnabled = switchDuring === "initial size wait";
        terminal.geometry = { x: 50, y: 80, width: 780, height: 540 };
        f.onLaunch(() => {
            if (!initialEnabled) {
                f.settings.set(setting, true);
                f.settings.set(setting, false);
            }
            f.windows.push(terminal);
            f.app.emit("windows-changed");
        });
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, initialEnabled);
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());

        await f.pressShortcut();
        assert.equal(terminal.listenerCount("size-changed"), 1);
        f.focus(terminal);
        if (initialEnabled) {
            assert.equal(terminal.is_maximized(), true);
            f.settings.set(setting, false);
        }
        assert.deepEqual(showStarts(terminal), [0, 0]);
        await f.pressShortcut();
        assert.deepEqual(showStarts(terminal), [0, 0]);
        assert.equal(actor.hideAnimations, 0);

        if (initialEnabled) {
            terminal.geometry = { x: 0, y: 24, width: 1600, height: 876 };
            terminal.emit("size-changed");
            assert.equal(terminal.listenerCount("size-changed"), 1);
            await f.pressShortcut();
            assert.deepEqual(showStarts(terminal), [0, 0]);
            assert.equal(actor.hideAnimations, 0);
        }

        f.flush(0, 500);
        terminal.emit("size-changed");
        f.flush(0, 500);
        assert.deepEqual(showStarts(terminal), [1, 1]);
        assert.equal(terminal.hidden, false);
        assert.equal(terminal.has_focus(), true);
        assert.deepEqual(windowShape(terminal), {
            axes: [false, false],
            fullscreen: false,
            frame: { x: 320, y: 24, width: 960, height: 438 },
        });
        assert.equal(terminal.monitor, 0);
        assert.equal(f.launches, 1);
    });
}

for (const purpose of ["launch", "recall"]) {
    for (const end of ["disable", "unmanaged"]) {
        test(`a pending ${purpose} size wait does not show a terminal after ${end}`, async () => {
            const f = fixture(45);
            globalThis.shellFixture = f.host;
            const { default: Extension } = await import("../src/extension.js?shell=45");
            const terminal = f.createWindow("new terminal");
            const actor = terminal.get_compositor_private();
            f.settings.set("terminal-id", "foot.desktop");
            f.settings.set(setting, true);
            const extension = new Extension();
            extension.enable();
            let disabled = false;

            try {
                if (purpose === "recall") {
                    await launchManagedWindow(f, terminal);
                    terminal.minimize();
                    terminal.unmaximize(3);
                } else {
                    f.onLaunch(() => {
                        f.windows.push(terminal);
                        f.app.emit("windows-changed");
                    });
                }
                const starts = showStarts(terminal);
                await f.pressShortcut();
                assert.equal(terminal.is_maximized(), true);
                assert.equal(terminal.listenerCount("size-changed"), 1);
                assert.deepEqual(showStarts(terminal), starts);
                const frame = { ...terminal.get_frame_rect() };
                const hidden = terminal.hidden;
                if (end === "disable") {
                    extension.disable();
                    disabled = true;
                } else {
                    f.windows.pop();
                    terminal.close();
                }
                terminal.emit("shown");
                actor.emit("notify::mapped");
                terminal.emit("size-changed");
                f.flush(0, 500);
                f.flush(200);
                assert.deepEqual([terminal.activations, actor.showAnimations], starts);
                assert.equal(terminal.hidden, hidden);
                assert.deepEqual(terminal.get_frame_rect(), frame);
                assert.deepEqual(f.app.get_windows(), disabled ? [terminal] : []);
                assert.equal(terminal.get_compositor_private(), disabled ? actor : null);
            } finally {
                if (!disabled) extension.disable();
            }
        });
    }
}

test("first launch ignores preexisting and transient windows and applies normal maximization", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { QuakeMode } = await import("../src/quake-mode.js");
    const other = f.createWindow("other");
    const dialog = f.createWindow("dialog");
    const terminal = f.createWindow("new terminal");
    terminal.make_fullscreen();
    dialog.get_transient_for = () => other;
    f.windows.push(other);
    f.onLaunch(() => {
        f.windows.push(dialog);
        f.app.emit("windows-changed");
        f.windows.push(terminal);
        f.app.emit("windows-changed");
    });
    const mode = new QuakeMode(f.app, f.settings, { enabled: true });

    await mode.toggle();
    f.flush(0);
    f.flush(200);
    assert.equal(mode.terminalWindow, terminal);
    assert.equal(terminal.is_maximized(), true);
    assert.equal(terminal.fullscreen, false);
    assert.equal(terminal.has_focus(), true);
    assert.equal(other.moves + dialog.moves, 0);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);

    f.settings.set("auto-hide-window", true);
    const clipboard = { title: "wl-clipboard", get_client_type: () => 1, get_pid: () => 123 };
    f.focus(clipboard);
    f.flush(200);
    await setImmediate();
    assert.equal(terminal.hidden, false);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);

    terminal.maximized_horizontally = false;
    f.focus(terminal);
    f.flush(200);
    assert.equal(terminal.is_maximized(), false);
    assert.equal(f.panel.visible, true);
    f.settings.set("auto-hide-window", false);
    f.focus(other);
    f.settings.set("hide-on-toggle-without-focus", true);
    await mode.toggle();
    f.flush(200);
    assert.equal(terminal.hidden, true);
    assert.equal(terminal.is_maximized(), false);
    f.settings.set("hide-on-toggle-without-focus", false);
    await mode.toggle();
    f.flush(0);
    f.flush(200);
    assert.equal(terminal.hidden, false);
    assert.equal(terminal.is_maximized(), true);

    terminal.maximized_horizontally = false;
    f.focus(other);
    await mode.toggle();
    f.flush(200);
    assert.equal(terminal.is_maximized(), true);
    assert.equal(f.panel.visible, false);
    f.settings.set("auto-hide-window", true);
    f.focus(other);
    await setImmediate();
    f.flush(200);
    assert.equal(terminal.hidden, true);
    assert.equal(f.panel.visible, true);
    mode.destroy();
});

test("losing focus restores the panel and leaves the terminal visible and maximized when auto-hide is off", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { QuakeMode } = await import("../src/quake-mode.js");
    const terminal = f.createWindow("new terminal");
    const sameApp = f.createWindow("another window of the same app");
    const dialog = f.createWindow("dialog of the same app");
    dialog.get_transient_for = () => terminal;
    f.windows.push(sameApp);
    f.onLaunch(() => {
        f.windows.push(terminal);
        f.app.emit("windows-changed");
    });
    const clipboard = f.createWindow("wl-clipboard");
    clipboard.get_pid = () => 123;
    const other = f.createWindow("other app");
    f.settings.set("auto-hide-window", false);
    const mode = new QuakeMode(f.app, f.settings, { enabled: true });

    try {
        await mode.toggle();
        f.flush(0);
        f.flush(200);
        assert.equal(terminal.has_focus(), true);
        assert.equal(terminal.is_maximized(), true);
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
        f.windows.push(dialog);
        f.app.emit("windows-changed");

        for (const target of [sameApp, dialog, clipboard, other]) {
            f.focus(target);
            await setImmediate();
            f.flush(200);

            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true], target.title);
            assert.equal(terminal.hidden, false, target.title);
            assert.equal(terminal.is_maximized(), true, target.title);
            assert.equal(terminal.fullscreen, false, target.title);

            f.focus(terminal);
            f.flush(200);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false], target.title);
        }
    } finally {
        mode.destroy();
    }
});

test("configuration changes restore only the panel reservation and never reposition windows", async () => {
    const f = fixture(49);
    globalThis.shellFixture = f.host;
    const { QuakeMode } = await import("../src/quake-mode.js?shell=49");
    const terminal = f.createWindow("quake-terminal");
    f.windows.push(terminal);
    const mode = new QuakeMode(f.app, f.settings, { enabled: true });
    await mode.toggle();
    f.flush(200);
    assert.equal(terminal.is_maximized(), true);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts, f.foreign.affectsStruts], [false, false, true]);
    const moves = terminal.moves;

    terminal.monitor = 1;
    f.host.shell.display.emit("window-entered-monitor", 1, terminal);
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts, f.foreign.affectsStruts], [true, true, true]);

    f.primaryMonitor.index = 1;
    f.host.layoutManager.emit("monitors-changed");
    f.flush(200);
    assert.equal(f.panel.visible, false);
    f.host.layoutManager.primaryMonitor = null;
    f.host.layoutManager.emit("monitors-changed");
    f.flush(200);
    assert.equal(f.panel.visible, true);
    f.host.layoutManager.primaryMonitor = f.primaryMonitor;
    f.host.layoutManager.emit("monitors-changed");
    f.flush(200);
    assert.equal(f.panel.visible, false);
    assert.equal(terminal.moves, moves);

    f.host.overview.visible = true;
    f.host.overview.emit("showing");
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
    f.host.overview.visible = false;
    f.host.overview.emit("hidden");
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
    f.host.sessionMode.isLocked = true;
    f.host.sessionMode.emit("updated");
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
    f.host.sessionMode.isLocked = false;
    f.host.sessionMode.emit("updated");
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);

    f.focus(null);
    mode.destroy();
    f.focus(terminal);
    f.flush(200);
    assert.equal(terminal.is_maximized(), true);
    assert.equal(terminal.is_alive, true);
    assert.equal(terminal.hidden, false);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts, f.foreign.affectsStruts], [true, true, true]);
});

for (const useStageViewSignal of [true, false]) {
    test(useStageViewSignal
        ? "first launch also applies the mode after map and stage-view notifications"
        : "first launch applies the mode when the stage-view notification times out", async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { QuakeMode } = await import("../src/quake-mode.js");
        const terminal = f.createWindow("new terminal");
        const actor = terminal.get_compositor_private();
        actor.mapped = false;
        f.onLaunch(() => {
            f.windows.push(terminal);
            f.app.emit("windows-changed");
        });
        const mode = new QuakeMode(f.app, f.settings, { enabled: true });

        try {
            await mode.toggle();
            assert.equal(terminal.is_maximized(), false);
            actor.mapped = true;
            f.host.shell.window_manager.emit("map", actor);
            assert.equal(terminal.is_maximized(), false);
            if (useStageViewSignal) actor.emit("stage-views-changed");
            else f.flush(0);
            terminal.emit("size-changed");
            f.flush(200);
            assert.equal(terminal.is_maximized(), true);
            assert.equal(terminal.fullscreen, false);
            assert.equal(terminal.has_focus(), true);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
        } finally {
            mode.destroy();
        }
    });
}

test("managed window lookup requires its actor but not a mapped window", async () => {
    const f = fixture(45);
    globalThis.shellFixture = f.host;
    const { QuakeMode } = await import("../src/quake-mode.js?shell=45");
    const closed = f.createWindow("quake-terminal");
    const ordinary = f.createWindow("ordinary terminal");
    f.windows.push(closed, ordinary);
    closed.close();
    assert.equal(closed.get_compositor_private(), null);
    assert.ok(!QuakeMode.findManagedWindow(f.app));

    f.windows.shift();
    assert.deepEqual(f.app.get_windows(), [ordinary]);
    assert.ok(!QuakeMode.findManagedWindow(f.app));

    const managed = f.createWindow("quake-terminal");
    managed.minimize();
    f.windows.push(managed);
    assert.equal(QuakeMode.findManagedWindow(f.app), managed);
});

test("restoring the reservation does not override the Shell's fullscreen panel visibility", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { PanelAutohide } = await import("../src/panel-autohide.js");
    const terminal = f.createWindow("quake-terminal");
    terminal.maximize(3);
    f.focus(terminal);
    const panelAutohide = new PanelAutohide();
    panelAutohide.setEnabled(true);
    panelAutohide.watch(terminal);

    try {
        f.flush(200);
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
        assert.equal(terminal.get_work_area_for_monitor(0).y, 0);

        f.primaryMonitor.inFullscreen = true;
        terminal.make_fullscreen();
        f.flush(200);

        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, true]);
        assert.equal(terminal.get_work_area_for_monitor(0).y, 24);
    } finally {
        panelAutohide.destroy();
    }
});

for (const [release, horizontal, vertical] of [
    ["horizontal", true, false],
    ["vertical", false, true],
    ["both", true, true],
]) {
    test(`maximization notifications restore the panel after ${release} release`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { PanelAutohide } = await import("../src/panel-autohide.js");
        const terminal = f.createWindow("quake-terminal");
        const areaBefore = terminal.get_work_area_for_monitor(0);
        terminal.maximize(3);
        f.focus(terminal);
        const panelAutohide = new PanelAutohide();
        panelAutohide.setEnabled(true);
        panelAutohide.watch(terminal);

        try {
            f.flush(200);
            assert.equal(f.panel.visible, false);
            assert.deepEqual(terminal.get_work_area_for_monitor(0), { x: 0, y: 0, width: 1600, height: 900 });

            terminal.maximized_horizontally = !horizontal;
            terminal.maximized_vertically = !vertical;
            if (horizontal) terminal.emit("notify::maximized-horizontally");
            if (vertical) terminal.emit("notify::maximized-vertically");
            f.flush(200);

            assert.equal(terminal.has_focus(), true);
            assert.deepEqual(
                { visible: f.panel.visible, workArea: terminal.get_work_area_for_monitor(0) },
                { visible: true, workArea: areaBefore }
            );
        } finally {
            panelAutohide.destroy();
        }
    });
}

test("reenabling the extension resumes control of the surviving terminal without recalling it", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const terminal = f.createWindow("quake-terminal");
    f.windows.push(terminal);
    terminal.maximize(3);
    f.focus(terminal);
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set(setting, true);
    const extension = new Extension();

    extension.enable();
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
    const frame = { ...terminal.get_frame_rect() };
    extension.disable();
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
    assert.deepEqual(terminal.get_frame_rect(), frame);
    assert.equal(terminal.is_alive, true);
    extension.enable();
    f.flush(200);
    assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
    assert.equal(terminal.is_alive, true);
    assert.equal(terminal.is_maximized(), true);
    assert.equal(terminal.hidden, false);
    assert.equal(terminal.moves, 0);
    extension.disable();
});

for (const firstKey of [false, true]) {
    const entry = firstKey ? "the first shortcut" : "reenabling the extension";
    test(`Shell 45: ${entry} adopts the surviving terminal for panel and geometry changes`, async t => {
        const f = fixture(45);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js?shell=45");
        const terminal = f.createWindow("quake-terminal");
        const actor = terminal.get_compositor_private();
        const ordinary = f.createWindow("ordinary terminal");
        ordinary.maximize(3);
        const ordinaryShape = windowShape(ordinary);
        const secondFrame = monitorFrames[1];
        f.windows.push(ordinary, terminal);
        f.settings.set(setting, true);
        f.settings.set("auto-hide-window", false);
        if (firstKey) {
            const otherId = "org.gnome.Console.desktop";
            f.createApp(otherId, []);
            f.settings.set("terminal-id", otherId);
            terminal.monitor = 1;
            terminal.minimize();
        } else {
            f.settings.set("terminal-id", "foot.desktop");
            terminal.maximize(3);
            f.focus(terminal);
        }
        const extension = new Extension();
        extension.enable();
        t.after(() => extension.disable());

        if (firstKey) {
            f.settings.set("terminal-id", "foot.desktop");
            const recalled = f.pressShortcut();
            await setImmediate();
            f.flush(0, 5000);
            await recalled;
            assert.equal(f.launches, 0, "reuse must not launch another instance");
            terminal.emit("size-changed");
            assert.deepEqual(showStarts(terminal), [1, 1]);
        } else {
            extension.disable();
            extension.enable();
            assert.deepEqual(showStarts(terminal), [0, 0]);
        }
        assert.equal(terminal.monitor, 0);
        assert.equal(terminal.has_focus(), true);
        f.flush(200);
        const panelState = () => [
            f.panel.visible, f.tracked.affectsStruts, f.foreign.affectsStruts, terminal.get_work_area_for_monitor(0).y,
        ];
        assert.deepEqual(panelState(), [false, false, true, 0]);
        f.focus(ordinary);
        f.flush(200);
        assert.deepEqual(panelState(), [true, true, true, 24]);
        assert.equal(terminal.is_maximized(), true);
        assert.equal(terminal.hidden, false);
        assert.deepEqual(windowShape(ordinary), ordinaryShape);
        assert.deepEqual([ordinary.moves, ordinary.activations, ordinary.minimizeCalls], [0, 0, 0]);

        terminal.monitor = 1;
        terminal.geometry = { ...secondFrame };
        f.host.shell.display.emit("window-entered-monitor", 1, terminal);
        f.focus(terminal);
        f.flush(200);
        assert.deepEqual(panelState(), [true, true, true, 24]);
        const readSaved = () => ["horizontal-size", "vertical-size", "horizontal-alignment"].map(key => f.settings.get_int(key));
        const saved = readSaved();
        const previousStarts = showStarts(terminal);
        f.settings.set(setting, false);
        assert.deepEqual(windowShape(terminal), {
            axes: [false, false],
            fullscreen: false,
            frame: { x: 1856, y: 0, width: 768, height: 400 },
        });
        assert.deepEqual(readSaved(), saved);
        f.settings.set(setting, true);
        assert.deepEqual(windowShape(terminal), { axes: [true, true], fullscreen: false, frame: secondFrame });
        assert.deepEqual(readSaved(), saved);
        assert.equal(terminal.monitor, 1);
        assert.equal(terminal.hidden, false);
        assert.deepEqual(showStarts(terminal), previousStarts);
        assert.equal(f.launches, 0);
        assert.deepEqual(f.app.get_windows(), [ordinary, terminal]);
        assert.equal(terminal.get_compositor_private(), actor);
    });
}

for (const target of ["the same application", "the newly selected application", "another managed window"]) {
    test(`first key after reenable selects ${target}`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const original = f.createWindow("quake-terminal");
        original.maximize(3);
        f.windows.push(original);
        f.focus(original);
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, true);
        f.settings.set("auto-hide-window", false);
        const extension = new Extension();
        extension.enable();
        extension.disable();
        extension.enable();
        f.flush(200);

        try {
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
            if (target === "the same application") {
                await f.pressShortcut();
                assert.equal(original.hidden, true);
                assert.equal(original.minimizeCalls, 1);
                assert.equal(f.launches, 0);
                return;
            }

            const recall = target === "another managed window";
            const next = f.createWindow(recall ? "quake-terminal" : "new terminal");
            const nextId = "org.gnome.Console.desktop";
            const nextWindows = [];
            const nextApp = f.createApp(nextId, nextWindows);
            if (recall) {
                next.minimize();
                nextWindows.push(next);
            } else {
                f.onLaunch(() => {
                    nextWindows.push(next);
                    nextApp.emit("windows-changed");
                });
            }
            const frame = { ...original.get_frame_rect() };
            const moves = original.moves;
            f.settings.set("terminal-id", nextId);
            await f.pressShortcut();

            assert.equal(original.hidden, false);
            assert.equal(original.is_alive, true);
            assert.equal(original.is_maximized(), true);
            assert.equal(original.minimizeCalls, 0);
            assert.equal(original.moves, moves);
            assert.deepEqual(showStarts(original), [0, 0]);
            assert.deepEqual(original.get_frame_rect(), frame);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);

            next.emit("size-changed");
            f.flush(200);
            assert.equal(f.launches, recall ? 0 : 1);
            assert.equal(next.has_focus(), true);
            assert.equal(next.hidden, false);
            assert.equal(next.is_maximized(), true);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
        } finally {
            extension.disable();
        }
    });
}

for (const [key, updated, frame] of [
    ["horizontal-size", 70, { x: 240, y: 24, width: 1120, height: 438 }],
    ["vertical-size", 60, { x: 320, y: 24, width: 960, height: 526 }],
    ["horizontal-alignment", 0, { x: 0, y: 24, width: 960, height: 438 }],
]) {
    test(`before the first key after reenable, ${key} is saved without moving or resizing`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("quake-terminal");
        f.windows.push(terminal);
        f.focus(f.createWindow("other app"));
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, false);
        f.settings.set("auto-hide-window", false);
        const extension = new Extension();
        extension.enable();
        extension.disable();
        extension.enable();

        try {
            const originalValue = f.settings.get_int(key);
            const originalFrame = { ...terminal.get_frame_rect() };
            f.settings.set(key, updated);
            assert.equal(f.settings.get_int(key), updated);
            assert.equal(terminal.hidden, false);
            assert.deepEqual({ frame: terminal.get_frame_rect(), moves: terminal.moves }, { frame: originalFrame, moves: 0 });

            await f.pressShortcut();
            assert.equal(terminal.has_focus(), true);
            assert.deepEqual(terminal.get_frame_rect(), frame);
            f.settings.set(key, originalValue);
            assert.equal(f.settings.get_int(key), originalValue);
            assert.deepEqual(terminal.get_frame_rect(), originalFrame);
        } finally {
            extension.disable();
        }
    });
}

for (const [key, readWindowValue] of [
    ["always-on-top", window => window.is_above()],
    ["skip-taskbar", window => window.skip_taskbar],
]) {
    for (const initial of [false, true]) {
        const updated = !initial;
        test(`before the first key after reenable, ${key}=${updated} is saved without changing the window`, async () => {
            const f = fixture(48);
            globalThis.shellFixture = f.host;
            const { default: Extension } = await import("../src/extension.js");
            const terminal = f.createWindow("quake-terminal");
            const actor = terminal.get_compositor_private();
            const other = f.createWindow("other app");
            f.windows.push(terminal);
            f.focus(other);
            f.settings.set("terminal-id", "foot.desktop");
            f.settings.set(setting, false);
            f.settings.set("auto-hide-window", false);
            f.settings.set(key, key === "skip-taskbar" && initial);
            const extension = new Extension();
            extension.enable();

            try {
                await f.pressShortcut();
                if (key === "always-on-top" && initial) f.settings.set(key, true);
                assert.equal(readWindowValue(terminal), initial);
                extension.disable();
                f.focus(other);
                extension.enable();

                assert.equal(f.settings.get_boolean(key), initial);
                assert.equal(terminal.hidden, false);
                assert.equal(actor.mapped, true);
                assert.equal(terminal.is_skip_taskbar(), false);
                assert.equal(readWindowValue(terminal), initial);
                f.settings.set(key, updated);
                assert.equal(f.settings.get_boolean(key), updated);
                assert.equal(readWindowValue(terminal), initial, "the setting must not affect the window before the first key");

                await f.pressShortcut();
                assert.equal(terminal.has_focus(), true);
                assert.equal(terminal.get_compositor_private(), actor);
                assert.equal(f.launches, 0);
                assert.equal(readWindowValue(terminal), key === "skip-taskbar" ? updated : initial);

                f.settings.set(key, initial);
                assert.equal(readWindowValue(terminal), initial);
                f.settings.set(key, updated);
                assert.equal(readWindowValue(terminal), updated);
            } finally {
                extension.disable();
            }
        });
    }
}

for (const [alwaysOnTop, skipTaskbar] of [[true, true], [false, true], [true, false]]) {
    test(`new launch applies always-on-top=${alwaysOnTop} and skip-taskbar=${skipTaskbar}`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("new terminal");
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set("always-on-top", alwaysOnTop);
        f.settings.set("skip-taskbar", skipTaskbar);
        f.onLaunch(() => {
            f.windows.push(terminal);
            f.app.emit("windows-changed");
        });
        const extension = new Extension();
        extension.enable();

        try {
            await f.pressShortcut();
            assert.equal(f.launches, 1);
            assert.equal(terminal.get_compositor_private().get_name(), "quake-terminal");
            assert.equal(terminal.is_above(), alwaysOnTop);
            assert.equal(terminal.skip_taskbar, skipTaskbar);
        } finally {
            extension.disable();
        }
    });
}

test("before the first key, a mode change still applies immediately on the current monitor", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const terminal = f.createWindow("quake-terminal");
    terminal.monitor = 1;
    f.windows.push(terminal);
    f.focus(terminal);
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set("monitor-screen", 0);
    const extension = new Extension();
    extension.enable();

    try {
        f.settings.set(setting, true);
        assert.equal(terminal.is_maximized(), true);
        f.settings.set(setting, false);
        assert.equal(terminal.is_maximized(), false);
        assert.equal(terminal.get_monitor(), 1);
        assert.equal(terminal.hidden, false);
        assert.deepEqual(terminal.get_frame_rect(), { x: 1856, y: 0, width: 768, height: 400 });
    } finally {
        extension.disable();
    }
});

for (const acquisition of ["early adoption", "lazy adoption", "new launch"]) {
    test(`auto-hide observes focus exactly once after ${acquisition}`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow(acquisition === "new launch" ? "new terminal" : "quake-terminal");
        const other = f.createWindow("other app");
        const clipboard = f.createWindow("wl-clipboard");
        clipboard.get_pid = () => 123;
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, true);
        f.settings.set("auto-hide-window", false);
        const extension = new Extension();
        if (acquisition === "early adoption") {
            terminal.maximize(3);
            f.windows.push(terminal);
            f.focus(terminal);
            extension.enable();
            extension.disable();
        }
        extension.enable();

        try {
            if (acquisition === "lazy adoption") {
                f.windows.push(terminal);
                await f.pressShortcut();
            } else if (acquisition === "new launch") {
                f.onLaunch(() => {
                    f.windows.push(terminal);
                    f.app.emit("windows-changed");
                });
                await f.pressShortcut();
                terminal.emit("size-changed");
            }
            f.flush(200);
            assert.equal(terminal.has_focus(), true);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);

            f.focus(other);
            await setImmediate();
            f.flush(200);
            assert.equal(terminal.hidden, false);
            assert.equal(terminal.minimizeCalls, 0);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);

            f.settings.set("auto-hide-window", true);
            f.focus(terminal);
            f.flush(200);
            await setImmediate();
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
            f.focus(clipboard);
            await setImmediate();
            f.flush(200);
            assert.equal(terminal.hidden, false);
            assert.equal(terminal.minimizeCalls, 0);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);

            f.focus(terminal);
            f.flush(200);
            await setImmediate();
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
            const actor = terminal.get_compositor_private();
            actor.deferAnimations = true;
            f.focus(other);
            await setImmediate();
            f.flush(200);
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
            assert.equal(actor.hideAnimations, 1);
            actor.advanceAnimation(1);
            assert.equal(terminal.minimizeCalls, 1);
            assert.equal(terminal.hidden, true);
        } finally {
            extension.disable();
        }
    });
}

async function startAutoHide(t, duration) {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const terminal = f.createWindow("quake-terminal");
    const actor = terminal.get_compositor_private();
    const frame = { x: 0, y: 24, width: 1600, height: 876 };
    const clip = [6, 8, 1500, 800];
    terminal.geometry = { ...frame };
    actor.width = frame.width;
    actor.height = frame.height;
    actor.set_clip(...clip);
    actor.deferAnimations = true;
    terminal.maximize(3);
    f.windows.push(terminal);
    f.focus(terminal);
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set(setting, true);
    f.settings.set("auto-hide-window", true);
    f.settings.set("animation-time", duration);
    const extension = new Extension();
    extension.enable();
    t.after(() => extension.disable());
    f.flush(200);
    assert.equal(f.panel.visible, false);
    assert.deepEqual(terminal.get_work_area_for_monitor(0), { x: 0, y: 0, width: 1600, height: 900 });

    f.focus(f.createWindow("other app"));
    await setImmediate();
    assert.equal(actor.hideAnimations, 1);
    assert.equal(actor.lastDuration, duration);
    if (duration > 0) {
        actor.advanceAnimation(0.5);
        assert.equal(terminal.hidden, false);
        assert.equal(terminal.minimizeCalls, 0);
        assert.equal(actor.translation_y, -frame.height / 2);
        assert.equal(actor.get_clip()[1], frame.height / 2);
    }
    return { f, extension, terminal, actor, frame, clip };
}

for (const beforeCompletion of [true, false]) {
    test(`auto-hide: disabling ${beforeCompletion ? "before" : "after"} completion preserves the terminal`, async t => {
        const { f, extension, terminal, actor, frame, clip } = await startAutoHide(t, 125);
        if (!beforeCompletion) actor.advanceAnimation(1);
        extension.disable();

        const assertStopped = () => {
            assert.equal(terminal.hidden, !beforeCompletion);
            assert.equal(actor.mapped, beforeCompletion);
            assert.equal(terminal.is_alive, true);
            assert.equal(terminal.is_maximized(), true);
            assert.deepEqual(terminal.get_frame_rect(), frame);
            assert.equal(terminal.moves, 0);
            assert.equal(actor.translation_y, 0);
            assert.deepEqual(actor.get_clip(), clip);
            assert.equal(terminal.minimizeCalls, beforeCompletion ? 0 : 1);
            assert.equal(actor.skipEffectCalls, beforeCompletion ? 0 : 1);
            assert.equal(f.panel.visible, true);
            assert.deepEqual(terminal.get_work_area_for_monitor(0), frame);
        };
        assertStopped();
        actor.advanceAnimation(1);
        f.flush(200);
        assertStopped();
    });
}

for (const close of ["no close", "Shell close animation", "actor destroyed before unmanaged"]) {
    test(`auto-hide: window lifetime after ${close}`, async t => {
        const { f, terminal, actor, frame } = await startAutoHide(t, 125);
        if (close === "no close") {
            actor.advanceAnimation(1);
            f.flush(200);
            assert.equal(terminal.minimizeCalls, 1);
            assert.equal(actor.skipEffectCalls, 1);
            assert.equal(terminal.hidden, true);
            assert.equal(terminal.is_alive, true);
            assert.equal(f.panel.visible, true);
            assert.deepEqual(terminal.get_work_area_for_monitor(0), frame);
            return;
        }

        const shellClose = close === "Shell close animation";
        const hideTransition = actor.get_transition("translation-y");
        terminal.close(shellClose);
        assert.equal(terminal.is_alive, false);
        assert.equal(terminal.get_compositor_private(), null);
        assert.equal(actor.destroyed, !shellClose);
        assert.equal(terminal.minimizeCalls, 0);
        assert.equal(actor.skipEffectCalls, 0);
        assert.equal(f.panel.visible, true);
        assert.deepEqual(terminal.get_work_area_for_monitor(0), frame);
        if (shellClose) {
            const closeTransition = actor.get_transition("translation-y");
            assert.ok(closeTransition);
            assert.notEqual(closeTransition, hideTransition);
            assert.equal(actor.translation_y, -frame.height / 2);
            actor.advanceAnimation(0.5);
            assert.equal(actor.translation_y, -frame.height * 0.75);
            assert.equal(actor.get_clip()[1], frame.height * 0.75);
        }

        const next = f.createWindow("quake-terminal");
        const nextActor = next.get_compositor_private();
        next.maximize(3);
        f.windows.push(next);
        await f.pressShortcut();
        f.flush(200);
        assert.equal(f.panel.visible, false);
        assert.equal(next.get_work_area_for_monitor(0).y, 0);

        actor.advanceAnimation(1);
        f.flush(200);
        assert.equal(actor.destroyed, true);
        assert.equal(actor.closeCompletions, Number(shellClose));
        assert.equal(terminal.minimizeCalls, 0);
        assert.equal(actor.skipEffectCalls, 0);
        assert.equal(next.has_focus(), true);
        assert.equal(next.hidden, false);
        assert.equal(next.minimizeCalls, 0);
        assert.equal(nextActor.skipEffectCalls, 0);
        assert.equal(f.panel.visible, false);
        assert.equal(next.get_work_area_for_monitor(0).y, 0);
    });
}

for (const beforeCompletion of [true, false]) {
    test(`auto-hide: the first key selects a different terminal ${beforeCompletion ? "before" : "after"} completion`, async t => {
        const { f, terminal, actor, frame, clip } = await startAutoHide(t, 125);
        const next = f.createWindow("quake-terminal");
        const nextActor = next.get_compositor_private();
        const nextId = "org.gnome.Console.desktop";
        next.maximize(3);
        f.createApp(nextId, [next]);
        f.settings.set("terminal-id", nextId);

        if (!beforeCompletion) actor.advanceAnimation(1);
        await f.pressShortcut();
        f.flush(200);
        actor.advanceAnimation(1);
        f.flush(200);
        assert.equal(terminal.hidden, !beforeCompletion);
        assert.equal(actor.mapped, beforeCompletion);
        assert.equal(terminal.is_alive, true);
        assert.equal(terminal.is_maximized(), true);
        assert.deepEqual(terminal.get_frame_rect(), frame);
        assert.equal(terminal.moves, 0);
        assert.equal(terminal.activations, 0);
        assert.equal(terminal.minimizeCalls, beforeCompletion ? 0 : 1);
        assert.equal(actor.skipEffectCalls, beforeCompletion ? 0 : 1);
        assert.equal(actor.translation_y, 0);
        assert.deepEqual(actor.get_clip(), clip);
        assert.equal(next.hidden, false);
        assert.equal(next.has_focus(), true);
        assert.equal(next.activations, 1);
        assert.equal(next.minimizeCalls, 0);
        assert.equal(nextActor.skipEffectCalls, 0);
        assert.equal(f.panel.visible, false);
        assert.equal(next.get_work_area_for_monitor(0).y, 0);
    });
}

test("auto-hide: a zero-duration animation minimizes once before disable", async t => {
    const { f, extension, terminal, actor, frame, clip } = await startAutoHide(t, 0);
    assert.equal(terminal.hidden, true);
    assert.equal(terminal.minimizeCalls, 1);
    assert.equal(actor.skipEffectCalls, 1);
    extension.disable();
    actor.advanceAnimation(1);
    f.flush(200);
    assert.equal(terminal.hidden, true);
    assert.equal(terminal.is_alive, true);
    assert.equal(terminal.minimizeCalls, 1);
    assert.equal(actor.skipEffectCalls, 1);
    assert.equal(actor.translation_y, 0);
    assert.deepEqual(actor.get_clip(), clip);
    assert.deepEqual(terminal.get_frame_rect(), frame);
    assert.equal(f.panel.visible, true);
    assert.deepEqual(terminal.get_work_area_for_monitor(0), frame);
});

for (const end of ["another clipboard helper gets focus", "disable", "unmanaged", "no interruption"]) {
    const shouldHide = end === "no interruption";
    test(shouldHide
        ? "a pending clipboard check hides a still-managed terminal when the helper exits"
        : `a pending clipboard check does not hide a terminal after ${end}`, async () => {
        const f = fixture(48);
        globalThis.shellFixture = f.host;
        const { default: Extension } = await import("../src/extension.js");
        const terminal = f.createWindow("new terminal");
        const firstClipboard = f.createWindow("wl-clipboard");
        firstClipboard.get_pid = () => 123;
        const nextClipboard = f.createWindow("wl-clipboard");
        nextClipboard.get_pid = () => 456;
        let failRead;
        const newForPath = f.host.gio.File.new_for_path;
        f.host.gio.File.new_for_path = path => path === "/proc/123/cmdline" ? {
            load_contents_async: () => new Promise((_resolve, reject) => {
                failRead = () => reject(new Error("clipboard helper exited"));
            }),
        } : newForPath(path);
        f.onLaunch(() => {
            f.windows.push(terminal);
            f.app.emit("windows-changed");
        });
        f.settings.set("terminal-id", "foot.desktop");
        f.settings.set(setting, true);
        f.settings.set("auto-hide-window", true);
        const extension = new Extension();
        extension.enable();
        let disabled = false;

        try {
            await f.pressShortcut();
            terminal.emit("size-changed");
            f.flush(200);
            await setImmediate();
            assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
            const frame = { ...terminal.get_frame_rect() };
            f.focus(firstClipboard);
            assert.equal(typeof failRead, "function");
            let nextTerminal;

            if (end === "disable") {
                extension.disable();
                disabled = true;
            } else if (end === "unmanaged") {
                terminal.is_alive = false;
                f.windows.pop();
                terminal.emit("unmanaged");
                assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
                nextTerminal = f.createWindow("quake-terminal");
                f.windows.push(nextTerminal);
                await f.pressShortcut();
            } else if (!shouldHide) {
                f.focus(nextClipboard);
            }
            failRead();
            await setImmediate();
            f.flush(200);
            assert.equal(terminal.minimizeCalls, Number(shouldHide));
            assert.deepEqual(terminal.get_frame_rect(), frame);
            assert.equal(terminal.is_alive, end !== "unmanaged");
            if (nextTerminal) {
                assert.equal(nextTerminal.has_focus(), true);
                assert.equal(nextTerminal.hidden, false);
                assert.equal(nextTerminal.minimizeCalls, 0);
            } else {
                assert.equal(terminal.hidden, shouldHide);
                assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
            }
        } finally {
            if (!disabled) extension.disable();
        }
    });
}

test("the next configured terminal application uses the same enabled mode", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { default: Extension } = await import("../src/extension.js");
    const first = f.createWindow("first terminal");
    const next = f.createWindow("next terminal");
    const nextId = "org.gnome.Console.desktop";
    const nextWindows = [];
    const nextApp = f.createApp(nextId, nextWindows);
    next.make_fullscreen();
    f.settings.set("terminal-id", "foot.desktop");
    f.settings.set(setting, true);
    const show = async () => {
        const shown = f.pressShortcut();
        await setImmediate();
        f.flush(0);
        await shown;
        f.flush(200);
    };
    const extension = new Extension();
    extension.enable();

    try {
        f.onLaunch(() => {
            f.windows.push(first);
            f.app.emit("windows-changed");
        });
        await show();
        assert.equal(first.has_focus(), true);
        assert.equal(first.is_maximized(), true);
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);

        f.settings.set("terminal-id", nextId);
        first.is_alive = false;
        f.windows.pop();
        first.emit("unmanaged");
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [true, true]);
        f.focus(null);
        f.onLaunch(() => {
            nextWindows.push(next);
            nextApp.emit("windows-changed");
        });
        await show();

        assert.equal(f.settings.get_boolean(setting), true);
        assert.equal(next.has_focus(), true);
        assert.equal(next.hidden, false);
        assert.equal(next.fullscreen, false);
        assert.equal(next.is_maximized(), true);
        assert.deepEqual([f.panel.visible, f.tracked.affectsStruts], [false, false]);
    } finally {
        extension.disable();
    }
});

test("refocusing the same terminal preserves each manual window state", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { QuakeMode } = await import("../src/quake-mode.js");
    const terminal = f.createWindow("quake-terminal");
    const other = f.createWindow("other");
    f.windows.push(terminal);
    f.settings.set("auto-hide-window", false);
    const mode = new QuakeMode(f.app, f.settings, { enabled: true });

    try {
        await mode.toggle();
        f.flush(200);
        assert.equal(terminal.has_focus(), true);
        assert.equal(terminal.is_maximized(), true);

        const manualStates = [
            ["horizontal only", true, false, false, { x: 0, y: 90, width: 1600, height: 500 }],
            ["vertical only", false, true, false, { x: 70, y: 24, width: 850, height: 876 }],
            ["unmaximized", false, false, false, { x: 70, y: 90, width: 850, height: 500 }],
            ["fullscreen", true, true, true, { x: 0, y: 0, width: 1600, height: 900 }],
        ];
        for (const [label, horizontal, vertical, fullscreen, frame] of manualStates) {
            Object.assign(terminal, {
                maximized_horizontally: horizontal,
                maximized_vertically: vertical,
                fullscreen,
                geometry: { ...frame },
            });
            f.focus(other);
            f.flush(200);
            f.focus(terminal);
            f.flush(200);

            assert.equal(terminal.has_focus(), true, label);
            assert.equal(terminal.hidden, false, label);
            assert.deepEqual(
                [terminal.maximized_horizontally, terminal.maximized_vertically, terminal.fullscreen],
                [horizontal, vertical, fullscreen],
                label
            );
            assert.deepEqual(terminal.get_frame_rect(), frame, label);
        }
    } finally {
        mode.destroy();
    }
});

test("legacy recall preserves a manually fullscreen terminal with the mode off", async () => {
    const f = fixture(48);
    globalThis.shellFixture = f.host;
    const { QuakeMode } = await import("../src/quake-mode.js");
    const terminal = f.createWindow("quake-terminal");
    const other = f.createWindow("other");
    f.windows.push(terminal);
    const mode = new QuakeMode(f.app, f.settings, { enabled: false });

    try {
        await mode.toggle();
        assert.equal(terminal.has_focus(), true);
        terminal.make_fullscreen();
        f.focus(other);

        await mode.toggle();
        f.flush(200);
        assert.equal(terminal.has_focus(), true);
        assert.equal(terminal.hidden, false);
        assert.equal(terminal.fullscreen, true);
    } finally {
        mode.destroy();
    }
});

for (const enabled of [false, true]) {
    test(`recall uses the existing display selection with the mode ${enabled ? "on" : "off"}`, async () => {
        const { QuakeMode } = await import("../src/quake-mode.js");
        const monitors = [
            { index: 0, x: 1600 },
            { index: 1, x: 6400 },
            { index: 2, x: 0 },
            { index: 3, x: 3200 },
            { index: 4, x: 4800 },
        ];
        const choices = [
            ["render-on-leftmost-monitor", true, 2],
            ["render-on-center-monitor", true, 3],
            ["render-on-rightmost-monitor", true, 1],
            ["render-on-current-monitor", true, 0],
            ["render-on-primary-monitor", true, 4],
            ["monitor-screen", 2, 2],
            ["monitor-screen", -1, 4],
            ["monitor-screen", monitors.length, 4],
        ];
        for (const [key, value, expected] of choices) {
            const f = fixture(48, monitors.map(({ x }) => ({ x, y: 0, width: 1600, height: 900 })));
            globalThis.shellFixture = f.host;
            f.host.layoutManager.monitors = monitors;
            f.primaryMonitor.index = 4;
            Object.assign(f.host.shell.display, {
                get_current_monitor: () => 0,
                get_primary_monitor: () => f.primaryMonitor.index,
            });
            const terminal = f.createWindow("quake-terminal");
            terminal.monitor = (expected + 1) % monitors.length;
            f.windows.push(terminal);
            f.focus(f.createWindow("other"));
            f.settings.set("monitor-screen", terminal.monitor);
            f.settings.set(key, value);
            const mode = new QuakeMode(f.app, f.settings, { enabled });

            try {
                await mode.toggle();
                f.flush(200);
                assert.equal(terminal.has_focus(), true, `${key}=${value}`);
                assert.equal(terminal.get_monitor(), expected, `${key}=${value}`);
            } finally {
                mode.destroy();
            }
        }
    });
}
