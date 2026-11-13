import {
  aiReady,
  DEFAULT_PROMPT,
  feedbackStats,
  getAiSettings,
  matchesEntryNoise,
  publicAiSettings,
  reviewItems,
  saveAiSettings,
  shouldPassSourceToAi,
  testAiConnection,
  type AiSettings,
  type AiSourceMode,
  type AiVerdict,
} from "./ai-settings.ts";

export type { AiVerdict, AiSettings, AiSourceMode };
export {
  reviewItems,
  aiReady,
  getAiSettings,
  saveAiSettings,
  publicAiSettings,
  testAiConnection,
  feedbackStats,
  matchesEntryNoise,
  shouldPassSourceToAi,
  DEFAULT_PROMPT,
};

/** 采集器调用：是否该送审（读数据库里的开关，改配置立即生效）。 */
export function shouldReview(): boolean {
  return aiReady();
}
