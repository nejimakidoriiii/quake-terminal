/*
 * Quake Terminal for GNOME Shell 45+
 * Copyright 2025 Diego Dario
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * If this extension breaks your desktop you get to keep all of the pieces...
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";
import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { QuakeMode } from "./quake-mode.js";

const MAXIMIZE_AND_HIDE_PANEL = "maximize-and-hide-panel";

export default class QuakeTerminalExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._quakeMode = null;
    this._maximizedPanelModeChangedId = this._settings.connect(
      `changed::${MAXIMIZE_AND_HIDE_PANEL}`,
      settings => {
        const enabled = settings.get_boolean(MAXIMIZE_AND_HIDE_PANEL);
        if (enabled === maximizedPanelMode.enabled) return;
        maximizedPanelMode.enabled = enabled;
        QuakeMode._clearOppositePendingDisplayGeometry(enabled);
        const mode = this._quakeMode;
        if (mode && mode._internalState !== QuakeMode.LIFECYCLE.DEAD)
          mode._onMaximizedPanelModeChanged();
      }
    );
    const maximizedPanelMode = {
      enabled: this._settings.get_boolean(MAXIMIZE_AND_HIDE_PANEL),
    };
    this._maximizedPanelMode = maximizedPanelMode;

    this._appSystem = Shell.AppSystem.get_default();
    const terminalId = this._settings.get_string("terminal-id");
    const terminal = terminalId && this._appSystem.lookup_app(terminalId);
    if (terminal) {
      const existingWindow = QuakeMode.findManagedWindow(terminal);
      if (existingWindow)
        this._quakeMode = new QuakeMode(
          terminal,
          this._settings,
          this._maximizedPanelMode,
          existingWindow
        );
    }

    Main.wm.addKeybinding(
      "terminal-shortcut",
      this._settings,
      Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
      Shell.ActionMode.NORMAL |
        Shell.ActionMode.OVERVIEW |
        Shell.ActionMode.POPUP,
      () =>
        this._handleQuakeModeTerminal().catch((reason) => console.log(reason))
    );
  }

  disable() {
    Main.wm.removeKeybinding("terminal-shortcut");

    if (this._settings && this._maximizedPanelModeChangedId) {
      this._settings.disconnect(this._maximizedPanelModeChangedId);
      this._maximizedPanelModeChangedId = null;
    }

    if (this._quakeMode) {
      this._quakeMode.destroy();
    }

    this._settings = null;
    this._appSystem = null;
    this._quakeMode = null;
  }

  _handleQuakeModeTerminal() {
    const mode = this._quakeMode;
    const state = mode?._internalState;
    if (
      state === QuakeMode.LIFECYCLE.STARTING ||
      state === QuakeMode.LIFECYCLE.CREATED_ACTOR
    ) {
      return Promise.resolve();
    }

    if (
      !mode ||
      state === QuakeMode.LIFECYCLE.DEAD ||
      state === QuakeMode.LIFECYCLE.READY
    ) {
      const terminalId = this._settings.get_string("terminal-id");

      if (!terminalId) {
        Main.notify(_(`Select an application in Quake Terminal preferences.`));
        return Promise.resolve();
      }

      const terminal = this._appSystem.lookup_app(terminalId);

      if (!terminal) {
        Main.notify(_(`No terminal found with id ${terminalId}. Skipping ...`));
        return Promise.resolve();
      }

      if (mode && state === QuakeMode.LIFECYCLE.READY) {
        if (mode._terminal.get_id() === terminal.get_id()) return mode.toggle();
        mode.destroy();
      }
      this._quakeMode = new QuakeMode(
        terminal,
        this._settings,
        this._maximizedPanelMode
      );
      return this._quakeMode.toggle();
    }

    return mode.toggle();
  }
}
