# 研究メモ: 現実の社会と人間臭さ、ゲームデザイン

2026-09-23 調査。作者の依頼「ゲーム性と実際の社会やニンゲン臭さを研究して取り入れる」に応えるためのメモである。
各項目に、**何が分かっているか → ゲームにどう写すか → 扱い** を書く。
扱いは「取り入れる」「取り入れた」「提案のみ（作者の判断待ち）」のいずれか。

このゲームは現実の予測ではない（CLAUDE.md 掟9）。研究は**手触りの根拠**として使い、数値をそのまま写すことはしない。

---

## A. ゲームデザイン

### A1. 人が同時に追える動く物は4つ前後

- 分かっていること: 同じ見た目の動く物を追う実験で、人が同時に追えるのは4〜5個前後とされる
  （Pylyshyn & Storm 1988 以来の多物体追跡の研究）。条件次第で変わるが、数が増えるほど成績は下がる
- 写し方: 作者の所感「対処するものが多すぎて雑に対応してしまう」の正体はこれである。
  85人から30人に減らすだけでなく、**プレイヤーが注意すべき対象を4つ以内に絞る**。
  特性持ちの人（B1）は1試合に数人まで、見た目ではっきり区別できるようにする
- 扱い: **取り入れる**（人数30人は合意済み。特性持ちの数の上限に使う）
- 出典: [Multiple object tracking（Wikipedia）](https://en.wikipedia.org/wiki/Multiple_object_tracking)、
  [How many objects can you track?（JOV）](https://jov.arvojournals.org/article.aspx?articleid=2121950)

### A2. 緊張は時間とともに上げ、連鎖は劇的に見せる

- 分かっていること: 協力型ボードゲーム『パンデミック』は、山札を切り直すたびに感染率の目盛りが進み、
  引く枚数が増えることで緊張を上げる。都市が限界を超えると隣へ広がる「アウトブレイク」が連鎖する
- 写し方: 流入が時間とともに強まる仕組み、ウェーブはすでにある。連鎖を目に見える形で出す
  （CHAIN 表示・OUTBREAK 表示）は、作者の優先度2「演出・手応え」そのものである
- 扱い: 演出の段階で**取り入れる**
- 出典: [Pandemic (board game)（Wikipedia）](https://en.wikipedia.org/wiki/Pandemic_(board_game))、
  [Pandemic, a Game Gone Viral（Think Global Health）](https://www.thinkglobalhealth.org/article/pandemic-game-gone-viral)

---

## B. 感染症の側

### B1. 感染の2割が、広がりの8割を生む（過分散）

- 分かっていること: 感染者の一部が大半の二次感染を生む。新型コロナでは分散パラメータ k が 0.1 前後と推定され、
  感染者の約1割が新規感染の8割を生んだという見積もりがある（季節性インフルエンザは k≒1 で偏りが小さい）
- 写し方: 1試合に**数人だけ「よく人と会う人」**を置く（作者の案「スーパースプレッダー」）。
  その人を押さえられるかが勝負を分ける。数は A1 に従って絞る
- 扱い: 人の個性の段階で**取り入れる**
- 出典: [Superspreading, overdispersion and their implications（BMC Public Health, 2023）](https://link.springer.com/article/10.1186/s12889-023-15915-1)、
  [Characterizing superspreading of SARS-CoV-2（PMC）](https://pmc.ncbi.nlm.nih.gov/articles/PMC7743081/)

### B2. 接触は家・職場・学校で起き、移動中は少ない

- 分かっていること: 欧州の大規模接触調査（POLYMOD）では、接触の場所の内訳はおおよそ
  家23%・職場21%・学校14%・余暇16%・移動中3% である
- 写し方: 感染症モードでは、**同じ場所に留まっている人どうしの接触を重く、通りですれ違う接触を軽く**する。
  いまの「近づいた時間が長いほどうつる」仕組みの延長で表せる。守るべきは通りより場所になる
- 扱い: **取り入れる**（モードごとに「どこで広がるか」を変える。D1 を参照）
- 出典: [Changes in social contacts in England（PLOS Medicine, CoMix）](https://journals.plos.org/plosmedicine/article?id=10.1371%2Fjournal.pmed.1003907)、
  [Projecting social contact matrices in 152 countries（PubMed）](https://pubmed.ncbi.nlm.nih.gov/28898249/)

### B3. 体調が悪くても出勤・登校してしまう（プレゼンティーイズム）

- 分かっていること: 日本の労働者の調査で、発熱や風邪の症状があっても出勤する人が一定数いる。
  雇用が不安定な人、上司や同僚の支えが少ない人ほど休みにくい。職場での感染拡大の要因として挙げられている
- 写し方: **感染した人の多くは予定どおり職場や学校へ行く。一部だけが家で休む。**
  「具合が悪ければ休むはず」という理想どおりには動かない、人間臭い動きである
- 扱い: **取り入れる**
- 出典: [Psychosocial factors and sickness presenteeism in Japanese workers（PMC）](https://pmc.ncbi.nlm.nih.gov/articles/PMC8715929/)、
  [Work attendance when experiencing fever or cold symptoms（medRxiv）](https://www.medrxiv.org/content/10.1101/2021.09.13.21263476v1.full)

### B4. 感染が見えると人は自分から避け、落ち着くとまた集まる

- 分かっていること: 周りで感染が増えると人は自発的に接触を減らし、減ると元に戻る。この行動と感染の
  跳ね返りが、繰り返す流行の波を生む一因とされる。地域の報告数への自発的な反応は、外出自粛の命令に匹敵する大きさだった
- 写し方: **街で感染が目に見えて多いとき、一部の人が昼の広場へ行くのをやめる（自粛）。** 落ち着けば戻る。
  抑え込みに成功すると人が戻ってきて、また危なくなる。「一度抑えたら終わり」にならない
- 扱い: **取り入れる**
- 出典: [Measuring voluntary and policy-induced social distancing behavior（PNAS）](https://www.pnas.org/doi/10.1073/pnas.2008814118)、
  [Endogenous social distancing（Scientific Reports）](https://www.nature.com/articles/s41598-021-82770-8)

### B5. 規制は繰り返すほど守られなくなる（自粛疲れ）

- 分かっていること: スイスの若年層の追跡調査で、1回目の都市封鎖では受け入れも順守も高かったが、
  2回目では大きく下がった。規制を「不要・効果がない」と感じることや、政府への信頼の低さと関係する
- 写し方: **ロックダウンは使うたびに効きが落ちる**（従わない人が増える）。強力だが、いつ使うかの判断が要る
- 扱い: **取り入れる**
- 出典: [Fatigue during the COVID-19 pandemic: young adults in Switzerland（PMC）](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8664223/)、
  [Who develops pandemic fatigue?（PLOS One）](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0276791)

### B6. 規制の発表で、かえって人が店に押し寄せる（買いだめ）

- 分かっていること: 都市封鎖の発表は、各国で短い買いだめの波を引き起こした。行列や混雑を伴う
- 写し方: ロックダウンの直前に、一瞬だけ人が店へ集まる。人間臭いが、プレイヤーには理不尽に感じられやすい
- 扱い: **提案のみ（作者の判断待ち）** — 手触りを悪くする恐れがあるため入れていない
- 出典: [Panic buying research: A systematic literature review（Wiley）](https://onlinelibrary.wiley.com/doi/10.1111/ijcs.12669)

---

## C. 噂話の側

### C1. 嘘は真実より速く遠くへ広がる。鍵は目新しさと感情

- 分かっていること: Twitter 上の約12万件の噂を調べた研究で、偽の情報は真実より速く、遠く、広く拡散した。
  目新しさと、驚き・怒りなどの感情的な反応が要因と考えられている
- 写し方: 噂は**新しいうちは速く広がり、飽きられると止まる**。いまの「噂している → 飽きた」の流れと、
  「尾ひれが付きました」ウェーブ（目新しさの更新）がこれに当たる。すでに合っている
- 扱い: **取り入れた**（既存の仕組みが該当）
- 出典: [The spread of true and false news online（Science）](https://www.science.org/doi/10.1126/science.aap9559)、
  [Study: False news spreads faster than the truth（MIT Sloan）](https://mitsloan.mit.edu/ideas-made-to-matter/study-false-news-spreads-faster-truth)

### C2. 訂正は効きにくい。先回りの予防のほうが効く

- 分かっていること: 誤情報は訂正された後も判断に影響し続ける（継続的影響効果）。
  誤情報に触れる前に手口を知らせておく「プレバンキング（心理的予防接種）」が抵抗力を高める
- 写し方: 噂話モードの「訂正情報」は、**まだ噂を聞いていない人への予防がよく効き、
  すでに噂している人を止める効果は弱い**ようにする。「広まる前に先回りする」判断が大事になる
- 扱い: **取り入れる**（モード別の調整）
- 出典: [Vaccination against misinformation: inoculation reduces the continued influence effect（PLOS One）](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0267463)、
  [Psychological drivers of misinformation belief and its resistance to correction（Nature Reviews Psychology）](https://www.nature.com/articles/s44159-021-00006-y)

### C3. 情報は人の集まる所と、顔の広い人から広がる

- 写し方: 噂話モードでは広場や駅など**人が行き交う場所**と、**顔の広い人（人気者）**が広がりの中心になる
- 扱い: 人の個性の段階で**取り入れる**（「人気者」）

---

## D. 悪感情の側

### D1. 怒りは喜びより速く、見知らぬ人どうしを伝って広がる

- 分かっていること: 中国の SNS（微博）の研究で、怒りは喜びより感染しやすく、しかも**弱い紐帯（見知らぬ人・薄い付き合い）**
  を好んで伝わるため、共同体の壁を越えて広がる。突発的な出来事では、怒りの投稿は喜びより短い間隔で頂点に達した
- 写し方: 悪感情モードでは、**通りですれ違う見知らぬ人どうしの接触を重く、同じ職場の仲間どうしを軽く**する。
  感染症（B2）と逆になる。**同じ街でも、モードによって守る場所が変わる**（感染症は場所、悪感情は通り）
- 扱い: **取り入れる**
- 出典: [Anger is More Influential Than Joy: Sentiment Correlation in Weibo（arXiv）](https://arxiv.org/abs/1309.2402)、
  [Higher contagion and weaker ties mean anger spreads faster than joy（arXiv）](https://arxiv.org/abs/1608.03656)

---

## まとめ: モードごとの「どこで広がるか」

| モード | よく広がる所                         | 守るべき所             | 根拠   |
| ------ | ------------------------------------ | ---------------------- | ------ |
| 感染症 | 長く一緒にいる場所（職場・学校・家） | 場所そのもの           | B2     |
| 噂話   | 人が行き交う場所・顔の広い人         | 広場・駅・人気者       | C1・C3 |
| 悪感情 | 通りですれ違う見知らぬ人どうし       | 通り・交差点           | D1     |

同じ街を使いながら、モードを変えると**守る場所が変わる**。3モードが別の遊びになる。
