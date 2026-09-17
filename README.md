# 感染広がりラボ

ブラウザですぐ遊べる、**感染拡大を食い止めるリアルタイム介入ゲーム**。

画面の中を動き回る人々のあいだに感染が広がっていく。プレイヤーは街のオペレーターとして、
限られた対策ポイントで隔離・治療・ロックダウンを打ち、制限時間まで感染者数を抑え込む。
1プレイ60〜90秒。

眺めるシミュレーションではなく、**「どこに、いつ介入するか」を判断するゲーム**である。
現実の感染症を予測・再現するものではない。

| 項目             | 内容                              |
| ---------------- | --------------------------------- |
| プラットフォーム | ブラウザ（PC・スマートフォン）    |
| 技術             | React + TypeScript / Canvas       |
| 状態             | 開発中                            |

## 遊ぶ

<https://ry-yamaguchi.github.io/kansen-game/>

main へ push されるたびに自動で公開される。
画面の実装が入るまでは、この URL はまだ開けない。

## 開発

実装は [Kiro](https://kiro.dev) で進める。

| 置き場所                                   | 中身                                         |
| ------------------------------------------ | -------------------------------------------- |
| [docs/backlog.md](docs/backlog.md)         | **要望リスト。やってほしいことはここへ書く** |
| [docs/feedback.md](docs/feedback.md)       | 意見・感想（どなたでも歓迎）                 |
| [AGENTS.md](AGENTS.md)                     | AI エージェント向けの案内                    |
| [scripts/note](scripts/note)               | 要望・意見を1行で投げ込む道具（作者用）      |
| [.kiro/steering/](.kiro/steering/)         | Kiro が常時読む方針と前提                    |
| `.kiro/specs/`                             | 要件・設計・タスク                           |
| [.kiro/hooks/](.kiro/hooks/)               | セッション開始時などの自動処理               |

## 意見をお寄せください

遊んでみた感想、気づいた問題、こうなると良いという案を歓迎しています。
[Issue](https://github.com/ry-yamaguchi/kansen-game/issues/new/choose) から出していただくのが
いちばん手軽です。[docs/feedback.md](docs/feedback.md) への追記（Pull Request）でも受け付けています。

AI エージェントでご覧の場合は、[AGENTS.md](AGENTS.md) に手順があります。

## ライセンス

未定。
