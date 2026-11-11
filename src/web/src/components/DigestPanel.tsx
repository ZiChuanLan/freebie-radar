import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Item } from "../types.ts";
import { ItemCard } from "./ItemView.tsx";

export function DigestPanel({
  digests,
  detail,
  pickedDate,
  onPickDate,
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
  sourceName: (id: string) => string;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const active = pickedDate ?? digests[0]?.date ?? null;

  if (!digests.length) {
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-16 text-center">
        <Sparkles size={26} className="text-ink-600" />
        <div className="text-[14px]">还没有生成过日报</div>
        <p className="max-w-md text-[12.5px] leading-relaxed text-ink-400">
          运行 <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono">pnpm daily</code>{" "}
          生成当日精选；生成后这里会按日期列出，同时可查看每条与历史文本。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {digests.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => onPickDate(d.date)}
            className={
              "rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors " +
              (d.date === active
                ? "border-lime/40 bg-lime/10 text-lime"
                : "border-ink-700 text-ink-300 hover:border-ink-600")
            }
          >
            {d.date}
            {d.pushed_at ? <span className="ml-1.5 text-[10px] text-lime/70">已推送</span> : null}
          </button>
        ))}
      </div>

      {detail.loading && <div className="card p-6 text-[13px] text-ink-400">加载中…</div>}
      {detail.error && <div className="card border-red-500/30 p-4 text-[13px] text-red-400">{detail.error}</div>}

      {detail.data && (
        <>
          <div className="card p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-medium">{detail.data.date} 精选</span>
              <span className="text-[11.5px] text-ink-400">
                {detail.data.count} 条 · 生成于 {detail.data.created_at.replace("T", " ").slice(5, 16)}
                {detail.data.pushed_at ? " · 已推送 Telegram" : " · 仅落库"}
              </span>
            </div>
            <pre className="mt-3 max-h-[240px] overflow-auto rounded-lg bg-ink-900/80 p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-300">
              {detail.data.text}
            </pre>
          </div>

          <div className="space-y-2.5">
            {detail.data.items.map((item) => (
              <ItemCard
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
