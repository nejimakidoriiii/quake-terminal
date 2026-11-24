# Issue #1 の要求対応と検証

## 入口と要求の出典

- [確定要求と承認の記録](requirements.md)。Issue URL は https://github.com/nejimakidoriiii/quake-terminal/issues/1、updatedAt は `2026-11-22T07:09:20Z`。
- [分類表](classification.yaml)。形式選択の true/false と各理由の正本。
- [表示動作の Gherkin](gherkin/display.feature)。以下の表では `D` と略記する。
- [検証・報告の Gherkin](gherkin/delivery.feature)。以下の表では `V` と略記する。
- [状態遷移の Quint](quint/panel.qnt)。以下の表では `Q` と略記する。
- [所有・配置関係の Alloy](alloy/ownership.als)。以下の表では `A` と略記する。

Issue の「最大化したまま透過し全画面を覆う」という目的を、承認された「他の予約領域がなければ対象モニター全体」に限定した。設定の即時反映、別窓の識別、元の状態を尊重する復元、論理モニターの扱い、後続実装の合格条件、未確認の報告は利用者の追加決定である。現行コードや参考実装の動作を追加の要求にはしていない。

## Trace matrix

各 Gherkin セルは、その行の REQ-ID タグを持つ Scenario または Scenario Outline を示す。
`—` は非適用であり、理由は分類表にある。すべての形式を一律には生成していない。
「6項目一致」は語彙・終端性・ガード・多重度・対称性・適合性を照合した結果である。
Gherkin の実行成功や実装の合格を表すものではない。

