# Issue #3 の要求対応と検証

## 仕様への入口

- [確定要求・出典・利用者の追加決定](requirements.md)
- [分類表と各形式の要否の根拠](classification.yaml)
- [描画と復元の Gherkin](gherkin/panel.feature)。表では `P` と記す。
- [後続実装の検証・報告の Gherkin](gherkin/delivery.feature)。表では `D` と記す。
- [描画境界と復元の Quint](quint/panel_frame.qnt)。表では `Q` と記す。
- [現在の操作対象の配置・所有の Alloy](alloy/footprint.als)。表では `A` と記す。

Issue URL は https://github.com/nejimakidoriiii/quake-terminal/issues/3、updatedAt は `2026-11-27T11:27:12Z`。
利用者が承認した改訂版の共有理解に従い、Issue 原文の再表示に、新規起動と方法を問わないフォーカス復帰を加えた。
最初の描画、上端への反映、途中の描画の禁止、既存スライドの維持を別の要求として追跡する。
原因と実装方式は未指定のままであり、現行コードの観察を追加要求にはしていない。

## Trace matrix

`—` は非適用を示す。各 false の理由の正本は分類表である。
Gherkin のセルは、その REQ-ID タグを持つ Scenario または Scenario Outline の名前である。
「6項目一致」は語彙・終端性・ガード・多重度・対称性・適合性の照合結果であり、実装の合格を意味しない。
画素の見え方と工程の要求では、単一形式の分類根拠だけを確認した。

