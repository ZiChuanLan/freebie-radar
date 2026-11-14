/**
 * 噪音标题与福利信号的共享规则。
 * 每日精选（digest）与即时推送（push）都用这套，避免同一批垃圾在推送侧漏过去。
 */

/** 仅拦真正无价值的硬噪音（求助/提问/二手买卖/纯社会财经新闻/游戏补丁更新）；不再误杀「降价/黑五/评测/开源盘点」。 */
export const NOISE_TITLE =
  /^(怎样|怎么|如何|哪里|哪个|为什么|为何)|请问|有没有|求推荐|求一个|哪里(有|能)|值得买吗|怎么样\?|不够用|用完了|失效了|吐槽|踩坑|后悔|失望|致歉|股价|油价|冲突|送医|受伤|致\s*\d+\s*死|事故|判刑|被捕|辞职|离任|解散|阵容|转会|投诉|维权|跌破|市值|财报|营收|裁员|上市|万元|车型|受访|工作组|新规|研究表明|报告显示|调查显示|统计显示|谁有|求个|求购|哪有|哪里有|多少钱|求助|求带|大佬|老哥|有人吗|有人知道|怎么弄|能白嫖吗|免费更新|内容更新|版本更新|免费升级|更新公告|更新补丁|补丁说明|patch\s*notes|free\s+update/i;

/** 仅用于纯白嫖严格模式下排除资讯/测评/普通涨降价（不作为全局入口拦截）。 */
export const NON_FREEBIE_HINT =
  /盘点|评测|测评|涨价|降价|权益价|发布会|宣布|组建|规划|白皮书|开发者大会/i;

/** 真正的白嫖福利信号（含「报名领/领积分/算力/代金券」等活动）。 */
export const DEAL_HINT =
  /免费|领取|报名领|领积分|领额度|赠送|白嫖|白送|白给|零元|0\.01|试用|体验金|兑换|激活码|注册送|限时|开放注册|额度|代金券|算力券|抵扣券|学生包|公测|内测|礼包|优惠券|包邮|:free\b|(?:领|送)\s*\d+\s*(?:积分|算力|额度|tokens?|天|元|刀|美元)|giveaway|coupon|free|credits|tokens/i;

/** 特价/黑五/史低/VPS 优惠信号。 */
export const PROMO_HINT =
  /黑五|black\s*friday|cyber\s*monday|双十一|双11|618|周年庆|特价|特惠|促销|折扣|史低|最低价|优惠码|promo\s*code|年付|月付|折上折|\d+\s*折|%\s*off|clearance|flash\s*sale|\$\d+(?:\.\d+)?\/(?:yr|year|mo|month)|[¥￥]\d+|拼车|合租|车位|发车|明盘|出鸡|转让|\b(?:vps|kvm|nat)\b.*(?:优惠|特价|折扣|促销|年付|\$\d)/i;

/** 开源项目/自托管工具信号。 */
export const OPENSOURCE_HINT =
  /开源|open\s*source|opensource|github\.com|gitlab\.com|self-?host(?:ed)?|自托管|自建服务|mit\s*协议|apache\s*协议|gpl|开源项目|开源工具|开源软件|开源库|\bv\d+\.\d+\.\d+\b/i;

/** 泛资讯源进 AI 一审前的超宽松触发门禁：覆盖白嫖、特价促销与开源项目。 */
export const WIDE_AI_TRIGGER =
  /免费|白嫖|限免|喜加一|赠送|送|领|白送|白给|抽奖|兑换|激活|邀请|体验|试用|优惠|特价|促销|折扣|黑五|史低|年付|代金券|算力|积分|额度|token|credits|:free\b|0元|零元|0\.01|\bfree\b|giveaway|coupon|promo|black\s*friday|开源|open\s*source|github|self-?host/i;

/** 综合判断一条内容是否具备任一兴趣频道的价值信号（白嫖 / 好价 / 开源）。 */
export function hasValueSignal(title: string, kind?: string | null): boolean {
  if (kind === "deal") return PROMO_HINT.test(title) || DEAL_HINT.test(title);
  if (kind === "opensource") return OPENSOURCE_HINT.test(title) || DEAL_HINT.test(title);
  if (kind === "info") return !NOISE_TITLE.test(title);
  return DEAL_HINT.test(title) || PROMO_HINT.test(title) || OPENSOURCE_HINT.test(title);
}

/** 手慢无的信号：命中就值得立刻推，不等攒批。 */
export const URGENT =
  /先到先得|手慢无|名额有限|限量\s*\d|还剩\s*\d|仅剩|库存告急|cdk|cdkey|兑换码|激活码|邀请码|免费领|白嫖|送码|送\s*\d+\s*(?:个|份|张|枚|次)|送体验金|送额度|赠送\s*\d|抽\s*\d+\s*份|限时免费|限免/;
