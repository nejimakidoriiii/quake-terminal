Feature: 後続実装の検証と仕様の根拠
  この Feature は後続実装の検査と報告の要件である。
  ステップ定義の実装や対象環境の画面観察を実施済みとはしない。

  @REQ-033
  Scenario: 対応バージョンを維持する
    Given 後続実装の配布メタデータがある
    When shell-version を読み取る
    Then GNOME Shell 45〜51 の既存の対応宣言が維持されている

  @REQ-034
  Scenario: 新しく利用する機能を照合する
    Given 後続実装で新しく利用する機能の一覧がある
    When 各機能を GNOME Shell 45〜51 の対応する資料と照合する
    Then 対象バージョンとの適合を判断できる根拠がある

  @REQ-035 @REQ-036 @REQ-037
  Scenario Outline: 既存の機械的検証を通す
    Given 後続実装がある
    When "<コマンド>" を実行する
    Then "<検査>" は終了コード 0 で成功する

    Examples:
      | コマンド | 検査 |
      | npx eslint . | lint |
      | make compile | スキーマのコンパイル |
      | make pack | パッケージ作成 |

  @REQ-038
  Scenario: 配布 ZIP の内容を確認する
    Given 後続実装の配布 ZIP がある
    When ZIP のエントリーと実装の実行時参照先を照合する
    Then 設定・スキーマと本体が参照する必要なファイルが ZIP に含まれている

  @REQ-039
  Scenario: 本体が使う判断をテストする
    Given 後続実装のパネル表示の判断がある
    When Node.js 標準の node:test と本体からの利用箇所を検査する
    Then 小さなテストが成功し本体が実際に使う判断を検査している

  @REQ-040 @REQ-041 @REQ-042 @REQ-043
  Scenario Outline: テストは条件の取り違えを検出する
    Given 本体が利用するパネル判断の node:test が成功する
    When "<条件>" を取り違えた判断に対する検出力を検査する
    Then 取り違えを含む判断でテストが失敗することを確認できる

    Examples:
      | 条件 |
      | Terminal 自身と SameApp・Dialog・Clipboard・Other のフォーカス |
      | 縦横最大化と片軸・最大化なし・フルスクリーン |
      | Terminal と Panel の同一または別 Monitor |
      | eligible 喪失時の元の表示・Reservation への復元 |

  @REQ-044 @REQ-045 @REQ-046
  Scenario: 新しい検証基盤や依存を追加しない
    Given 後続実装の差分と依存宣言がある
    When 追加されたファイルと依存の利用箇所を検査する
    Then 新しい依存も CI も GUI テスト基盤も追加されていない

  @REQ-047
  Scenario: 対象環境で透過と上端を人が観察する
    Given Debian 13・GNOME Shell/Mutter 48 系・Wayland・foot 1.21.0 を利用する
    And foot の透過設定と mode がオンで他の Reservation はない
    When 人がショートカットで foot を呼び出す
    Then 人が非フルスクリーンの縦横最大化のまま背景が透けることを観察する
    And 人が foot が対象 Monitor 全体を覆い画面上端へ達することを観察する

  @REQ-048
  Scenario: 対象環境でフォーカス移動後の復元を人が観察する
    Given 対象環境で mode がオンの foot は縦横最大化され Panel を隠している
    When 人が別アプリへフォーカスを移す
    Then 人が foot の縦横最大化が維持されたまま Panel と Reservation が元に戻ることを観察する

  @REQ-049 @REQ-050 @REQ-051
  Scenario: 観察の未実施と機械的な合否を分ける
    Given 機械的検証は成功し対象環境の画面観察は未実施である
    When 検証結果を報告する
    Then 画面観察は機械的検証と区別して「未確認」と記載する
    And 未実施だけを TAKT 実装の不合格理由にしない
    And 他の環境での背景透過を保証しない

  @REQ-052 @REQ-053 @REQ-054
  Scenario: 参考実装を前提にせず根拠を渡す
    Given 生成した仕様と後続実装の成果物がある
    When trace.md の根拠と成果物の参照先を読む
    Then hidetopbar の固定出典・観察・条件と復元方針の違いが trace.md だけで理解できる
    And hidetopbar のソースは複製も同梱もされていない
    And 外部ディレクトリは実装の前提となっていない
