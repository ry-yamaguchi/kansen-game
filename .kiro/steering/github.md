---
inclusion: always
---

# GitHub とこのリポジトリ

## 基本情報

| 項目         | 値                                              |
| ------------ | ----------------------------------------------- |
| URL          | https://github.com/ry-yamaguchi/kansen-game     |
| 所有者       | ry-yamaguchi                                    |
| 公開設定     | **public（誰でも見られる）**                    |
| 既定ブランチ | main                                            |
| リモート     | origin（HTTPS）                                 |

`gh` コマンドは `ry-yamaguchi` で認証済みである。追加のログインは要らない。

## 公開リポジトリであることの帰結

- API キー・トークン・個人情報をコミットしない。`.env` は `.gitignore` 済みであり、追跡しない。
- **誤ってコミットしたら、消すだけでは足りない**（履歴に残る）。その場で作者に伝えること。
- README は外から読まれる。内輪のメモは `docs/` に置く。

## ブランチ

ハッカソンなので **main へ直接コミットしてよい**。ブランチを切るのは、壊れる可能性が高い
作り替えのときだけにする。その場合は `feature/<短い名前>` とし、動いたら main へマージする。

## コミット

- author は `meryo <meryo2000@gmail.com>`。このリポジトリの `git config` に設定済みである。
  **グローバル設定は仕事用なので、`--global` を付けて上書きしないこと。**
- メッセージは日本語。`feat:` `fix:` `docs:` `chore:` `refactor:` の接頭辞を付ける。
- `Co-Authored-By` 行は付けない。
- **コミット履歴は書き換えない**（rebase・force push をしない）。
- `git add -A` は避け、触ったファイルを指定する。commit の前に `git status --short` で
  意図しないファイルが混ざっていないか目で見る。

## 遊べる状態が1つ進むたびにコミットする

「人が動く」「感染が広がる」「介入できる」「勝敗が決まる」のように、**遊べる状態が1段進んだら
その都度コミットして push する**。ハッカソンで一番危ないのは、動いたものが手元にしか無い状態である。

```bash
git add <触ったファイル>
git commit -m "feat: 隔離エリアの設置を実装する"
git push origin main
```

## 公開（GitHub Pages）

ブラウザだけで完結する構成なので、ビルド成果物を GitHub Pages に置けば URL で遊べる。
スマートフォンでの確認も、この URL を開くのが一番早い。

必要になったら、次の2つを作者に依頼すること（作者が用意する）。

1. リポジトリ設定で Pages の配信元を「GitHub Actions」にする
2. ビルドして Pages へ上げるワークフロー（`.github/workflows/`）を追加する

Vite を使う場合、Pages はサブパス（`/kansen-game/`）に載るため、`vite.config.ts` に
`base: '/kansen-game/'` が必要になる。**これを入れ忘れると、公開した URL で
アセットが 404 になって画面が真っ白になる。**

## Issue と PR

1人開発なので必須ではない。「あとでやる」を手元から逃がしたいときだけ Issue を立てる。

```bash
gh issue create --title "..." --body "..."
```