| REQ-ID | Gherkin | Quint | Alloy | 判定・整合根拠 |
|---|---|---|---|---|
| REQ-001 | D: 初期設定の mode | — | — | 単一形式の根拠妥当。設定画面の切替数 |
| REQ-002 | D: mode は端末アプリごとに分かれない | — | Mode、ManagedApplication.mode、SharedMode | 6項目一致。複数アプリが一つの共通設定を参照 |
| REQ-003 | D: 初期設定の mode | init、defaultOff | — | 6項目一致。既定オフと実際の値の切替を区別 |
| REQ-004 | D: 既存の表示操作を維持する | — | — | 単一形式の根拠妥当。オフ時のフルスクリーンの扱いも既存動作との比較に委ねる |
| REQ-005 | D: showOrRecall は通常の縦横最大化を適用する | showOrRecall、showResult | — | 6項目一致。mode オンの表示分岐だけで非フルスクリーンの両軸最大化 |
| REQ-006 | D: showOrRecall は通常の縦横最大化を適用する | showOrRecall、setMode、showResult | — | 6項目一致。Maximized と Saved の優先関係 |
| REQ-007 | D: 表示中の setMode は即時反映し保存値を維持する | setMode、savedUnchanged | — | 6項目一致。保存値と表示形状を別に保持 |
| REQ-008 | D: 既存の表示操作を維持する | — | — | 単一形式の根拠妥当。既存の選択方針との比較 |
| REQ-009 | D: 既存の表示操作を維持する | — | — | 単一形式の根拠妥当。既存ショートカットの分岐との比較 |
| REQ-010 | D: 既存の表示操作を維持する | — | — | 単一形式の根拠妥当。描画アニメーションの比較 |
| REQ-011 | D: 既存の表示操作を維持する | — | — | 単一形式の根拠妥当。既存の自動非表示との比較 |
| REQ-012 | D: 表示中の setMode は即時反映し保存値を維持する | setMode、settingResult | — | 6項目一致。表示中のオフからオンへの実際の切替で即時反映 |
| REQ-013 | D: 表示中の setMode は即時反映し保存値を維持する | setMode、settingResult | — | 6項目一致。表示中のオンからオフへの実際の切替で Saved に復元 |
| REQ-014 | D: 非表示中の setMode は窓を呼び出さない / 非表示中に変更した mode を次の表示で使う | setMode、showOrRecall、settingResult、showResult | — | 6項目一致。非表示維持と次回の保存値適用を確認し、オフの fullscreen 解除は含意しない |
| REQ-015 | D: eligible のとき Panel と Reservation を取り除く / eligible の各条件を失ったとき自分の変更を復元する / 不適格な状態では Panel を隠さない | eligible、reconcile、panelPolicy | — | 6項目一致。肯定と全条件の否定を照合 |
| REQ-016 | D: eligible のとき Panel と Reservation を取り除く | reconcile、panelPolicy | — | 6項目一致。可視性と予約を独立に扱う |
| REQ-017 | D: 別 Monitor の Panel は操作しない | affected、reconcile、panelPolicy | LocalPanel、NoForeignReservation、MirrorAndForeign、NoLocalPanel | 6項目一致。Panel の ID と現在の Monitor 関係を区別 |
| REQ-018 | D: 他の Reservation を維持する | — | OwnedReservation、NoForeignReservation、MirrorAndForeign | 6項目一致。Panel 所有ではない予約は操作対象外 |
| REQ-019 | D: 透過設定は端末に任せる | — | — | 単一形式の根拠妥当。端末の外部設定との比較 |
| REQ-020 | D: eligible の各条件を失ったとき自分の変更を復元する / 復元は元の非表示と予約状態を尊重する / stop は Panel を復元し端末を残す | reconcile、focusWindow、manual、hide、close、sessionChange、workspaceChange、setMode、stop、panelPolicy | — | 6項目一致。各喪失契機の後に同じ復元契約を適用 |
| REQ-021 | D: 復元は元の非表示と予約状態を尊重する | reconcile、panelPolicy | — | 6項目一致。元の非表示と元の予約有無を独立に保持 |
| REQ-022 | D: アプリではなく窓自身のフォーカスを判定する | eligible、focusWindow、focusResult | — | 6項目一致。SameApp・Dialog・Clipboard・Other は別 ID |
| REQ-023 | D: Clipboard の例外は Panel に適用しない | focusWindow、focusResult、panelPolicy | — | 6項目一致。shown の例外とパネル条件を分離 |
| REQ-024 | D: focusWindow だけでは手動の窓状態を変えない | manual、focusWindow、focusResult | — | 6項目一致。各軸・fullscreen・shape を保存 |
| REQ-025 | D: showOrRecall は通常の縦横最大化を適用する | showOrRecall、showResult | — | 6項目一致。Manual からも表示分岐で最大化へ戻れる |
| REQ-026 | D: stop は Panel を復元し端末を残す | stop、stopResult | — | 6項目一致。停止は窓の形状を変えない |
| REQ-027 | D: stop は Panel を復元し端末を残す | stop、stopResult | — | 6項目一致。停止は alive を保存 |
| REQ-028 | D: topology の後は現在の Monitor を使う | topology、reconcile、topologyResult | — | 6項目一致。移動した同じ Panel の元の状態を保持 |
| REQ-029 | D: topology の後は現在の Monitor を使う | topology、topologyResult | — | 6項目一致。GNOME の配置を入力として受け取り物理出力履歴を持たない |
| REQ-030 | D: ミラー表示は一つの Monitor として扱う | — | PhysicalOutput.logical、MirrorAndForeign | 6項目一致。二つの出力が同じ論理 Monitor を指せる |
| REQ-031 | D: 共通作業領域の変化と他の窓への直接操作を区別する | — | — | 単一形式の根拠妥当。GNOME による外部の結果を許容 |
| REQ-032 | D: 共通作業領域の変化と他の窓への直接操作を区別する | — | ManagedWindowOnly、MirrorAndForeign | 6項目一致。他の Window が存在しても直接操作は Terminal に限定 |
| REQ-033 | V: 対応バージョンを維持する | — | — | 単一形式の根拠妥当。配布物のメタデータ |
| REQ-034 | V: 新しく利用する機能を照合する | — | — | 単一形式の根拠妥当。後続実装の API 適合確認 |
| REQ-035 | V: 既存の機械的検証を通す | — | — | 単一形式の根拠妥当。lint のコマンド応答 |
| REQ-036 | V: 既存の機械的検証を通す | — | — | 単一形式の根拠妥当。スキーマコンパイルのコマンド応答 |
| REQ-037 | V: 既存の機械的検証を通す | — | — | 単一形式の根拠妥当。パッケージ作成のコマンド応答 |
| REQ-038 | V: 配布 ZIP の内容を確認する | — | — | 単一形式の根拠妥当。具体的な実装と ZIP の照合 |
| REQ-039 | V: 本体が使う判断をテストする | — | — | 単一形式の根拠妥当。本体の利用箇所とテストの照合 |
| REQ-040 | V: テストは条件の取り違えを検出する | — | — | 単一形式の根拠妥当。フォーカス条件に対する検出力 |
| REQ-041 | V: テストは条件の取り違えを検出する | — | — | 単一形式の根拠妥当。最大化条件に対する検出力 |
| REQ-042 | V: テストは条件の取り違えを検出する | — | — | 単一形式の根拠妥当。モニター条件に対する検出力 |
| REQ-043 | V: テストは条件の取り違えを検出する | — | — | 単一形式の根拠妥当。復元条件に対する検出力 |
| REQ-044 | V: 新しい検証基盤や依存を追加しない | — | — | 単一形式の根拠妥当。依存の差分 |
| REQ-045 | V: 新しい検証基盤や依存を追加しない | — | — | 単一形式の根拠妥当。CI の差分 |
| REQ-046 | V: 新しい検証基盤や依存を追加しない | — | — | 単一形式の根拠妥当。GUI テスト基盤の差分 |
| REQ-047 | V: 対象環境で透過と上端を人が観察する | — | — | 単一形式の根拠妥当。実画面でしか確認できない |
| REQ-048 | V: 対象環境でフォーカス移動後の復元を人が観察する | — | — | 単一形式の根拠妥当。実環境での最大化維持と復元 |
| REQ-049 | V: 観察の未実施と機械的な合否を分ける | — | — | 単一形式の根拠妥当。保証範囲の報告 |
| REQ-050 | V: 観察の未実施と機械的な合否を分ける | — | — | 単一形式の根拠妥当。機械的合否と人の観察を区別 |
| REQ-051 | V: 観察の未実施と機械的な合否を分ける | — | — | 単一形式の根拠妥当。観察証拠と報告の照合 |
| REQ-052 | V: 参考実装を前提にせず根拠を渡す | — | — | 単一形式の根拠妥当。下記の固定出典と違いの記載 |
| REQ-053 | V: 参考実装を前提にせず根拠を渡す | — | — | 単一形式の根拠妥当。ソースの複製・同梱を禁止 |
| REQ-054 | V: 参考実装を前提にせず根拠を渡す | — | — | 単一形式の根拠妥当。外部ディレクトリを前提にしない |

