import { getLineChannels } from "./channels";
import { getLineClient } from "./client";

export type ChannelQuota =
  | { channel: number; ok: true; totalUsage: number; limit: number | null }
  | { channel: number; ok: false; error: string };

/**
 * 全チャネルの当月メッセージ消費量と上限を取得する(設定ページの表示用)。
 * チャネル単位で try/catch し、一部の失敗が他チャネルの表示や送信経路に
 * 影響しないようにする。limit が null のときは上限なしプラン。
 */
export async function getChannelQuotas(): Promise<ChannelQuota[]> {
  const channels = [...getLineChannels().keys()].sort((a, b) => a - b);
  return Promise.all(
    channels.map(async (channel): Promise<ChannelQuota> => {
      try {
        const client = getLineClient(channel);
        const [quota, consumption] = await Promise.all([
          client.getMessageQuota(),
          client.getMessageQuotaConsumption(),
        ]);
        return {
          channel,
          ok: true,
          totalUsage: consumption.totalUsage,
          limit: quota.type === "limited" ? (quota.value ?? null) : null,
        };
      } catch (e) {
        return {
          channel,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}
