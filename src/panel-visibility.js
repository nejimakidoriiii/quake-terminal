/*
 * SPDX-FileCopyrightText: 2026 Quake Terminal contributors
 * SPDX-License-Identifier: LGPL-3.0-or-later
 */

/**
 * @template {{monitor: number, visible: boolean, reserved: boolean}} Panel
 * @param {{
 *   panel: Panel | null, extensionEnabled: boolean, modeEnabled: boolean,
 *   terminalAlive: boolean, terminalShown: boolean, terminalOnActiveWorkspace: boolean,
 *   managedWindow: object | null, focusedWindow: object | null, session: string,
 *   maximizedHorizontally: boolean, maximizedVertically: boolean,
 *   fullscreen: boolean, terminalMonitor: number
 * }} state - Current inputs from the window manager.
 * @param {{panel: Panel, visibility: boolean, reservation: boolean} | null} ownership - Changes that can still be restored.
 */
export function reconcilePanelVisibility(state, ownership) {
  const { panel } = state;
  const eligible =
    state.extensionEnabled &&
    state.modeEnabled &&
    state.terminalAlive &&
    state.terminalShown &&
    state.terminalOnActiveWorkspace &&
    state.managedWindow === state.focusedWindow &&
    state.session === "desktop" &&
    state.maximizedHorizontally &&
    state.maximizedVertically &&
    !state.fullscreen &&
    panel !== null &&
    panel.monitor === state.terminalMonitor;

  /** @type {{panel: Panel, visible?: boolean, reserved?: boolean}[]} */
  const changes = [];
  if (ownership && (!eligible || ownership.panel !== panel)) {
    const previous = ownership.panel;
    const restore = {
      panel: previous,
      ...(ownership.visibility && !previous.visible ? { visible: true } : {}),
      ...(ownership.reservation && !previous.reserved ? { reserved: true } : {}),
    };
    if ("visible" in restore || "reserved" in restore) changes.push(restore);
    ownership = null;
  }

  if (eligible && (panel.visible || panel.reserved)) {
    changes.push({
      panel,
      ...(panel.visible ? { visible: false } : {}),
      ...(panel.reserved ? { reserved: false } : {}),
    });
    ownership = {
      panel,
      visibility: panel.visible || ownership?.visibility || false,
      reservation: panel.reserved || ownership?.reservation || false,
    };
  }

  return { changes, ownership };
}