## 整合性の検査範囲

1. 語彙。Terminal、各別窓、Monitor、Panel、Reservation、mode と操作名を要求の語彙に対応させた。Alloy の `Mode` は設定の存在、Quint の `mode` はその値である。
2. 終端性。非表示・終了・停止を永久に再開できない終端にはしていない。Quint の showOrRecall は再表示・起動を抽象化し、start は拡張の再有効化を表す。Gherkin は停止中のショートカット実行を要求しない。
3. ガード。showOrRecall と setMode は拡張の有効中だけ実行可能である。setMode は `value != s.mode` の場合だけを設定変更イベントとして扱う。Gherkin の設定切替の例も元の値と反対の値への操作に限定する。同値の通知を設定切替とは扱わず、手動の窓状態を再適用で上書きしない。このガードは設定画面にエラー表示や操作禁止を追加する要求ではない。フォーカス・最大化・画面モード・配置は環境からの入力として停止中も変化できる。拡張の停止中には Panel を隠さない。
4. 多重度。管理窓自身と別窓を個別 ID で識別する。Quint の Panel は ID ごとに元の表示・予約を保持し、配置とは別に扱う。Alloy は複数の端末アプリが一つの設定を参照し、複数物理出力が同じ Monitor を参照する例を持つ。
5. 対称性。Gherkin の mode オンでの通常最大化、各条件を失った後の復元、手動操作後の再フォーカス・明示的な呼び戻しは対応する Quint action で表せる。mode オフの showOrRecall の fullscreen の結果は非決定入力とし、解除も保持も新しい契約にしない。既存動作との一致は REQ-004 の Gherkin で比較する。表示中の実際のオフへの切替は REQ-013、非表示の維持と次回の保存値適用は REQ-014 として残す。Alloy は eligibility を前提に要求全体を証明したとは扱わず、操作対象の所有・配置の側面だけを制限する。
6. 適合性。Quint のパネル出力契約 `panelPolicy` は実行側の eligible/affected を呼ばず独立に条件を照合する。Alloy の唯一の assert は LocalPanel と OwnedReservation の組合せの帰結であり、宣言多重度だけの再検査ではない。下記の mutation check で非自明性を確認した。

