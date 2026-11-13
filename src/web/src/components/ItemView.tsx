import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  ShieldAlert,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { CATEGORY_LABEL, OBTAIN_HINT, OBTAIN_LABEL, expiresLabel, extractBlockCandidates, timeAgo } from "../lib/sources.ts";
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
        window.setTimeout(() => setCopied(false), 1400);
      }}
      className={
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors " +
        (copied
          ? "border-deal-border bg-deal-subtle text-deal"
          : "border-code-border bg-code-subtle text-amber-800 hover:bg-amber-100/80")
      }
      title="点击复制兑换码"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {code}
    </button>
  );
}

function PriceBadge({ item }: { item: Item }) {
  if (item.is_free === 1 || item.price === 0) {
    return (
      <span className="inline-flex items-center rounded-md border border-deal-border bg-deal-subtle px-1.5 py-0.5 text-[11px] font-medium text-deal">
        免费
      </span>
    );
  }
  if (typeof item.price === "number" && item.price > 0) {
    const label = item.price < 1 ? "<1 元" : Math.round(item.price) + " 元内";
    return (
      <span className="inline-flex items-center rounded-md border border-brand-border bg-brand-subtle px-1.5 py-0.5 text-[11px] font-medium text-brand">
        {label}
      </span>
    );
  }
  return null;
  return null;
}

const OBTAIN_STYLE: Record<string, string> = {
  conditional: "border-amber-300 bg-amber-50 text-amber-800",
  lottery: "border-purple-300 bg-purple-50 text-purple-700",
  trial: "border-sky-300 bg-sky-50 text-sky-700",
  promo: "border-slate-300 bg-slate-100 text-slate-600",
  paid: "border-slate-300 bg-slate-100 text-slate-600",
};

/** 获取方式徽章：非 free 的一律标出来，避免抽奖/试用/推广混进「完全白嫖」。 */
function ObtainBadge({ obtain }: { obtain: string | null | undefined }) {
  const mode = obtain ?? "free";
  if (mode === "free") return null;
  return (
    <span
      className={
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium " +
        (OBTAIN_STYLE[mode] ?? OBTAIN_STYLE.promo)
      }
      title={OBTAIN_HINT[mode] ?? ""}
    >
      {OBTAIN_LABEL[mode] ?? mode}
    </span>
  );
}

