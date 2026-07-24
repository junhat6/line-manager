---
name: manual-sync
description: 直近の機能追加コミットと docs/manual.md を突き合わせ、未反映の記述を検出してドラフトを提案する
disable-model-invocation: true
---

# manual-sync

`docs/manual.md` は運営マニュアル本体で、管理画面の `/p/docs` から `splitManualSections`(`src/lib/manual.ts`)により `##` 見出し単位の章に分割されて表示される(`src/components/manual-sections.tsx`)。
過去に機能追加後の反映漏れが実際に発生している(コミット `ebf9267` 「運営マニュアルに未反映だった機能追加を反映」)。このスキルはその再発を防ぐ。

## 手順

1. `docs/manual.md` の最終更新コミットを特定する:
   `git log -1 --format=%H -- docs/manual.md`
2. そのコミット以降に、ユーザー向け挙動へ影響しうる変更が入っていないか調べる:
   `git log --oneline <上記ハッシュ>..HEAD -- src/app src/lib src/components src/contracts src/db/schema.ts`
   マージコミットやテスト/リファクタのみのコミットは対象外。「新しい設定項目」「自動化フローの追加・変更」「管理画面の操作手順が変わる変更」を拾う。
3. 気になるコミットごとに `git show <hash>` で内容を確認し、それが運営者の操作手順・自動化フローに影響するか判断する。
4. 影響ありと判断したものについて、`docs/manual.md` の該当章を特定し、追記・修正のドラフトを提示する。章立ては変わりうるので決め打ちせず、まず `docs/manual.md` を実際に読んで現在の構成を把握すること。
5. 既存の文体(見出しは `##`、💡のTip、症状/対処の表形式、「⚙️」などの記号の使い方)に合わせてドラフトを書く。プレースホルダーではなく実際に読める日本語の文章にする。
6. 最後に差分をユーザーに提示してレビューさせる。**確認なしに `docs/manual.md` を直接コミットしない。**

## 対象外

- タイポ修正やコードコメントのみの変更
- 内部実装のリファクタで運営者から見た挙動が変わらないもの
- テストのみの変更
