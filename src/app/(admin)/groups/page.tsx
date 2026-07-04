import { asc } from "drizzle-orm";
import { UsersIcon } from "lucide-react";
import { setGroupKind } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/db/client";
import { lineGroups } from "@/db/schema";
import { formatJstDateTimeLabel } from "@/lib/jst";

export const dynamic = "force-dynamic";

const KIND_ITEMS = [
  { value: "main", label: "メイン" },
  { value: "session", label: "日程別" },
  { value: "unknown", label: "未分類" },
] as const;

export default async function GroupsPage() {
  const db = getDb();
  const rows = await db
    .select()
    .from(lineGroups)
    .orderBy(asc(lineGroups.joinedAt));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">LINEグループ</h1>
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          ボットをLINEグループに招待すると、ここに自動で表示されます。
          全体アナウンス用のグループを1つ「メイン」に設定してください。
          日程別グループは、イベント詳細ページで日程に紐付けます。
        </p>
      </div>

      {rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>まだグループがありません</EmptyTitle>
            <EmptyDescription>
              LINEアプリでボットをグループに招待してください。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>グループ名</TableHead>
                  <TableHead>役割</TableHead>
                  <TableHead>チャネル</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead>参加日時</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((group) => (
                  <TableRow key={group.id}>
                    <TableCell>
                      {group.name ?? (
                        <span className="text-muted-foreground">
                          (名前未取得)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <form
                        action={setGroupKind}
                        className="flex items-center gap-2"
                      >
                        <input type="hidden" name="id" value={group.id} />
                        <Select
                          name="kind"
                          defaultValue={group.kind}
                          items={KIND_ITEMS}
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`${group.name ?? group.lineGroupId} の役割`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {KIND_ITEMS.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {item.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <SubmitButton variant="outline" size="sm">
                          変更
                        </SubmitButton>
                      </form>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* joinイベントで自動記録。実態(どのボットが居るか)とズレないよう手動変更UIは設けない */}
                      {group.channel}
                    </TableCell>
                    <TableCell>
                      {group.active ? (
                        <Badge variant="outline">参加中</Badge>
                      ) : (
                        <Badge variant="secondary">退出済み</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatJstDateTimeLabel(group.joinedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