## 形式仕様の検証

実行場所はリポジトリのルートである。`skill_dir` は SkillPort が返した requirements-to-specs のディレクトリであり、今回の実行値は `/home/masano/.ghq/neptune/srv/git/make-world/dotfiles/dot.skillport/skills/requirements-to-specs`。
以下のコマンド中の `verify.sh` は検証用であり、実装・配布時の依存ではない。検証内部の出力はラッパーの使い捨てコンテナ内に置かれ、仕様ディレクトリには保存しない。

Quint の下表の結果は、設定変更イベントと mode オフ時の fullscreen の契約を訂正した後の再検証である。修正前の成功結果ではない。Alloy はソースに変更がないため、前回の commands/exec と mutation check の成功証拠を再利用する。
検証対象の Quint の SHA-256 は `cb8b79879162b62d86b75b05ad7fa7bccfd11921e6dbc0e3e841d38d89469338`、変更のない Alloy の SHA-256 は `27aba593824741e90b510f0ad5a65081e3a9b2362fec2425da3efb77ecdd621e` である。

| コマンド | 期待 | 現行版の結果と証拠 | 終了コード |
|---|---|---|---|
| `bash "$skill_dir/scripts/verify.sh" quint typecheck specs/1/quint/panel.qnt` | 型・効果の整合 | 診断なし、TYPECHECK_EXIT_CODE=0 | 0 |
| `bash "$skill_dir/scripts/verify.sh" quint run specs/1/quint/panel.qnt --invariant=safety --max-steps=40 --max-samples=2000 --seed=1 --verbosity=1` | safety の違反なし | `[ok] No violation found (1863ms at 1074 traces/second)`、RUN_EXIT_CODE=0 | 0 |
| `bash "$skill_dir/scripts/verify.sh" quint verify specs/1/quint/panel.qnt --invariant=safety --max-steps=5 --verbosity=1` | 深さ5以内の反例なし | `[ok] No violation found (16957ms)`、VERIFY_EXIT_CODE=0 | 0 |
| `bash "$skill_dir/scripts/verify.sh" alloy commands specs/1/alloy/ownership.als` | 全コマンドを列挙可能 | check 1件と run 3件を列挙 | 0 |
| `bash "$skill_dir/scripts/verify.sh" alloy exec specs/1/alloy/ownership.als -c '*'` | 下表と一致 | stdout の JSON commands を全件照合 | 0 |

Quint の safety は defaultOff、panelPolicy、savedUnchanged、showResult、settingResult、focusResult、stopResult、topologyResult の連言である。
settingResult は実際に mode が変化したことも検査する。showResult の非フルスクリーン・縦横最大化の契約は mode オンに限定する。オフの Saved は保存値適用の抽象状態であり、fullscreen 解除と同義ではない。
run は2,000試行、各最大40遷移の探索であり網羅検証ではない。verify は初期状態から深さ5までの有限探索であり、showOrRecall・mode オン・条件喪失という複数操作も含める。無限長の実行やすべての実装を証明したとはしない。

Alloy はすべて `for 5` の範囲であり、各 sig の上限は要求上の個数制限ではない。全件の期待値を以下に示す。

| コマンド名 | 種類 | 期待 | 結果の根拠 |
|---|---|---|---|
| NoForeignReservation | check | UNSAT | commands の当該項目に solution なし。反例なし |
| SharedMode | run | SAT | solution あり。二つの ManagedApplication と一つの Mode が共存 |
| MirrorAndForeign | run | SAT | solution あり。ミラー・別 Monitor の Panel・他所有の Reservation・別 Window が共存 |
| NoLocalPanel | run | SAT | solution あり。Terminal の Monitor に標準 Panel がない配置を許容 |

### Mutation check

