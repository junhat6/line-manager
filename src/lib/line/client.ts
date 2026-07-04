import { messagingApi } from "@line/bot-sdk";
import { getLineChannel } from "./channels";

const clients = new Map<number, messagingApi.MessagingApiClient>();

export function getLineClient(channel = 1): messagingApi.MessagingApiClient {
  let client = clients.get(channel);
  if (!client) {
    client = new messagingApi.MessagingApiClient({
      channelAccessToken: getLineChannel(channel).accessToken,
    });
    clients.set(channel, client);
  }
  return client;
}

/** LINEへのpush送信。グループ宛はグループ人数分が月間メッセージ数にカウントされる点に注意 */
export async function pushMessages(
  to: string,
  messages: messagingApi.Message[],
  channel = 1,
): Promise<void> {
  await getLineClient(channel).pushMessage({ to, messages });
}
