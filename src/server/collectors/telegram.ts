import { cleanText, parseDate } from "../enrich/normalize.ts";
import { flaresolverrGet, hasFlare } from "../flaresolverr.ts";
import type { Collector, RawItem } from "./types.ts";

function stripTags(html: string): string {
  return cleanText(html.replace(/<br\s*\/?>/gi, "\n"), 400);
}

type Message = { postId: string; text: string; datetime: string | null };

function parseChannelPage(html: string): Message[] {
  const out: Message[] = [];
  const blocks = html.split('class="tgme_widget_message_wrap');
  for (const block of blocks.slice(1)) {
    const idMatch = /data-post="([^"/]+)\/(\d+)"/.exec(block);
    if (!idMatch) continue;
    const textMatch = /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    const timeMatch = /<time[^>]*datetime="([^"]+)"/.exec(block);
    if (!textMatch) continue;
    out.push({
      postId: idMatch[2] ?? "",
      text: stripTags(textMatch[1] ?? ""),
      datetime: timeMatch?.[1] ?? null,
    });
  }
  return out;
}

export const telegramCollector: Collector = {
  kind: "telegram",
  label: "Telegram 频道",
  defaults: { config: { channels: [] } },
  async collect(ctx) {
    const channels = (ctx.config.channels as string[] | undefined) ?? [];
    if (!channels.length) throw new Error("未配置 channels");

    const items: RawItem[] = [];
    const problems: string[] = [];
    let ok = 0;

    for (const channel of channels) {
      const url = "https://t.me/s/" + channel;
      try {
        // t.me 的公开预览页直连即可；只有直连解析不到时才降级到 FlareSolverr。
        // 之前无条件走 FlareSolverr，拿回的是人机校验页，解析永远是 0 条。
        let body = "";
        const direct = await ctx.http.text(url).catch(() => null);
        if (direct && direct.status === 200) body = direct.body;
        let messages = body ? parseChannelPage(body).slice(-30) : [];
        if (!messages.length && hasFlare()) {
          const res = await flaresolverrGet(url);
          if (res.status === 200) {
            body = res.body;
            messages = parseChannelPage(body).slice(-30);
          }
        }
        if (!messages.length) throw new Error("页面解析不到消息（频道不存在或页面结构变化）");

        ctx.log(channel + " parsed " + messages.length + " messages");
        ok += 1;
        for (const m of messages) {
          if (!m.text) continue;
          const firstLine = m.text.split("\n")[0] ?? m.text;
          items.push({
            externalId: channel + "/" + m.postId,
            url: url + "/" + m.postId,
            title: firstLine.slice(0, 180),
            summary: m.text.slice(0, 400),
            content: m.text,
            author: channel,
            publishedAt: parseDate(m.datetime),
            tags: ["telegram", channel],
            raw: { channel, postId: m.postId },
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        problems.push(channel + ": " + message);
        ctx.log(channel + " FAILED " + message);
      }
    }

    if (!ok && problems.length) throw new Error("全部频道失败: " + problems.join("; "));

    return {
      items: items.slice(0, ctx.maxItems),
      cursor: null,
      degraded: problems.length ? problems.join("; ") : null,
    };
  },
};