| 対象 | 一時変更 | コマンド | 期待・観察結果 | 終了コード |
|---|---|---|---|---|
| Alloy NoForeignReservation | OwnedReservation の関係等式を除去し空の fact にする | `bash "$skill_dir/scripts/verify.sh" alloy exec specs/1/alloy/ownership.als -c NoForeignReservation` | SAT。JSON の solution に反例があり、Control.affectedReservation が空でなくてもその所有者を対象 Panel に限定できなくなる | 0 |
| Quint panelPolicy | eligible の `x.focus == "Terminal"` だけを `x.focus != "None"` に置換する | `bash "$skill_dir/scripts/verify.sh" quint verify specs/1/quint/panel.qnt --invariant=safety --max-steps=5 --verbosity=1` | 今回の修正後も再実行し、`[violation] Found an issue (12753ms)` と `found a counterexample` | 1 |
| Quint settingResult | setMode の `value != s.mode` のガードだけを一時除去する | `bash "$skill_dir/scripts/verify.sh" quint verify specs/1/quint/panel.qnt --invariant=safety --max-steps=5 --verbosity=1` | `[violation] Found an issue (10003ms)` と `found a counterexample`。同値を設定変更イベントに戻す誤りを検出 | 1 |
| Quint showResult の適用範囲 | action は変えず showResult に mode を問わない `not(s.fullscreen)` を一時追加する | `bash "$skill_dir/scripts/verify.sh" quint verify specs/1/quint/panel.qnt --invariant=safety --max-steps=5 --verbosity=1` | `[violation] Found an issue (10091ms)` と `found a counterexample`。オフ時の fullscreen=true を許していることを確認する検査であり、製品の合格条件ではない | 1 |

一時変更はすべて戻した。今回の修正後の Quint は全ての一時変更を戻してから前掲の typecheck/run/verify を再実行し成功した。Alloy の変更なしの成功証拠は再利用する。現行版に mutation や適用範囲を超える仮の検査条件は残っていない。

### Gherkin と要求対応

Gherkin は英語キーワード、REQ-ID タグ、一つの When、観察可能な Then、否定ケース、Examples の列と変数の対応を確認した。
軽量な構造検査を Python 3 と PyYAML で実行し、終了コード0を得た。REQ-001〜REQ-054 の連番、分類の3列、最低一つの true、仕様のタグ・コメントの集合の一致を検査した。結果は Gherkin 54セル、Quint 20セル、Alloy 5セル、display 21ブロック、delivery 11ブロックである。
設定切替の前提とオフ時の比較例の明確化後にも同じ検査を再実行し、分類表と対応表の true/false の一致、全仕様への相対リンク、上記のブロック数を終了コード0で確認した。
Gherkin のステップ定義は存在せず、シナリオは実行していない。軽量検査は完全な Gherkin パーサーでも実装の合格判定でもない。

要求対応の再検査に用いるコマンドは次のとおりである。Scenario の意味と前掲6項目は別に照合する。

```sh
python3 - <<'PY'
from pathlib import Path
import re, yaml
p = Path("specs/1")
c = yaml.safe_load((p / "classification.yaml").read_text())
ids = set(re.findall(r"^\| (REQ-\d+) \|", (p / "requirements.md").read_text(), re.M))
assert ids == set(c) == {f"REQ-{i:03}" for i in range(1, 55)}
for form, pattern in [("gherkin", "*.feature"), ("quint", "*.qnt"), ("alloy", "*.als")]:
    text = "\n".join(f.read_text() for f in (p / form).glob(pattern))
    assert set(re.findall(r"REQ-\d+", text)) == {k for k, v in c.items() if v[form]}
    print(form, sum(v[form] for v in c.values()))
assert all(any(v[f] for f in ("gherkin", "quint", "alloy")) for v in c.values())
trace = (p / "trace.md").read_text()
assert set(re.findall(r"^\| (REQ-\d+) \|", trace, re.M)) == ids
for target in re.findall(r"\]\(([^)]+)\)", trace):
    if "://" not in target:
        assert (p / target.split("#")[0]).is_file(), target
print("PASS")
PY
```

## 形式化上の選択と限界

以下はモデルの選択であり、利用者の設計判断や後続実装の方式を追加するものではない。

