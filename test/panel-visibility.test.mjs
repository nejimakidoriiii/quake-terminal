/*
 * SPDX-FileCopyrightText: 2026 Quake Terminal contributors
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePanelVisibility } from "../src/panel-visibility.js";

/**
 * @param {number} monitor - The current logical monitor index.
 * @param {boolean} [visible] - The initial panel visibility.
 * @param {boolean} [reserved] - Whether the panel initially reserves space.
 */
function createPanel(monitor, visible = true, reserved = true) {
    return { monitor, visible, reserved };
}

/**
 * @param {ReturnType<typeof createPanel>} panel - The current standard panel.
 */
function createFixture(panel) {
    const terminal = { appId: "foot.desktop" };
    let snapshot = {
        extensionEnabled: true,
        modeEnabled: true,
        managedWindow: terminal,
        focusedWindow: terminal,
        terminalAlive: true,
        terminalShown: true,
        terminalOnActiveWorkspace: true,
        session: "desktop",
        maximizedHorizontally: true,
        maximizedVertically: true,
        fullscreen: false,
        terminalMonitor: 0,
        panel,
    };
    let ownership = null;

    return {
        terminal,
        /** @param {Partial<typeof snapshot>} [overrides] - The changed inputs. */
        update(overrides = {}) {
            snapshot = { ...snapshot, ...overrides };
            const result = reconcilePanelVisibility(snapshot, ownership);
            ownership = result.ownership;
            for (const { panel: target, ...effect } of result.changes) {
                Object.assign(target, effect);
            }
            return result.changes;
        },
    };
}

/**
 * @param {ReturnType<typeof createPanel>} panel - The panel after reconciliation.
 * @param {boolean} visible - The expected visibility.
 * @param {boolean} reserved - The expected reservation.
 * @param {string} [reason] - The condition being exercised.
 */
function assertPanel(panel, visible, reserved, reason) {
    assert.deepEqual(
        { visible: panel.visible, reserved: panel.reserved },
        { visible, reserved },
        reason
    );
}

test("restores the panel on focus loss and hides it again on refocus", () => {
    const panel = createPanel(0);
    const { terminal, update } = createFixture(panel);
    const focusTargets = [
        { reason: "another window of the same app", window: { ...terminal } },
        {
            reason: "a dialog of the same app",
            window: { ...terminal, transientFor: terminal },
        },
        { reason: "a clipboard helper", window: { appId: "wl-clipboard" } },
        { reason: "another app", window: { appId: "other.desktop" } },
        { reason: "no focused window", window: null },
    ];

    assert.deepEqual(update({ focusedWindow: null }), []);
    assertPanel(panel, true, true);

    update({ focusedWindow: terminal });
    assertPanel(panel, false, false);
    update();
    assertPanel(panel, false, false);

    for (const { reason, window } of focusTargets) {
        update({ focusedWindow: window });
        assertPanel(panel, true, true, reason);

        update({ focusedWindow: terminal });
        assertPanel(panel, false, false, `focus returned after ${reason}`);
    }
});

test("restores the panel unless both axes are maximized outside fullscreen", () => {
    const panel = createPanel(0);
    const { update } = createFixture(panel);
    const maximized = {
        maximizedHorizontally: true,
        maximizedVertically: true,
        fullscreen: false,
    };
    const shapes = [
        {
            reason: "only the horizontal axis",
            change: { maximizedVertically: false },
        },
        {
            reason: "only the vertical axis",
            change: { maximizedHorizontally: false },
        },
        {
            reason: "neither axis",
            change: { maximizedHorizontally: false, maximizedVertically: false },
        },
        {
            reason: "fullscreen with both axes still maximized",
            change: { fullscreen: true },
        },
    ];

    for (const { reason, change } of shapes) {
        update(maximized);
        assertPanel(panel, false, false);

        update(change);
        assertPanel(panel, true, true, reason);
    }
});

test("restores the panel when the mode, terminal or desktop becomes ineligible", () => {
    const losses = [
        { reason: "mode switched off", change: { modeEnabled: false } },
        { reason: "terminal hidden", change: { terminalShown: false } },
        { reason: "terminal closed", change: { terminalAlive: false } },
        {
            reason: "terminal left the active workspace",
            change: { terminalOnActiveWorkspace: false },
        },
        { reason: "overview opened", change: { session: "overview" } },
        { reason: "screen locked", change: { session: "locked" } },
    ];

    for (const { reason, change } of losses) {
        const panel = createPanel(0);
        const { update } = createFixture(panel);
        update();
        assertPanel(panel, false, false);

        update(change);
        assertPanel(panel, true, true, reason);
    }
});

test("restores visibility and reservation independently", () => {
    for (const { visible, reserved } of [
        { visible: false, reserved: true },
        { visible: false, reserved: false },
        { visible: true, reserved: false },
    ]) {
        const panel = createPanel(0, visible, reserved);
        const { update } = createFixture(panel);
        update();
        assertPanel(panel, false, false);

        const effects = update({ focusedWindow: null });
        assertPanel(panel, visible, reserved);
        if (!visible) assert.ok(effects.every(effect => !("visible" in effect)));
        if (!reserved) assert.ok(effects.every(effect => !("reserved" in effect)));
    }
});

test("preserves a visibility change it did not make", () => {
    const panel = createPanel(0, false, true);
    const { update } = createFixture(panel);
    update();
    assertPanel(panel, false, false);

    panel.visible = true;
    update({ focusedWindow: null });
    assertPanel(panel, true, true);
});

test("uses current logical monitors without losing the same panel's original state", () => {
    const panel = createPanel(0);
    const { update } = createFixture(panel);

    assert.deepEqual(update({ terminalMonitor: 1 }), []);
    assertPanel(panel, true, true);

    update({ terminalMonitor: 0 });
    assertPanel(panel, false, false);

    panel.monitor = 1;
    update({ terminalMonitor: 1 });
    assertPanel(panel, false, false);

    update({ terminalMonitor: 0 });
    assertPanel(panel, true, true);

    update({ terminalMonitor: 1 });
    assertPanel(panel, false, false);

    update({ panel: null });
    assertPanel(panel, true, true);

    update({ panel });
    assertPanel(panel, false, false);
});

test("restores the replaced panel and uses the replacement's own original state", () => {
    const panel = createPanel(0, false, true);
    const replacement = createPanel(0, true, false);
    const { update } = createFixture(panel);
    update();
    assertPanel(panel, false, false);

    update({ panel: replacement });
    assertPanel(panel, false, true);
    assertPanel(replacement, false, false);

    update({ focusedWindow: null });
    assertPanel(panel, false, true);
    assertPanel(replacement, true, false);
});

test("restores the panel on stop and leaves it restored while stopped", () => {
    const panel = createPanel(0);
    const { terminal, update } = createFixture(panel);
    update();
    assertPanel(panel, false, false);

    update({ extensionEnabled: false });
    assertPanel(panel, true, true);

    assert.deepEqual(update({ focusedWindow: null }), []);
    assert.deepEqual(update({ focusedWindow: terminal }), []);
    assertPanel(panel, true, true);
});
