import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Filter,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { CATEGORY_LABEL, OBTAIN_LABEL } from "../lib/sources.ts";
import { KIND_LABEL } from "../lib/sources.ts";
import type { AiPayload, AiSettings, AiSourceMode, Source } from "../types.ts";

type TestResult = {
  ok: boolean;
  ms: number;
  model: string;
  results: {
    title: string;
    keep: boolean;
    category: string;
    kind?: string;
    obtain?: string;
    quality?: number | null;
    reason: string;
  }[];
  error?: string;
};

type BackfillMode = "pending" | "recent" | "rejected";

function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-ink-200 bg-surface-hover px-3.5 py-2.5 text-left transition-colors hover:border-ink-300"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink-900">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug break-words text-ink-500">{hint}</div>}
      </div>
      <span
        className={
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors " +
          (value ? "bg-brand" : "bg-ink-300")
        }
      >
        <span
          className={
            "inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform " +
            (value ? "translate-x-4.5" : "translate-x-0.5")
          }
        />
      </span>
    </button>
  );
}

export function AiPanel({
  data,
  sources,
  reload,
  onNotify,
}: {
  data: AiPayload | null;
  sources: Source[];
  reload: () => void;
  onNotify?: (msg: string) => void;
}) {
  const [form, setForm] = useState<AiSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [backfillMode, setBackfillMode] = useState<BackfillMode>("pending");
  const [backfillLimit, setBackfillLimit] = useState(200);
  const [backfill, setBackfill] = useState<{
    reviewed: number;
    rejected: number;
    scanned: number;
    mode?: BackfillMode;
    error?: string;
  } | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showSamples, setShowSamples] = useState(false);
  const [noiseInput, setNoiseInput] = useState("");

  useEffect(() => {
    if (data?.settings && !form) setForm({ ...data.settings });
  }, [data, form]);

  useEffect(() => {
    if (!data?.settings) return;
    setForm((prev) =>
      prev
        ? {
            ...prev,
            enabled: data.settings.enabled,
            learnFromFeedback: data.settings.learnFromFeedback,
            preFilterEnabled: data.settings.preFilterEnabled,
            skipFreebieSources: data.settings.skipFreebieSources,
            sourceMode: data.settings.sourceMode,
            sourceIds: data.settings.sourceIds,
            customNoiseKeywords: data.settings.customNoiseKeywords,
          }
        : prev,
    );
  }, [
    data?.settings?.enabled,
    data?.settings?.learnFromFeedback,
    data?.settings?.preFilterEnabled,
    data?.settings?.skipFreebieSources,
    data?.settings?.sourceMode,
    data?.settings?.sourceIds,
    data?.settings?.customNoiseKeywords,
  ]);

  if (!data || !form) {
    return <div className="panel p-6 text-[13px] text-ink-500">正在读取 AI 配置…</div>;
  }

  const s = data.settings;
  const st = data.stats;
  const total = st.kept + st.rejected + st.pending;
  const keptPct = total ? Math.round((st.kept / total) * 100) : 0;
  const enabledSources = sources.filter((src) => src.enabled);

  async function save(patch: Partial<AiSettings>, toastText = "AI 配置已保存") {
    setSaving(true);
    try {
      const r = await fetch("/api/ai", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (r.ok) {
        const j = (await r.json()) as AiPayload;
        setForm({ ...j.settings });
        reload();
        onNotify?.(toastText);
      } else {
        onNotify?.("保存失败");
      }
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const draft: Partial<AiSettings> = {
        baseUrl: form?.baseUrl ?? "",
        model: form?.model ?? "",
        apiKey: (form?.apiKey ?? "").startsWith("••••") ? "" : (form?.apiKey ?? ""),
        timeoutSec: form?.timeoutSec,
        extraPrompt: form?.extraPrompt,
        systemPrompt: form?.systemPrompt,
        learnFromFeedback: form?.learnFromFeedback,
        feedbackLimit: form?.feedbackLimit,
      };
      const r = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      setTest((await r.json()) as TestResult);
    } finally {
      setTesting(false);
    }
  }

  async function runBackfill() {
    setBackfilling(true);
    setBackfill(null);
    try {
      const r = await fetch("/api/ai/backfill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: backfillLimit, mode: backfillMode }),
      });
      setBackfill((await r.json()) as typeof backfill);
      reload();
    } finally {
      setBackfilling(false);
    }
  }

  async function runReclassify() {
    setReclassifying(true);
    try {
      const r = await fetch("/api/ai/reclassify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "other" }),
      });
      const j = (await r.json()) as { scanned: number; updated: number; movedFromOther: number };
      reload();
      onNotify?.(`已扫描 ${j.scanned} 条「其它」，成功归类 ${j.movedFromOther} 条（零 Token）`);
    } finally {
      setReclassifying(false);
    }
  }

  const addNoiseKeyword = () => {
    const kw = noiseInput.trim();
    if (!kw) return;
    if (form.customNoiseKeywords.includes(kw)) {
      setNoiseInput("");
      return;
    }
    const next = [...form.customNoiseKeywords, kw];
    setForm({ ...form, customNoiseKeywords: next });
    setNoiseInput("");
    void save({ customNoiseKeywords: next }, `已添加入口拦截词「${kw}」`);
  };

  const removeNoiseKeyword = (kw: string) => {
    const next = form.customNoiseKeywords.filter((x) => x !== kw);
    setForm({ ...form, customNoiseKeywords: next });
    void save({ customNoiseKeywords: next }, `已移除「${kw}」`);
  };

  const toggleSourceId = (id: string) => {
    const next = form.sourceIds.includes(id)
      ? form.sourceIds.filter((x) => x !== id)
      : [...form.sourceIds, id];
    setForm({ ...form, sourceIds: next });
    void save({ sourceIds: next });
  };

  const canTest = Boolean(form.baseUrl.trim() && form.model.trim());

  return (
    <div className="space-y-4">
      {/* 1. 状态与测试/补审工具 */}
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Bot size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink-900">AI 语义审核引擎</h2>
              {s.ready ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-deal-subtle px-1.5 py-0.5 text-[11px] font-medium text-deal">
                  <CircleCheck size={11} /> 运行中
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  <AlertTriangle size={11} /> 未启用
                </span>
              )}
              {st.queue && (
                <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">
                  异步队列：{st.queue.queued} 待审{st.queue.running ? "（运行中）" : ""} · 已处理 {st.queue.processed}
                  {st.queue.dropped > 0 ? ` · 丢弃 ${st.queue.dropped}` : ""}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {s.baseUrl ? s.model + " @ " + s.baseUrl.replace(/^https?:\/\//, "") : "还没有配置端点"}
              {s.hasKey ? " · Key " + s.keyHint : " · 未设置 Key"}
              {" · 推送前等待/极速抢码时机请到「推送规则」设置"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={runTest}
              disabled={testing || !canTest}
              title="直接用下方表单的端点、模型与提示词草稿发起测试"
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
              测试草稿配置
            </button>
          </div>
        </div>

        {/* 补审 / 重审工具条 */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-200 bg-surface-hover px-3.5 py-2.5">
          <div className="text-[12px] text-ink-700">
            <span className="font-medium text-ink-900">历史库补审 / 重审：</span>
            改完补充规则或提示词后，可立即拿历史条目复审验证
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={backfillMode}
              onChange={(e) => setBackfillMode(e.target.value as BackfillMode)}
              className="rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[12px] text-ink-800 outline-none focus:border-brand"
            >
              <option value="pending">仅审未审条目 (pending)</option>
              <option value="recent">重审近期已入库 (校准分类/评分)</option>
              <option value="rejected">复核已被 AI 拦截 (防误杀)</option>
            </select>
            <select
              value={backfillLimit}
              onChange={(e) => setBackfillLimit(Number(e.target.value))}
              className="rounded-lg border border-ink-200 bg-surface px-2 py-1 font-mono text-[12px] text-ink-800 outline-none focus:border-brand"
            >
              <option value={50}>50 条</option>
              <option value={200}>200 条</option>
              <option value={500}>500 条</option>
            </select>
            <button
              type="button"
              onClick={runBackfill}
              disabled={backfilling || !s.ready}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1 text-[12px] font-medium text-white hover:bg-brand-hover disabled:opacity-50"
            >
              {backfilling ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
              立即执行
            </button>

            <button
              type="button"
              onClick={runReclassify}
              disabled={reclassifying}
              title="按最新关键词规则零 Token 重算历史「其它」分类"
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
            >
              {reclassifying ? <Loader2 size={12} className="animate-spin" /> : null}
              重整分类 (0 Token)
            </button>
          </div>
        </div>

        {test && (
          <div
            className={
              "rounded-lg border p-3 text-[12.5px] " +
              (test.ok ? "border-deal-border bg-deal-subtle" : "border-red-200 bg-red-50")
            }
          >
            <div className="mb-2 flex items-center gap-2 font-medium">
              {test.ok ? <CircleCheck size={13} className="text-deal" /> : <CircleX size={13} className="text-red-600" />}
              {test.ok ? "连通正常" : "调用失败"} · {test.model} · {test.ms} ms
              {test.error && <span className="font-normal text-red-700">{test.error}</span>}
            </div>
            {test.results.map((r) => (
              <div key={r.title} className="flex flex-wrap items-center gap-2 py-1 text-[12px]">
                <span className={"shrink-0 " + (r.keep ? "text-deal" : "text-red-600")}>
                  {r.keep ? <Check size={12} /> : <CircleX size={12} />}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink-800">{r.title}</span>
                {r.kind && r.kind !== "noise" && (
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-brand">
                    {KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                )}
                <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-600">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
                {r.obtain && (
                  <span className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-600">
                    {OBTAIN_LABEL[r.obtain] ?? r.obtain}
                  </span>
                )}
                {typeof r.quality === "number" && (
                  <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-brand">
                    ★{r.quality}
                  </span>
                )}
                <span className="shrink-0 text-ink-500">{r.reason}</span>
              </div>
            ))}
          </div>
        )}

        {backfill && (
          <div className="rounded-lg border border-ink-200 bg-surface p-3 text-[12.5px]">
            执行完成（{backfill.mode ?? "pending"}）：扫描 {backfill.scanned} 条，判定 {backfill.reviewed} 条，其中拦掉{" "}
            {backfill.rejected} 条
            {backfill.error && <span className="text-red-700"> · {backfill.error}</span>}
          </div>
        )}
      </div>

      {/* 2. 判定分布 */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center gap-2">
          <Activity size={14} className="text-ink-500" />
          <h3 className="text-[13.5px] font-semibold text-ink-900">判定分布</h3>
          <span className="text-[11.5px] text-ink-500">共 {total} 条在库</span>
        </div>
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-ink-100">
          <div className="h-full bg-deal" style={{ width: keptPct + "%" }} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="font-mono text-[18px] font-semibold text-deal">{st.kept}</div>
            <div className="text-[11.5px] text-ink-500">判定是福利</div>
          </div>
          <div>
            <div className="font-mono text-[18px] font-semibold text-ink-700">{st.rejected}</div>
            <div className="text-[11.5px] text-ink-500">判定非福利</div>
          </div>
          <div>
            <div className="font-mono text-[18px] font-semibold text-ink-500">{st.pending}</div>
            <div className="text-[11.5px] text-ink-500">还没送审</div>
          </div>
        </div>
        {st.byCategory.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {st.byCategory.map((c) => (
              <span key={c.category} className="rounded-md bg-ink-100 px-2 py-0.5 text-[11.5px] text-ink-700">
                {CATEGORY_LABEL[c.category] ?? c.category} <span className="font-mono">{c.n}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 3. 第一道规则初筛与送审范围控制 */}
      <div className="panel space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter size={15} className="text-brand" />
            <h3 className="text-[13.5px] font-semibold text-ink-900">规则初筛与送审范围（省额度 · 提速度）</h3>
          </div>
          <span className="text-[11.5px] text-ink-500">采集入库后，先过规则初筛再决定是否送入 AI</span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <SwitchRow
            label="启用入口噪音预拦截（规则初筛）"
            hint="自动跳过求助/问价/游戏更新补丁等明显非福利帖，不送 AI 也不主动直推"
            value={form.preFilterEnabled}
            onChange={(v) => {
              setForm({ ...form, preFilterEnabled: v });
              void save({ preFilterEnabled: v }, v ? "已开启规则初筛" : "已关闭规则初筛（全量直通 AI）");
            }}
          />
          <SwitchRow
            label="纯白嫖专源免送 AI 直通"
            hint="Epic/Steam/GamerPower/CheapShark/ITAD/SharewareOnSale 等纯白嫖源直接判真福利省额度"
            value={form.skipFreebieSources}
            onChange={(v) => {
              setForm({ ...form, skipFreebieSources: v });
              void save({ skipFreebieSources: v }, v ? "纯白嫖专源已设为免审直通" : "纯白嫖专源已恢复送 AI");
            }}
          />
        </div>

        {form.preFilterEnabled && (
          <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-ink-900">自定义入口噪音拦截词（命中即跳过送审）</span>
              <span className="text-[11px] text-ink-500">已配置 {form.customNoiseKeywords.length} 个</span>
            </div>
            <div className="flex gap-2">
              <input
                value={noiseInput}
                onChange={(e) => setNoiseInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addNoiseKeyword();
                }}
                placeholder="例如：拼车 / 二手 / 出售 / 求助…"
                className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900 outline-none focus:border-brand"
              />
              <button
                type="button"
                onClick={addNoiseKeyword}
                className="inline-flex items-center gap-1 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-hover"
              >
                <Plus size={13} /> 添加
              </button>
            </div>
            {form.customNoiseKeywords.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {form.customNoiseKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-surface px-2 py-0.5 text-[12px] text-ink-800"
                  >
                    {kw}
                    <button
                      type="button"
                      onClick={() => removeNoiseKeyword(kw)}
                      className="text-ink-400 hover:text-alert"
                      title="移除"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] font-medium text-ink-900">送审数据源范围</span>
            <div className="flex items-center gap-1.5">
              {[
                { key: "all" as AiSourceMode, label: "全部启用源" },
                { key: "exclude" as AiSourceMode, label: "排除指定源" },
                { key: "only" as AiSourceMode, label: "仅审指定源" },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setForm({ ...form, sourceMode: m.key });
                    void save({ sourceMode: m.key });
                  }}
                  className={
                    "rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors " +
                    (form.sourceMode === m.key
                      ? "border-brand bg-brand text-white"
                      : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                  }
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {form.sourceMode !== "all" && (
            <div className="mt-2 flex max-h-[150px] flex-wrap gap-1.5 overflow-auto rounded-lg border border-ink-200 bg-surface p-2">
              {enabledSources.map((src) => {
                const active = form.sourceIds.includes(src.id);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => toggleSourceId(src.id)}
                    className={
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] transition-colors " +
                      (active
                        ? "border-brand bg-brand-subtle font-medium text-brand"
                        : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
                    }
                  >
                    {active && <Check size={11} />}
                    {src.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 4. 模型连接、性能并发与提示词自定义 */}
      <div className="panel space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-ink-900">模型连接、并发性能与审核口径</h3>
          <label className="flex items-center gap-2 text-[12.5px] font-medium text-ink-800">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => {
                setForm({ ...form, enabled: e.target.checked });
                void save({ enabled: e.target.checked }, e.target.checked ? "已启用 AI 语义审核" : "已关闭 AI 语义审核");
              }}
              className="h-3.5 w-3.5 accent-brand"
            />
            启用 AI 语义审核
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">API 端点（OpenAI 兼容）</span>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">模型名</span>
            <input
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder="mercury-3"
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">
              API Key {s.hasKey && <span className="font-normal text-ink-500">（当前 {s.keyHint}）</span>}
            </span>
            <input
              type="password"
              value={(form.apiKey ?? "").startsWith("••••") ? "" : (form.apiKey ?? "")}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={s.hasKey ? "已配置，留空保持不变" : "sk-..."}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
        </div>

        {/* 性能参数 */}
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block rounded-lg border border-ink-200 bg-surface-hover p-3">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">单轮送审上限 (20~500)</span>
            <input
              type="number"
              min={20}
              max={500}
              step={10}
              value={form.maxItems}
              onChange={(e) => setForm({ ...form, maxItems: Number(e.target.value) })}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
          <label className="block rounded-lg border border-ink-200 bg-surface-hover p-3">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">每批条数 (2~20)</span>
            <input
              type="number"
              min={2}
              max={20}
              value={form.batchSize}
              onChange={(e) => setForm({ ...form, batchSize: Number(e.target.value) })}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
          <label className="block rounded-lg border border-ink-200 bg-surface-hover p-3">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">并发批数 (1~8)</span>
            <input
              type="number"
              min={1}
              max={8}
              value={form.concurrency}
              onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) })}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
          <label className="block rounded-lg border border-ink-200 bg-surface-hover p-3">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">单批超时秒数 (5~60)</span>
            <input
              type="number"
              min={5}
              max={60}
              value={form.timeoutSec}
              onChange={(e) => setForm({ ...form, timeoutSec: Number(e.target.value) })}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
        </div>

        {/* 偏好自适应 */}
        <div className="rounded-lg border border-ink-200 bg-surface-hover p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[12.5px] font-medium text-ink-900">从收藏与关闭自动学习偏好</div>
              <div className="mt-0.5 text-[11px] text-ink-500">
                自动提取最近收藏（正样本 {data.feedback?.positive ?? 0} 条）与手动关闭（负样本 {data.feedback?.negative ?? 0} 条）作为审核参考
              </div>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11.5px] text-ink-600">
                各取最近
                <input
                  type="number"
                  min={1}
                  max={15}
                  value={form.feedbackLimit}
                  onChange={(e) => setForm({ ...form, feedbackLimit: Number(e.target.value) })}
                  className="w-12 rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-center font-mono text-[12px]"
                />
                条
              </label>
              <button
                type="button"
                onClick={() => setShowSamples((v) => !v)}
                className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[11.5px] text-ink-700 hover:bg-ink-100"
              >
                {showSamples ? <ChevronUp size={12} /> : <ChevronDown size={12} />} 查看样本
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = !form.learnFromFeedback;
                  setForm({ ...form, learnFromFeedback: next });
                  void save({ learnFromFeedback: next }, next ? "已开启偏好自适应" : "已关闭偏好自适应");
                }}
                className={
                  "rounded-lg border px-3 py-1 text-[12px] font-medium transition-colors " +
                  (form.learnFromFeedback
                    ? "border-deal-border bg-deal-subtle text-deal"
                    : "border-ink-200 bg-ink-100 text-ink-600")
                }
              >
                {form.learnFromFeedback ? "自动学习中" : "已关闭"}
              </button>
            </div>
          </div>

          {showSamples && (
            <div className="mt-3 grid gap-2.5 border-t border-ink-200 pt-2.5 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] font-medium text-deal">注入的正样本（最近收藏）</div>
                <ul className="space-y-1 text-[11.5px] text-ink-700">
                  {(data.feedback?.positiveSamples ?? []).map((t, idx) => (
                    <li key={idx} className="truncate">
                      · {t}
                    </li>
                  ))}
                  {!(data.feedback?.positiveSamples?.length) && <li className="text-ink-400">暂无收藏样本</li>}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-alert">注入的负样本（最近关闭）</div>
                <ul className="space-y-1 text-[11.5px] text-ink-700">
                  {(data.feedback?.negativeSamples ?? []).map((t, idx) => (
                    <li key={idx} className="truncate">
                      · {t}
                    </li>
                  ))}
                  {!(data.feedback?.negativeSamples?.length) && <li className="text-ink-400">暂无关闭样本</li>}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* 补充审核规则（推荐） */}
        <label className="block">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[12px] font-medium text-ink-800">
              补充审核规则（推荐 · 自动追加在系统默认口径后，不破坏 JSON 格式）
            </span>
            <span className="text-[11px] text-ink-500">可随时追加偏好，如「需要绑信用卡的判 false」「AI 模型免费额度一律留」</span>
          </div>
          <textarea
            value={form.extraPrompt}
            onChange={(e) => setForm({ ...form, extraPrompt: e.target.value })}
            rows={3}
            placeholder="例如：1. 需要企业认证/营业执照的活动判 keep=false；2. 开源免费 AI 接口/白嫖算力券优先给 quality=5..."
            className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink-800 outline-none focus:border-brand"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              save({
                enabled: form.enabled,
                baseUrl: form.baseUrl,
                model: form.model,
                apiKey: (form.apiKey ?? "").startsWith("••••") ? "" : (form.apiKey ?? ""),
                maxItems: form.maxItems,
                batchSize: form.batchSize,
                concurrency: form.concurrency,
                timeoutSec: form.timeoutSec,
                feedbackLimit: form.feedbackLimit,
                extraPrompt: form.extraPrompt,
                systemPrompt: form.systemPrompt,
              })
            }
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            保存配置
          </button>
          <button
            type="button"
            onClick={() => setShowPrompt((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
          >
            <Zap size={13} />
            {showPrompt ? "收起完整主提示词" : "高级：自定义完整主提示词"}
          </button>
          <button
            type="button"
            onClick={reload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100"
          >
            <RefreshCw size={13} /> 刷新
          </button>
        </div>

        {showPrompt && (
          <div className="border-t border-ink-100 pt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-700">
                完整系统主提示词
                {s.promptIsDefault ? (
                  <span className="ml-1 font-normal text-ink-500">（当前使用内置默认，留空可随时吃满版本更新）</span>
                ) : (
                  <span className="ml-1 font-normal text-brand">（已完全自定义覆盖）</span>
                )}
              </span>
              {!s.promptIsDefault && (
                <button
                  type="button"
                  onClick={() => {
                    setForm({ ...form, systemPrompt: "" });
                    void save({ systemPrompt: "" }, "已恢复内置主提示词");
                  }}
                  className="text-[11.5px] font-medium text-brand hover:underline"
                >
                  恢复默认主提示词
                </button>
              )}
            </div>
            <textarea
              value={form.systemPrompt || (s.promptIsDefault ? s.defaultPrompt : "")}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={11}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink-800 outline-none focus:border-brand"
            />
          </div>
        )}
      </div>

      {/* 5. 最近判定 */}
      <div className="panel p-4">
        <h3 className="mb-2 text-[13.5px] font-semibold text-ink-900">最近判定样本</h3>
        <div className="divide-y divide-ink-100">
          {st.recent.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-[12.5px]">
              <span className={"shrink-0 " + (r.keep ? "text-deal" : "text-red-600")}>
                {r.keep ? <Check size={12} /> : <CircleX size={12} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-800">{r.title}</span>
              {r.kind && r.kind !== "noise" && (
                <span className="rounded bg-brand-subtle px-1.5 py-0.5 text-[11px] font-medium text-brand">
                  {KIND_LABEL[r.kind] ?? r.kind}
                </span>
              )}
              {r.category && (
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                  {CATEGORY_LABEL[r.category] ?? r.category}
                </span>
              )}
              {r.obtain && r.obtain !== "free" && (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800">
                  {OBTAIN_LABEL[r.obtain] ?? r.obtain}
                </span>
              )}
              {typeof r.quality === "number" && (
                <span className="rounded bg-brand-subtle px-1.5 py-0.5 font-mono text-[11px] text-brand">
                  ★{r.quality}
                </span>
              )}
              <span className="shrink-0 text-[12px] text-ink-500">{r.reason}</span>
            </div>
          ))}
          {!st.recent.length && <div className="py-2 text-[12.5px] text-ink-500">还没有判定记录</div>}
        </div>
      </div>
    </div>
  );
}
