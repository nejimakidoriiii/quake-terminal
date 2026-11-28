Feature: 最大化 Terminal と Panel の最初の描画
  最初の描画は requirements.md の Launch、Recall、FocusReturn ごとの定義を用いる。
  時間の長さではなく画面に現れた順序で判定する。

  @REQ-001 @REQ-002 @REQ-003 @REQ-004 @REQ-019
  Scenario Outline: 対象操作の最初の描画までに Panel を一度で消す
    Given Panel 自動非表示が有効で同じ Monitor の Panel が表示され自身の Reservation を持つ
    And <操作>の表示時に eligible の全条件を満たす Terminal がある
    When <操作>を行う
    Then 最初の描画までに Panel 全体が非表示になる
    And 時計や背景が移動するフレームも一部が残るフレームも徐々に薄くなるフレームも表示されない
    And Panel 自身の Reservation が解放される

    Examples:
      | 操作        |
      | Launch      |
      | Recall      |
      | FocusReturn |

  @REQ-005 @REQ-007 @REQ-008
  Scenario Outline: 登場スライドを最初から上端基準にする
    Given <操作>の表示時に eligible を満たし上端に他の Reservation がない
    When <操作>を行う
    Then Terminal の既存の登場スライドが最初の描画から画面上端を基準に再生される
    And 旧 Panel 分の帯が後から詰まるフレームは表示されない

    Examples:
      | 操作   |
      | Launch |
      | Recall |

  @REQ-003 @REQ-004 @REQ-006 @REQ-007 @REQ-009 @REQ-010
  Scenario Outline: 方法を問わず FocusReturn の最初の描画を完成した配置にする
    Given 表示中の縦横最大化した非フルスクリーンの Terminal はフォーカスを失っている
    And Panel 自動非表示が有効で同じ Monitor の Panel は表示されている
    And 上端に他の Reservation がなくフォーカス以外の eligible 条件を満たす
    When <方法>で Terminal 自身への FocusReturn が確定する
    Then 確定後の最初の描画では Panel 全体が途中の描画なく非表示になっている
    And 同じ描画で Terminal は画面上端に達している
    And Terminal の登場スライドは再生し直されない
    And 旧 Panel 分の帯が後から詰まるフレームは表示されない

    Examples:
      | 方法                                         |
      | Click                                        |
      | AltTab の選択確定                             |
      | 表示中の Terminal を手前に出す Shortcut       |
      | 上記以外の方法 Other                          |

  @REQ-011
  Scenario: Selecting は FocusReturn ではない
    Given 表示中の Terminal はフォーカスを失い Panel は表示されている
    When AltTab で Terminal を候補として Selecting にする
    Then 未確定の候補選択を理由に Panel は非表示にならない

  @REQ-012 @REQ-020 @REQ-021
  Scenario: Hide は既存の逆操作を維持する
    Given eligible を満たす Terminal が表示され拡張自身が Panel とその Reservation を取り除いている
    When 非表示分岐の Shortcut で Hide を行う
    Then Terminal は既存の非表示スライドで隠れる
    And 自分が隠した Panel は途中の動きなく瞬時に再表示される
    And FocusReturn として登場スライドを開始しない

  @REQ-013
  Scenario Outline: Pending では対象が確定するまで先に隠さない
    Given 新規 Terminal の起動待ちで<未確定対象>が未確定の Pending である
    And Panel は表示され Reservation を持つ
    When 起動待ちの画面を描画する
    Then Launch を理由に Panel の表示と Reservation は変更されない

    Examples:
      | 未確定対象           |
      | Terminal 自身        |
      | 表示先 Monitor       |
      | Terminal と Monitor  |

  @REQ-025
  Scenario Outline: 対象特定と表示要求だけでは Panel を消さない
    Given Launch または Recall の対象窓と Monitor は確定している
    And 表示を要求した後も<未成立条件>
    And Panel は表示され Reservation を持つ
    When 表示準備中の画面を描画する
    Then 表示要求を理由に Panel は先に消えない
    And Panel 自身の Reservation も解放されない

    Examples:
      | 未成立条件                                 |
      | 対象窓は隠れたままである                   |
      | 対象窓は表示されたが入力先は他の窓のままである |

  @REQ-014 @REQ-015 @REQ-016
  Scenario Outline: 失敗と中断では自分の変更だけを復元する
    Given 対象 Panel の元の可視性は<可視性>で自身の Reservation は<予約>である
    And 確定した対象の表示準備で拡張が自分の変更だけを加えている
    When 表示操作が<結果>になる
    Then Panel の可視性は<可視性>に戻る
    And Panel 自身の Reservation は<予約>に戻る
    And 自分が変更していない表示と予約は変更されない

    Examples:
      | 可視性 | 予約 | 結果 |
      | 表示   | 有   | 失敗 |
      | 表示   | 無   | 中断 |
      | 非表示 | 有   | 中断 |
      | 非表示 | 無   | 失敗 |

  @REQ-014 @REQ-015 @REQ-025
  Scenario Outline: eligible の条件喪失で自分の変更を復元する
    Given eligible を満たす Terminal のために拡張が Panel とその Reservation を取り除いている
    When <条件喪失>が起きる
    Then 拡張が行った Panel の表示と Reservation の変更だけが取り消される
    And 他の主体が隠している Panel は強制表示されない

    Examples:
      | 条件喪失                                     |
      | Terminal 自身からのフォーカス喪失             |
      | Terminal の非表示                            |
      | Terminal の終了                              |
      | 横方向の最大化解除                           |
      | 縦方向の最大化解除                           |
      | 両軸の最大化解除                             |
      | フルスクリーン化                             |
      | 非アクティブなワークスペースへの移動          |
      | Overview への移行                            |
      | ロック                                      |
      | パネル自動非表示設定の無効化                 |
      | 拡張の停止                                   |
      | 現在の Terminal と Panel の Monitor の不一致 |
      | 対象 Panel の消失                            |

  @REQ-014 @REQ-015 @REQ-025
  Scenario: GNOME Shell のフルスクリーン用非表示を復元で上書きしない
    Given 拡張自身が Panel の表示と Reservation を取り除いている
    And 同じ Monitor のフルスクリーン窓に対して GNOME Shell が Panel を隠している
    When 対象 Terminal が eligible の条件を失う
    Then 自分が変更した Reservation は復元される
    And GNOME Shell が必要とする非表示を強制表示で上書きしない

  @REQ-017 @REQ-025
  Scenario: 別 Monitor の Panel を対象にしない
    Given 縦横最大化した非フルスクリーンの Terminal が Monitor 1 にある
    And 操作できる標準 Panel は別の Monitor 0 にだけ存在する
    When Terminal への FocusReturn が確定する
    Then Monitor 0 の Panel の表示と Reservation は変更されない

  @REQ-017
  Scenario: 対象 Monitor の変更では旧 Panel の自分の変更を残さない
    Given 拡張が Monitor 0 の Panel の表示と Reservation を変更している
    When GNOME が Terminal と対象 Panel の現在の配置を変更する
    Then 旧 Panel に加えた自分の変更は取り消される
    And 以後の操作対象は現在の Terminal と同じ Monitor の Panel だけになる

  @REQ-018 @REQ-019
  Scenario: 他の Reservation がある場合はそれを残す
    Given 対象 Monitor の上端に Panel 自身と別所有者の Reservation がある
    And 表示時に eligible を満たす Terminal がある
    When Recall を行う
    Then Panel 自身の Reservation だけが解放される
    And 別所有者の Reservation は維持される
    And 画面上端への到達は合格条件にしない

  @REQ-022
  Scenario Outline: 最大化をフルスクリーンで代用しない
    Given <操作>の対象条件を満たす Terminal がある
    When <操作>を行う
    Then Terminal は通常の縦横最大化のままでフルスクリーンにはならない

    Examples:
      | 操作        |
      | Launch      |
      | Recall      |
      | FocusReturn |

  @REQ-023 @REQ-024
  Scenario: 設定の変更で Panel の見え方を代用しない
    Given Terminal の透過設定とアニメーション設定は開始 HEAD での値である
    When Issue 3 の変更を適用した状態で対象操作を行う
    Then 透過設定とアニメーション設定の値は変更されない
    And 同じ設定値で Panel の受入条件を満たす
