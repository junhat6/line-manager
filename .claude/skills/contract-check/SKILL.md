---
name: contract-check
description: src/contracts/ 配下の型・スキーマ変更が実装層・呼び出し側・テストに漏れなく波及しているかを確認する
---

# contract-check

このプロジェクトは契約層(`src/contracts/`)と実装層を分離する設計を採る:

- `src/contracts/messages.ts` — メッセージ種別(`MessageKind`)の唯一の定義元。ラベルと手動/自動区分もここで一元管理。
- `src/contracts/forms.ts` — Server Action入力のzodスキーマ。UIと`actions.ts`の両方が依存する。
- `src/contracts/templates.ts` — LINEメッセージテンプレートの変数契約(「テンプレート実装はこの型だけに依存し、DBの形を知らない」とファイル冒頭に明記)。

契約を変更すると複数の実装側が追従を要求される。このスキルは変更が漏れなく波及しているかを確認する。

## 手順

1. `git diff`(またはユーザー指定の範囲)で `src/contracts/*.ts` の変更点を特定する。
2. 変更されたエクスポート(型・定数・スキーマ)ごとに、以下の既知の消費者を `grep -rn "<識別子>" src` で洗い出し、実際に更新が必要か確認する:

   | 契約 | 既知の消費者 |
   |---|---|
   | `MESSAGE_KINDS` / `MessageKind` | `src/lib/templates.ts`(テンプレート実装)、`src/lib/send.ts`、`src/lib/checklist.ts`、`src/lib/poll-time-options.ts`、`src/db/schema.ts`(`scheduled_messages.kind` のenum)、対応する `*.test.ts` |
   | `MESSAGE_KIND_LABELS` / `MESSAGE_KIND_TRIGGER` | 上記に加えチェックリスト表示コンポーネント(UI側) |
   | `src/contracts/forms.ts` のスキーマ | `src/app/actions.ts`(Server Action本体)、`src/components/ToastForm.tsx`、対応するテスト |
   | `src/contracts/templates.ts` の `*Input` 型 | `src/lib/templates.ts` 内の対応するテンプレート関数 |

3. 新しい `MessageKind` を追加する変更の場合は特に、DBスキーマ側(`src/db/schema.ts` のenum、必要ならマイグレーション)まで一気通貫で追従しているか確認する。追従していなければ `/create-migration` スキルの利用を促す。
4. テストが契約の変更を検証できているか確認する(新しいkindやフィールドに対するケースが `*.test.ts` に存在するか)。
5. 漏れを指摘するだけでなく、具体的にどのファイルのどこを直すべきかを列挙して報告する。

## 対象外

- 契約層に触れないアプリケーションロジックのみの変更
- `src/contracts/` 内のコメント・型定義の意味を変えないリファクタ
