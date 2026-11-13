import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CircleCheck,
  CircleX,
  FlaskConical,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Zap,
} from "lucide-react";
import type { AiPayload, AiSettings } from "../types.ts";

const CATEGORY_LABEL: Record<string, string> = {
  ai: "AI 额度",
  cloud: "云服务",
  domain: "域名",
  software: "软件授权",
  media: "影音会员",
  game: "游戏喜加一",
  goods: "实物/优惠",
  invite: "邀请码",
  edu: "教育",
  other: "其它",
};

type TestResult = {
  ok: boolean;
  ms: number;
  model: string;
  results: { title: string; keep: boolean; category: string; reason: string }[];
  error?: string;
};

export function AiPanel({
  data,
  reload,
  onNotify,
}: {
  data: AiPayload | null;
  reload: () => void;
  onNotify?: (msg: string) => void;
}) {
  const [form, setForm] = useState<AiSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [backfill, setBackfill] = useState<{ reviewed: number; rejected: number; scanned: number; error?: string } | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    if (data?.settings && !form) setForm({ ...data.settings });
  }, [data, form]);

  useEffect(() => {
    if (data?.settings) {
      setForm((prev) =>
        prev
          ? {
              ...prev,
              reviewBeforePush: data.settings.reviewBeforePush,
              learnFromFeedback: data.settings.learnFromFeedback,
              enabled: data.settings.enabled,
            }
          : prev,
      );
    }
  }, [data?.settings?.reviewBeforePush, data?.settings?.learnFromFeedback, data?.settings?.enabled]);

  if (!data || !form) {
    return <div className="panel p-6 text-[13px] text-ink-500">正在读取 AI 配置…</div>;
  }

  const s = data.settings;
  const st = data.stats;
  const total = st.kept + st.rejected + st.pending;
  const keptPct = total ? Math.round((st.kept / total) * 100) : 0;

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
      const r = await fetch("/api/ai/test", { method: "POST" });
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
        body: JSON.stringify({ limit: 200 }),
      });
      setBackfill((await r.json()) as typeof backfill);
      reload();
    } finally {
      setBackfilling(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 状态卡 */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Bot size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-semibold text-ink-900">AI 二审引擎</h2>
              {s.ready ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-deal-subtle px-1.5 py-0.5 text-[11px] font-medium text-deal">
                  <CircleCheck size={11} /> 运行中
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  <AlertTriangle size={11} /> 未启用
                </span>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-ink-500">
              {s.baseUrl ? s.model + " @ " + s.baseUrl.replace(/^https?:\/\//, "") : "还没有配置端点"}
              {s.hasKey ? " · Key " + s.keyHint : " · 未设置 Key"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={runTest}
              disabled={testing || !s.ready}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
              连通性测试
            </button>
            <button
              type="button"
              onClick={runBackfill}
              disabled={backfilling || !s.ready}
              className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-700 hover:bg-ink-100 disabled:opacity-50"
            >
              {backfilling ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              补审 200 条
            </button>
          </div>
        </div>

        {test && (
          <div
            className={
              "mt-3 rounded-lg border p-3 text-[12.5px] " +
              (test.ok ? "border-deal-border bg-deal-subtle" : "border-red-200 bg-red-50")
            }
          >
            <div className="mb-2 flex items-center gap-2 font-medium">
              {test.ok ? <CircleCheck size={13} className="text-deal" /> : <CircleX size={13} className="text-red-600" />}
              {test.ok ? "连通正常" : "调用失败"} · {test.model} · {test.ms} ms
              {test.error && <span className="font-normal text-red-700">{test.error}</span>}
            </div>
            {test.results.map((r) => (
              <div key={r.title} className="flex items-start gap-2 py-1">
                <span className={"mt-0.5 shrink-0 " + (r.keep ? "text-deal" : "text-red-600")}>
                  {r.keep ? <Check size={12} /> : <CircleX size={12} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink-800">{r.title}</span>
                <span className="shrink-0 text-ink-500">{r.reason}</span>
              </div>
            ))}
          </div>
        )}

        {backfill && (
          <div className="mt-3 rounded-lg border border-ink-200 bg-surface p-3 text-[12.5px]">
            补审完成：扫描 {backfill.scanned} 条，判定 {backfill.reviewed} 条，其中拦掉 {backfill.rejected} 条
            {backfill.error && <span className="text-red-700"> · {backfill.error}</span>}
          </div>
        )}
      </div>

      {/* 判定统计 */}
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

      {/* 配置表单 */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[13.5px] font-semibold text-ink-900">连接配置</h3>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => {
                setForm({ ...form, enabled: e.target.checked });
                void save({ enabled: e.target.checked });
              }}
              className="h-3.5 w-3.5 accent-brand"
            />
            启用 AI 二审
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">API 端点（OpenAI 兼容）</span>
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://mg.zichuanlan.top/v1"
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
              API Key {s.hasKey && <span className="font-normal text-ink-500">（当前 {s.keyHint}，留空不修改）</span>}
            </span>
            <input
              type="password"
              value={(form.apiKey ?? "").startsWith("••••") ? "" : (form.apiKey ?? "")}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={s.hasKey ? "已配置，输入新值可替换" : "sk-..."}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-1.5 font-mono text-[12.5px] text-ink-900 outline-none focus:border-brand"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink-700">
              每轮送审上限 <span className="font-normal text-ink-500">（{form.maxItems} 条 · 每批 6 条 / 4 并发）</span>
            </span>
            <input
              type="range"
              min={20}
              max={300}
              step={20}
              value={form.maxItems}
              onChange={(e) => setForm({ ...form, maxItems: Number(e.target.value) })}
              className="mt-2 w-full accent-brand"
            />
          </label>
        </div>

        {/* 数据驱动偏好自适应：不用写复杂提示词，从收藏/关闭自动学习 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-surface p-3">
          <div>
            <div className="text-[12.5px] font-medium text-ink-900">从收藏与关闭自动学习偏好（零提示词自适应）</div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              自动提取最近收藏（正样本 {data.feedback?.positive ?? 0} 条）与手动关闭（负样本 {data.feedback?.negative ?? 0} 条）作为一审参考，越用越准
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !form.learnFromFeedback;
              setForm({ ...form, learnFromFeedback: next });
              void save({ learnFromFeedback: next }, next ? "已开启偏好自适应" : "已关闭偏好自适应");
            }}
            className={
              "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors " +
              (form.learnFromFeedback
                ? "border-deal-border bg-deal-subtle text-deal"
                : "border-ink-200 bg-ink-100 text-ink-600")
            }
          >
            {form.learnFromFeedback ? "自动学习中" : "已关闭"}
          </button>
        </div>

        {/* 一审时机：推送前拦截 vs 推送后补审 */}
        <div className="mt-3 rounded-lg border border-ink-200 bg-surface p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-ink-800">AI 一审时机（无关键词门禁全量直审）</span>
            <span className="text-[11px] text-ink-500">
              {form.reviewBeforePush ? "当前：发 Telegram 前先过模型审核" : "当前：命中规则先即时推送，随后后台补审"}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setForm({ ...form, reviewBeforePush: true });
                void save({ reviewBeforePush: true });
              }}
              className={
                "rounded-lg border px-3 py-2 text-left text-[12px] transition-colors " +
                (form.reviewBeforePush
                  ? "border-brand bg-brand-subtle font-medium text-brand"
                  : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
              }
            >
              <div>推送前先审（推荐）</div>
              <div className="mt-0.5 text-[11px] font-normal text-ink-500">
                新条目先过 AI 验真再发 Telegram，多等 1~3 秒，拦掉更新公告/水帖
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                setForm({ ...form, reviewBeforePush: false });
                void save({ reviewBeforePush: false });
              }}
              className={
                "rounded-lg border px-3 py-2 text-left text-[12px] transition-colors " +
                (!form.reviewBeforePush
                  ? "border-brand bg-brand-subtle font-medium text-brand"
                  : "border-ink-200 bg-surface-hover text-ink-700 hover:bg-ink-100")
              }
            >
              <div>推送后补审（极速抢码）</div>
              <div className="mt-0.5 text-[11px] font-normal text-ink-500">
                高分/兑换码 0 延迟立刻推送，AI 随后在后台补写结论（只影响后续列表）
              </div>
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => save({ ...form, apiKey: (form.apiKey ?? "").startsWith("••••") ? "" : (form.apiKey ?? "") })}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12.5px] font-medium text-white hover:bg-brand-dark disabled:opacity-60"
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
            {showPrompt ? "收起提示词" : "自定义提示词"}
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
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-medium text-ink-700">
                系统提示词
                {s.promptIsDefault ? (
                  <span className="ml-1 font-normal text-ink-500">（当前用内置默认，编辑后覆盖）</span>
                ) : (
                  <span className="ml-1 font-normal text-brand">（已自定义）</span>
                )}
              </span>
              {!s.promptIsDefault && (
                <button
                  type="button"
                  onClick={() => {
                    setForm({ ...form, systemPrompt: "" });
                    void save({ systemPrompt: "" }, "已恢复默认提示词");
                  }}
                  className="text-[11.5px] font-medium text-brand hover:underline"
                >
                  恢复默认
                </button>
              )}
            </div>
            <textarea
              value={form.systemPrompt || (s.promptIsDefault ? s.defaultPrompt : "")}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              rows={12}
              className="w-full rounded-lg border border-ink-200 bg-surface px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-ink-800 outline-none focus:border-brand"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => save({ systemPrompt: form.systemPrompt }, "提示词已保存")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:bg-brand-hover"
              >
                <Save size={12} /> 保存提示词
              </button>
              <span className="text-[11.5px] text-ink-500">改完立即生效，下一轮采集就用新提示词</span>
            </div>
          </div>
        )}
      </div>

      {/* 最近判定 */}
      <div className="panel p-4">
        <h3 className="mb-2 text-[13.5px] font-semibold text-ink-900">最近判定样本</h3>
        <div className="divide-y divide-ink-100">
          {st.recent.map((r) => (
            <div key={r.id} className="flex items-start gap-2 py-1.5 text-[12.5px]">
              <span className={"mt-0.5 shrink-0 " + (r.keep ? "text-deal" : "text-red-600")}>
                {r.keep ? <Check size={12} /> : <CircleX size={12} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink-800">{r.title}</span>
              <span className="shrink-0 text-ink-500">{r.reason}</span>
            </div>
          ))}
          {!st.recent.length && <div className="py-2 text-[12.5px] text-ink-500">还没有判定记录</div>}
        </div>
      </div>
    </div>
  );
}
