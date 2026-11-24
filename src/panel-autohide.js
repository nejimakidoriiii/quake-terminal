/*
 * SPDX-FileCopyrightText: 2026 Quake Terminal contributors
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

import GLib from "gi://GLib";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { reconcilePanelVisibility } from "./panel-visibility.js";

/**
 * @typedef {import("gi://Clutter").default.Actor} Actor
 * @typedef {{actor: Actor, tracked: {actor: Actor, affectsStruts: boolean, trackFullscreen: boolean}, monitor: number, visible: boolean, reserved: boolean}} Panel
 * @typedef {{
 *   panelBox: Actor,
 *   primaryMonitor: {index: number} | null,
 *   _trackedActors: Panel["tracked"][],
 *   findMonitorForActor(actor: Actor): {inFullscreen: boolean} | null,
 *   _updateRegions(): void
 * }} PanelLayout
 */

export class PanelAutohide {
  constructor() {
    /** @type {import("gi://Meta").default.Window | null} */
    this._window = null;
    this._enabled = false;
    /** @type {ReturnType<typeof reconcilePanelVisibility<Panel>>["ownership"]} */
    this._ownership = null;
    /** @type {(() => void)[]} */
    this._disconnect = [];
    /** @type {number | null} */
    this._idleId = null;
    this._active = false;
    /** @type {WeakMap<Panel["tracked"], Panel>} */
    this._panels = new WeakMap();
  }

  /** @param {import("gi://Meta").default.Window} window - The managed terminal. */
  watch(window) {
    this._window = window;
    this._active = true;
    const schedule = () => this._schedule();
    const layout = Main.layoutManager;
    const shell = Shell.Global.get();
    const actor = /** @type {Actor} */ (window.get_compositor_private());
    const connect = (
      /** @type {{connect(signal: string, callback: () => void): number, disconnect(id: number): void}} */ source,
      /** @type {string[]} */ signals
    ) => {
      for (const signal of signals) {
        const id = source.connect(signal, schedule);
        this._disconnect.push(() => source.disconnect(id));
      }
    };

    connect(window, [
      "notify::minimized",
      "notify::maximized-horizontally",
      "notify::maximized-vertically",
      "notify::fullscreen",
      "workspace-changed",
    ]);
    connect(actor, ["notify::mapped"]);
    connect(shell.display, [
      "notify::focus-window",
      "window-entered-monitor",
      "window-left-monitor",
    ]);
    connect(shell.workspace_manager, ["active-workspace-changed"]);
    connect(layout, ["monitors-changed"]);
    connect(layout.panelBox, ["notify::visible"]);
    connect(Main.overview, ["showing", "hidden"]);
    connect(Main.sessionMode, ["updated"]);
    this._schedule();
  }

  /** @param {boolean} enabled - The current common setting. */
  setEnabled(enabled) {
    this._enabled = enabled;
    if (enabled) this._schedule();
    else this._reconcile();
  }

  destroy() {
    this._active = false;
    if (this._idleId !== null) {
      GLib.Source.remove(this._idleId);
      this._idleId = null;
    }
    for (const disconnect of this._disconnect) disconnect();
    this._disconnect = [];
    this._window = null;
    this._reconcile();
  }

  _schedule() {
    if (!this._active || !this._enabled || this._idleId !== null) return;
    this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this._idleId = null;
      this._reconcile();
      return GLib.SOURCE_REMOVE;
    });
  }

  _reconcile() {
    if (!this._ownership && (!this._active || !this._enabled)) return;

    const layout = /** @type {PanelLayout} */ (
      /** @type {unknown} */ (Main.layoutManager)
    );
    const box = layout.panelBox;
    const tracked = layout._trackedActors.find(entry => entry.actor === box);
    let panel = null;
    if (tracked && layout.primaryMonitor) {
      panel = this._panels.get(tracked);
      if (!panel) {
        panel = {
          actor: box,
          tracked,
          monitor: layout.primaryMonitor.index,
          get visible() {
            return this.actor.visible;
          },
          get reserved() {
            return this.tracked.affectsStruts;
          },
        };
        this._panels.set(tracked, panel);
      }
      panel.monitor = layout.primaryMonitor.index;
    }

    const shell = Shell.Global.get();
    const window = this._window;
    const actor = /** @type {Actor | null | undefined} */ (
      window?.get_compositor_private()
    );
    const session = Main.sessionMode;
    const result = reconcilePanelVisibility(
      {
        extensionEnabled: this._active,
        modeEnabled: this._enabled,
        managedWindow: window,
        focusedWindow: shell.display.focus_window,
        terminalAlive: window !== null,
        terminalShown:
          window !== null &&
          window.showing_on_its_workspace() &&
          !!actor?.mapped,
        terminalOnActiveWorkspace:
          window !== null &&
          window.located_on_workspace(shell.workspace_manager.get_active_workspace()),
        session:
          session.hasWindows && !session.isLocked && !Main.overview.visible
            ? "desktop"
            : "other",
        maximizedHorizontally: window?.maximized_horizontally ?? false,
        maximizedVertically: window?.maximized_vertically ?? false,
        fullscreen: window?.fullscreen ?? false,
        terminalMonitor: window ? window.get_monitor() : -1,
        panel,
      },
      this._ownership
    );
    this._ownership = result.ownership;

    let updateRegions = false;
    for (const change of result.changes) {
      const target = change.panel;
      if (change.visible !== undefined) {
        const hiddenByShell =
          target.tracked.trackFullscreen &&
          shell.window_group.visible &&
          layout.findMonitorForActor(target.actor)?.inFullscreen;
        if (!change.visible || !hiddenByShell)
          target.actor.visible = change.visible;
      }
      if (change.reserved !== undefined && layout._trackedActors.includes(target.tracked)) {
        target.tracked.affectsStruts = change.reserved;
        updateRegions = true;
      }
    }
    if (updateRegions) layout._updateRegions();
  }
}
