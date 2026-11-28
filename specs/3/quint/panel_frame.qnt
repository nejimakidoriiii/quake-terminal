module panel_frame {
  // 表示準備、作業領域反映、最初の描画を区別する要求モデル。
  // 個々の action は GNOME の API 呼出しや実装の配置を指定しない。
  pure val panelIds = Set(0, 1)
  pure val reservationIds = Set("Dock", "OtherExtension")
  pure val methods = Set("Click", "AltTab", "Shortcut", "Other")
  pure val losses = Set(
    "FocusLost", "Hidden", "Unmapped", "Closed", "MaxH", "MaxV", "BothAxes",
    "Fullscreen", "Workspace", "Overview", "Locked", "ModeOff",
    "Stopped", "MonitorMismatch", "PanelGone"
  )
  type State = {
    extension: bool, enabled: bool, alive: bool, shown: bool, mapped: bool,
    workspace: bool, focus: str, session: str,
    maxH: bool, maxV: bool, fullscreen: bool,
    monitor: int, known: bool, panels: Set[int], panelMonitor: int -> int,
    baselineVisible: int -> bool, baselineReserved: int -> bool,
    panelVisible: int -> bool, panelReserved: int -> bool,
    foreignBaseline: str -> bool, foreignReserved: str -> bool,
    foreignMonitor: str -> int,
    phase: str, operation: str, method: str,
    areaReady: bool, atTop: bool, entrance: bool, hideSlide: bool
  }
  var s: State
  var before: State
  var event: str

  // REQ-025: 実際の shown・mapped・フォーカスを要求する。表示意図は代用しない。
  pure def eligible(x: State): bool = and {
    x.extension, x.enabled, x.alive, x.known, x.shown, x.mapped, x.workspace,
    x.focus == "Terminal", x.session == "Desktop",
    x.maxH, x.maxV, not(x.fullscreen)
  }
  // REQ-017: Panel の ID と現在の論理 Monitor を区別する。
  pure def affected(x: State, p: int): bool =
    eligible(x) and x.panels.contains(p) and
    x.panelMonitor.get(p) == x.monitor
  pure def hasLocalPanel(x: State): bool =
    panelIds.exists(p => x.panels.contains(p) and x.panelMonitor.get(p) == x.monitor)
  pure def applicable(x: State): bool = eligible(x) and hasLocalPanel(x)
  pure def otherTopReservation(x: State): bool =
    reservationIds.exists(r => x.foreignMonitor.get(r) == x.monitor and x.foreignReserved.get(r))

  // REQ-014 REQ-015 REQ-016: 元の可視性と予約を ID ごとに独立に復元する。
  pure def restore(x: State): State = x
    .with("panelVisible", x.baselineVisible)
    .with("panelReserved", x.baselineReserved)
    .with("areaReady", false).with("atTop", false)
    .with("phase", "Idle").with("operation", "None")
    .with("entrance", false).with("hideSlide", false)
  pure def suppress(x: State): State = x
    .with("panelVisible", panelIds.mapBy(p =>
      x.baselineVisible.get(p) and not(affected(x, p))))
    .with("panelReserved", panelIds.mapBy(p =>
      x.baselineReserved.get(p) and not(affected(x, p))))
    .with("areaReady", false).with("atTop", false)

  action commit(x: State, name: str): bool = all {
    s' = x, before' = s, event' = name
  }

  action init = {
    nondet v0 = Set(false, true).oneOf()
    nondet v1 = Set(false, true).oneOf()
    nondet r0 = Set(false, true).oneOf()
    nondet r1 = Set(false, true).oneOf()
    nondet f0 = Set(false, true).oneOf()
    nondet f1 = Set(false, true).oneOf()
    nondet alive = Set(false, true).oneOf()
    nondet shown = Set(false, true).oneOf()
    nondet mapped = Set(false, true).oneOf()
    val base: State = {
      extension: true, enabled: true, alive: alive,
      shown: alive and shown, mapped: alive and mapped,
      workspace: true, focus: "Other", session: "Desktop",
      maxH: true, maxV: true, fullscreen: false,
      monitor: 0, known: alive, panels: Set(0, 1),
      panelMonitor: Map(0 -> 0, 1 -> 1),
      baselineVisible: Map(0 -> v0, 1 -> v1),
      baselineReserved: Map(0 -> r0, 1 -> r1),
      panelVisible: Map(0 -> v0, 1 -> v1),
      panelReserved: Map(0 -> r0, 1 -> r1),
      foreignBaseline: Map("Dock" -> f0, "OtherExtension" -> f1),
      foreignReserved: Map("Dock" -> f0, "OtherExtension" -> f1),
      foreignMonitor: Map("Dock" -> 0, "OtherExtension" -> 1),
      phase: "Idle", operation: "None", method: "Other",
      areaReady: false, atTop: false, entrance: false, hideSlide: false
    }
    all { s' = base, before' = base, event' = "Init" }
  }

  // REQ-013: 対象窓か Monitor が未確定なら先に Panel を変更しない。
  action requestLaunch = all {
    s.extension, not(s.alive), s.phase == "Idle",
    commit(s.with("known", false).with("phase", "Pending")
      .with("operation", "Launch"), "RequestLaunch")
  }
  // REQ-001 REQ-022: 対象窓と Monitor が確定した表示準備。
  action resolveLaunch(monitor: int): bool = all {
    s.phase == "Pending",
    commit(s.with("alive", true).with("known", true)
      .with("monitor", monitor).with("phase", "Preparing"), "ResolveLaunch")
  }
  // REQ-002: 既存ショートカットの再表示分岐だけを扱う。
  action recall = all {
    s.extension, s.alive, not(s.shown and s.mapped), s.phase == "Idle",
    commit(s.with("known", true).with("phase", "Preparing")
      .with("operation", "Recall"), "Recall")
  }
  // REQ-001 REQ-002 REQ-025: 表示要求とは別に実状態を観測する。
  // shown と mapped は独立の入力。フォーカスとの前後関係も固定しない。
  action observeWindow(shown: bool, mapped: bool): bool = all {
    s.alive, s.known, s.phase == "Preparing",
    val x = s.with("shown", shown).with("mapped", mapped)
      .with("areaReady", false).with("atTop", false)
    commit(if (eligible(s) and not(eligible(x))) restore(x) else x, "ObserveWindow")
  }
  // REQ-001 REQ-002 REQ-025: Launch/Recall の実際のフォーカス確定の観測。
  action observeFocus = all {
    s.alive, s.known, s.phase == "Preparing", s.focus != "Terminal",
    Set("Launch", "Recall").contains(s.operation),
    commit(s.with("focus", "Terminal").with("areaReady", false)
      .with("atTop", false), "ObserveFocus")
  }
  // REQ-003 REQ-009 REQ-010: 表示中の窓への実際の復帰が確定した入力。
  // 操作要求ではない。方法はガードに用いず、確定後の最初の描画を待つ。
  action focusReturn(method: str): bool = all {
    s.alive, s.shown, s.mapped, s.focus != "Terminal", s.phase == "Idle",
    commit(s.with("focus", "Terminal").with("operation", "FocusReturn")
      .with("phase", "Preparing").with("method", method)
      .with("entrance", false).with("areaReady", false)
      .with("atTop", false), "FocusReturn")
  }
  // REQ-011: 候補選択ではフォーカスを確定せず表示準備も開始しない。
  action selecting = all {
    s.alive, s.shown, s.mapped, s.focus != "Terminal", s.phase == "Idle",
    commit(s, "Selecting")
  }
  // REQ-001 REQ-002 REQ-003 REQ-017 REQ-018 REQ-019:
  // 元から非表示・未予約だった項目も区別して保持する。
  action suppressPanel = all {
    s.phase == "Preparing", s.known,
    commit(suppress(s), "SuppressPanel")
  }
  // REQ-005 REQ-006 REQ-007: 予約の解放と作業領域への反映を区別する。
  action settleArea = all {
    s.phase == "Preparing", applicable(s),
    panelIds.forall(p => affected(s, p) implies
      (not(s.panelVisible.get(p)) and not(s.panelReserved.get(p)))),
    commit(s.with("areaReady", true)
      .with("atTop", applicable(s) and not(otherTopReservation(s))), "SettleArea")
  }
  // REQ-001 REQ-002 REQ-003 REQ-005 REQ-006 REQ-007 REQ-008 REQ-009 REQ-010:
  // これは許される描画境界の仕様であり、実装が描画を止められるという主張ではない。
  action drawFirst = all {
    s.phase == "Preparing", s.alive, s.known, s.shown, s.mapped,
    applicable(s) implies and {
      s.areaReady,
      panelIds.forall(p => affected(s, p) implies
        (not(s.panelVisible.get(p)) and not(s.panelReserved.get(p))))
    },
    commit(s.with("phase", "Visible")
      .with("entrance", Set("Launch", "Recall").contains(s.operation)), "DrawFirst")
  }
  action finishDisplay = all {
    s.phase == "Visible",
    commit(s.with("phase", "Idle").with("operation", "None")
      .with("entrance", false), "FinishDisplay")
  }
  // REQ-012 REQ-014 REQ-015 REQ-020 REQ-021: 逆操作は表示準備とは別。
  action hide = all {
    s.alive, s.shown,
    commit(restore(s.with("shown", false).with("mapped", false).with("focus", "Other"))
      .with("hideSlide", true), "Hide")
  }
  // REQ-014 REQ-015: 成功前の失敗・中断では確保した自分の変更を戻す。
  action abort(name: str): bool = all {
    Set("Pending", "Preparing").contains(s.phase),
    commit(restore(s.with("focus", "Other")), name)
  }
  // REQ-014 REQ-015 REQ-025: 各条件喪失は外部からの入力として区別する。
  action lose(reason: str): bool = {
    val x =
      if (reason == "FocusLost") s.with("focus", "Other")
      else if (reason == "Hidden") s.with("shown", false).with("mapped", false).with("focus", "Other")
      else if (reason == "Unmapped") s.with("mapped", false)
      else if (reason == "Closed") s.with("alive", false).with("shown", false)
        .with("mapped", false).with("known", false)
      else if (reason == "MaxH") s.with("maxH", false)
      else if (reason == "MaxV") s.with("maxV", false)
      else if (reason == "BothAxes") s.with("maxH", false).with("maxV", false)
      else if (reason == "Fullscreen") s.with("fullscreen", true)
      else if (reason == "Workspace") s.with("workspace", false)
      else if (reason == "Overview") s.with("session", "Overview")
      else if (reason == "Locked") s.with("session", "Locked")
      else if (reason == "ModeOff") s.with("enabled", false)
      else if (reason == "Stopped") s.with("extension", false)
      else if (reason == "MonitorMismatch") s.with("panels", Set(0)).with("monitor", 1)
      else s.with("panels", Set())
    commit(restore(x), "Loss")
  }
  // REQ-017 REQ-025: 配置は GNOME の現在の結果を入力し旧対象の変更を戻す。
  action topology(monitor: int, panel: int): bool =
    commit(suppress(restore(s.with("monitor", monitor).with("panels", Set(panel)))),
      "Topology")

  action step = {
    nondet monitor = Set(0, 1).oneOf()
    nondet panel = panelIds.oneOf()
    nondet method = methods.oneOf()
    nondet reason = losses.oneOf()
    nondet failure = Set("Failure", "Cancel").oneOf()
    nondet shown = Set(false, true).oneOf()
    nondet mapped = Set(false, true).oneOf()
    any {
      requestLaunch, resolveLaunch(monitor), recall, focusReturn(method),
      observeWindow(shown, mapped), observeFocus,
      selecting, suppressPanel, settleArea, drawFirst, finishDisplay,
      hide, abort(failure), lose(reason), topology(monitor, panel)
    }
  }

  // REQ-013: Pending は既存の Panel 表示と予約を保持する。
  val pendingSafe = (s.phase == "Pending") implies and {
    s.panelVisible == s.baselineVisible,
    s.panelReserved == s.baselineReserved, not(s.known)
  }
  // REQ-013 REQ-025: 対象確定・表示意図・表示とフォーカスの片方だけでは変更しない。
  val noEarlySuppression = not(and {
    s.known, s.alive, s.shown, s.mapped, s.focus == "Terminal"
  }) implies and {
    s.panelVisible == s.baselineVisible,
    s.panelReserved == s.baselineReserved
  }
  // REQ-025: 操作要求と対象特定は実際の表示・フォーカスや Panel を代入しない。
  val requestPreserved = Set("RequestLaunch", "ResolveLaunch", "Recall").contains(event) implies and {
    s.shown == before.shown, s.mapped == before.mapped, s.focus == before.focus,
    s.panelVisible == before.panelVisible, s.panelReserved == before.panelReserved
  }
  // REQ-017 REQ-018: 出力側の検査は affected を呼ばず対象を照合する。
  val scopeSafe = and {
    s.foreignReserved == s.foreignBaseline,
    panelIds.forall(p =>
      (not(s.panels.contains(p)) or s.panelMonitor.get(p) != s.monitor) implies and {
        s.panelVisible.get(p) == s.baselineVisible.get(p),
        s.panelReserved.get(p) == s.baselineReserved.get(p)
      })
  }
  // REQ-014 REQ-015 REQ-016 REQ-021 REQ-025
  val restored = (Set("Failure", "Cancel", "Loss", "Hide").contains(event) or
    (event == "ObserveWindow" and s.phase == "Idle")) implies and {
    s.panelVisible == s.baselineVisible,
    s.panelReserved == s.baselineReserved
  }
  // REQ-017 REQ-025: 旧対象を復元し、同じ Monitor の新対象だけに再適用する。
  val topologySafe = (event == "Topology") implies panelIds.forall(p => {
    val local = and {
      s.extension, s.enabled, s.alive, s.shown, s.mapped, s.known, s.workspace,
      s.focus == "Terminal", s.session == "Desktop",
      s.maxH, s.maxV, not(s.fullscreen),
      s.panels.contains(p), s.panelMonitor.get(p) == s.monitor
    }
    and {
      s.panelVisible.get(p) == (s.baselineVisible.get(p) and not(local)),
      s.panelReserved.get(p) == (s.baselineReserved.get(p) and not(local))
    }
  })
  // REQ-001 REQ-002 REQ-003 REQ-005 REQ-006 REQ-007 REQ-019:
  // 実行側の eligible/affected と独立に描画時の全条件を確認する。
  val frameSafe = (event == "DrawFirst") implies {
    val applies = and {
      s.extension, s.enabled, s.alive, s.shown, s.mapped, s.known, s.workspace,
      s.focus == "Terminal", s.session == "Desktop",
      s.maxH, s.maxV, not(s.fullscreen),
      panelIds.exists(p => s.panels.contains(p) and s.panelMonitor.get(p) == s.monitor)
    }
    applies implies and {
      s.areaReady,
      panelIds.forall(p =>
        (s.panels.contains(p) and s.panelMonitor.get(p) == s.monitor) implies
          (not(s.panelVisible.get(p)) and not(s.panelReserved.get(p)))),
      not(otherTopReservation(s)) implies s.atTop
    }
  }
  // REQ-008 REQ-009 REQ-010 REQ-012 REQ-020
  val slidePolicy = and {
    (event == "DrawFirst") implies
      (s.entrance == Set("Launch", "Recall").contains(s.operation)),
    (event == "Hide") implies (s.hideSlide and not(s.entrance)),
    (event == "FocusReturn") implies not(s.entrance)
  }
  // REQ-011: 候補選択では入力先も Panel も変更しない。
  val selectionSafe = (event == "Selecting") implies (s == before)
  // REQ-022: 対象操作自身は両軸最大化と非フルスクリーンを変更しない。
  val windowPreserved = Set("ResolveLaunch", "Recall", "ObserveWindow", "ObserveFocus",
    "FocusReturn", "SuppressPanel", "SettleArea", "DrawFirst", "FinishDisplay").contains(event) implies and {
    s.maxH == before.maxH, s.maxV == before.maxV,
    s.fullscreen == before.fullscreen
  }
  // REQ-025: 未確定または対象条件外の Panel を新たに変更しない。
  val eligibilitySafe = panelIds.forall(p =>
      (s.panelVisible.get(p) != s.baselineVisible.get(p) or
       s.panelReserved.get(p) != s.baselineReserved.get(p)) implies and {
         s.known, s.extension, s.enabled, s.alive, s.shown, s.mapped, s.workspace,
        s.focus == "Terminal", s.session == "Desktop",
        s.maxH, s.maxV, not(s.fullscreen),
        s.panels.contains(p), s.panelMonitor.get(p) == s.monitor
      })
  val safety = and {
    pendingSafe, scopeSafe, restored, frameSafe, slidePolicy,
    selectionSafe, windowPreserved, eligibilitySafe, topologySafe,
    noEarlySuppression, requestPreserved
  }
}
