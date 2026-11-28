Feature: 後続実装の検証と報告
  この Feature は仕様の生成成功と実装の検証成功を区別する。

  @REQ-026 @REQ-027
  Scenario Outline: 既存 node:test で最初の描画に必要な順序を検査する
    Given Issue 3 の後続実装が検査対象である
    When 既存の node:test で<操作>のテストを実行する
    Then 対象確定前には Panel を隠さないことを検査できる
    And 表示要求だけ、実際の表示と mapped だけ、または実際のフォーカスだけでは Panel と Reservation を新しく変更しないことを検査できる
    And 対象 Panel の非表示と予約解放と作業領域の反映が最初の描画に先行することを検査できる

    Examples:
      | 操作   |
      | Launch |
      | Recall |

  @REQ-028
  Scenario: 既存 node:test で中断と復元を検査する
    Given 後続実装には表示準備中の中断を発生させるテストがある
    When 既存の node:test でそのテストを実行する
    Then 可視性と Reservation の自分の変更だけの復元を検査できる
    And 元から非表示の Panel と他所有者の Reservation を変更しないことを検査できる

  @REQ-029 @REQ-030
  Scenario Outline: 既存 node:test で FocusReturn を検査する
    Given 表示中の最大化 Terminal がフォーカスを失った後続実装のテストがある
    When 既存の node:test で<方法>の FocusReturn のテストを実行する
    Then フォーカス確定後最初の描画に必要な Panel 非表示と予約解放と配置反映の順序を検査できる
    And 登場スライドを再生し直さないことを検査できる

    Examples:
      | 方法                               |
      | 通常のフォーカス復帰               |
      | 表示中の Terminal を出す Shortcut  |

  @REQ-031 @REQ-032 @REQ-033
  Scenario Outline: 検証のために新しい基盤を追加しない
    Given 後続実装の開始 HEAD と変更後のリポジトリがある
    When <対象>の差分を確認する
    Then Issue 3 の後続実装による追加はない

    Examples:
      | 対象                 |
      | 依存パッケージ       |
      | CI                   |
      | GUI テスト基盤       |

  @REQ-034 @REQ-035
  Scenario Outline: 対象環境の実画面で表示を観察する
    Given Debian 13 と GNOME Shell/Mutter 48 系と Wayland の実画面が利用できる
    And <操作>の対象条件を満たし上端に他の Reservation がない
    When 実画面で<操作>を行う
    Then Panel に途中の描画がないことを観察する
    And Terminal の既存スライドが最初の描画から上端基準であることを観察する
    And 旧 Panel 分の帯が後から詰まる描画がないことを観察する

    Examples:
      | 操作   |
      | Launch |
      | Recall |

  @REQ-036
  Scenario: 実画面で代表的な FocusReturn を観察する
    Given 同じ対象環境にフォーカスを失った表示中の最大化 Terminal がある
    And 上端に他の Reservation がなくフォーカス以外の eligible 条件を満たす
    When 少なくとも一つの代表的な方法で FocusReturn を確定する
    Then 最初の描画で Panel が途中の描画なく消えて Terminal が画面上端に達することを観察する
    And 登場スライドを再生し直さないことを観察する

  @REQ-037 @REQ-038
  Scenario: 実画面の未観察を機械的合格と区別する
    Given 後続実装の機械的な検証は合格し実画面は利用できていない
    When 後続実装の検証結果を報告する
    Then 「実画面は未確認」と明記する
    And 機械的な検証の合格を実画面の確認済みとは記さない
    And 未観察だけを TAKT 実装タスクの不合格理由にしない

  @REQ-039
  Scenario: 実際に観察した受入条件違反は不合格とする
    Given 後続実装の機械的な検証は合格している
    And 対象環境の実画面では受入条件に反する描画が観察されている
    When 後続実装の合否を報告する
    Then 機械的合格を根拠に実装を合格とはせず受入条件違反により不合格とする