| REQ-ID | Gherkin | Quint | Alloy | 判定と整合根拠 |
|---|---|---|---|---|
| REQ-001 | P: 対象操作の最初の描画までに Panel を一度で消す | resolveLaunch、observeWindow、observeFocus、suppressPanel、drawFirst、frameSafe | — | 6項目一致。実際の表示・mapped・フォーカス成立後、Launch の最初の可視フレームまでに反映 |
| REQ-002 | P: 対象操作の最初の描画までに Panel を一度で消す | recall、observeWindow、observeFocus、suppressPanel、drawFirst、frameSafe | — | 6項目一致。隠れた既存窓への表示要求を実表示の成立とみなさない |
| REQ-003 | P: 対象操作の最初の描画までに Panel を一度で消す / 方法を問わず FocusReturn の最初の描画を完成した配置にする | focusReturn、suppressPanel、drawFirst、frameSafe | — | 6項目一致。確定したフォーカスとその後の描画を区別 |
| REQ-004 | P: 対象操作の最初の描画までに Panel を一度で消す / 方法を問わず FocusReturn の最初の描画を完成した配置にする | — | — | 単一形式の根拠妥当。時計・背景・部分・フェードは実画面の受入条件 |
| REQ-005 | P: 登場スライドを最初から上端基準にする | settleArea、drawFirst、frameSafe | — | 6項目一致。他の上端予約がない場合だけ画面上端を要求 |
| REQ-006 | P: 方法を問わず FocusReturn の最初の描画を完成した配置にする | settleArea、drawFirst、frameSafe | — | 6項目一致。表示中の窓も最初の描画までに配置を反映 |
| REQ-007 | P: 登場スライドを最初から上端基準にする / 方法を問わず FocusReturn の最初の描画を完成した配置にする | settleArea、drawFirst、frameSafe | — | 6項目一致。予約フラグの解除だけで完成とはしない |
| REQ-008 | P: 登場スライドを最初から上端基準にする | drawFirst、slidePolicy | — | 6項目一致。Launch/Recall では登場を開始。曲線・時間の同一性は Gherkin で比較 |
| REQ-009 | P: 方法を問わず FocusReturn の最初の描画を完成した配置にする | focusReturn、drawFirst、slidePolicy | — | 6項目一致。FocusReturn は登場開始と区別 |
| REQ-010 | P: 方法を問わず FocusReturn の最初の描画を完成した配置にする | methods、focusReturn、slidePolicy | — | 6項目一致。Click・AltTab・Shortcut・Other は同じガード |
| REQ-011 | P: Selecting は FocusReturn ではない | selecting、selectionSafe | — | 6項目一致。候補選択から確定への独自の先行処理を要求しない |
| REQ-012 | P: Hide は既存の逆操作を維持する | hide、slidePolicy | — | 6項目一致。Hide は復帰ではなく非表示分岐 |
| REQ-013 | P: Pending では対象が確定するまで先に隠さない | requestLaunch、resolveLaunch、pendingSafe、noEarlySuppression | — | 6項目一致。窓と Monitor の両方の確定が必要。確定だけでも非表示の十分条件にはしない |
| REQ-014 | P: 失敗と中断では自分の変更だけを復元する / eligible の条件喪失で自分の変更を復元する / GNOME Shell のフルスクリーン用非表示を復元で上書きしない | restore、abort、observeWindow、lose、restored | — | 6項目一致。元の可視性を復元。保持中の Shell 側の変更との競合は Gherkin で補う |
| REQ-015 | P: 失敗と中断では自分の変更だけを復元する / eligible の条件喪失で自分の変更を復元する / GNOME Shell のフルスクリーン用非表示を復元で上書きしない | restore、abort、observeWindow、lose、restored | — | 6項目一致。予約を可視性と独立に復元 |
| REQ-016 | P: 失敗と中断では自分の変更だけを復元する | restore、restored | — | 6項目一致。元から非表示・元から未予約の組合せを保持 |
| REQ-017 | P: 別 Monitor の Panel を対象にしない / 対象 Monitor の変更では旧 Panel の自分の変更を残さない | affected、scopeSafe、topology、topologySafe | LocalPanel、NoForeignReservation、LocalAndForeign、NoLocalPanel | 6項目一致。現在の非干渉と旧対象への自分の変更の復元は別の側面 |
| REQ-018 | P: 他の Reservation がある場合はそれを残す | suppressPanel、scopeSafe | OwnedReservation、NoForeignReservation、LocalAndForeign | 6項目一致。Panel 自身と他の所有者を混同しない |
| REQ-019 | P: 対象操作の最初の描画までに Panel を一度で消す / 他の Reservation がある場合はそれを残す | suppressPanel、frameSafe | — | 6項目一致。可視性と予約をそれぞれ解除 |
| REQ-020 | P: Hide は既存の逆操作を維持する | hide、slidePolicy | — | 6項目一致。非表示スライドの開始を維持。描画曲線は Gherkin で比較 |
| REQ-021 | P: Hide は既存の逆操作を維持する | hide、restored | — | 6項目一致。自分が隠した可視性だけを復元。途中の動きの有無は Gherkin で確認 |
| REQ-022 | P: 最大化をフルスクリーンで代用しない | resolveLaunch、windowPreserved | — | 6項目一致。対象は元から両軸最大化・非フルスクリーンの表示操作 |
| REQ-023 | P: 設定の変更で Panel の見え方を代用しない | — | — | 単一形式の根拠妥当。端末アプリの設定と比較 |
| REQ-024 | P: 設定の変更で Panel の見え方を代用しない | — | — | 単一形式の根拠妥当。既存のアニメーション設定と比較 |
| REQ-025 | P: 対象特定と表示要求だけでは Panel を消さない / eligible の条件喪失で自分の変更を復元する / GNOME Shell のフルスクリーン用非表示を復元で上書きしない / 別 Monitor の Panel を対象にしない | eligible、observeWindow、observeFocus、lose、eligibilitySafe、noEarlySuppression、requestPreserved、restored、topologySafe | — | 6項目一致。全条件を実状態で判定し、表示要求や対象確定で代用しない |
| REQ-026 | D: 既存 node:test で最初の描画に必要な順序を検査する | — | — | 単一形式の根拠妥当。Launch の後続実装テスト |
| REQ-027 | D: 既存 node:test で最初の描画に必要な順序を検査する | — | — | 単一形式の根拠妥当。Recall の後続実装テスト |
| REQ-028 | D: 既存 node:test で中断と復元を検査する | — | — | 単一形式の根拠妥当。実装における中断の検査 |
| REQ-029 | D: 既存 node:test で FocusReturn を検査する | — | — | 単一形式の根拠妥当。通常の復帰の検査 |
| REQ-030 | D: 既存 node:test で FocusReturn を検査する | — | — | 単一形式の根拠妥当。Shortcut による復帰の検査 |
| REQ-031 | D: 検証のために新しい基盤を追加しない | — | — | 単一形式の根拠妥当。依存パッケージの差分 |
| REQ-032 | D: 検証のために新しい基盤を追加しない | — | — | 単一形式の根拠妥当。CI の差分 |
| REQ-033 | D: 検証のために新しい基盤を追加しない | — | — | 単一形式の根拠妥当。GUI テスト基盤の差分 |
| REQ-034 | D: 対象環境の実画面で表示を観察する | — | — | 単一形式の根拠妥当。指定環境での Launch 観察 |
| REQ-035 | D: 対象環境の実画面で表示を観察する | — | — | 単一形式の根拠妥当。指定環境での Recall 観察 |
| REQ-036 | D: 実画面で代表的な FocusReturn を観察する | — | — | 単一形式の根拠妥当。全方法の要求と代表操作の実観察を区別 |
| REQ-037 | D: 実画面の未観察を機械的合格と区別する | — | — | 単一形式の根拠妥当。完了報告の内容 |
| REQ-038 | D: 実画面の未観察を機械的合格と区別する | — | — | 単一形式の根拠妥当。未観察だけで不合格にはしない |
| REQ-039 | D: 実際に観察した受入条件違反は不合格とする | — | — | 単一形式の根拠妥当。実際の違反を機械的合格で無視しない |

