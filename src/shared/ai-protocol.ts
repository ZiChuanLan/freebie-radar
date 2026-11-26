/** AI 协议类型：空字符串沿用 Chat Completions；response 使用 Responses。 */
export type AiProtocol = "" | "response";

/** 缺省配置兼容旧版本；仅显式选择 response 时切换协议。 */
export function normalizeAiProtocol(value: unknown): AiProtocol {
  return value === "response" ? "response" : "";
}
