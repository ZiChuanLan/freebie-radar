import { config, pushEnabled } from "../config.ts";
import { all, get, run } from "../db.ts";
import type { RawItem } from "../collectors/types.ts";
import {
  aiReady,
  DEFAULT_PROMPT,
  getAiSettings,
  publicAiSettings,
  reviewItems,
  saveAiSettings,
  testAiConnection,
  type AiSettings,
  type AiVerdict,
} from "./ai-settings.ts";

export type { AiVerdict, AiSettings };
export { reviewItems, aiReady, getAiSettings };

/** 采集器调用：是否该送审（读数据库里的开关，改配置立即生效）。 */
export function shouldReview(): boolean {
  return aiReady();
}
