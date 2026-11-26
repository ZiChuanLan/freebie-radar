import { normalizeAiProtocol, type AiProtocol } from "../../shared/ai-protocol.ts";

type AiConnection = {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol?: AiProtocol;
};

type AiRequestOptions = {
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  errorLabel?: string;
  errorPreviewLength?: number;
};

type AiTextResponse = {
  choices?: { message?: { content?: string } }[];
  status?: string;
  error?: { message?: string };
  output?: {
    type?: string;
    content?: { type?: string; text?: string }[];
  }[];
};

/** 统一协议请求与文本提取；超时、重试和业务 JSON 校验仍由调用方控制。 */
export async function requestAiText(
  connection: AiConnection,
  prompts: { system: string; user: string },
  options: AiRequestOptions,
): Promise<{ content: string; ttfbMs: number }> {
  const responses = normalizeAiProtocol(connection.protocol) === "response";
  const endpoint = connection.baseUrl.replace(/\/+$/, "") + (responses ? "/responses" : "/chat/completions");
  const body = responses
    ? {
        model: connection.model,
        instructions: prompts.system,
        input: prompts.user,
        stream: false,
        store: false,
      }
    : {
        model: connection.model,
        temperature: 0,
        messages: [
          { role: "system", content: prompts.system },
          { role: "user", content: prompts.user },
        ],
      };
  // Responses 使用模型默认采样参数，兼容不支持 temperature 的模型。
  const startedAt = Date.now();
  const res = await (options.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(connection.apiKey ? { authorization: "Bearer " + connection.apiKey } : {}),
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const ttfbMs = Date.now() - startedAt;
  const errorLabel = options.errorLabel ?? "AI";
  if (!res.ok) {
    throw new Error(`${errorLabel} HTTP ${res.status} ${(await res.text()).slice(0, options.errorPreviewLength ?? 120)}`);
  }
  const data = (await res.json()) as AiTextResponse;
  if (!responses) return { content: data.choices?.[0]?.message?.content ?? "", ttfbMs };
  if (data.status && data.status !== "completed") {
    throw new Error(`${errorLabel} Responses ${data.status}: ${data.error?.message ?? "响应未完成"}`);
  }
  // 只取 message 中的 output_text，跳过推理与工具输出，不把未完成结果当审核结论。
  const content = (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return { content, ttfbMs };
}
