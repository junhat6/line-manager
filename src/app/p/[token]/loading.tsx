import { Skeleton } from "@/components/ui/skeleton";

/** LINEアプリ内ブラウザで開かれる公開ページ用。回線が遅くても即座に反応を見せる */
export default function PublicStatusLoading() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-5 py-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </main>
  );
}