- 形式の選択は分類表の各コメントを正本とする。検証工程・報告・描画は Gherkin のみ、可変の窓条件は Quint、所有関係と論理画面は Alloy に分けた。
- Quint は二つの論理 Monitor、二つの Panel ID、管理窓 Terminal 一つ、別窓の種類ごとの ID とフォーカスなしを扱う。Panel が移動しても同じ ID なら復元元を保持する。Panel がない配置と別インスタンスへの置換も表せる。
- GNOME 標準 Panel は Quint の各時点で最大一つが配置される。Alloy は所有・配置の安全性を広い構造で検査するため Panel の個数を制限しない。Alloy で複数を許すことは複数パネル対応の実装要求ではない。
- 元の可視性と予約の有無は Panel ID ごとに独立に選び、拡張自身の変更を重ねる。画面上の予約座標、具体的 API、他拡張との変更通知の競合・原子性はモデル化しない。実装は「自分の変更だけを取り消す」を維持する必要がある。
- サイズ・水平配置は保存値の組 `(70, 50, 2)` と Saved/Maximized/Manual で表す。数値はモデルの代表値であり新しい既定値ではない。実際の画素寸法・丸め・配置計算は既存動作との比較で確認する。
- mode オフの showOrRecall では fullscreen の結果を既存動作からの非決定入力として扱う。これは実装が任意に解除・保持を選べるという要求ではない。実装は既存動作を維持する必要があり、その比較は Gherkin に残す。
- 「即時」は設定や環境イベントに対する一つの reconcile の完了後として表す。GNOME の非同期通知、アニメーション途中、Wayland の再描画待ちと設定切替・切断の競合は離散モデルから外す。遅延を許す追加要求ではない。
- topology は GNOME が決めた現在の配置を受け取る。コネクター ID や以前の物理モニターへの自動復帰、ホットプラグの信号順序はモデル化しない。
- 既存ショートカットの分岐・モニター選択・アニメーション全体、GNOME が他の最大化窓を再配置する過程は形式状態から外す。Gherkin の比較・許容条件は残す。
- API の対象バージョンとの適合、パッケージへの同梱、本体が使う判断の node:test と検出力は後続実装で確認する。モデルはコードとの同値性を証明していない。
- 透過・上端・実際の作業領域は対象環境の人の観察が必要であり、形式検証からは証明しない。Debian 13・GNOME Shell/Mutter 48 系・Wayland・foot 1.21.0 の画面観察は未確認。他環境の透過は保証せず、この未実施だけでは TAKT 実装を不合格にしない。

## 既存コードの観察

以下は開始 HEAD `7cccf5df1fd14effba4811bd26fa984d440e05a6` に対する読取結果であり、変更前の観察である。本体の修正案や今回の実装済み機能を意味しない。

### 管理窓の識別

観察: アクター名と生存状態で管理窓を探している。

```javascript
src/quake-mode.js#L191-L193
   191        const actor = w.get_compositor_private();
   192        return actor.get_name() === "quake-terminal" && w.is_alive;
   193      });
```

解釈: アプリに属する全窓をパネル条件の対象に広げる根拠にはならない。REQ-022 は利用者の別窓識別の決定に従う。

### Monitor の作業領域と保存した寸法

観察: 選んだ Monitor の作業領域と保存した幅・高さを読む。

```javascript
src/quake-mode.js#L790-L796
   790    const monitorDisplayScreenIndex = this.monitorDisplayScreenIndex;
   791    const area = this.terminalWindow.get_work_area_for_monitor(
   792      monitorDisplayScreenIndex
   793    );
   794
   795    const verticalSettingsValue = this._settings.get_int("vertical-size");
   796    const horizontalSettingsValue = this._settings.get_int("horizontal-size");
```

解釈: パネルの可視性だけでなく作業領域に反映される予約を扱う必要がある。これは REQ-016 の実装調査の根拠であり、他の予約まで除去する許可ではない。

### Clipboard の既存例外

観察: 自動非表示の処理は Clipboard と管理窓自身へのフォーカスを除外する。

```javascript
src/quake-mode.js#L933-L941
   933    if (await is_wlclipboard(source.focus_window)) {
   934      return;
   935    }
   936
   937    if (source.focus_window === this.terminalWindow) {
   938      return;
   939    }
   940
   941    this._hideTerminalWithAnimationBottomUp();
```

解釈: この例外を新しいパネル判断へ流用すると REQ-023 と異なる。端末の自動非表示とパネルの復元は別の結果として扱う。