## 形式間の整合性

1. 語彙。Terminal、Panel、Monitor、Reservation、Launch、Recall、FocusReturn、Selecting、Hide を要求一覧の意味で使う。Quint の `requestLaunch` と `resolveLaunch` は Launch の未確定・確定を分けた action である。`observeWindow` は実際の shown と mapped、`observeFocus` は Launch/Recall の実フォーカスの観測入力である。これらは `drawFirst` が表す画面上の「最初の描画」と区別する。
2. 終端性。Pending、非表示、失敗、中断を永久的な終端にはしていない。`abort` と `hide` は Idle に戻り、対象窓の状態に応じて次の操作を開始できる。停止・終了からの実装全体の再起動は検証の対象外であり、その禁止を要求していない。
3. ガード。Gherkin の成功例と Quint の Panel 変更は、その時点の実際の shown・mapped・Terminal 自身へのフォーカスを含む全 eligible 条件を満たす。Launch/Recall の要求や対象確定は、実表示・フォーカス・Panel を変更しない。未表示・unmapped・未フォーカスのいずれかが残る間は、表示準備中でも先行非表示を許さない。各条件が成立する順序は固定しない。FocusReturn は操作要求ではなく表示中の窓自身への実際の復帰の確定であり、Selecting と Hide には該当しない。復帰方法はガードにしない。
4. 多重度。Quint は Panel と他所有者の Reservation を ID ごとに保持する。元の可視性と予約は独立に選ぶ。Alloy は現在の操作対象を一つの Terminal に対応させ、Panel と Reservation の個数を要求上の固定値にはしない。
5. 対称性。予約解放だけで上端への配置が反映されたとはしない。`settleArea` と `drawFirst` を分け、Gherkin の「帯が後から詰まらない」を描画前の反映として表す。Alloy は復元の時間順序を前提に現在の操作範囲まで証明したとは扱わず、現在の配置・所有だけを制約する。旧対象への復元は Quint と Gherkin が担う。
6. 適合性。`frameSafe`、`eligibilitySafe`、`noEarlySuppression`、`topologySafe` は実行側の `eligible` と `affected` を呼ばず実状態の条件を照合する。`requestPreserved` は要求と実状態の混同を独立に検査する。Alloy の assert は二つの fact の組合せの帰結であり、宣言多重度の再検査ではない。以下の境界状態の到達性、三経路の成功到達性、制約除去時の反例により、対象の描画を一度も許さないためだけに成功している検査ではないことを確認した。

## 形式仕様の検証

通常の検証の作業ディレクトリは `/home/masano/.ghq/github-private.com/nejimakidoriiii/quake-terminal`。
`skill_dir` は SkillPort が返した `/home/masano/.ghq/neptune/srv/git/make-world/dotfiles/dot.skillport/skills/requirements-to-specs`。
検証ラッパーは入力を読み取り専用にし、内部出力を使い捨てコンテナに置く。実装や配布物の依存追加ではない。

検証した Quint の SHA-256 は `598db211ac08119ec81422bc1c2303323cdcdc5f4dfd3819cbbafbc47548daae`。
Alloy の SHA-256 は `47e5c0cf0bb981ac512b4f1eab5f6729beff7675b31d3af6370a23f6879b5547`。
Alloy は同じハッシュのため、前回の commands/exec と二つの制約除去検査の結果を再利用する。
Quint と要求・Gherkin の整合性は現行版で再検証する。

