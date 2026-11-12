import { useState } from "react";
import { Loader2, Play, Sparkles } from "lucide-react";
import type { Item } from "../types.ts";
import { CompactRow } from "./ItemView.tsx";

export function DigestPanel({
  digests,
  detail,
  pickedDate,
  onPickDate,
  onRunDaily,
  sourceName,
  onPatch,
  onOpen,
  onQuickBlock,
  onCopyCode,
}: {
  digests: { date: string; created_at: string; pushed_at: string | null }[];
  detail: {
    data: { date: string; text: string; count: number; created_at: string; pushed_at: string | null; items: Item[] } | null;
    loading: boolean;
    error: string | null;
  };
  pickedDate: string | null;
  onPickDate: (d: string) => void;
  onRunDaily: () => Promise<void>;
  sourceName: (id: string) => string;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const active = pickedDate ?? digests[0]?.date ?? null;

  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {digests.map((d) => (
            <button
              key={d.date}
              type="button"
              onClick={() => onPickDate(d.date)}
              className={
                "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors " +
                (d.date === active
                  ? "border-brand bg-brand text-white"
                  : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
              }
            >
              {d.date}
              {d.pushed_at ? <span className="ml-1.5 text-[11px] opacity-80">· 已推</span> : null}
            </button>
          ))}
          {!digests.length && <span className="text-[13px] text-ink-500">还没有生成过每日精选</span>}
        </div>

        <button
          type="button"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            try {
              await onRunDaily();
            } finally {
              setRunning(false);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          立即生成今日精选
        </button>
      </div>

      {!digests.length && (
        <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Sparkles size={26} className="text-ink-400" />
          <div className="text-[14.5px] font-medium text-ink-900">还没有日报记录</div>
          <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
            点右上角「立即生成今日精选」，会按照你在「推送规则」里设好的价格、分类与 AI 条件生成今日精选并自动记录。
          </p>
        </div>
      )}

      {detail.loading && <div className="panel p-6 text-[13px] text-ink-500">加载日报中…</div>}
      {detail.error && (
        <div className="panel border-alert-border bg-alert-subtle p-4 text-[13px] text-alert">{detail.error}</div>
      )}

      {detail.data && (
        <>
          <div className="panel p-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
              <span className="font-semibold text-ink-950">{detail.data.date} 精选摘要</span>
              <span className="text-[12px] text-ink-500">
                共 {detail.data.count} 条 · 生成于 {detail.data.created_at.replace("T", " ").slice(5, 16)}
                {detail.data.pushed_at ? " · 已发 Telegram" : " · 仅落库"}
              </span>
            </div>
            <pre className="mt-2 max-h-[240px] overflow-auto rounded-xl border border-ink-200 bg-surface-hover p-3.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-700">
              {detail.data.text}
            </pre>
          </div>

          <div className="panel overflow-hidden">
            {detail.data.items.map((item) => (
              <CompactRow
                key={item.id}
                item={item}
                sourceName={sourceName}
                onPatch={onPatch}
                onOpen={onOpen}
                onQuickBlock={onQuickBlock}
                onCopyCode={onCopyCode}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
