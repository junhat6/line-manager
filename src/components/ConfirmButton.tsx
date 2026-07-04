"use client";

import type { ComponentProps } from "react";

type Props = ComponentProps<"button"> & { confirmMessage: string };

/** 送信・削除など取り返しのつかない操作のボタン。確認ダイアログを挟んでからsubmitする */
export function ConfirmButton({ confirmMessage, onClick, ...props }: Props) {
  return (
    <button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