| コマンド | 期待値 | 結果の証拠 | 終了コード |
|---|---|---|---|
| `bash "$skill_dir/scripts/verify.sh" quint typecheck specs/3/quint/panel_frame.qnt` | 型・効果の整合 | 診断なし、`TYPECHECK_EXIT_CODE=0` | 0 |
| `bash "$skill_dir/scripts/verify.sh" quint run specs/3/quint/panel_frame.qnt --invariant=safety --max-steps=40 --max-samples=2000 --seed=3 --verbosity=1` | safety 違反なし | `[ok] No violation found (3115ms at 642 traces/second)` | 0 |
| `bash "$skill_dir/scripts/verify.sh" quint verify specs/3/quint/panel_frame.qnt --invariant=safety --max-steps=9 --verbosity=1` | 深さ9以内の反例なし | `[ok] No violation found (64538ms)` | 0 |
| `bash "$skill_dir/scripts/verify.sh" quint verify specs/3/quint/panel_frame.qnt --invariant=noEarlySuppression --max-steps=9 --verbosity=2` | 実際の表示・mapped・フォーカスが揃う前の変更なし | `[ok] No violation found (33487ms)` | 0 |
| `bash "$skill_dir/scripts/verify.sh" alloy commands specs/3/alloy/footprint.als` | 全コマンド列挙 | check 1件、run 2件を列挙 | 0 |
| `bash "$skill_dir/scripts/verify.sh" alloy exec specs/3/alloy/footprint.als -c '*'` | 全3件が下表と一致 | stdout の JSON `commands` を全件照合 | 0 |

Quint の `safety` は pendingSafe、scopeSafe、restored、frameSafe、slidePolicy、selectionSafe、windowPreserved、eligibilitySafe、topologySafe、noEarlySuppression、requestPreserved の連言である。
run は2,000試行、各最大40遷移であり網羅検証ではない。
verify は初期状態から9遷移までの有界検証である。
Launch の requestLaunch → resolveLaunch → observeWindow/observeFocus → suppressPanel → settleArea → drawFirst と、表示準備中の中断を含められる深さである。
observeWindow と observeFocus の順序は固定せず、shown と mapped も独立に入力できる。
`drawFirst` は既に成立している論理表示と mapped を要求し、それらやフォーカスを代入しない。
無限長の実行の安全性、完了までの時間、実装とモデルの同値性は証明していない。
現行 Quint の標準出力と標準エラーは、リポジトリ外の `/tmp/opencode/issue-3-revision.8Kfleg/logs/` の typecheck.log、run.log、verify.log、noEarlySuppression.log に保存した。

| Alloy コマンド | 期待値 | 実結果 |
|---|---|---|
| NoForeignReservation | UNSAT | `solution` なし。スコープ内の反例なし |
| LocalAndForeign | SAT | `solution` あり。対象 Panel、別 Monitor の Panel、他所有者の予約が共存 |
| NoLocalPanel | SAT | `solution` あり。同じ Monitor に Panel がない構造を許容 |

Alloy は全て `for 5` の範囲である。各 sig の上限は実装上の対応数の制約ではない。
スコープ外の構造まで証明していない。

### Alloy の制約を外した検査

同じハッシュに対して実施済みの次の結果を再利用する。
作業ディレクトリはリポジトリ外の `/tmp/opencode/issue-3-verification.GvHNwi`。

| 検査対象と一時変更 | コマンド | 期待値と結果 | ツール終了コード |
|---|---|---|---|
| OwnedReservation の制約だけを除去 | `bash "$skill_dir/scripts/verify.sh" alloy exec alloy-no-owner/footprint.als -c NoForeignReservation` | SAT。JSON の当該 check に `solution` があり所有範囲の反例を検出 | 0 |
| LocalPanel の制約だけを除去 | `bash "$skill_dir/scripts/verify.sh" alloy exec alloy-no-local/footprint.als -c NoForeignReservation` | SAT。JSON の当該 check に `solution` があり別 Monitor の所有者の反例を検出 | 0 |

### Quint の制約を外した検査

以下の作業ディレクトリは `/tmp/opencode/issue-3-revision.8Kfleg`。
現行 Quint の検証用コピーだけを変更し、仕様には一時変更を入れていない。
各ログは同じ作業ディレクトリの `logs/` に置き、表の検査名をファイル名として `.log` を付ける。
反例ありの終了コード1が期待値であり、元の仕様の不合格を意味しない。