/** 默认的精致紧凑列表行：在纯白面板里用 1px 细线分隔，扫货效率最高。 */
export function CompactRow({
  item,
  sourceName,
  selected,
  onPatch,
  onOpen,
  onQuickBlock,
  onToggleRelated,
  expanded,
  onCopyCode,
}: {
  item: Item;
  sourceName: (id: string) => string;
  selected?: boolean;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
  /** 合并组：展开/收起同福利的其他来源 */
  onToggleRelated?: (id: number) => void;
  expanded?: boolean;
}) {
  const exp = expiresLabel(item.expires_at);
  const codes = Array.isArray(item.codes) ? item.codes : [];
  const matched = Array.isArray(item.matched) ? item.matched : [];
  const aiRejected = item.ai?.keep === false;

  return (
    <div
      onClick={() => onOpen(item)}
      className={
        "group flex cursor-pointer items-start gap-3 border-b border-ink-100 px-4 py-3 transition-colors last:border-b-0 " +
        (selected ? "bg-brand-subtle/50" : "hover:bg-surface-hover") +
        (item.read ? " opacity-60 hover:opacity-100" : "")
      }
    >
      {/* 评分 + 未读小点 */}
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <span
          className={
            "h-2 w-2 rounded-full " + (item.read ? "bg-transparent" : "bg-brand")
          }
          title={item.read ? "已读" : "未读"}
        />
        <span
          className={
            "inline-flex w-8 justify-center rounded-md px-1 py-0.5 font-mono text-[11px] font-semibold tabular-nums " +
            (item.score >= 70
              ? "bg-deal-subtle text-deal"
              : item.score >= 45
                ? "bg-ink-100 text-ink-700"
                : "bg-ink-100 text-ink-500")
          }
          title="综合评分"
        >
          {Math.round(item.score)}
        </span>
      </div>

      {/* 主信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span
            className={
              "text-[14px] leading-snug font-medium text-ink-950 transition-colors group-hover:text-brand " +
              (aiRejected ? "line-through decoration-ink-300" : "")
            }
          >
            {item.title}
          </span>
          {matched.length > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
              订阅：{matched.join("/")}
            </span>
          )}
          {(item.dupCount ?? 1) > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleRelated?.(item.id);
              }}
              title="同一福利被多个源报道，点击看全部来源"
              className="rounded bg-brand-subtle px-1.5 py-0.5 text-[11px] font-medium text-brand hover:bg-brand hover:text-white"
            >
              {expanded ? "收起" : `${item.dupCount} 个来源`}
            </button>
          )}
          {item.blockedBy && (
            <span className="rounded bg-alert-subtle px-1.5 py-0.5 text-[11px] text-alert">
              屏蔽命中：{item.blockedBy}
            </span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-500">
          <span className="font-medium text-ink-700">{sourceName(item.source_id)}</span>
          <span>·</span>
          <span>{CATEGORY_LABEL[item.category ?? "other"] ?? item.category}</span>
          <PriceBadge item={item} />
          <ObtainBadge obtain={item.obtain} />
          {item.ai?.reason && (
            <span
              className={
                "inline-flex items-center gap-1 " +
                (item.ai.keep === false ? "text-ink-400" : "text-deal")
              }
            >
              <Sparkles size={10} />
              {item.ai.reason}
            </span>
          )}
          {exp && (
            <span className={"inline-flex items-center gap-0.5 " + (exp.urgent ? "font-medium text-amber-700" : "")}>
              <Clock3 size={10} /> {exp.text}
            </span>
          )}
          <span className="tabular-nums text-ink-400">{timeAgo(item.published_at ?? item.first_seen_at)}</span>
        </div>
      </div>

      {/* 右端：兑换码 & 快捷操作 */}
      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {codes.slice(0, 2).map((code) => (
          <CodeChip key={code} code={code} onCopy={onCopyCode} />
        ))}
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => {
            if (!item.read) onPatch(item.id, { read: true });
          }}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-brand"
          title="新标签打开原帖"
        >
          <ArrowUpRight size={15} />
        </a>
        <button
          type="button"
          onClick={() => onPatch(item.id, { starred: !item.starred })}
          className={
            "rounded-lg p-1.5 transition-colors hover:bg-ink-100 " +
            (item.starred ? "text-amber-500" : "text-ink-400 hover:text-ink-700")
          }
          title={item.starred ? "取消收藏" : "收藏"}
        >
          <Star size={14} fill={item.starred ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={() => onQuickBlock(item)}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-alert-subtle hover:text-alert"
          title="加入屏蔽词 / 屏蔽"
        >
          <Ban size={14} />
        </button>
        <button
          type="button"
          onClick={() => onPatch(item.id, { status: item.status === "ignored" ? "active" : "ignored" })}
          className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
          title={item.status === "ignored" ? "恢复到列表" : "不想看，从列表移除（可在「已关闭」找回）"}
        >
          <EyeOff size={14} />
        </button>
      </div>
    </div>
  );
}

