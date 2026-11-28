module footprint

sig Monitor {}
abstract sig Owner {}
sig Panel extends Owner { monitor: one Monitor }
sig OtherOwner extends Owner {}
sig Reservation { owner: one Owner }
sig Terminal { monitor: one Monitor }

one sig Control {
  terminal: one Terminal,
  writtenPanels: set Panel,
  writtenReservations: set Reservation
}

// REQ-017: その時点での操作対象だけを表す。旧対象の復元は Quint の領分。
fact LocalPanel {
  all p: Control.writtenPanels | p.monitor = Control.terminal.monitor
}
// REQ-018: 他所有者の予約を操作対象に加えない。
fact OwnedReservation {
  Control.writtenReservations.owner in Control.writtenPanels
}

// REQ-017 REQ-018: 二つの fact の組合せから、別モニターの所有者も除外される。
assert NoForeignReservation {
  all r: Control.writtenReservations |
    r.owner in { p: Panel | p.monitor = Control.terminal.monitor }
}
check NoForeignReservation for 5

// REQ-017 REQ-018: 同じ構造に対象 Panel、別 Monitor の Panel、他所有者を置ける。
pred LocalAndForeign {
  some Control.writtenPanels
  some Control.writtenReservations
  some p: Panel | p.monitor != Control.terminal.monitor
  some r: Reservation | r.owner in OtherOwner
}
run LocalAndForeign for 5

// REQ-017: 同じ Monitor に標準 Panel がなければ他の Panel を使わない。
pred NoLocalPanel {
  some Panel
  no p: Panel | p.monitor = Control.terminal.monitor
  no Control.writtenPanels
  no Control.writtenReservations
}
run NoLocalPanel for 5
