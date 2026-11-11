/** 从标题/正文里抽取兑换码、邀请码一类可直接使用的凭据。 */

const EXPLICIT = /(?:邀请码|兑换码|激活码|优惠码|注册码|礼品码|口令|code|invite\s*code)[\s:：是]{0,4}([A-Za-z0-9][A-Za-z0-9_\-]{3,39})/gi;
const DASHED = /\b([A-Z0-9]{4}(?:-[A-Z0-9]{4}){2,5})\b/g;
const LONG_UPPER = /\b([A-Z0-9]{10,40})\b/g;
const URLISH = /^(?:https?|www|linux|topic|app|store|game)/i;
const STOP = new Set([
  "FREE", "WINNER", "HTTP", "HTTPS", "HTML", "NULL", "TRUE", "FALSE", "LOGIN", "REGISTER",
  "STEAM", "EPIC", "GAMES", "GIVEAWAY", "BONUS", "COUPON", "WELCOME", "SUPPORT", "ACCOUNT",
  "DOWNLOAD", "PASSWORD", "USERNAME", "VERIFY", "PLEASE", "THANKS", "UPDATE", "VERSION",
]);

function plausible(code: string): boolean {
  if (code.length < 4 || code.length > 40) return false;
  if (STOP.has(code.toUpperCase())) return false;
  if (URLISH.test(code)) return false;
  if (/^\d+$/.test(code)) return false; // 纯数字多半是价格或数量
  // 至少含一个字母
  if (!/[A-Za-z]/.test(code)) return false;
  return true;
}

/**
 * 返回去重后的凭据列表（最多 limit 个）。
 * 只认三类：显式标注（邀请码/兑换码…）、带连字符的分段码、超长大写串。
 */
export function extractCodes(title: string, content: string | null | undefined, limit = 6): string[] {
  const text = title + " " + (content ?? "");
  const found: string[] = [];
  const push = (c: string | undefined) => {
    const v = (c ?? "").trim().replace(/[.,;:)]}"']+$/, "");
    if (plausible(v) && !found.includes(v)) found.push(v);
  };

  for (const m of text.matchAll(EXPLICIT)) push(m[1]);
  for (const m of text.matchAll(DASHED)) push(m[1]);
  for (const m of text.matchAll(LONG_UPPER)) push(m[1]);

  return found.slice(0, limit);
}

/** 标题里出现这些词说明「名额有限、去晚就没」，值得立即推送。 */
export const URGENT = /先到先得|名额|限量|限时|手慢无|抢|cdk|cdkey|兑换码|邀请码|激活码|白嫖|送|还剩|最后/;
