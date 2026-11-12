import { config } from "./config.ts";

export async function sendTelegram(text: string): Promise<void> {
  const base = config.telegramApiBase.replace(/\/+$/, "");
  const url = base + "/bot" + config.telegramBotToken + "/sendMessage";
  const init: RequestInit & { dispatcher?: unknown } = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  };
  if (config.telegramProxy) {
    const { ProxyAgent } = await import("undici");
    init.dispatcher = new ProxyAgent(config.telegramProxy);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error("Telegram HTTP " + res.status + " " + (await res.text()).slice(0, 150));
}
