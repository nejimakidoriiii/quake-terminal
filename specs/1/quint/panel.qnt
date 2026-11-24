module panel {
  // Monitor は論理モニター。Terminal と各別窓を識別する。
  pure val monitors = Set(0, 1)
  pure val panelIds = Set(0, 1)
  pure val windows = Set("Terminal", "SameApp", "Dialog", "Clipboard", "Other", "None")
  pure val sessions = Set("Desktop", "Overview", "Locked")
  type State = {
    extension: bool, mode: bool, alive: bool, shown: bool,
    workspace: bool, focus: str, session: str,
    maxH: bool, maxV: bool, fullscreen: bool, shape: str,
    monitor: int, panels: Set[int], panelMonitor: int -> int,
    baselineVisible: int -> bool, baselineReserved: int -> bool,
    panelVisible: int -> bool, panelReserved: int -> bool,
    saved: (int, int, int), autoHide: bool
  }
  var s: State
  var before: State
  var event: str

  // REQ-015 REQ-022: 窓自身・両軸・通常 Desktop の全条件。
  pure def eligible(x: State): bool = and {
    x.extension, x.mode, x.alive, x.shown, x.workspace,
    x.focus == "Terminal", x.session == "Desktop",
    not(x.fullscreen), x.maxH, x.maxV
  }
  pure def affected(x: State, p: int): bool =
    eligible(x) and x.monitor == x.panelMonitor.get(p) and x.panels.contains(p)

  // REQ-015 REQ-016 REQ-017 REQ-020 REQ-021:
  // 外部の元の状態に自分の変更だけを重ねる抽象化。
  pure def reconcile(x: State): State = x
    .with("panelVisible", panelIds.mapBy(p =>
      x.baselineVisible.get(p) and not(affected(x, p))))
    .with("panelReserved", panelIds.mapBy(p =>
      x.baselineReserved.get(p) and not(affected(x, p))))

  action commit(candidate: State, name: str): bool = all {
    s' = reconcile(candidate),
    before' = s,
    event' = name
  }

  // REQ-003: 初期値 mode=false。元の表示・予約は独立に選ぶ。
  action init = {
    nondet v0 = Set(false, true).oneOf()
    nondet v1 = Set(false, true).oneOf()
    nondet r0 = Set(false, true).oneOf()
    nondet r1 = Set(false, true).oneOf()
    nondet ah = Set(false, true).oneOf()
    val base: State = {
      extension: true, mode: false, alive: true, shown: false,
      workspace: true, focus: "Other", session: "Desktop",
      maxH: false, maxV: false, fullscreen: false, shape: "Saved",
      monitor: 0, panels: Set(0), panelMonitor: Map(0 -> 0, 1 -> 1),
      baselineVisible: Map(0 -> v0, 1 -> v1),
      baselineReserved: Map(0 -> r0, 1 -> r1),
      panelVisible: Map(0 -> v0, 1 -> v1),
      panelReserved: Map(0 -> r0, 1 -> r1),
      saved: (70, 50, 2), autoHide: ah
    }
    all { s' = base, before' = base, event' = "Init" }
  }

  // REQ-007 REQ-012 REQ-013 REQ-014:
  // 実際の値の切替だけを設定変更イベントとする。同値の入力は対象外。
  // 隠れた窓は呼ばず、表示中だけ形状を即時に反映する。
  action setMode(value: bool): bool = all {
    s.extension,
    value != s.mode,
    val candidate = s.with("mode", value)
    val fitted = if (s.alive and s.shown)
      candidate.with("maxH", value).with("maxV", value)
        .with("fullscreen", false)
        .with("shape", if (value) "Maximized" else "Saved")
      else candidate
    commit(fitted, "SetMode")
  }

  // REQ-005 REQ-006 REQ-014 REQ-025:
  // 既存分岐のうち表示・呼び戻しを入力とする。隠す分岐は hide。
  // オフ時の fullscreen の結果は既存動作の比較に委ね、ここでは制約しない。
  action showOrRecall = {
    nondet legacyFullscreen = Set(false, true).oneOf()
    all {
      s.extension,
      commit(s.with("alive", true).with("shown", true)
        .with("workspace", true).with("focus", "Terminal")
        .with("fullscreen", if (s.mode) false else legacyFullscreen)
        .with("maxH", s.mode).with("maxV", s.mode)
        .with("shape", if (s.mode) "Maximized" else "Saved"), "ShowOrRecall")
    }
  }

  // REQ-020 REQ-022 REQ-023 REQ-024:
  // Clipboard 例外は shown だけ。最大化・fullscreen・shape は保存する。
  action focusWindow(w: str): bool = {
    val hideForFocus = s.extension and s.autoHide
      and w != "Terminal" and w != "Clipboard"
    commit(s.with("focus", w)
      .with("shown", s.shown and not(hideForFocus)), "FocusWindow")
  }

  // REQ-020 REQ-024: 窓状態の手動変更は環境の入力。
  action manual(h: bool, v: bool, full: bool): bool = all {
    s.alive,
    commit(s.with("maxH", h).with("maxV", v)
      .with("fullscreen", full).with("shape", "Manual"), "Manual")
  }

  // REQ-020: 非表示・終了・Overview・Locked・ワークスペース。
  action hide = commit(s.with("shown", false), "Hide")
  action close = commit(s.with("alive", false).with("shown", false), "Close")
  action sessionChange(value: str): bool =
    commit(s.with("session", value), "SessionChange")
  action workspaceChange(value: bool): bool =
    commit(s.with("workspace", value), "WorkspaceChange")

  // REQ-020 REQ-026 REQ-027: 停止は窓を変更せずパネル変更を取り消す。
  action stop = commit(s.with("extension", false), "Stop")
  action start = commit(s.with("extension", true), "Start")

  // REQ-028 REQ-029: GNOME が決めた現在の Monitor と標準 Panel の配置。
  // location=-1 は操作可能な標準 Panel がない場合。
  // 同じ Panel の移動では同じ ID を使い、復元元の状態を持ち運ぶ。
  action topology(current: int, location: int, panelId: int): bool =
    commit(s.with("monitor", current)
      .with("panels", if (location == -1) Set() else Set(panelId))
      .with("panelMonitor", s.panelMonitor.set(panelId, location)), "Topology")

  action step = {
    nondet b = Set(false, true).oneOf()
    nondet h = Set(false, true).oneOf()
    nondet v = Set(false, true).oneOf()
    nondet w = windows.oneOf()
    nondet session = sessions.oneOf()
    nondet m = monitors.oneOf()
    nondet p = Set(-1, 0, 1).oneOf()
    nondet id = panelIds.oneOf()
    any {
      setMode(b), showOrRecall, focusWindow(w), manual(h, v, b),
      hide, close, sessionChange(session), workspaceChange(b),
      stop, start, topology(m, p, id)
    }
  }

  // REQ-003
  val defaultOff = (event == "Init") implies not(s.mode)
  // REQ-015 REQ-016 REQ-017 REQ-020 REQ-021:
  // 出力の契約は eligible/affected を呼ばず、条件の取り違えを検出する。
  val panelPolicy = panelIds.forall(p => {
    val suppress = and {
      s.extension, s.mode, s.alive, s.shown, s.workspace,
      s.focus == "Terminal", s.session == "Desktop",
      not(s.fullscreen), s.maxH, s.maxV,
      s.monitor == s.panelMonitor.get(p), s.panels.contains(p)
    }
    and {
      s.panelVisible.get(p) == (s.baselineVisible.get(p) and not(suppress)),
      s.panelReserved.get(p) == (s.baselineReserved.get(p) and not(suppress))
    }
  })
  // REQ-007: 他の操作にも保存値を変更する権限を与えない。
  val savedUnchanged = s.saved == (70, 50, 2)
  // REQ-005 REQ-006 REQ-014 REQ-025:
  // 非フルスクリーンの縦横最大化はオンの場合だけの契約。
  // オフの Saved は保存値適用の抽象化であり fullscreen 解除を含意しない。
  val showResult = (event == "ShowOrRecall") implies and {
    s.alive, s.shown,
    s.mode implies and {
      not(s.fullscreen), s.maxH, s.maxV, s.shape == "Maximized"
    },
    not(s.mode) implies (s.shape == "Saved")
  }
  // REQ-012 REQ-013 REQ-014
  val settingResult = (event == "SetMode") implies and {
    s.mode != before.mode,
    s.shown == before.shown,
    (before.alive and before.shown) implies and {
      s.maxH == s.mode, s.maxV == s.mode, not(s.fullscreen),
      s.shape == (if (s.mode) "Maximized" else "Saved")
    },
    not(before.alive and before.shown) implies and {
      s.maxH == before.maxH, s.maxV == before.maxV,
      s.fullscreen == before.fullscreen, s.shape == before.shape
    }
  }
  // REQ-022 REQ-023 REQ-024
  val focusResult = (event == "FocusWindow") implies and {
    s.maxH == before.maxH, s.maxV == before.maxV,
    s.fullscreen == before.fullscreen, s.shape == before.shape,
    (s.focus == "Clipboard") implies (s.shown == before.shown)
  }
  // REQ-026 REQ-027
  val stopResult = (event == "Stop") implies and {
    s.alive == before.alive, s.shown == before.shown,
    s.maxH == before.maxH, s.maxV == before.maxV,
    s.fullscreen == before.fullscreen, s.shape == before.shape
  }
  // REQ-028 REQ-029: 再判定は窓の形状に干渉しない。
  val topologyResult = (event == "Topology") implies and {
    s.shape == before.shape, s.maxH == before.maxH,
    s.maxV == before.maxV, s.fullscreen == before.fullscreen
  }
  val safety = and {
    defaultOff, panelPolicy, savedUnchanged, showResult,
    settingResult, focusResult, stopResult, topologyResult
  }
}