| 検査名と一時変更 | コマンド | 期待値と結果 | ツール終了コード |
|---|---|---|---|
| mutation-intent。eligible の実際の shown・mapped の要求を Launch/Recall の意図で代用可能にする | `bash "$skill_dir/scripts/verify.sh" quint verify mutation-intent/panel_frame.qnt --invariant=safety --max-steps=6 --verbosity=2` | 反例あり。`Found an issue (24448ms)`。表示意図による先行非表示を検出 | 1 |
| mutation-focus。eligible の実フォーカス条件だけを除去 | `bash "$skill_dir/scripts/verify.sh" quint verify mutation-focus/panel_frame.qnt --invariant=safety --max-steps=5 --verbosity=2` | 反例あり。`Found an issue (20628ms)`。表示だけでの非表示を検出 | 1 |
| mutation-mapped。eligible の mapped 条件だけを除去 | `bash "$skill_dir/scripts/verify.sh" quint verify mutation-mapped/panel_frame.qnt --invariant=safety --max-steps=6 --verbosity=2` | 反例あり。`Found an issue (23498ms)`。shown でも unmapped の非表示を検出 | 1 |
| mutation-frame。drawFirst の `s.areaReady` ガードだけを true に置換 | `bash "$skill_dir/scripts/verify.sh" quint verify mutation-frame/panel_frame.qnt --invariant=safety --max-steps=7 --verbosity=2` | 反例あり。`Found an issue (21895ms)`。作業領域反映前の描画を検出 | 1 |

### Quint の境界状態と成功状態への到達性

作業ディレクトリとログの命名は直前の節と同じ。
`reachability/panel_frame.qnt` は現行モデルに検証用述語だけを加えたコピーであり、action やガードは変えていない。
各 `no…` は、到達させたい状態を禁止する述語である。
全件で反例と状態列を得ることを期待する。正常な状態への到達を証明するための検査であり、製品の違反を意味しない。

| 検査名と到達させる状態 | コマンド | 期待値と結果 | ツール終了コード |
|---|---|---|---|
| noLaunchFrame。Launch の成功描画 | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noLaunchFrame --max-steps=7 --verbosity=2` | 反例と状態列あり。`Found an issue (19325ms)` | 1 |
| noRecallFrame。Recall の成功描画 | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noRecallFrame --max-steps=6 --verbosity=2` | 反例と状態列あり。`Found an issue (18246ms)` | 1 |
| noFocusFrame。FocusReturn の成功描画 | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noFocusFrame --max-steps=4 --verbosity=2` | 反例と状態列あり。`Found an issue (16503ms)` | 1 |
| noRestoredCancel。Panel 変更後の中断と復元 | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noRestoredCancel --max-steps=6 --verbosity=2` | 反例と状態列あり。`Found an issue (21165ms)` | 1 |
| noPendingBoundary。表示意図だけで対象未確定 | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noPendingBoundary --max-steps=1 --verbosity=2` | 未変更の状態に到達。`Found an issue (12701ms)` | 1 |
| noTargetOnly。対象確定だけで未表示・未フォーカス | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noTargetOnly --max-steps=3 --verbosity=2` | SuppressPanel 後も未変更。`Found an issue (14343ms)` | 1 |
| noShownOnly。shown・mapped だが未フォーカス | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noShownOnly --max-steps=4 --verbosity=2` | SuppressPanel 後も未変更。`Found an issue (15143ms)` | 1 |
| noFocusOnly。実フォーカスだけで未表示・unmapped | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noFocusOnly --max-steps=4 --verbosity=2` | SuppressPanel 後も未変更。`Found an issue (15161ms)` | 1 |
| noUnmapped。shown・フォーカス済みだが unmapped | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noUnmapped --max-steps=5 --verbosity=2` | SuppressPanel 後も未変更。`Found an issue (21130ms)` | 1 |
| noNotShown。mapped・フォーカス済みだが未表示 | `bash "$skill_dir/scripts/verify.sh" quint verify reachability/panel_frame.qnt --invariant=noNotShown --max-steps=5 --verbosity=2` | SuppressPanel 後も未変更。`Found an issue (16185ms)` | 1 |

境界検査では、同じ Monitor の Panel が元は可視で予約も持つ構造を要求する。
その上で `panelVisible == baselineVisible` かつ `panelReserved == baselineReserved` の状態を探すため、元から非表示・未予約であるだけの例では成功しない。
Pending 以外の境界では `event == "SuppressPanel"` を要求し、条件不足で変更 action を一度も実行できないためだけの成功とも区別する。

三つの成功検査は、`event == "DrawFirst"`、操作名、shown、mapped、実フォーカス、areaReady、atTop を要求する。
他の上端予約がなく、元は可視・予約ありだった同じ Monitor の Panel が非表示・未予約になっている例に限定する。
Panel を初めて変更するのは実条件の成立後かつ初描画前であり、drawFirst 自体は表示・フォーカス・Panel を変更しない。
中断検査は、直前に可視性が基準状態から変わっており、中断後には可視性と予約がそれぞれ基準状態へ戻る例である。

実際に得た三つの成功状態列は次のとおりである。どの列も SuppressPanel の時点で shown と mapped は true、実フォーカスは Terminal、phase は Preparing であり、DrawFirst では areaReady と atTop が true である。

- Launch: Init → RequestLaunch → ResolveLaunch → ObserveFocus → ObserveWindow → SuppressPanel → SettleArea → DrawFirst。
- Recall: Init → Recall → ObserveFocus → ObserveWindow → SuppressPanel → SettleArea → DrawFirst。
- FocusReturn: Init → FocusReturn → SuppressPanel → SettleArea → DrawFirst。

これらは存在する一例であり、ObserveFocus と ObserveWindow の実装上の順序を固定するものではない。

### Gherkin と要求対応

Gherkin は英語キーワード、REQ-ID タグ、一つの When、観察可能な Then、否定ケース、Outline と Examples の対応を確認した。
ステップ定義は追加しておらず、Gherkin を実行済みとはしない。
軽量な構造検査は完全な Gherkin パーサーの代わりではない。

次の検査をリポジトリのルートで実行する。
要求39件、分類表の全セル、各形式の REQ-ID 集合、trace matrix のセル、全仕様への相対リンクを確認する。
false セルの根拠コメント、シナリオの意味、上記6項目は別に照合する。

```sh
python3 - <<'PY'
from pathlib import Path
import re
import yaml