/** 舒适卡片视图（可选切换） */
export function ItemCard({
  item,
  sourceName,
  onPatch,
  onOpen,
  onQuickBlock,
  onCopyCode,
  onToggleRelated,
  expanded,
}: {
  item: Item;
  sourceName: (id: string) => string;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onOpen: (item: Item) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
  onToggleRelated?: (id: number) => void;
  expanded?: boolean;
}) {
  const exp = expiresLabel(item.expires_at);
  const codes = Array.isArray(item.codes) ? item.codes : [];
  const matched = Array.isArray(item.matched) ? item.matched : [];

  return (
    <article
      onClick={() => onOpen(item)}
      className={
        "panel group cursor-pointer p-4 transition-all hover:border-ink-300 " +
        (item.read ? "opacity-65 hover:opacity-100" : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-500">
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-medium text-ink-700">
              {sourceName(item.source_id)}
            </span>
            {item.category && (
              <span className="rounded-md bg-brand-subtle px-2 py-0.5 font-medium text-brand">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
            <PriceBadge item={item} />
            <ObtainBadge obtain={item.obtain} />
            {exp && (
              <span className={"inline-flex items-center gap-1 " + (exp.urgent ? "font-medium text-amber-700" : "")}>
                <Clock3 size={11} /> {exp.text}
              </span>
            )}
            <span className="tabular-nums">{timeAgo(item.published_at ?? item.first_seen_at)}</span>
          </div>

          <h3 className="text-[15px] leading-snug font-semibold text-ink-950 transition-colors group-hover:text-brand">
            {item.title}
            {(item.dupCount ?? 1) > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleRelated?.(item.id);
                }}
                title="同一福利被多个源报道，点击看全部来源"
                className="ml-2 rounded bg-brand-subtle px-1.5 py-0.5 align-middle text-[11px] font-medium text-brand hover:bg-brand hover:text-white"
              >
                {expanded ? "收起" : `${item.dupCount} 个来源`}
              </button>
            )}
          </h3>

          {item.summary && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-600">{item.summary}</p>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {matched.length > 0 && (
              <span className="rounded-md border border-code-border bg-code-subtle px-2 py-0.5 text-[11px] font-medium text-amber-800">
                订阅命中：{matched.join(" / ")}
              </span>
            )}
            {codes.map((code) => (
              <CodeChip key={code} code={code} onCopy={onCopyCode} />
            ))}
            {item.ai?.reason && (
              <span
                className={
                  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] " +
                  (item.ai.keep === false ? "bg-ink-100 text-ink-500" : "bg-deal-subtle text-deal")
                }
              >
                <Sparkles size={10} /> {item.ai.reason}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <span
            className={
              "inline-flex min-w-8 justify-center rounded-lg px-2 py-1 font-mono text-xs font-semibold tabular-nums " +
              (item.score >= 70 ? "bg-deal-subtle text-deal" : "bg-ink-100 text-ink-700")
            }
          >
            {Math.round(item.score)}
          </span>
          <div className="flex items-center gap-0.5">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={() => {
                if (!item.read) onPatch(item.id, { read: true });
              }}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-brand"
              title="打开原文"
            >
              <ArrowUpRight size={15} />
            </a>
            <button
              type="button"
              onClick={() => onPatch(item.id, { starred: !item.starred })}
              className={
                "rounded-lg p-1.5 hover:bg-ink-100 " +
                (item.starred ? "text-amber-500" : "text-ink-400 hover:text-ink-700")
              }
              title={item.starred ? "取消收藏" : "收藏"}
            >
              <Star size={14} fill={item.starred ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              onClick={() => onQuickBlock(item)}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-alert-subtle hover:text-alert"
              title="屏蔽"
            >
              <Ban size={14} />
            </button>
            <button
              type="button"
              onClick={() => onPatch(item.id, { status: item.status === "ignored" ? "active" : "ignored" })}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              title={item.status === "ignored" ? "恢复到列表" : "不想看，从列表移除（可在「已关闭」找回）"}
            >
              <EyeOff size={14} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** 右侧滑出详情抽屉（按 Esc 关闭，↑/↓ 可在列表上下切换） */
export function ItemDetailDrawer({
  item,
  sourceName,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onPatch,
  onQuickBlock,
  onCopyCode,
}: {
  item: Item;
  sourceName: (id: string) => string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onPatch: (id: number, body: Record<string, unknown>) => void;
  onQuickBlock: (item: Item) => void;
  onCopyCode: (code: string) => void;
}) {
  const exp = expiresLabel(item.expires_at);
  const codes = Array.isArray(item.codes) ? item.codes : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowUp" && hasPrev) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === "ArrowDown" && hasNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, hasPrev, hasNext, onPrev, onNext]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/25 backdrop-blur-[1px]" onClick={onClose}>
      <aside
        className="drawer-shadow flex h-full w-full max-w-[500px] flex-col border-l border-ink-200 bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏 */}
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!hasPrev}
              onClick={onPrev}
              className="rounded-lg border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              title="上一条 (↑)"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              disabled={!hasNext}
              onClick={onNext}
              className="rounded-lg border border-ink-200 p-1.5 text-ink-600 hover:bg-ink-100 disabled:opacity-30"
              title="下一条 (↓)"
            >
              <ChevronDown size={14} />
            </button>
            <span className="ml-2 text-[12px] text-ink-500">{sourceName(item.source_id)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
            title="关闭 (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            {item.category && (
              <span className="rounded-md bg-brand-subtle px-2 py-0.5 font-medium text-brand">
                {CATEGORY_LABEL[item.category] ?? item.category}
              </span>
            )}
            <PriceBadge item={item} />
            <ObtainBadge obtain={item.obtain} />
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-ink-700">
              评分 {Math.round(item.score)}
            </span>
            {exp && (
              <span className={"inline-flex items-center gap-1 " + (exp.urgent ? "font-medium text-amber-700" : "text-ink-500")}>
                <Clock3 size={11} /> {exp.text}
              </span>
            )}
          </div>

          <h2 className="text-[17px] leading-snug font-semibold text-ink-950">{item.title}</h2>

          {item.ai?.reason && (
            <div
              className={
                "flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] " +
                (item.ai.keep === false
                  ? "border-ink-200 bg-ink-100/70 text-ink-600"
                  : "border-deal-border bg-deal-subtle text-emerald-900")
              }
            >
              <Sparkles size={14} className={item.ai.keep === false ? "text-ink-500" : "text-deal"} />
              <span>
                <strong>AI 判定：</strong>
                {item.ai.keep === false ? "非福利内容 · " : "可领取福利 · "}
                {item.ai.reason}
              </span>
            </div>
          )}

          {codes.length > 0 && (
            <div className="rounded-xl border border-code-border bg-code-subtle p-3.5">
              <div className="mb-2 text-[12px] font-medium text-amber-900">提取到的兑换码（点击复制）</div>
              <div className="flex flex-wrap gap-2">
                {codes.map((code) => (
                  <CodeChip key={code} code={code} onCopy={onCopyCode} />
                ))}
              </div>
            </div>
          )}

          {item.summary && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-ink-500">摘要</div>
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-700">{item.summary}</p>
            </div>
          )}

          {item.content && item.content !== item.summary && (
            <div className="rounded-xl border border-ink-200 bg-surface-hover p-3.5">
              <div className="mb-1.5 text-[12px] font-medium text-ink-500">正文快照（原帖被删也能留档）</div>
              <p className="max-h-[260px] overflow-auto text-[12.5px] leading-relaxed whitespace-pre-wrap text-ink-700">
                {item.content}
              </p>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-ink-200 bg-surface-hover p-3.5 text-[12px]">
            <div>
              <dt className="text-ink-500">发布时间</dt>
              <dd className="mt-0.5 font-mono text-ink-900">
                {item.published_at ? item.published_at.replace("T", " ").slice(0, 19) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">截止时间</dt>
              <dd className="mt-0.5 font-mono text-ink-900">
                {item.expires_at ? item.expires_at.replace("T", " ").slice(0, 19) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">收录时间</dt>
              <dd className="mt-0.5 font-mono text-ink-900">{item.first_seen_at.replace("T", " ").slice(0, 19)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">来源 ID</dt>
              <dd className="mt-0.5 truncate font-mono text-ink-700">{item.source_id}</dd>
            </div>
          </dl>

          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((t) => (
                <span key={t} className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">
                  #{t}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 底部动作栏 */}
        <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 bg-surface-hover px-5 py-3.5">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => {
              if (!item.read) onPatch(item.id, { read: true });
            }}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-brand-hover"
          >
            打开原帖领取 <ArrowUpRight size={14} />
          </a>
          <button
            type="button"
            onClick={() => onPatch(item.id, { starred: !item.starred })}
            className={
              "inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-[13px] transition-colors " +
              (item.starred
                ? "border-amber-300 bg-code-subtle text-amber-800"
                : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
            }
          >
            <Star size={14} fill={item.starred ? "currentColor" : "none"} /> {item.starred ? "已收藏" : "收藏"}
          </button>
          <button
            type="button"
            onClick={() => onPatch(item.id, { read: !item.read })}
            className="inline-flex items-center gap-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[13px] text-ink-700 hover:bg-ink-100"
          >
            <Eye size={14} /> {item.read ? "标未读" : "标已读"}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              onQuickBlock(item);
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-alert-border bg-alert-subtle px-3 py-2 text-[13px] text-alert hover:bg-red-100/80"
          >
            <ShieldAlert size={14} /> 屏蔽
          </button>
          <button
            type="button"
            onClick={() => {
              onPatch(item.id, { status: "ignored" });
              onClose();
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[13px] text-ink-700 hover:bg-ink-100"
            title="单纯不想看，不进屏蔽词"
          >
            <EyeOff size={14} /> 关闭
          </button>
        </div>
      </aside>
    </div>
  );
}

/** 快捷屏蔽弹窗 */
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/30 p-4 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div className="panel w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[14.5px] font-semibold text-ink-950">
            <ShieldAlert size={16} className="text-alert" /> 屏蔽处理
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-500 hover:bg-ink-100">
            <X size={15} />
          </button>
        </div>

        <p className="mb-3 line-clamp-2 rounded-xl border border-ink-200 bg-surface-hover p-2.5 text-[12.5px] text-ink-700">
          {item.title}
        </p>

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 text-[12px] text-ink-500">点选标题关键词快速加入屏蔽：</div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPattern(c)}
                  className={
                    "rounded-lg border px-2 py-1 text-[12px] transition-colors " +
                    (pattern === c
                      ? "border-alert-border bg-alert-subtle font-medium text-alert"
                      : "border-ink-200 bg-surface text-ink-700 hover:bg-ink-100")
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[12px] text-ink-500">
              屏蔽关键词（命中该词的新老条目都会隐藏，且不推 Telegram）
            </label>
            <input
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              placeholder="输入要屏蔽的关键词…"
              className="w-full rounded-xl border border-ink-200 bg-surface px-3 py-2 text-[13px] text-ink-950 outline-none focus:border-brand"
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
                  "flex-1 truncate rounded-xl border px-2.5 py-2 transition-colors " +
                  (scope === o.key
                    ? "border-alert-border bg-alert-subtle font-medium text-alert"
                    : "border-ink-200 text-ink-600 hover:bg-ink-100")
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
              className="rounded-xl border border-ink-200 px-3 py-2 text-[12.5px] text-ink-600 hover:bg-ink-100"
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
              className="rounded-xl bg-alert px-4 py-2 text-[12.5px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
            >
              加入屏蔽规则
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