### 停止の入口

観察: 拡張の disable は管理オブジェクトの destroy を呼ぶ。

```javascript
src/extension.js#L48-L53
    48  disable() {
    49    Main.wm.removeKeybinding("terminal-shortcut");
    50
    51    if (this._quakeMode) {
    52      this._quakeMode.destroy();
    53    }
```

解釈: REQ-020・REQ-026・REQ-027 の停止時の動作は、この経路を含めて後続実装で確認する。

### 対応宣言と配布

観察: 対応宣言には45〜51が含まれる。

```json
src/metadata.json#L6-L14
     6  "shell-version": [
     7    "45",
     8    "46",
     9    "47",
    10    "48",
    11    "49",
    12    "50",
    13    "51"
    14  ],
```

解釈: 宣言があること自体は新しく使う API の互換性の証明ではない。REQ-034 の照合は別途必要である。

観察: pack は明示的な追加ソースとして quake-mode.js を渡す。

```makefile
Makefile#L17-L18
    17  @gnome-extensions pack --podir=po --extra-source='quake-mode.js' src
    18  @FILE_SIZE_KB=$$($$(which stat) -c%s "$(PACKED_EXTENSION_FILE)" | awk '{printf "%.2f KB", $$1/1024}'); echo "Packed $(NAME): $$FILE_SIZE_KB"
```

解釈: 後続実装でモジュールを追加した場合、その同梱はビルドの成功だけでは確定しない。REQ-038 は実際の ZIP と利用箇所の照合を求める。

## 固定された参考資料の観察と違い

次の観察は、親から渡された承認済みの調査結果を出典とともに記載したものである。この仕様作成では外部実装を実行・複製していない。

- [GNOME Shell 48.0 の layout.js L561-L562](https://github.com/GNOME/gnome-shell/blob/48.0/js/ui/layout.js#L561-L562) は標準 Panel を主 Monitor に配置する。[同 L855-L858](https://github.com/GNOME/gnome-shell/blob/48.0/js/ui/layout.js#L855-L858) はアクターの可視性だけでは strut がなくならないと記している。したがって Panel の表示と Reservation は別の状態として扱う。同じ Monitor に標準 Panel がない場合、他の Monitor の Panel は隠さない。
- Hide Top Bar の固定版は commit `835f343cb00b3af9242ad6581413339c2ba24399` である。[panelVisibilityManager.js L59-L63](https://gitlab.gnome.org/tuxor1337/hidetopbar/-/blob/835f343cb00b3af9242ad6581413339c2ba24399/panelVisibilityManager.js#L59-63) の構築時には `affectsStruts: false` を設定する。[同 L657-L667](https://gitlab.gnome.org/tuxor1337/hidetopbar/-/blob/835f343cb00b3af9242ad6581413339c2ba24399/panelVisibilityManager.js#L657-667) の destroy では Panel を show し、セッションモードから予約を再設定する。
- [同版 intellihide.js L248-L265](https://gitlab.gnome.org/tuxor1337/hidetopbar/-/blob/835f343cb00b3af9242ad6581413339c2ba24399/intellihide.js#L248-265) の重なり判定は本件の eligible 条件とは異なる。参考版の「隠す条件」も「停止時に show する復元」も、そのまま採用する根拠にはならない。本件は Terminal 自身のフォーカスと両軸最大化を要求し、元から隠れていた Panel を強制表示しない。
- 実装は `gi://`、Shell 同梱モジュール、自身のコードを使う。hidetopbar の複製・同梱、新しい依存、外部ディレクトリへの参照を必要としない。ここにある URL は根拠であり、外部ソースの取得を実装の開始条件にしない。
- 作業環境の Ubuntu 20.04・GNOME Shell 3.36.9 は、利用先の GNOME 48 の画面観察を代替しない。対象環境での実行は未確認である。

## 完了範囲

要求54件と分類、必要な3形式、形式仕様の検証・整合性確認を対象とする。未解決要求・形式間の矛盾はない。
本体・ライブラリ・実装用テスト・CI は作成していない。lint・スキーマ・パッケージ・ZIP・API 照合・node:test は後続実装の未実施事項であり、今回の形式仕様の成功に含めない。