p = Path("specs/3")
c = yaml.safe_load((p / "classification.yaml").read_text())
ids = set(re.findall(r"^\| (REQ-\d+) \|", (p / "requirements.md").read_text(), re.M))
assert ids == set(c) == {f"REQ-{i:03}" for i in range(1, 40)}
forms = ("gherkin", "quint", "alloy")
assert all(all(type(v[f]) is bool for f in forms) for v in c.values())
assert all(any(v[f] for f in forms) for v in c.values())
for form, pattern in zip(forms, ("*.feature", "*.qnt", "*.als")):
    text = "\n".join(f.read_text() for f in (p / form).glob(pattern))
    assert set(re.findall(r"REQ-\d+", text)) == {k for k, v in c.items() if v[form]}
    print(form, sum(v[form] for v in c.values()))
trace = (p / "trace.md").read_text()
rows = re.findall(r"^\| (REQ-\d+) \| (.*?) \| (.*?) \| (.*?) \|", trace, re.M)
assert {r[0] for r in rows} == ids and len(rows) == len(ids)
for req, *cells in rows:
    for form, cell in zip(forms, cells):
        assert (cell != "—") == c[req][form], (req, form)
for target in re.findall(r"\]\(([^)]+)\)", trace):
    if "://" not in target:
        assert (p / target.split("#")[0]).is_file(), target
for line in (p / "classification.yaml").read_text().splitlines():
    if re.match(r"  (gherkin|quint|alloy): false", line):
        assert re.search(r"#\s*\S", line), line
for f in (p / "gherkin").glob("*.feature"):
    lines = [line.strip() for line in f.read_text().splitlines()]
    assert sum(line.startswith("Feature:") for line in lines) == 1
    assert not any(line.startswith("# language:") for line in lines)
    starts = [i for i, line in enumerate(lines) if re.match(r"Scenario(?: Outline)?:", line)]
    for begin, end in zip(starts, starts[1:] + [len(lines)]):
        block = lines[begin:end]
        prior = next(line for line in reversed(lines[:begin]) if line)
        assert prior.startswith("@REQ-") and set(re.findall(r"REQ-\d+", prior)) <= ids
        assert sum(line.startswith("When ") for line in block) == 1
        assert any(line.startswith("Given ") for line in block)
        assert any(line.startswith("Then ") for line in block)
        if block[0].startswith("Scenario Outline:"):
            examples = block.index("Examples:")
            table = [line for line in block[examples + 1:] if line.startswith("|")]
            assert len(table) >= 2
            cells = lambda line: [cell.strip() for cell in line.strip("|").split("|")]
            header = cells(table[0])
            variables = set(re.findall(r"<([^>]+)>", "\n".join(block[:examples])))
            assert variables == set(header), (f, block[0])
            assert all(len(cells(row)) == len(header) for row in table[1:])
