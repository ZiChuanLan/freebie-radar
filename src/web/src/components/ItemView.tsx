import { useState } from "react";
import {
  ArrowUpRight,
  Ban,
  Check,
  Clock3,
  Copy,
  Eye,
  Info,
  ShieldAlert,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { CATEGORY_LABEL, expiresLabel, extractBlockCandidates, timeAgo } from "../lib/sources.ts";
import type { Item } from "../types.ts";

export function CodeChip({ code, onCopy }: { code: string; onCopy: (code: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCopy(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
      className="inline-flex items-center gap-1 rounded-md border border-amber-400/50 bg-amber-400/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/25"
      title="点击复制兑换码"
    >
      {copied ? <Check size={10} className="text-lime" /> : <Copy size={10} />}
      {code}
    </button>
  );
}

export function ItemCard({
  item,
  sourceName,
  onPatch,
  onOpen,
  onQuickBlock,
  onCopyCode,
}: {
  item: Item;
  sourceName: (id: string) => string;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const exp = expiresLabel(item.expires_at);
  const codes = Array.isArray(item.codes) ? item.codes : [];
  const matched = Array.isArray(item.matched) ? item.matched : [];

  return (
    <article
      className={
        "card group relative overflow-hidden p-4 transition-all hover:border-ink-600/90 " +
        (item.read ? "opacity-65 hover:opacity-100" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400">
            <span className="rounded-full bg-ink-700/70 px-2 py-0.5 font-medium text-ink-200">
              {sourceName(item.source_id)}
            </span>
            {item.category && (
              <span className="rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 font-medium text-lime">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
            {item.is_free === 1 && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 font-medium text-emerald-300">
                白嫖
              </span>
            )}
            {item.is_free !== 1 && typeof item.price === "number" && item.price > 0 && (
              <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-medium text-sky-300">
                {item.price < 1 ? "<1" : Math.round(item.price)} 元内
              </span>
            )}
            {item.blockedBy && (
              <span className="rounded-full border border-red-400/40 bg-red-500/15 px-2 py-0.5 text-red-300">
                已命中屏蔽：{item.blockedBy}
              </span>
            )}
            {exp && (
              <span className={"inline-flex items-center gap-1 " + (exp.urgent ? "text-orange-400" : "text-ink-400")}>
                <Clock3 size={11} /> {exp.text}
              </span>
            )}
            <span>{timeAgo(item.published_at ?? item.first_seen_at)}</span>
            {item.read && <span className="text-ink-500">· 已读</span>}
          </div>

          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => {
              if (!item.read) onPatch(item.id, { read: true });
            }}
            className="block text-[15px] leading-snug font-medium text-ink-100 decoration-lime/60 underline-offset-4 hover:text-lime hover:underline"
          >
            {item.title}
            <ArrowUpRight size={13} className="ml-1 inline-block opacity-0 transition-opacity group-hover:opacity-60" />
          </a>

          {item.summary && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-400">{item.summary}</p>}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {matched.length > 0 && (
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300 text-[11px]">
                订阅命中：{matched.join(" / ")}
              </span>
            )}
            {codes.map((code) => (
              <CodeChip key={code} code={code} onCopy={onCopyCode} />
            ))}
            {item.tags.slice(0, 5).map((t) => (
              <span key={t} className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-300">
                #{t}
              </span>
            ))}
            {item.ai?.reason && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-400">
                <Sparkles size={10} /> {item.ai.reason}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div
            className={
              "flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 font-mono text-xs font-semibold tabular-nums " +
              (item.score >= 70 ? "bg-lime/15 text-lime" : item.score >= 40 ? "bg-ink-700 text-ink-200" : "bg-ink-800 text-ink-400")
            }
            title="综合评分"
          >
            {Math.round(item.score)}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onOpen(item)}
              className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-700 hover:text-ink-100"
              title="详情与快照"
            >
              <Info size={14} />
            </button>
            <button
              type="button"
              onClick={() => onPatch(item.id, { starred: !item.starred })}
              className={
                "rounded-md p-1.5 transition-colors hover:bg-ink-700 " +
                (item.starred ? "text-amber-300" : "text-ink-400 hover:text-ink-100")
              }
              title={item.starred ? "取消收藏" : "收藏"}
            >
              <Star size={14} fill={item.starred ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => onQuickBlock(item)}
              className="rounded-md p-1.5 text-ink-400 transition-colors hover:bg-ink-700 hover:text-red-300"
              title="加入屏蔽词 / 屏蔽此条"
            >
              <Ban size={14} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function CompactRow({
  item,
  sourceName,
  onPatch,
  onOpen,
  onQuickBlock,
  onCopyCode,
}: {
  item: Item;
  sourceName: (id: string) => string;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const codes = Array.isArray(item.codes) ? item.codes : [];
  return (
    <div
      className={
        "flex items-center gap-2.5 rounded-xl border border-ink-800 bg-ink-900/60 px-3 py-2 text-[13px] transition-colors hover:border-ink-600/80 " +
        (item.read ? "opacity-55 hover:opacity-100" : "")
      }
    >
      <span
        className={
          "w-7 shrink-0 rounded-md py-0.5 text-center font-mono text-[11px] font-semibold tabular-nums " +
          (item.score >= 70 ? "bg-lime/15 text-lime" : "bg-ink-800 text-ink-300")
        }
      >
        {Math.round(item.score)}
      </span>

      <span className="hidden w-[116px] shrink-0 truncate rounded bg-ink-800/80 px-1.5 py-0.5 text-[11px] text-ink-300 sm:inline-block">
        {sourceName(item.source_id)}
      </span>

      {item.is_free === 1 ? (
        <span className="shrink-0 rounded border border-emerald-400/40 bg-emerald-400/10 px-1.5 py-0.5 text-[10.5px] text-emerald-300">
          白嫖
        </span>
      ) : typeof item.price === "number" && item.price > 0 ? (
        <span className="shrink-0 rounded border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 text-[10.5px] text-sky-300">
          ≤{Math.round(item.price)}¥
        </span>
      ) : null}

      <a
        href={item.url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={() => {
          if (!item.read) onPatch(item.id, { read: true });
        }}
        className="min-w-0 flex-1 truncate font-medium text-ink-100 hover:text-lime"
        title={item.title}
      >
        {item.title}
      </a>

      {codes.slice(0, 1).map((c) => (
        <CodeChip key={c} code={c} onCopy={onCopyCode} />
      ))}

      <span className="hidden shrink-0 font-mono text-[11px] text-ink-500 md:inline">
        {timeAgo(item.published_at ?? item.first_seen_at)}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="rounded p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100"
          title="详情"
        >
          <Info size={13} />
        </button>
        <button
          type="button"
          onClick={() => onPatch(item.id, { starred: !item.starred })}
          className={"rounded p-1 hover:bg-ink-700 " + (item.starred ? "text-amber-300" : "text-ink-500 hover:text-ink-200")}
          title="收藏"
        >
          <Star size={13} fill={item.starred ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={() => onQuickBlock(item)}
          className="rounded p-1 text-ink-500 hover:bg-ink-700 hover:text-red-300"
          title="屏蔽"
        >
          <Ban size={13} />
        </button>
      </div>
    </div>
  );
}

export function ItemDetail({
  item,
  sourceName,
  onClose,
  onPatch,
  onQuickBlock,
  onCopyCode,
}: {
  item: Item;
  sourceName: (id: string) => string;
  onClose: () => void;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const exp = expiresLabel(item.expires_at);
  const codes = Array.isArray(item.codes) ? item.codes : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/75 p-4 backdrop-blur-sm sm:p-10"
      onClick={onClose}
    >
      <div className="card w-full max-w-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
            <span className="rounded-full bg-ink-700/70 px-2 py-0.5 text-ink-200">{sourceName(item.source_id)}</span>
            {item.category && (
              <span className="rounded-full border border-lime/25 bg-lime/10 px-2 py-0.5 text-lime">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
            {item.is_free === 1 && (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-emerald-300">
                白嫖
              </span>
            )}
            {exp && <span className={exp.urgent ? "text-orange-400" : ""}>{exp.text}</span>}
            <span>{timeAgo(item.published_at ?? item.first_seen_at)}</span>
            <span className="font-mono">评分 {Math.round(item.score)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 hover:bg-ink-700 hover:text-ink-100"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <h2 className="text-[17px] leading-snug font-semibold text-ink-100">{item.title}</h2>
        {item.summary && (
          <p className="mt-3 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-300">{item.summary}</p>
        )}

        {codes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-2.5">
            <span className="text-[11.5px] text-amber-300">兑换码（点击复制）</span>
            {codes.map((code) => (
              <CodeChip key={code} code={code} onCopy={onCopyCode} />
            ))}
          </div>
        )}

        {item.content && item.content !== item.summary && (
          <div className="mt-3 rounded-lg bg-ink-900/70 p-3">
            <div className="mb-1 text-[11px] text-ink-500">正文快照（原帖被删或被改也留档）</div>
            <p className="max-h-[260px] overflow-auto text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-300">
              {item.content}
            </p>
          </div>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
          <div>
            <dt className="text-ink-500">首次收录</dt>
            <dd className="text-ink-300">{item.first_seen_at.replace("T", " ").slice(0, 19)}</dd>
          </div>
          <div>
            <dt className="text-ink-500">最近更新</dt>
            <dd className="text-ink-300">{item.last_seen_at.replace("T", " ").slice(0, 19)}</dd>
          </div>
          <div>
            <dt className="text-ink-500">发布时间</dt>
            <dd className="text-ink-300">{item.published_at ? item.published_at.replace("T", " ").slice(0, 19) : "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-500">截止时间</dt>
            <dd className="text-ink-300">{item.expires_at ? item.expires_at.replace("T", " ").slice(0, 19) : "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-ink-500">来源 ID</dt>
            <dd className="font-mono text-ink-400">
              {item.source_id} · {item.external_id}
            </dd>
          </div>
        </dl>

        {item.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {item.tags.map((t) => (
              <span key={t} className="rounded-md bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300">
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => {
              if (!item.read) onPatch(item.id, { read: true });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-lime/15 px-3 py-2 text-[13px] font-medium text-lime hover:bg-lime/25"
          >
            打开原文 <ArrowUpRight size={14} />
          </a>
          <button
            type="button"
            onClick={() => onPatch(item.id, { starred: !item.starred })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-ink-200 hover:border-ink-600"
          >
            <Star size={14} fill={item.starred ? "currentColor" : "none"} /> {item.starred ? "取消收藏" : "收藏"}
          </button>
          <button
            type="button"
            onClick={() => onPatch(item.id, { read: !item.read })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-ink-300 hover:border-ink-600"
          >
            <Eye size={14} /> {item.read ? "标为未读" : "标为已读"}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onQuickBlock(item);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-[13px] text-red-300 hover:bg-red-500/10"
          >
            <ShieldAlert size={14} /> 屏蔽词 / 屏蔽
          </button>
        </div>
      </div>
    </div>
  );
}

/** 点击「屏蔽」图标时打开的快捷动作弹窗：既可仅忽略这一条，也可一键从标题提取词加入全局或本源屏蔽词。 */
export function QuickBlockModal({
  item,
  sourceName,
  onClose,
  onIgnoreOne,
  onAddRule,
}: {
  item: Item;
  sourceName: (id: string) => string;
  onClose: () => void;
  onIgnoreOne: (id: number) => void;
  onAddRule: (pattern: string, scope: string) => Promise<void>;
}) {
  const candidates = extractBlockCandidates(item.title);
  const [pattern, setPattern] = useState(candidates[0] ?? "");
  const [scope, setScope] = useState("all");
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <ShieldAlert size={16} className="text-red-400" /> 屏蔽处理
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-700">
            <X size={15} />
          </button>
        </div>

        <p className="mb-3 line-clamp-2 rounded-lg bg-ink-900/70 p-2.5 text-[12.5px] text-ink-300">{item.title}</p>

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[11px] text-ink-400">点选词片快速填入屏蔽词：</div>
            <div className="flex flex-wrap gap-1">
              {candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPattern(c)}
                  className={
                    "rounded-md border px-2 py-0.5 text-[11.5px] transition-colors " +
                    (pattern === c
                      ? "border-red-400/50 bg-red-500/15 text-red-200"
                      : "border-ink-700 text-ink-300 hover:border-ink-600")
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] text-ink-400">屏蔽关键词（含该词的新老条目都会立即隐藏、不推送）</label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="输入要屏蔽的词…"
              className="w-full rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[13px] outline-none focus:border-red-400/50"
            />
          </div>

          <div className="flex gap-2 text-[12px]">
            {[
              { key: "all", label: "全部来源屏蔽" },
              { key: item.source_id, label: "仅对「" + sourceName(item.source_id) + "」生效" },
            ].map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setScope(o.key)}
                className={
                  "flex-1 truncate rounded-lg border px-2.5 py-1.5 transition-colors " +
                  (scope === o.key
                    ? "border-red-400/40 bg-red-500/10 text-red-200"
                    : "border-ink-700 text-ink-300 hover:border-ink-600")
                }
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                onIgnoreOne(item.id);
                onClose();
              }}
              className="rounded-lg border border-ink-700 px-3 py-2 text-[12.5px] text-ink-300 hover:border-ink-600"
            >
              仅隐藏这一条
            </button>
            <button
              type="button"
              disabled={!pattern.trim() || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onAddRule(pattern.trim(), scope);
                  onClose();
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-red-500/20 px-4 py-2 text-[12.5px] font-medium text-red-200 transition-colors hover:bg-red-500/30 disabled:opacity-40"
            >
              加入屏蔽规则
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
