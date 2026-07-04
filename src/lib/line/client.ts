import { messagingApi } from "@line/bot-sdk";
import { getEnv } from "@/lib/env";

let client: messagingApi.MessagingApiClient | undefined;

export function getLineClient(): messagingApi.MessagingApiClient {
  client ??= new messagingApi.MessagingApiClient({
    channelAccessToken: getEnv().LINE_CHANNEL_ACCESS_TOKEN,
  });
  return client;
}

/** LINEへのpush送信。グループ宛はグループ人数分が月間メッセージ数にカウントされる点に注意 */
export async function pushMessages(
  to: string,
  messages: messagingApi.Message[],
): Promise<void> {
  await getLineClient().pushMessage({ to, messages });
}