print("PASS")
PY
```

結果は `gherkin 39`、`quint 22`、`alloy 2`、`PASS`、終了コード0。
同じ検査で Gherkin の構造と Examples、および false セルの理由コメントも確認した。

## 形式化上の選択

以下は入力から追加された製品の設計判断ではなく、形式化の分類・語彙・簡略化の選択である。

- 形式の選択の正本は分類表である。画素の途中状態と検証工程は Gherkin、変化する表示準備と復元は Quint、現在の操作範囲の配置・所有は Alloy とした。
- Quint は対象 Terminal 一つ、二つの論理 Monitor、二つの Panel ID、別所有者の二つの Reservation ID を使う。これらの数は同じ対象と別の対象を区別するためであり、実装上の対応数を制限しない。
- Launch の対象窓と Monitor の未確定を Pending 一つにまとめた。どちらか一方だけ未確定でも先行非表示を許さない意味は同じであり、Gherkin には三つの未確定ケースを残した。
- shown、mapped、実際のフォーカス、画面への最初の描画を別の状態として表す。表示要求はそのいずれの代用にもしない。観測入力の action は特定の API や通知の順序を指定せず、実表示とフォーカスの成立を別々に観測できるようにしたものである。
- `areaReady` は予約解放が配置に反映された状態、`atTop` は他の上端予約がない場合の画面上端との一致を表す。座標値、ミリ秒、GNOME の具体的な待機手段は指定しない。
- 個々の action は要求上の操作または描画境界であり、実装に同名の関数や独立の待機処理を要求しない。描画前に非表示・予約解放・配置反映が完了するという順序だけを制約する。
- 元の可視性と予約は ID ごとに独立に選んだ固定の基準状態に対し、自分の変更を重ねる。この抽象化で「元から非表示を強制表示しない」と独立した復元を検査する。

## モデル化していない相互作用と限界

- 実際の shown・mapped・フォーカスの成立と最初の描画の境界はモデル化したが、Wayland の再描画、Mutter の作業領域更新、通知、アクターの画素描画が具体的に交錯する過程までは含めない。移動・部分表示・フェードと帯の実描画は Gherkin の受入条件で確認する。描画を無期限に遅らせてよいという意味ではない。
- 自分の変更を保持している途中に GNOME Shell や他拡張が基準の表示・予約状態を変更する競合は Quint では扱わない。Shell のフルスクリーン用非表示を上書きしない負のシナリオは Gherkin に残した。実装には自分の変更だけを復元する要求がそのまま適用される。
- 複数の管理 Terminal による表示準備の同時進行、非同期コールバックの遅延と窓の置換、設定変更とホットプラグから再開する通知順序は、この一つの対象操作のモデルには含めない。条件喪失による中断と現在の配置に基づく操作範囲は扱うが、全実装の競合安全性を証明したとはしない。
- スライドの曲線、透過の画素、画面座標の丸め、選択中の AltTab の Shell 側描画は実物と比較する。`entrance` と `hideSlide` はスライドを開始するかを表し、アニメーションの全フレームを証明しない。
- 公平性、無限長の繰り返し、操作完了の時間上限は検証していない。有限モデルの探索深さと Alloy のスコープを超える性質は今回の検証結果に含めない。

これらは受入条件の除外や未承認の実装上の選択肢の追加ではない。

## 現行コードから確認した事実

以下は開始 HEAD に対する読取結果であり、実装済みの修正や原因の特定を示さない。
`specs/1/`、対象コード、`test/panel-visibility.test.mjs` と `test/quake-mode.test.mjs` を関連資料として調査した。

### 実際の表示とフォーカスの条件

観察。パネル判断へ渡す terminalShown は、窓の論理表示とアクターの mapped の両方を要求する。

```javascript
src/panel-autohide.js#L147-L150
   147	        terminalShown:
   148	          window !== null &&
   149	          window.showing_on_its_workspace() &&
   150	          !!actor?.mapped,
