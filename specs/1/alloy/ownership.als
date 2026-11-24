module ownership

// REQ-002: 管理対象端末ごとではなく一つの共通設定。
one sig Mode {}
sig Monitor {}
sig PhysicalOutput { logical: one Monitor }
sig Window { monitor: one Monitor }
one sig Terminal extends Window {}
sig ManagedApplication { mode: one Mode }

abstract sig Owner {}
sig Panel extends Owner { monitor: one Monitor }
sig DockOrExtension extends Owner {}
sig Reservation { owner: one Owner }

one sig Control {
  affectedPanel: set Panel,
  affectedReservation: set Reservation,
  directWindow: set Window
}

// REQ-017: 対象 Panel を Terminal と同じ論理 Monitor に限定。
fact LocalPanel {
  all p: Control.affectedPanel | p.monitor = Terminal.monitor
}
// REQ-018: Panel 自身が所有する Reservation だけを対象とする。
fact OwnedReservation {
  Control.affectedReservation = Control.affectedPanel.~owner
}
// REQ-030: ミラーの物理出力が同じ Monitor を指せる。
// Control は物理出力を直接の対象としない。
// REQ-032: 他の Window は直接操作しない。
fact ManagedWindowOnly {
  Control.directWindow in Terminal
}

// REQ-017 REQ-018: 予約所有関係と同一モニター制約からの帰結。
assert NoForeignReservation {
  all r: Control.affectedReservation |
    r.owner in Panel and (r.owner & Panel).monitor = Terminal.monitor
}
check NoForeignReservation for 5

// REQ-002: 端末アプリを区別しても共通設定を参照できる。
pred SharedMode {
  #ManagedApplication = 2
  all a: ManagedApplication | a.mode = Mode
}
run SharedMode for 5

// REQ-017 REQ-018 REQ-030 REQ-032: ミラーと別 Monitor・別窓・別予約の共存。
pred MirrorAndForeign {
  #Monitor = 2
  #PhysicalOutput = 2
  some disj a, b: PhysicalOutput | a.logical = b.logical
  some p: Panel | p.monitor = Terminal.monitor and p in Control.affectedPanel
  some p: Panel | p.monitor != Terminal.monitor
  some r: Reservation | r.owner in DockOrExtension
  some Control.affectedReservation
  some Window - Terminal
  Control.directWindow = Terminal
}
run MirrorAndForeign for 5

// REQ-017: 同じ Monitor に標準 Panel がない配置も許す。
pred NoLocalPanel {
  some Panel
  all p: Panel | p.monitor != Terminal.monitor
  no Control.affectedPanel
}
run NoLocalPanel for 5
