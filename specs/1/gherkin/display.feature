Feature: 管理対象端末の通常の最大化と Panel の復元
  Terminal と別窓を区別し、Monitor は論理モニターを表す。
  eligible と各操作名は requirements.md の語彙に従う。

  @REQ-001 @REQ-003
  Scenario: 初期設定の mode
    Given 新規の設定で拡張を利用する
    When 設定画面を開く
    Then mode の切替が一つありオフになっている

  @REQ-002
  Scenario: mode は端末アプリごとに分かれない
    Given mode をオンにしている
    When 管理対象として選ぶ端末アプリを変更する
    Then mode は同じ共通設定のオンのままである

  @REQ-004 @REQ-008 @REQ-009 @REQ-010 @REQ-011
  Scenario Outline: 既存の表示操作を維持する
    Given mode が "<mode>" で比較対象となる既存の設定と窓状態がある
    When "<操作>" を行う
    Then "<維持する結果>" は変更前と一致する

    Examples:
      | mode | 操作 | 維持する結果 |
      | オフ | 表示する | サイズ・水平配置を含む表示動作 |
      | オフ | 手動フルスクリーンの Terminal を呼び戻す | フルスクリーン状態の扱いを含む既存の表示動作 |
      | オン | 表示する | 表示先 Monitor の選択 |
      | オン | 非表示の Terminal にショートカットを押す | 表示する分岐 |
      | オン | フォーカス中の Terminal にショートカットを押す | 隠す分岐 |
      | オン | 非フォーカスの Terminal にショートカットを押す | hide-on-toggle-without-focus に従う分岐 |
      | オン | Terminal を表示する | アニメーション |
      | オン | Terminal から Other にフォーカスを移す | auto-hide-window に従う自動非表示 |

  @REQ-005 @REQ-006 @REQ-025
  Scenario: showOrRecall は通常の縦横最大化を適用する
    Given mode がオンで Terminal は Manual の形状または非表示である
    And 保存した幅・高さは Monitor 全体より小さく水平配置も指定されている
    When showOrRecall を行う
    Then Terminal は非フルスクリーンで縦横ともに最大化された Maximized の形状で表示される

  @REQ-007 @REQ-012 @REQ-013
  Scenario Outline: 表示中の setMode は即時反映し保存値を維持する
    Given Terminal は表示中で幅・高さ・水平配置の保存値を読み取ってある
    And mode は "<元の値>" である
    When setMode で mode を "<値>" に切り替える
    Then Terminal の形状は即時に "<形状>" になる
    And 幅・高さ・水平配置を再読出しすると保存値は変更されていない

    Examples:
      | 元の値 | 値 | 形状 |
      | オフ | オン | 非フルスクリーンの通常の縦横最大化 Maximized |
      | オン | オフ | 保存したサイズ・水平配置 Saved |

  @REQ-014
  Scenario Outline: 非表示中の setMode は窓を呼び出さない
    Given Terminal は非表示である
    And mode は "<元の値>" である
    When setMode で mode を "<値>" に切り替える
    Then Terminal は非表示のままである

    Examples:
      | 元の値 | 値 |
      | オフ | オン |
      | オン | オフ |

  @REQ-014
  Scenario Outline: 非表示中に変更した mode を次の表示で使う
    Given Terminal が非表示の間に mode を "<値>" に変更した
    When showOrRecall を行う
    Then Terminal は "<形状>" で表示される

    Examples:
      | 値 | 形状 |
      | オン | 非フルスクリーンの通常の縦横最大化 Maximized |
      | オフ | 保存したサイズ・水平配置 Saved |

  @REQ-015 @REQ-016
  Scenario: eligible のとき Panel と Reservation を取り除く
    Given Terminal が eligible で同じ Monitor の Panel は表示され Reservation を持つ
    When reconcile を行う
    Then 同じ Monitor の Panel は非表示になる
    And その Panel の Reservation は解放される

  @REQ-015 @REQ-020
  Scenario Outline: eligible の各条件を失ったとき自分の変更を復元する
    Given Terminal が eligible で Panel と Reservation を拡張が変更している
    When "<操作>" を行う
    Then 自分が変更した Panel の表示と Reservation は変更前に戻る

    Examples:
      | 操作 |
      | focusWindow で Other に移る |
      | hide で Terminal を非表示にする |
      | close で Terminal を終了する |
      | manual で横軸だけ最大化を解除する |
      | manual で縦軸だけ最大化を解除する |
      | manual で両軸の最大化を解除する |
      | manual でフルスクリーンにする |
      | sessionChange で Overview に入る |
      | sessionChange で Locked に入る |
      | workspaceChange で Terminal の見えないワークスペースに移る |
      | setMode で mode をオフにする |
      | stop で拡張を無効にする |

  @REQ-015
  Scenario Outline: 不適格な状態では Panel を隠さない
    Given "<不適格条件>" 以外の eligible 条件を満たす Terminal がある
    And Panel は拡張以外の要因による元の表示と Reservation を持つ
    When reconcile を行う
    Then Panel の元の表示と Reservation は維持される

    Examples:
      | 不適格条件 |
      | mode がオフ |
      | 拡張が停止中 |
      | Terminal が非表示 |
      | Terminal が終了済み |
      | Terminal が現在のワークスペースに見えない |
      | Terminal 自身にフォーカスがない |
      | 横軸だけの最大化 |
      | 縦軸だけの最大化 |
      | 最大化なし |
      | フルスクリーン |
      | Overview |
      | Locked |

  @REQ-017
  Scenario: 別 Monitor の Panel は操作しない
    Given Terminal の Monitor と標準 Panel の Monitor は異なる
    When eligible な Terminal について reconcile を行う
    Then 別 Monitor の Panel の表示と Reservation は変更されない

  @REQ-018
  Scenario: 他の Reservation を維持する
    Given eligible な Terminal と同じ Monitor にドックまたは別拡張の Reservation がある
    When reconcile を行う
    Then ドックまたは別拡張の Reservation は維持される

  @REQ-019
  Scenario: 透過設定は端末に任せる
    Given 端末側の透過設定を読み取ってある
    When mode がオンで showOrRecall を行う
    Then 端末側の透過設定は変更されない

  @REQ-020 @REQ-021
  Scenario Outline: 復元は元の非表示と予約状態を尊重する
    Given Panel は元から非表示で Reservation は "<元の予約>" だった
    And Terminal が eligible である間の拡張の変更が適用されている
    When focusWindow で Other に移る
    Then Panel は非表示のままである
    And Reservation は "<元の予約>" に戻る

    Examples:
      | 元の予約 |
      | あり |
      | なし |

  @REQ-022
  Scenario Outline: アプリではなく窓自身のフォーカスを判定する
    Given Terminal は eligible で auto-hide-window はオフである
    When focusWindow で "<別窓>" に移る
    Then Panel と Reservation は拡張による変更前に戻る
    And Terminal の縦横最大化は維持される

    Examples:
      | 別窓 |
      | SameApp |
      | Dialog |
      | Clipboard |
      | Other |

  @REQ-023
  Scenario: Clipboard の例外は Panel に適用しない
    Given Terminal は eligible で auto-hide-window はオンである
    When focusWindow で Clipboard に移る
    Then Terminal は自動非表示にならない
    And Panel と Reservation は拡張による変更前に戻る

  @REQ-024
  Scenario Outline: focusWindow だけでは手動の窓状態を変えない
    Given Terminal を手動で "<窓状態>" に変更して別窓にフォーカスしている
    And auto-hide-window はオフである
    When focusWindow で Terminal に戻る
    Then Terminal の窓状態は "<窓状態>" のままである

    Examples:
      | 窓状態 |
      | 横軸だけの最大化 |
      | 縦軸だけの最大化 |
      | 最大化なし |
      | フルスクリーン |

  @REQ-020 @REQ-026 @REQ-027
  Scenario: stop は Panel を復元し端末を残す
    Given Terminal は表示中で窓状態と生存を読み取ってある
    And eligible により拡張が Panel を変更している
    When stop で拡張を停止する
    Then 自分の Panel と Reservation の変更は取り消される
    And Terminal は同じ形状で生存する

  @REQ-028 @REQ-029
  Scenario Outline: topology の後は現在の Monitor を使う
    Given eligible な Terminal がある
    When "<配置イベント>" の後の GNOME の現在配置で topology を反映する
    Then 現在の Terminal と Panel の Monitor に基づいて変更と復元が行われる
    And Terminal を以前の物理出力へ独自に移動しない

    Examples:
      | 配置イベント |
      | 別 Monitor への移動 |
      | 主 Monitor の変更 |
      | Monitor の切断 |
      | Monitor の再接続 |

  @REQ-030
  Scenario: ミラー表示は一つの Monitor として扱う
    Given 二つの物理出力が一つの論理 Monitor をミラー表示している
    When eligible な Terminal について reconcile を行う
    Then 論理 Monitor の Panel と Reservation だけが一組として扱われる

  @REQ-031 @REQ-032
  Scenario: 共通作業領域の変化と他の窓への直接操作を区別する
    Given Terminal と同じ Monitor に別の最大化窓がある
    When eligible な Terminal について reconcile を行う
    Then 拡張の窓への直接操作対象に別の窓は含まれない
    And GNOME が作業領域に合わせて別の窓を一時的に広げる結果は許容される
