import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Shell from "gi://Shell";
import Meta from "gi://Meta";
import { PACKAGE_VERSION } from "resource:///org/gnome/shell/misc/config.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { PanelAutohide } from "./panel-autohide.js";

const SHELL_VERSION = Number.parseInt(PACKAGE_VERSION.split(".")[0]);
const AUTO_HIDE_WINDOW = "auto-hide-window";
const HIDE_TRANSITION = "translation-y";

let pendingMaximizedGeometry = new WeakSet();
let pendingSavedGeometryRestores = new WeakSet();

const STARTUP_TIMER_IN_SECONDS = 5;

/**
 * How long (seconds) to wait for `stage-views-changed` after the actor is
 * created before giving up and positioning the terminal anyway (CREATED_ACTOR
 * → RUNNING fallback).
 */
const CREATED_ACTOR_TIMEOUT_IN_SECONDS = 5;

/**
 * How long (ms) to wait for the terminal to redraw at its new size on first
 * launch before showing it anyway.
 */
const RESIZE_TIMEOUT_IN_MS = 500;

const _DEBUG = false;

/**
 * Helper function for debug logging.
 *
 * @param {string} message - The message to log.
 */
function _log(message) {
  if (_DEBUG) {
    console.log(message);
  }
}

/**
 * Checks if the given window is a wl-clipboard window (wl-copy or wl-paste) running under Wayland.
 *
 * This function verifies the window's client type, title, and command line to determine
 * if it is a wl-clipboard instance. Used to avoid interfering with clipboard popups.
 *
 * @param {Meta.Window} win - The window to check.
 * @returns {boolean} True if the window is a wl-clipboard window, false otherwise.
 */
export async function is_wlclipboard(win) {
  if (!win) return false;
  if (win.get_client_type() !== Meta.WindowClientType.WAYLAND) return false;
  if (win.title !== "wl-clipboard") return false;
  const pid = win.get_pid();
  try {
    const file = Gio.File.new_for_path(`/proc/${pid}/cmdline`);
    const [contents] = await file.load_contents_async(null);
    const argv0_bytes = contents.slice(0, contents.indexOf(0));
    const argv0 = new TextDecoder().decode(argv0_bytes);
    return ["wl-copy", "wl-paste"].includes(GLib.path_get_basename(argv0));
  } catch {
    return false;
  }
}

/**
 * Quake Mode Module
 *
 * This module provides a Quake mode for managing a terminal window with animations and specific behavior.
 * It allows showing and hiding a terminal window with animation effects.
 *
 * @module QuakeMode
 */
