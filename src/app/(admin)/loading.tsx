import { Skeleton } from "@/components/ui/skeleton";

/**
 * 管理画面共通のローディングUI。全ページforce-dynamicでDB往復を待つため、
 * 遷移直後に骨組みを即表示して「反応していない」ように見える空白をなくす。
 */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-8 w-36" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    </div>
  );
}
