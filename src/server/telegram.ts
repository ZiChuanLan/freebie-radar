import { config } from "./config.ts";

export async function sendTelegram(text: string): Promise<void> {
  const base = config.telegramApiBase.replace(/\/+$/, "");
  const url = base + "/bot" + config.telegramBotToken + "/sendMessage";
  // CF 版：TELEGRAM_PROXY 不再生效（Workers 无出口代理），TG API 从边缘直连即可
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error("Telegram HTTP " + res.status + " " + (await res.text()).slice(0, 150));
}
