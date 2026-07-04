"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Server Actionフォーム用の送信ボタン。送信中はスピナー表示+disabledで
 * 多重送信を防ぐ。useFormStatusは祖先のformの状態を読むため、
 * 必ず対象のform要素の内側に置くこと。
 */
export function SubmitButton({
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending || disabled} {...props}>
      {pending && <Spinner data-icon="inline-start" />}
      {children}
    </Button>
  );
}
