import { normalizeAiProtocol, type AiProtocol } from "../../../shared/ai-protocol.ts";
import { t } from "../lib/i18n.ts";

/** 与服务端共用协议取值；空值保持旧配置的调用方式。 */
export function AiProtocolField({ value, onChange }: {
  value?: AiProtocol;
  onChange: (protocol: AiProtocol) => void;
}) {
  return (
    <label className="block sm:col-span-3">
      <span className="mb-1 block text-[12px] font-medium text-ink-700">{t("协议类型")}</span>
      <select
        value={normalizeAiProtocol(value)}
        onChange={(e) => onChange(normalizeAiProtocol(e.target.value))}
        className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12px] text-ink-900 outline-none focus:border-brand"
      >
        <option value="">{t("默认（Chat Completions）")}</option>
        <option value="response">Responses</option>
      </select>
      <span className="mt-1 block text-[11px] text-ink-500">
        {t("留空沿用 /chat/completions；选择 Responses 使用 /responses。基础地址保留 /v1，不含接口路径。")}
      </span>
    </label>
  );
}
