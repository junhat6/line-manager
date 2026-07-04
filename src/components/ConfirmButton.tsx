"use client";

import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type ButtonProps = ComponentProps<typeof Button>;

type Props = {
  confirmMessage: string;
  /** ダイアログ側の実行ボタンのラベル。省略時は「実行する」 */
  actionLabel?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  "aria-label"?: string;
  children: ReactNode;
};

/**
 * 送信・削除など取り返しのつかない操作のボタン。AlertDialogで確認を挟んでから
 * 親フォームをsubmitする。ダイアログ本体はポータルでフォーム外に描画されるため、
 * トリガーボタンの form 参照経由で requestSubmit() する。
 */
export function ConfirmButton({
  confirmMessage,
  actionLabel = "実行する",
  variant = "outline",
  size = "sm",
  className,
  children,
  ...rest
}: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 確認後にsubmitされる親フォームの送信状態。送信中はトリガーを
  // スピナー化して「押せたのに何も起きない」空白時間をなくす
  const { pending } = useFormStatus();
  const isIconButton = size?.startsWith("icon") ?? false;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            ref={triggerRef}
            type="button"
            variant={variant}
            size={size}
            className={className}
            disabled={pending}
            {...rest}
          >
            {pending ? (
              <>
                <Spinner data-icon={isIconButton ? undefined : "inline-start"} />
                {!isIconButton && children}
              </>
            ) : (
              children
            )}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確認</AlertDialogTitle>
          <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={() => {
              setOpen(false);
              triggerRef.current?.form?.requestSubmit();
            }}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