```

解釈。Launch/Recall が要求された事実だけでは、この実状態の条件を満たしたことにはならない。

観察。eligible は terminalShown と管理窓自身の実際のフォーカスを含む条件の連言である。

```javascript
src/panel-visibility.js#L19-L31
    19	  const eligible =
    20	    state.extensionEnabled &&
    21	    state.modeEnabled &&
    22	    state.terminalAlive &&
    23	    state.terminalShown &&
    24	    state.terminalOnActiveWorkspace &&
    25	    state.managedWindow === state.focusedWindow &&
    26	    state.session === "desktop" &&
    27	    state.maximizedHorizontally &&
    28	    state.maximizedVertically &&
    29	    !state.fullscreen &&
    30	    panel !== null &&
    31	    panel.monitor === state.terminalMonitor;
```

解釈。REQ-025 を維持するには、表示だけ、フォーカスだけ、対象の特定だけで Panel を変更してはならない。論理状態の成立と最初の実描画との時間関係は要求モデルで区別するが、これらの断片だけで実描画の結果を確認したとはしない。

### Panel の表示と予約の更新

観察。表示と予約を別の項目として更新し、予約の変更後に領域を更新している。

```javascript
src/panel-autohide.js#L168-L184
   168	    let updateRegions = false;
   169	    for (const change of result.changes) {
   170	      const target = change.panel;
   171	      if (change.visible !== undefined) {
   172	        const hiddenByShell =
   173	          target.tracked.trackFullscreen &&
   174	          shell.window_group.visible &&
   175	          layout.findMonitorForActor(target.actor)?.inFullscreen;
   176	        if (!change.visible || !hiddenByShell)
   177	          target.actor.visible = change.visible;
   178	      }
   179	      if (change.reserved !== undefined && layout._trackedActors.includes(target.tracked)) {
   180	        target.tracked.affectsStruts = change.reserved;
   181	        updateRegions = true;
   182	      }
   183	    }
   184	    if (updateRegions) layout._updateRegions();
```

解釈。可視性と予約を別々に維持・復元する要求に対応する。領域更新の呼出しだけで最初の実描画が完成するとは断定しない。

### Terminal 自体の登場スライド

観察。Terminal のアクターの移動とアニメーション時間を登場処理で設定している。

```javascript
src/quake-mode.js#L765-L776
   765	    parent.set_child_above_sibling(this.actor, null);
   766	    this.actor.translation_y = this.actor.height * -1;
   767	    const clearClip = this._clipAnimationAboveTerminal(this.actor);
   768
   769	    Main.wm.skipNextEffect(this.actor);
   770	    Main.activateWindow(this.actor.meta_window);
   771
   772	    this.actor.ease({
   773	      mode: Clutter.AnimationMode.EASE_IN_QUAD,
   774	      translation_y: 0,
   775	      opacity: 255,
   776	      duration: this._settings.get_int("animation-time"),
```

解釈。Panel の見え方の変更を Terminal 自体のスライドの停止や設定変更で代用する根拠にはならない。二つの処理がある事実から、Issue の見え方の原因までは特定できない。

### 既存の機械的な検査

観察。既存テストは Node.js 標準の node:test を使い、本体のパネル判断を読み込む。

```javascript
test/panel-visibility.test.mjs#L6-L8
     6	import assert from "node:assert/strict";
     7	import test from "node:test";
     8	import { reconcilePanelVisibility } from "../src/panel-visibility.js";
```

解釈。後続実装の検証は既存テストを利用できる。今回の仕様検証が、その実装テストの実行や GNOME の画面観察を代替するとはしない。

## 完了範囲と未実施事項

確定要求39件、分類、必要な形式仕様、局所検証、形式間の整合性を確認した。
矛盾・未解決要求はない。成果物は `specs/3/` の仕様7ファイルだけである。
`specs/1/`、コード、テスト、依存、CI、設定は変更していない。

後続実装の node:test は未実施である。Gherkin のステップ実行も未実施である。
Debian 13・GNOME Shell/Mutter 48 系・Wayland の実画面は未確認。
機械的な形式仕様の検証成功を実画面の確認済みとはしない。
実画面の未観察だけで後続の TAKT 実装タスクを不合格にせず、実際に違反を観察した場合には不合格とする。
実装タスクの登録は今回の承認に含まれない。
