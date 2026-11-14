import { useState } from "react";
import { Bell, Eye, Plus, ShieldBan, Sparkles, Trash2 } from "lucide-react";
import type { BlockPreset, BlockRule, Item, Source, Subscription } from "../types.ts";

export function RulesPanel({
  subscriptions,
  rules,
  presets,
  totalBlocked,
  sources,
  blockedPreview,
  onAddSub,
  onRemoveSub,
  onJumpToSubscribed,
  onAddRule,
  onImportPresets,
  onToggleRule,
  onDeleteRule,
  onLoadBlockedPreview,
  sourceName,
}: {
  subscriptions: Subscription[];
  rules: BlockRule[];
  presets: BlockPreset[];
  totalBlocked: number;
  sources: Source[];
  blockedPreview: Item[] | null;
  onAddSub: (kw: string) => Promise<void>;
  onRemoveSub: (id: number) => Promise<void>;
  onJumpToSubscribed: (kw: string) => void;
  onAddRule: (pattern: string, mode: "keyword" | "regex", scope: string) => Promise<void>;
  onImportPresets: () => Promise<void>;
  onToggleRule: (id: number, enabled: boolean) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  onLoadBlockedPreview: () => void;
  sourceName: (id: string) => string;
}) {
  const [kw, setKw] = useState("");
  const [pattern, setPattern] = useState("");
  const [mode, setMode] = useState<"keyword" | "regex">("keyword");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      {/* 左栏：关键词订阅 */}
      <section className="panel space-y-4 p-5 lg:col-span-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
            <Bell size={16} className="text-accent" /> 我的关注关键词
          </div>
          <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[11px] font-medium text-ink-700">
            {subscriptions.length} 个
          </span>
        </div>

        <p className="text-[12.5px] leading-relaxed text-ink-500">
          标题或摘要命中关注词时，列表自动亮起提醒，且可在推送页开启「订阅命中优先直推」。
        </p>

        <div className="flex gap-2">
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && kw.trim()) {
                await onAddSub(kw.trim());
                setKw("");
              }
            }}
            placeholder="例如：epic / Claude / 域名…"
            className="min-w-0 flex-1 rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[13px] text-ink-950 outline-none focus:border-brand"
          />
          <button
            type="button"
            onClick={async () => {
              if (!kw.trim()) return;
              await onAddSub(kw.trim());
              setKw("");
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-brand px-3.5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
          >
            <Plus size={14} /> 添加
          </button>
        </div>

        <div className="divide-y divide-ink-100 rounded-lg border border-ink-200 bg-surface">
          {subscriptions.map((s) => (
            <div key={s.id} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
              <button
                type="button"
                onClick={() => onJumpToSubscribed(s.keyword)}
                className="font-medium text-ink-900 hover:text-brand"
                title="点击去资源流搜索"
              >
                {s.keyword}
              </button>
              <button
                type="button"
                onClick={() => onRemoveSub(s.id)}
                className="rounded-lg p-1 text-ink-400 hover:bg-alert-subtle hover:text-alert"
                title="删除关注词"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!subscriptions.length && (
            <div className="p-6 text-center text-[12.5px] text-ink-500">
              还没有关注词，加个「epic」或「会员」试试
            </div>
          )}
        </div>
      </section>

      {/* 右栏：屏蔽词防火墙 */}
      <section className="panel space-y-4 p-5 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
            <ShieldBan size={16} className="text-alert" /> 屏蔽词防火墙
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-alert-subtle px-2.5 py-1 font-mono text-[12px] font-medium text-alert">
              当前拦截 {totalBlocked} 条
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onImportPresets();
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-border bg-brand-subtle px-3 py-1.5 text-[12px] font-medium text-brand hover:bg-ink-200/70 disabled:opacity-50"
              title={"包含：" + presets.map((p) => p.pattern).join("、")}
            >
              <Sparkles size={12} /> 导入常见噪音屏蔽词（{presets.length} 条）
            </button>
          </div>
        </div>

        <p className="text-[12.5px] leading-relaxed text-ink-500">
          命中的条目在资源流隐藏，且<strong className="font-medium text-ink-800">不进每日精选和 Telegram 推送</strong>；
          原数据留在库里，删掉规则后立刻恢复。
        </p>

        <div className="grid gap-2 sm:grid-cols-12">
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={mode === "regex" ? "正则表达式，如 ^(请问|求推荐)" : "屏蔽词，如 汽车 / 测评 / 避坑"}
            className="rounded-lg border border-ink-200 bg-surface px-3 py-2 text-[13px] text-ink-950 outline-none focus:border-brand sm:col-span-5"
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "keyword" | "regex")}
            className="rounded-lg border border-ink-200 bg-surface px-2.5 py-2 text-[12.5px] text-ink-800 outline-none focus:border-brand sm:col-span-2"
          >
            <option value="keyword">关键词</option>
            <option value="regex">正则</option>
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-lg border border-ink-200 bg-surface px-2.5 py-2 text-[12.5px] text-ink-800 outline-none focus:border-brand sm:col-span-3"
          >
            <option value="all">全部来源</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                仅 {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pattern.trim() || busy}
            onClick={async () => {
              if (!pattern.trim()) return;
              setBusy(true);
              try {
                await onAddRule(pattern.trim(), mode, scope);
                setPattern("");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-alert px-3 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40 sm:col-span-2"
          >
            添加屏蔽
          </button>
        </div>

        <div className="max-h-[420px] divide-y divide-ink-100 overflow-auto rounded-lg border border-ink-200 bg-surface">
          {rules.map((r) => (
            <div
              key={r.id}
              className={
                "flex items-center justify-between gap-2 px-3.5 py-2.5 text-[12.5px] " +
                (r.enabled ? "" : "bg-surface-hover opacity-55")
              }
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono font-medium text-ink-950">{r.pattern}</span>
                <span className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                  {r.mode === "regex" ? "正则" : "词"}
                </span>
                <span className="shrink-0 truncate rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">
                  {r.scope === "all" ? "全局" : sourceName(r.scope)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] tabular-nums text-ink-500">拦截 {r.hits}</span>
                <button
                  type="button"
                  onClick={() => onToggleRule(r.id, !r.enabled)}
                  className={
                    "rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors " +
                    (r.enabled ? "bg-deal-subtle text-deal" : "bg-ink-100 text-ink-500")
                  }
                >
                  {r.enabled ? "启用中" : "已停用"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteRule(r.id)}
                  className="rounded-lg p-1 text-ink-400 hover:bg-alert-subtle hover:text-alert"
                  title="删除规则"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {!rules.length && (
            <div className="p-6 text-center text-[12.5px] text-ink-500">
              还没有屏蔽词，可手动添加或点右上角导入常见噪音屏蔽词
            </div>
          )}
        </div>

        <div className="border-t border-ink-100 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-500">担心误伤好资源？随时核对最近被拦截的内容：</span>
            <button
              type="button"
              onClick={onLoadBlockedPreview}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-200 bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-700 hover:bg-ink-100"
            >
              <Eye size={12} /> 抽查被屏蔽的条目
            </button>
          </div>
          {blockedPreview && (
            <div className="mt-2.5 max-h-[220px] space-y-1.5 overflow-auto rounded-lg border border-ink-200 bg-surface-hover p-3">
              {blockedPreview.filter((it) => it.blockedBy).length === 0 ? (
                <div className="py-2 text-center text-[12px] text-ink-500">前 80 条里没有命中屏蔽规则的条目</div>
              ) : (
                blockedPreview
                  .filter((it) => it.blockedBy)
                  .slice(0, 20)
                  .map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2 text-[12px]">
                      <a href={it.url} target="_blank" rel="noreferrer noopener" className="truncate text-ink-700 hover:text-accent">
                        {it.title}
                      </a>
                      <span className="shrink-0 rounded bg-alert-subtle px-1.5 py-0.5 font-mono text-[11px] text-alert">
                        {it.blockedBy}
                      </span>
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
