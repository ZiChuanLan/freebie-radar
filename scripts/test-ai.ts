import { config, aiEnabled } from "../src/server/config.ts";
import { reviewItems } from "../src/server/enrich/ai.ts";

const samples = [
  { title: "88% 受访开发者点头赞成：FreeBSD 组建工作组制定 AI 使用新规", summary: "FreeBSD 基金会宣布成立工作组……" },
  { title: "谁有ovh 年付10%优惠券哇", summary: "想续费，求个优惠券" },
  { title: "Super Duolingo两个月会员", summary: "免费领取两个月 Super Duolingo 会员" },
  { title: "【福利】送五个500M动态IP测试，先到先得", summary: "回复即可，先到先得" },
  { title: "限时白嫖！Epic额外隐藏免费游戏，截止11月3日", summary: "Epic 商店隐藏免费游戏" },
  { title: "四门“糯玉米”：长安 Lumin PLUS 上市，限时权益价 4.99 万元起", summary: "新车上市" },
  { title: "网易云音乐免费领取会员 7 天，需要自取", summary: "打开 App 领取" },
  { title: "【富可敌国】SevenAI｜双11福利大放送，回帖最高得7$体验金", summary: "回帖送体验金" },
];

if (!aiEnabled) {
  console.log("AI 未启用：缺少 AI_BASE_URL 或 AI_MODEL");
  process.exit(1);
}
console.log("模型:", config.aiModel, "端点:", config.aiBaseUrl);
const t0 = Date.now();
const map = await reviewItems(samples as never);
const cost = Date.now() - t0;
if (!map) {
  console.log("AI 调用失败");
  process.exit(1);
}
console.log("耗时", cost, "ms，返回", map.size, "条\n");
for (let i = 0; i < samples.length; i += 1) {
  const v = map.get(i);
  const mark = v?.keep ? "KEEP  " : "REJECT";
  console.log(mark, "|", (samples[i]!.title || "").slice(0, 40).padEnd(42), "|", v?.category ?? "-", "|", v?.reason ?? "（无结论）");
}
