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
      <section className="card space-y-4 p-5 lg:col-span-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Bell size={15} className="text-lime" /> 我的订阅关键词
          </div>
          <span className="font-mono text-[11px] text-ink-400">{subscriptions.length} 个</span>
        </div>

        <p className="text-[12px] leading-relaxed text-ink-400">
          命中标题或摘要的条目会自动打上黄色「订阅命中」徽章，在资源流一键筛出。
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
            placeholder="添加关键词，如 epic / Claude / 域名…"
            className="min-w-0 flex-1 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] outline-none focus:border-lime/40"
          />
          <button
            type="button"
            onClick={async () => {
              if (!kw.trim()) return;
              await onAddSub(kw.trim());
              setKw("");
            }}
            className="inline-flex items-center gap-1 rounded-xl bg-lime/15 px-3 py-2 text-[13px] font-medium text-lime hover:bg-lime/25"
          >
            <Plus size={14} /> 添加
          </button>
        </div>

        <div className="space-y-1.5">
          {subscriptions.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between rounded-xl border border-ink-800 bg-ink-900/60 px-3 py-2 text-[13px]"
            >
              <button
                type="button"
                onClick={() => onJumpToSubscribed(s.keyword)}
                className="font-medium text-ink-100 hover:text-lime"
                title="去资源流搜这个词"
              >
                {s.keyword}
              </button>
              <button
                type="button"
                onClick={() => onRemoveSub(s.id)}
                className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-red-400"
                title="删除订阅"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {!subscriptions.length && (
            <div className="rounded-xl border border-dashed border-ink-800 p-6 text-center text-[12px] text-ink-500">
              还没有订阅词，加个「epic」或「会员」试试
            </div>
          )}
        </div>
      </section>

      {/* 右栏：屏蔽词防火墙 */}
      <section className="card space-y-4 p-5 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <ShieldBan size={15} className="text-red-400" /> 屏蔽词防火墙
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-red-500/10 px-2.5 py-0.5 font-mono text-[11px] text-red-300">
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
              className="inline-flex items-center gap-1 rounded-lg border border-lime/30 bg-lime/10 px-2.5 py-1 text-[11.5px] font-medium text-lime hover:bg-lime/20 disabled:opacity-50"
              title={"包含：" + presets.map((p) => p.pattern).join("、")}
            >
              <Sparkles size={12} /> 一键导入常见噪音屏蔽词（{presets.length} 条）
            </button>
          </div>
        </div>

        <p className="text-[12px] leading-relaxed text-ink-400">
          命中屏蔽规则的条目会在资源流隐藏，且<strong className="text-ink-200">不会进每日精选和 Telegram 即时推送</strong>；
          原数据保留在库里，删除规则后立刻恢复。
        </p>

        <div className="grid gap-2 sm:grid-cols-12">
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={mode === "regex" ? "正则表达式，如 ^(请问|求推荐)" : "屏蔽关键词，如 汽车 / 测评 / 避坑"}
            className="rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] outline-none focus:border-red-400/50 sm:col-span-5"
          />
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "keyword" | "regex")}
            className="rounded-xl border border-ink-700 bg-ink-900 px-2.5 py-2 text-[12.5px] text-ink-200 outline-none sm:col-span-2"
          >
            <option value="keyword">关键词</option>
            <option value="regex">正则</option>
          </select>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-xl border border-ink-700 bg-ink-900 px-2.5 py-2 text-[12.5px] text-ink-200 outline-none sm:col-span-3"
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
            className="rounded-xl bg-red-500/20 px-3 py-2 text-[12.5px] font-medium text-red-200 hover:bg-red-500/30 disabled:opacity-40 sm:col-span-2"
          >
            添加屏蔽
          </button>
        </div>

        <div className="max-h-[420px] space-y-1.5 overflow-auto pr-1">
          {rules.map((r) => (
            <div
              key={r.id}
              className={
                "flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12.5px] " +
                (r.enabled ? "border-ink-800 bg-ink-900/60" : "border-ink-800/40 bg-ink-950/50 opacity-55")
              }
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate font-mono font-medium text-ink-100">{r.pattern}</span>
                <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10.5px] text-ink-400">
                  {r.mode === "regex" ? "正则" : "词"}
                </span>
                <span className="shrink-0 truncate rounded bg-ink-800 px-1.5 py-0.5 text-[10.5px] text-ink-400">
                  {r.scope === "all" ? "全局" : sourceName(r.scope)}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-[11px] text-ink-400">拦截 {r.hits}</span>
                <button
                  type="button"
                  onClick={() => onToggleRule(r.id, !r.enabled)}
                  className={
                    "rounded-md px-2 py-0.5 text-[11px] transition-colors " +
                    (r.enabled ? "bg-lime/15 text-lime" : "bg-ink-800 text-ink-400")
                  }
                >
                  {r.enabled ? "启用中" : "已停用"}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteRule(r.id)}
                  className="rounded p-1 text-ink-500 hover:bg-ink-800 hover:text-red-400"
                  title="删除规则"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
          {!rules.length && (
            <div className="rounded-xl border border-dashed border-ink-800 p-6 text-center text-[12px] text-ink-500">
              还没有屏蔽词；可手动添加，或点右上角「一键导入常见噪音屏蔽词」
            </div>
          )}
        </div>

        <div className="border-t border-ink-800 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-ink-400">担心误杀好资源？随时核对被拦截的列表：</span>
            <button
              type="button"
              onClick={onLoadBlockedPreview}
              className="inline-flex items-center gap-1 rounded-lg border border-ink-700 px-2.5 py-1 text-[11.5px] text-ink-200 hover:border-ink-600"
            >
              <Eye size={12} /> 抽查被屏蔽的条目
            </button>
          </div>
          {blockedPreview && (
            <div className="mt-2.5 max-h-[220px] space-y-1 overflow-auto rounded-xl bg-ink-950/60 p-2.5">
              {blockedPreview.filter((it) => it.blockedBy).length === 0 ? (
                <div className="py-2 text-center text-[11.5px] text-ink-500">前 80 条里没有命中屏蔽规则的条目</div>
              ) : (
                blockedPreview
                  .filter((it) => it.blockedBy)
                  .slice(0, 20)
                  .map((it) => (
                    <div key={it.id} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <a href={it.url} target="_blank" rel="noreferrer noopener" className="truncate text-ink-300 hover:text-lime">
                        {it.title}
                      </a>
                      <span className="shrink-0 rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] text-red-300">
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
