"use client";

import type { ComponentProps } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/contracts/forms";

type Props = Omit<ComponentProps<"form">, "action"> & {
  /**
   * ActionResultを返すServer Action。成功時にredirectするactionも渡せる
   * (その場合は結果が届かないためトーストは出ず、画面遷移が完了の合図になる)
   */
  action: (formData: FormData) => Promise<ActionResult>;
};

/**
 * 送信結果をトーストで通知するフォーム。
 * useEffect+useActionStateではなくaction内で直接toastを呼ぶ:
 * 参加者削除のように「成功するとフォーム自身がrevalidateで消える」ケースでは、
 * effectが走る前にアンマウントされてトーストが失われるため。
 * sonnerのtoast()はコンポーネント外部のストア更新なのでアンマウント後も安全。
 * 送信中の表示は中に置くSubmitButton/ConfirmButtonが担当する(useFormStatus)。
 */
export function ToastForm({ action, ...props }: Props) {
  return (
    <form
      action={async (formData: FormData) => {
        const result = await action(formData);
        // redirectするactionは結果が返らずここに到達しないことがある
        if (!result) return;
        if (result.ok) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
      }}
      {...props}
    />
  );
}