export const QuakeMode = class {
  static LIFECYCLE = {
    READY: "READY",
    STARTING: "STARTING",
    CREATED_ACTOR: "CREATED_ACTOR",
    RUNNING: "RUNNING",
    DEAD: "DEAD",
  };

  /** @param {boolean} enabled - The new maximized panel mode value. */
  static _clearOppositePendingDisplayGeometry(enabled) {
    if (enabled) pendingSavedGeometryRestores = new WeakSet();
    else pendingMaximizedGeometry = new WeakSet();
  }

  /** @param {Shell.App} terminal - The configured application. */
  static findManagedWindow(terminal) {
    return terminal.get_windows().find(window => {
      const actor = /** @type {Meta.WindowActor | null} */ (window.get_compositor_private());
      return actor?.get_name() === "quake-terminal";
    });
  }

  /**
   * The default timeout (in seconds) for force-moving from CREATED_ACTOR to
   * RUNNING. This guards against the window/actor appearing but a subsequent
   * GNOME signal never firing, leaving _internalState stuck and all further
   * shortcut presses silently dropped.
  /**
   * Creates a new QuakeMode instance.
   *
   * @param {Shell.App} terminal - The terminal application instance.
   * @param {Gio.Settings} settings - The Gio.Settings object for configuration.
   * @param {Readonly<{enabled: boolean}>} maximizedPanelMode - The current common mode state.
   * @param {Meta.Window} [existingWindow] - A managed window surviving extension disable.
   */
  constructor(terminal, settings, maximizedPanelMode, existingWindow) {
    _log(
      `*** QuakeTerminal@constructor - IsWayland = ${SHELL_VERSION >= 50 || Meta.is_wayland_compositor()} ***`
    );
    _log(
      `*** QuakeTerminal@constructor - Terminal App = ${terminal.get_name()} ***`
    );

    /**
     *@type {Shell.App}
     */
    this._terminal = terminal;
    this._settings = settings;
    this._internalState = QuakeMode.LIFECYCLE.READY;
    this._maximizedPanelMode = maximizedPanelMode;
    this._panelAutohide = new PanelAutohide();
    this._panelAutohide.setEnabled(this._maximizedPanelMode.enabled);

    this._sourceTimeoutLoopId = null;
    this._stageViewFallbackTimeoutId = null;
    this._resizeWait = null;
    this._allowToggleDuringLaunchResize = false;
    this._disconnectRedisplay = null;
    this._terminalWindowUnmanagedId = null;
    this._terminalWindowFocusId = null;
    this._wmMapSignalId = null;
    this._terminalChangedId = null;
    this._actorStageViewChangedId = null;
    this._clearAnimationClip = null;
    this._cancelHideAnimation = null;

    /**
     *@type {Meta.Window}
     */
    this._terminalWindow = null;
    this._isTaskbarConfigured = null;

    /** We will monkey-patch this method. Let's store the original one. */
    // @ts-ignore
    this._original_shouldAnimateActor = Main.wm._shouldAnimateActor;

    // Enhance the close animation behavior when exiting
    this._configureActorCloseAnimation();

    /**
     * Stores the IDs of settings signal handlers.
     *
     * @type {number[]}
     */
    this._settingsWatchingListIds = [];

    ["vertical-size", "horizontal-size", "horizontal-alignment"].forEach(
      (prefAdjustment) => {
        const settingsId = settings.connect(
          `changed::${prefAdjustment}`,
          () => {
            if (
              this._internalState !== QuakeMode.LIFECYCLE.READY &&
              !this._maximizedPanelMode.enabled
            ) {
              this._fitTerminalToMainMonitor(false);
            }
          }
        );

        this._settingsWatchingListIds.push(settingsId);
      }
    );

    const alwaysOnTopSettingsId = settings.connect(
      "changed::always-on-top",
      () => {
        if (this._internalState === QuakeMode.LIFECYCLE.READY) return;
        this._handleAlwaysOnTop();
      }
    );

    this._settingsWatchingListIds.push(alwaysOnTopSettingsId);

    const skipTaskbarSettingsId = settings.connect(
      "changed::skip-taskbar",
      () => {
        if (this._internalState === QuakeMode.LIFECYCLE.READY) return;
        this._configureSkipTaskbarProperty();
      }
    );

    this._settingsWatchingListIds.push(skipTaskbarSettingsId);
    if (existingWindow) this._watchTerminalWindow(existingWindow);
  }

  get _pendingDisplayGeometry() {
    return this._maximizedPanelMode.enabled
      ? pendingMaximizedGeometry
      : pendingSavedGeometryRestores;
  }

  _onMaximizedPanelModeChanged() {
    this._allowToggleDuringLaunchResize = false;
    const enabled = this._maximizedPanelMode.enabled;
    this._panelAutohide.setEnabled(enabled);

    const window = this._terminalWindow;
    if (!window) return;
    const actor = /** @type {Meta.WindowActor | null} */ (
      window.get_compositor_private()
    );
    if (window.is_hidden() || !actor?.mapped) {
      this._pendingDisplayGeometry.add(window);
      return;
    }

    this._pendingDisplayGeometry.delete(window);
    if (enabled) {
      this._maximizeTerminal(window, window.get_monitor(), false);
    } else {
      this._fitTerminalToMainMonitor(true, window.get_monitor());
    }
  }

  get terminalWindow() {
    if (!this._terminal) {
      _log(
        `*** QuakeTerminal@terminalWindow - There's no terminal application ***`
      );
      _log(
        `*** QuakeTerminal@terminalWindow - Current state ${this._internalState}  ***`
      );
      return null;
    }

    if (!this._terminalWindow) {
      _log(
        `*** QuakeTerminal@terminalWindow - There's no WindowActor, finding one ... ***`
      );
      const ourWindow = QuakeMode.findManagedWindow(this._terminal);

      if (!ourWindow) {
        return null;
      }

      this._watchTerminalWindow(ourWindow);
    }

    return this._terminalWindow;
  }

  /** @param {Meta.Window} window - The terminal window owned by the extension. */
  _watchTerminalWindow(window) {
    this._terminalWindow = window;
    this._terminalWindowUnmanagedId = window.connect("unmanaged", () => {
      _log(`*** QuakeTerminal@Unmanaged Called unmanaged ***`);
      pendingMaximizedGeometry.delete(window);
      pendingSavedGeometryRestores.delete(window);
      this.destroy();
    });
    const actor = /** @type {Meta.WindowActor} */ (window.get_compositor_private());
    const onRedisplay = () => {
      if (
        window !== this._terminalWindow ||
        window.get_compositor_private() !== actor ||
        window.is_hidden() ||
        !actor.mapped
      ) {
        return;
      }

      const wait = this._resizeWait;
      if (wait?.window === window && wait.purpose === "recall")
        this._cancelWaitForResize();

      if (!this._pendingDisplayGeometry.delete(window)) return;
      const monitor = window.get_monitor();
      if (this._maximizedPanelMode.enabled)
        this._maximizeTerminal(window, monitor, false);
      else this._fitTerminalToMainMonitor(true, monitor);
    };
    const shownId = window.connect("shown", onRedisplay);
    const mappedId = actor.connect("notify::mapped", onRedisplay);
    this._disconnectRedisplay = () => {
      window.disconnect(shownId);
      actor.disconnect(mappedId);
    };
    this._panelAutohide.watch(window);
    this._terminalWindowFocusId = Shell.Global.get().display.connect(
      "notify::focus-window",
      (source) => {
        this._handleHideOnFocusLoss(source).catch((e) =>
          _log(`*** QuakeTerminal@focus-window - ${e} ***`)
        );
      }
    );
  }

  get actor() {
    if (!this.terminalWindow) {
      _log(`*** QuakeTerminal@actor - There's no terminalWindow ***`);
      return null;
    }

    /**
     * The window actor for this terminal window.
     *
     * @type {Meta.WindowActor & { ease: Function }}
     */
    const actor = this.terminalWindow.get_compositor_private();

    if (!actor) {
      _log(`*** QuakeTerminal@actor - There's no actor ***`);
      return null;
    }

    if ("clip_y" in actor) {
      return actor;
    }

    Object.defineProperty(actor, "clip_y", {
      get() {
        return this.clip_rect.origin.y;
      },
      set(y) {
        const rect = this.clip_rect;
        this.set_clip(rect.origin.x, y, rect.size.width, rect.size.height);
      },
    });

    return actor;
  }

  get monitorDisplayScreenIndex() {
    if (this._settings.get_boolean("render-on-leftmost-monitor")) {
      return this._getMonitorIndexByPosition("leftmost");
    }

    if (this._settings.get_boolean("render-on-center-monitor")) {
      return this._getMonitorIndexByPosition("center");
    }

    if (this._settings.get_boolean("render-on-rightmost-monitor")) {
      return this._getMonitorIndexByPosition("rightmost");
    }

    if (this._settings.get_boolean("render-on-current-monitor")) {
      return Shell.Global.get().display.get_current_monitor();
    }

    if (this._settings.get_boolean("render-on-primary-monitor")) {
      return Shell.Global.get().display.get_primary_monitor();
    }

    const userSelectionDisplayIndex = this._settings.get_int("monitor-screen");
    const availableDisplaysIndexes =
      Shell.Global.get().display.get_n_monitors() - 1;

    if (
      userSelectionDisplayIndex >= 0 &&
      userSelectionDisplayIndex <= availableDisplaysIndexes
    ) {
      return userSelectionDisplayIndex;
    }

    return Shell.Global.get().display.get_primary_monitor();
  }

  /**
   * Gets the monitor index by physical position on the X axis.
   *
   * @param {"leftmost" | "center" | "rightmost"} position - Desired position
   * @returns {number} The monitor index matching that position
   */
  _getMonitorIndexByPosition(position) {
    const sorted = [...Main.layoutManager.monitors].sort((a, b) => a.x - b.x);

    if (position === "leftmost") {
      return sorted[0].index;
    }

    if (position === "rightmost") {
      return sorted[sorted.length - 1].index;
    }

    if (position === "center") {
      return sorted[Math.floor(sorted.length / 2)].index;
    }

    return Shell.Global.get().display.get_primary_monitor();
  }

  destroy() {
    _log(`*** QuakeTerminal@destroy - Starting destroy action ***`);
    this._disconnectRedisplay?.();
    this._disconnectRedisplay = null;
    this._allowToggleDuringLaunchResize = false;
    this._cancelWaitForResize();
    this._cancelHideAnimation?.();
    const actor = this._terminalWindow?.get_compositor_private();
    this._panelAutohide.destroy();
    if (actor) this._clearAnimationClip?.();
    if (this._sourceTimeoutLoopId) {
      GLib.Source.remove(this._sourceTimeoutLoopId);
      this._sourceTimeoutLoopId = null;
    }

    if (this._stageViewFallbackTimeoutId) {
      GLib.Source.remove(this._stageViewFallbackTimeoutId);
      this._stageViewFallbackTimeoutId = null;
    }

    if (this._settingsWatchingListIds.length && this._settings) {
      this._settingsWatchingListIds.forEach((id) => {
        this._settings.disconnect(id);
      });
    }

    if (actor && this._actorStageViewChangedId) {
      actor.disconnect(this._actorStageViewChangedId);
      this._actorStageViewChangedId = null;
    }

    if (this._terminalWindowUnmanagedId && this.terminalWindow) {
      this.terminalWindow.disconnect(this._terminalWindowUnmanagedId);
      this._terminalWindowUnmanagedId = null;
    }

    if (this._terminalChangedId && this._terminal) {
      this._terminal.disconnect(this._terminalChangedId);
      this._terminalChangedId = null;
    }

    if (this._terminalWindowFocusId) {
      Shell.Global.get().display.disconnect(this._terminalWindowFocusId);
      this._terminalWindowFocusId = null;
    }

    if (this._wmMapSignalId) {
      Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
      this._wmMapSignalId = null;
    }

    this._settingsWatchingListIds = [];
    this._terminal = null;
    this._terminalWindow = null;
    this._internalState = QuakeMode.LIFECYCLE.DEAD;
    this._isTaskbarConfigured = null;
    // @ts-ignore
    Main.wm._shouldAnimateActor = this._original_shouldAnimateActor;
  }

  /**
   * Toggles the visibility of the terminal window with animations.
   *
   * @returns {Promise<void>} A promise that resolves when the toggle operation is complete.
   */
  async toggle() {
    const wait = this._resizeWait;
    if (wait && (wait.purpose !== "launch" || !this._allowToggleDuringLaunchResize))
      return;

    if (!this.terminalWindow) {
      try {
        await this._launchTerminalWindow();
        this._adjustTerminalWindowPosition();
      } catch (error) {
        _log(`*** QuakeTerminal@toggle - Catch error ${error} ***`);
        this.destroy();
      }
      return;
    }

    this._internalState = QuakeMode.LIFECYCLE.RUNNING;
    if (!this._isTaskbarConfigured) {
      this._configureSkipTaskbarProperty();
    }

    if (this.terminalWindow.has_focus()) {
      return this._hideTerminalWithAnimationBottomUp();
    }

    if (this.terminalWindow.is_hidden()) {
      if (this._maximizedPanelMode.enabled) {
        this._showTerminalAfterResize("recall");
        return;
      }
      this._applyTerminalDisplayGeometry();
      return this._showTerminalWithAnimationTopDown();
    }

    if (this._settings.get_boolean("hide-on-toggle-without-focus")) {
      return this._hideTerminalWithAnimationBottomUp();
    }

    this._applyTerminalDisplayGeometry();
    Main.activateWindow(this.terminalWindow);
  }

  /**
   * Launches the terminal window and sets up event handlers.
   *
   * @returns {Promise<boolean>} A promise that resolves when the terminal window is ready.
   */
  _launchTerminalWindow() {
    this._internalState = QuakeMode.LIFECYCLE.STARTING;
    this._allowToggleDuringLaunchResize = !this._maximizedPanelMode.enabled;

    if (!this._terminal) {
      return Promise.reject(Error("Quake-Terminal - Terminal App is null"));
    }

    const info = this._terminal.get_app_info();
    _log(
      `*** QuakeTerminal@_launchTerminalWindow - launching a new window for terminal ${info.get_name()}  ***`
    );
    const launchArgsMap =
      this._settings.get_value("launch-args-map").deep_unpack() || {};

    const launchArgs = launchArgsMap[info.get_id()] || "";
    const cancellable = new Gio.Cancellable();
    const existingWindows = new Set(this._terminal.get_windows());
    const terminal = this._terminal;

    const promiseTerminalWindowInLessThanFiveSeconds = new Promise(
      (resolve, reject) => {
        const shellAppWindowsChangedHandler = () => {
          const candidates = terminal.get_windows().filter((window) =>
            !existingWindows.has(window) &&
            window.get_window_type() === Meta.WindowType.NORMAL &&
            !window.get_transient_for() &&
            window.get_compositor_private()
          );
          if (candidates.length !== 1) return;
          const [ourWindow] = candidates;
          if (this._sourceTimeoutLoopId !== null)
            GLib.Source.remove(this._sourceTimeoutLoopId);
          this._sourceTimeoutLoopId = null;
          if (this._terminalChangedId !== null)
            terminal.disconnect(this._terminalChangedId);
          this._terminalChangedId = null;
          /**
           * The window actor for this terminal window.
           *
           * @type {Meta.WindowActor & { ease: Function }}
           */
          const actor = ourWindow.get_compositor_private();
          actor.set_name("quake-terminal");
          this._internalState = QuakeMode.LIFECYCLE.CREATED_ACTOR;
          this._watchTerminalWindow(ourWindow);

          // Keeps the Terminal out of Overview mode and Alt-Tab window switching
          this._configureSkipTaskbarProperty();

          this._handleAlwaysOnTop();

          resolve(true);
        };

        this._terminalChangedId = terminal.connect(
          "windows-changed",
          shellAppWindowsChangedHandler
        );

        const exec = info.get_string("Exec");
        const cleanedExec = this._cleanDesktopFileExec(exec);
        let fullCommand = `${cleanedExec} ${launchArgs}`;

        try {
          const [success, argv] = GLib.shell_parse_argv(fullCommand);
          if (success) {
            this._spawn(argv, cancellable).catch((e) => reject(e));
          } else {
            reject(Error(`Failed to parse command line args: ${fullCommand}`));
          }
        } catch (e) {
          reject(e);
        }

        this._sourceTimeoutLoopId = GLib.timeout_add_seconds(
          GLib.PRIORITY_DEFAULT,
          STARTUP_TIMER_IN_SECONDS,
          () => {
            cancellable.cancel();
            reject(
              Error(
                `Quake-Terminal: Timeout reached after ${STARTUP_TIMER_IN_SECONDS} seconds while trying to open the Quake terminal`
              )
            );
            return GLib.SOURCE_REMOVE;
          }
        );
      }
    );

    return promiseTerminalWindowInLessThanFiveSeconds;
  }

  /**
   * Adjusts the terminal window's initial position and handles signal connections related
   * to window mapping and sizing.
   */
  _adjustTerminalWindowPosition() {
    if (!this.terminalWindow || !this.actor) {
      _log(
        `*** QuakeTerminal@_adjustTerminalWindowPosition - No terminalWindow || actor ***`
      );
      return;
    }

    this.terminalWindow.stick();

    // Defined at this scope so the unconditional fallback timer below can also
    // call it when the `map` signal fired before our handler was connected.
    const advanceToRunning = () => {
      if (this._stageViewFallbackTimeoutId) {
        GLib.Source.remove(this._stageViewFallbackTimeoutId);
        this._stageViewFallbackTimeoutId = null;
      }
      if (this._actorStageViewChangedId && this.actor) {
        this.actor.disconnect(this._actorStageViewChangedId);
        this._actorStageViewChangedId = null;
      }
      if (this._wmMapSignalId) {
        Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
        this._wmMapSignalId = null;
      }
      if (this._internalState !== QuakeMode.LIFECYCLE.CREATED_ACTOR) return;
      _log(`*** QuakeTerminal@advanceToRunning - Advancing to RUNNING ***`);
      this._internalState = QuakeMode.LIFECYCLE.RUNNING;
      this._showTerminalAfterResize("launch");
    };

    if (this.actor.is_mapped()) {
      // The `map` signal already fired before we could connect to it (the
      // race behind #85). By the time the actor is mapped, its stage views
      // have already settled too, so `stage-views-changed` will never fire
      // again for it.
      _log(
        `*** QuakeTerminal@_adjustTerminalWindowPosition - actor already mapped, missed map signal, advancing immediately ***`
      );
      this.actor.opacity = 0;
      Shell.Global.get().window_manager.emit("kill-window-effects", this.actor);
      advanceToRunning();
      return;
    }

    const mapSignalHandler = (
      /** @type {Shell.WM} */ wm,
      /** @type {Meta.WindowActor} */ metaWindowActor
    ) => {
      if (metaWindowActor !== this.actor) {
        _log(
          `*** QuakeTerminal@mapSignalHandler - ${metaWindowActor.get_name()} is not our actor, skipping. ***`
        );
        return;
      }
      this.actor.opacity = 0;
      Shell.Global.get().window_manager.disconnect(this._wmMapSignalId);
      this._wmMapSignalId = null;
      wm.emit("kill-window-effects", this.actor);
      this._actorStageViewChangedId = this.actor.connect(
        "stage-views-changed",
        () => {
          _log(
            `*** QuakeTerminal@_adjustTerminalWindowPosition - stage-views-changed received, state ${this._internalState} ***`
          );
          advanceToRunning();
        }
      );
    };

    this._wmMapSignalId = Shell.Global.get().window_manager.connect(
      "map",
      mapSignalHandler
    );

    this._stageViewFallbackTimeoutId = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      CREATED_ACTOR_TIMEOUT_IN_SECONDS,
      () => {
        this._stageViewFallbackTimeoutId = null;
        _log(
          `*** QuakeTerminal@_adjustTerminalWindowPosition - stage-views-changed fallback timeout fired (state=${this._internalState}) ***`
        );
        advanceToRunning();
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  _shouldAvoidAnimation() {
    if (!this.actor) {
      return true;
    }

    return false;
  }

  /**
   * Clips animation above the terminal's intended top edge.
   *
   * @param {Meta.WindowActor} actor - The animated terminal actor.
   * @returns {Function} Cleanup for completion or cancellation.
   */
  _clipAnimationAboveTerminal(actor) {
    this._clearAnimationClip?.();
    const originalClip = actor.has_clip ? actor.get_clip() : null;
    const top = actor.meta_window.get_frame_rect().y;

    // Actor-local coordinates move with the window; counteract the translation
    // so the animation stays below the terminal's intended top edge.
    const updateClip = () => {
      const [x, y, width, height] = originalClip || [
        0,
        0,
        actor.width,
        actor.height,
      ];
      const clipTop = Math.max(y, top - actor.y - actor.translation_y);
      actor.set_clip(x, clipTop, width, Math.max(0, y + height - clipTop));
    };
    const translationId = actor.connect("notify::translation-y", updateClip);
    const allocationId = actor.connect("notify::allocation", updateClip);
    let cleared = false;
    const clearClip = (destroyed = false) => {
      if (cleared) return;
      cleared = true;
      if (!destroyed) {
        actor.disconnect(translationId);
        actor.disconnect(allocationId);
        actor.disconnect(destroyId);
        if (originalClip) actor.set_clip(...originalClip);
        else actor.remove_clip();
      }
      if (this._clearAnimationClip === clearClip)
        this._clearAnimationClip = null;
    };
    const destroyId = actor.connect("destroy", () => clearClip(true));
    this._clearAnimationClip = clearClip;
    updateClip();
    return clearClip;
  }

  _showTerminalWithAnimationTopDown() {
    if (this._shouldAvoidAnimation()) {
      return;
    }

    const parent = this.actor.get_parent();

    if (!parent) {
      return;
    }

    parent.set_child_above_sibling(this.actor, null);
    this.actor.translation_y = this.actor.height * -1;
    const clearClip = this._clipAnimationAboveTerminal(this.actor);

    Main.wm.skipNextEffect(this.actor);
    Main.activateWindow(this.actor.meta_window);

    this.actor.ease({
      mode: Clutter.AnimationMode.EASE_IN_QUAD,
      translation_y: 0,
      opacity: 255,
      duration: this._settings.get_int("animation-time"),
      onStopped: () => clearClip(),
      onComplete: () => {
        this._isTransitioning = false;
      },
    });
  }

  _hideTerminalWithAnimationBottomUp() {
    const actor = this.actor;
    if (!actor) return;

    const window = actor.meta_window;
    const clearClip = this._clipAnimationAboveTerminal(actor);
    /** @type {Clutter.Transition | null} */
    let transition = null;
    const cancelHideAnimation = () => {
      this._cancelHideAnimation = null;
      if (
        !transition ||
        this._clearAnimationClip !== clearClip ||
        actor.get_transition(HIDE_TRANSITION) !== transition
      ) {
        return;
      }
      actor.remove_transition(HIDE_TRANSITION);
      if (
        window.get_compositor_private() === actor &&
        actor.get_transition(HIDE_TRANSITION) === null
      ) {
        actor.translation_y = 0;
      }
    };
    this._cancelHideAnimation = cancelHideAnimation;

    actor.ease({
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      translation_y: actor.height * -1,
      duration: this._settings.get_int("animation-time"),
      onStopped: (/** @type {boolean} */ finished) => {
        const ownsClip = this._clearAnimationClip === clearClip;
        clearClip();
        if (this._cancelHideAnimation !== cancelHideAnimation) return;
        this._cancelHideAnimation = null;
        if (!finished || !ownsClip) return;

        Main.wm.skipNextEffect(actor);
        window.minimize();
        actor.translation_y = 0;
      },
    });
    if (this._cancelHideAnimation === cancelHideAnimation)
      transition = actor.get_transition(HIDE_TRANSITION);
  }

  /**
   * Resizes the terminal, then shows it. On Wayland a resize only lands once
   * the terminal redraws, so showing it right away would slide in the old
   * size, e.g. the full width GNOME auto-maximized it to on launch.
   *
   * @param {"launch" | "recall"} purpose - The operation waiting for the resize.
   */
  _showTerminalAfterResize(purpose) {
    const enabled = this._maximizedPanelMode.enabled;
    const display = () => {
      if (purpose === "launch") this._allowToggleDuringLaunchResize = false;
      this._showTerminalWithAnimationTopDown();
    };

    if (!this._applyTerminalDisplayGeometry()) {
      display();
      return;
    }

    const window = this._terminalWindow;
    const wait = { window, purpose, signalId: 0, timeoutId: 0 };
    const show = () => {
      if (this._resizeWait !== wait) return;
      this._cancelWaitForResize();
      if (
        this._maximizedPanelMode.enabled !== enabled ||
        this._pendingDisplayGeometry.has(window)
      )
        this._showTerminalAfterResize(purpose);
      else display();
    };

    wait.signalId = window.connect("size-changed", show);
    wait.timeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RESIZE_TIMEOUT_IN_MS,
      () => {
        wait.timeoutId = 0;
        show();
        return GLib.SOURCE_REMOVE;
      }
    );
    this._resizeWait = wait;
  }

  /**
   * Stops waiting for the resize started by _showTerminalAfterResize().
   */
  _cancelWaitForResize() {
    const wait = this._resizeWait;
    if (!wait) return;
    this._resizeWait = null;
    if (wait.timeoutId) GLib.Source.remove(wait.timeoutId);
    wait.window.disconnect(wait.signalId);
  }

  _applyTerminalDisplayGeometry() {
    const window = this.terminalWindow;
    if (!window) return false;
    const wasPending = this._pendingDisplayGeometry.delete(window);
    if (!this._maximizedPanelMode.enabled)
      return this._fitTerminalToMainMonitor(wasPending);

    return this._maximizeTerminal(window, this.monitorDisplayScreenIndex, true);
  }

  /**
   * @param {Meta.Window} window - The managed terminal.
   * @param {number} monitor - The resolved logical monitor index.
   * @param {boolean} alwaysPlace - Apply placement even if the window was not fullscreen.
   */
  _maximizeTerminal(window, monitor, alwaysPlace) {
    const fullscreen = window.fullscreen;
    const monitorChanged = alwaysPlace && window.get_monitor() !== monitor;
    if (fullscreen) window.unmake_fullscreen();
    if (fullscreen || alwaysPlace) window.move_to_monitor(monitor);
    if (window.maximized_horizontally && window.maximized_vertically)
      return fullscreen || monitorChanged;
    if (SHELL_VERSION >= 49) {
      const maximize = /** @type {() => void} */ (window.maximize);
      maximize.call(window);
    } else {
      window.maximize(Meta.MaximizeFlags.BOTH);
    }
    return true;
  }

  /**
   * @param {boolean} restoringSavedGeometry - Apply a switch out of maximized mode.
   * @param {number} [monitorDisplayScreenIndex] - Keep the current monitor for a settings change.
   * @returns {boolean} True when the window must change size, which happens
   * asynchronously on Wayland.
   */
  _fitTerminalToMainMonitor(restoringSavedGeometry, monitorDisplayScreenIndex) {
    if (!this.terminalWindow) {
      return false;
    }
    monitorDisplayScreenIndex ??= this.monitorDisplayScreenIndex;
    if (restoringSavedGeometry && this.terminalWindow.fullscreen)
      this.terminalWindow.unmake_fullscreen();
    const area = this.terminalWindow.get_work_area_for_monitor(
      monitorDisplayScreenIndex
    );

    const verticalSettingsValue = this._settings.get_int("vertical-size");
    const horizontalSettingsValue = this._settings.get_int("horizontal-size");

    const horizontalAlignmentSettingsValue = this._settings.get_int(
      "horizontal-alignment"
    );

    const terminalHeight = Math.round(
      (verticalSettingsValue * area.height) / 100
    );
    const terminalWidth = Math.round(
      (horizontalSettingsValue * area.width) / 100
    );

    const terminalX =
      area.x +
      Math.round(
        horizontalAlignmentSettingsValue &&
          (area.width - terminalWidth) / horizontalAlignmentSettingsValue
      );

    this.terminalWindow.move_to_monitor(monitorDisplayScreenIndex);

    // GNOME auto-maximizes new windows that are nearly as big as the screen,
    // and a maximized window ignores the size below. GNOME 49 removed the
    // flags parameter and renamed get_maximized() to is_maximized().
    if (SHELL_VERSION >= 49) {
      const window = /** @type {Meta.Window & {is_maximized(): boolean}} */ (
        this.terminalWindow
      );
      const maximized = restoringSavedGeometry
        ? window.maximized_horizontally || window.maximized_vertically
        : window.is_maximized();
      if (maximized) {
        const unmaximize = /** @type {() => void} */ (window.unmaximize);
        unmaximize.call(window);
      }
    } else {
      const getMaximized = this.terminalWindow.get_maximized;
      if (getMaximized.call(this.terminalWindow)) {
        const unmaximize = this.terminalWindow.unmaximize;
        const maximizeFlags = Meta.MaximizeFlags;
        unmaximize.call(this.terminalWindow, maximizeFlags.BOTH);
      }
    }

    const frame = this.terminalWindow.get_frame_rect();
    const mustResize =
      frame.width !== terminalWidth || frame.height !== terminalHeight;

    this.terminalWindow.move_resize_frame(
      false,
      terminalX,
      area.y,
      terminalWidth,
      terminalHeight
    );

    return mustResize;
  }

  _configureSkipTaskbarProperty() {
    const terminalWindow = this.terminalWindow;
    const shouldSkipTaskbar = this._settings.get_boolean("skip-taskbar");

    Object.defineProperty(terminalWindow, "skip_taskbar", {
      get() {
        if (terminalWindow && shouldSkipTaskbar) {
          return true;
        }

        return this.is_skip_taskbar();
      },
      configurable: true,
    });

    this._isTaskbarConfigured = true;
  }

  _configureActorCloseAnimation() {
    /** We will use `self` to refer to the extension inside the patched method. */
    const self = this;

    // @ts-ignore
    Main.wm._shouldAnimateActor = function (
      /**
       * @type {Meta.WindowActor & { ease: Function }}
       */
      actor,
      /** @type {any} */ types
    ) {
      const stack = new Error().stack;
      const forClosing = stack.includes("_destroyWindow@");

      /**
       * We specifically handle window closing events, but only when our actor is the target.
       * For all other cases, the original behavior remains in effect.
       */
      if (!forClosing || actor !== self.actor) {
        return self._original_shouldAnimateActor.apply(this, [actor, types]);
      }

      /** Store the original ease() method of the terminal actor. */
      const originalActorAnimate = actor.ease;

      /**
       * Intercept the next call to actor.animate() to perform a custom bottom-up close animation.
       * Afterward, immediately restore the original behavior.
       */
      actor.ease = function () {
        actor.ease = originalActorAnimate;
        const clearClip = self._clipAnimationAboveTerminal(actor);

        originalActorAnimate.call(actor, {
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          translation_y: actor.height * -1,
          duration: self._settings.get_int("animation-time"),
          onStopped: () => clearClip(),
          onComplete: () => {
            // @ts-ignore
            Main.wm._destroyWindowDone(Main.wm._shellwm, actor);
          },
        });
      };

      return true;
    };
  }

  /**
   * Hides the terminal when it loses focus.
   *
   * @param {Meta.Display} source - The display object.
   */
  async _handleHideOnFocusLoss(source) {
    const window = this._terminalWindow;
    const focusedWindow = source.focus_window;
    if (
      !window ||
      focusedWindow === window ||
      window.is_hidden() ||
      !this._settings.get_boolean(AUTO_HIDE_WINDOW) ||
      (await is_wlclipboard(focusedWindow))
    ) {
      return;
    }

    if (
      this._terminalWindow !== window ||
      source.focus_window !== focusedWindow ||
      window.is_hidden() ||
      !this._settings.get_boolean(AUTO_HIDE_WINDOW)
    ) {
      return;
    }

    this._hideTerminalWithAnimationBottomUp();
  }

  _handleAlwaysOnTop() {
    const shouldAlwaysOnTop = this._settings.get_boolean("always-on-top");

    if (!shouldAlwaysOnTop && !this.terminalWindow.is_above()) {
      return;
    }

    if (!shouldAlwaysOnTop && this.terminalWindow.is_above()) {
      this.terminalWindow.unmake_above();
      return;
    }

    this.terminalWindow.make_above();
  }

  /**
   * Execute a command asynchronously and check the exit status.
   *
   * If given, @cancellable can be used to stop the process before it finishes.
   *
   * @param {string[]} argv - a list of string arguments
   * @param {Gio.Cancellable} [cancellable] - optional cancellable object
   * @returns {Promise<void>} - The process success
   */
  async _spawn(argv, cancellable = null) {
    let cancelId = 0;
    const proc = new Gio.Subprocess({
      argv,
      flags: Gio.SubprocessFlags.NONE,
    });
    proc.init(cancellable);

    if (cancellable instanceof Gio.Cancellable)
      cancelId = cancellable.connect(() => proc.force_exit());

    try {
      const success = await proc.wait_check_async(null);

      if (!success) {
        const status = proc.get_exit_status();

        throw new Gio.IOErrorEnum({
          code: Gio.IOErrorEnum.FAILED,
          message: `Command '${argv}' failed with exit code ${status}`,
        });
      }
    } finally {
      if (cancelId > 0) cancellable.disconnect(cancelId);
    }
  }

  /**
   * Cleans desktop file Exec field by removing field codes that are not applicable
   * for terminal launching in quake mode.
   *
   * According to Desktop Entry Specification, field codes include:
   * %f - single file name
   * %F - multiple file names
   * %u - single URL
   * %U - multiple URLs
   * %d - deprecated (single directory name)
   * %D - deprecated (multiple directory names)
   * %n - deprecated (single filename without path)
   * %N - deprecated (multiple filenames without path)
   * %i - icon field prefixed by --icon
   * %c - translated name of the application
   * %k - location of desktop file
   * %v - deprecated (device)
   * %% - literal percent sign
   *
   * For terminal applications in quake mode, we don't pass any files or URLs,
   * so we remove these field codes except for %%.
   *
   * @param {string} exec - The Exec field from the desktop file
   * @returns {string} The cleaned Exec command
   */
  _cleanDesktopFileExec(exec) {
    if (!exec) {
      return "";
    }

    // Handle %% first (literal percent sign) by temporarily replacing it
    const tempReplacement = "___PERCENT_PLACEHOLDER___";
    let cleaned = exec.replace(/%%/g, tempReplacement);

    // Remove all standard desktop file field codes
    // Match % followed by a letter (case insensitive)
    cleaned = cleaned.replace(/%[fFuUdDnNickv]/g, "");

    // Restore literal percent signs
    cleaned = cleaned.replace(new RegExp(tempReplacement, "g"), "%");

    // Clean up any extra whitespace that might be left
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    return cleaned;
  }
};
