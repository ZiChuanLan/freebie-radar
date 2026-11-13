import { all, get, migrate, run } from "./db.ts";
import { enrichItem, isCategory } from "./enrich/index.ts";
import { calibrateScoreByObtain, resolveDbMergeKey } from "./enrich/alias.ts";
import { reviewItems } from "./enrich/ai.ts";
import { runAll, runSource, ensureSources } from "./collectors/index.ts";
import { lastDigests, runDaily } from "./digest.ts";
import { getPushSettings, passesPushFilters } from "./push.ts";
import { guessObtain } from "./enrich/obtain.ts";
const [cmd = "help", ...args] = process.argv.slice(2);
migrate();
ensureSources();

async function main() {
  switch (cmd) {
    case "collect": {
      if (args.length) {
        for (const id of args) await runSource(id);
      } else {
        const results = await runAll();
        const failed = results.filter((r) => r.status === "failed").length;
        console.log(`[collect] done: ${results.length} sources, ${failed} failed, ${results.reduce((n, r) => n + r.inserted, 0)} inserted`);
        if (failed && failed === results.length) process.exitCode = 1;
      }
      break;
    }
    case "sources": {
      const rows = all<Record<string, unknown>>("SELECT id, name, kind, enabled, last_status, last_run_at, cursor FROM sources ORDER BY id");
      for (const r of rows) console.log(`${r.enabled ? "on " : "off"} ${r.id}\t${r.kind}\t${r.last_status ?? "-"}\t${r.last_run_at ?? "-"}\tcursor=${r.cursor ?? "-"}`);
      break;
    }
    case "enable": {
      for (const id of args) run("UPDATE sources SET enabled = 1 WHERE id = ?", id);
      console.log("enabled:", args.join(","));
      break;
    }
    case "disable": {
      for (const id of args) run("UPDATE sources SET enabled = 0 WHERE id = ?", id);
      console.log("disabled:", args.join(","));
      break;
    }
    case "config": {
      const [id, json] = args;
      if (!id || json === undefined) throw new Error("usage: config <sourceId> <json>");
      JSON.parse(json);
      run("UPDATE sources SET config = ? WHERE id = ?", json, id);
      console.log("config updated:", id);
      break;
    }
    case "daily": {
      const dryRun = args.includes("--dry-run");
      const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
      const date = dateArg ? new Date(dateArg + "T08:00:00") : new Date();
      const result = await runDaily({ dryRun, date });
      if (!dryRun) console.log("[daily] " + result.date + " count=" + result.count + " pushed=" + result.pushed);
      break;
    }
    case "digests": {
      console.log(lastDigests(10));
      break;
    }
    case "reclassify": {
      // 规则调整后重算历史条目的分类 / 标签 / 评分 / title_key（保留 ignored 状态与 AI 结论）
      const rows = all<{
        id: number; source_id: string; external_id: string; url: string; title: string;
        summary: string | null; author: string | null; published_at: string | null;
        expires_at: string | null; tags: string; category: string | null;
        ai: string | null; ai_keep: number | null; obtain: string | null;
      }>("SELECT id, source_id, external_id, url, title, summary, author, published_at, expires_at, tags, category, ai, ai_keep, obtain FROM items");
      let changed = 0;
      for (const row of rows) {
        let tags: string[] = [];
        try { tags = JSON.parse(row.tags) as string[]; } catch { tags = []; }
        const e = enrichItem({
          externalId: row.external_id,
          url: row.url,
          title: row.title,
          summary: row.summary ?? "",
          author: row.author,
          publishedAt: row.published_at,
          expiresAt: row.expires_at,
          tags,
        }, row.source_id);
        if (!e) continue;
        let finalCategory = e.category;
        if (row.ai) {
          try {
            const parsed = JSON.parse(row.ai) as { category?: string };
            if (isCategory(parsed.category)) finalCategory = parsed.category;
          } catch { /* ignore */ }
        }
        if (finalCategory !== row.category) changed += 1;
        const aiKeepBool = row.ai_keep === null ? null : row.ai_keep === 1;
        const finalScore = calibrateScoreByObtain(e.score, row.obtain, aiKeepBool);
        const titleKey = resolveDbMergeKey(row.title);
        run(
          "UPDATE items SET category = ?, tags = ?, score = ?, expires_at = ?, price = ?, is_free = ?, codes = ?, title_key = ?, status = CASE WHEN status = 'ignored' THEN 'ignored' ELSE ? END WHERE id = ?",
          finalCategory, JSON.stringify(e.tags), finalScore, e.expiresAt,
          e.price, e.isFree ? 1 : 0, JSON.stringify(e.codes), titleKey,
          e.keep ? "active" : "expired", row.id,
        );
      }
      console.log("[reclassify] " + rows.length + " items, category changed " + changed);
      break;
    }
    case "ai-review": {
      // 补审历史条目：AI 上线前入库的 item 没有 verdict，会导致新闻/提问混进推送
      const limit = Number(args[0] ?? 200);
      const rows = all<{
        id: number;
        source_id: string;
        external_id: string;
        title: string;
        summary: string | null;
        url: string;
        score: number;
        category: string | null;
      }>(
        `SELECT id, source_id, external_id, title, summary, url, score, category
         FROM items WHERE status = 'active' AND ai IS NULL
         ORDER BY COALESCE(published_at, first_seen_at) DESC LIMIT ?`,
        limit,
      );
      if (!rows.length) {
        console.log("[ai-review] 没有待审条目");
        break;
      }
      let rejected = 0;
      let reviewed = 0;
      const CHUNK = 20;
      for (let start = 0; start < rows.length; start += CHUNK) {
        const chunk = rows.slice(start, start + CHUNK);
        const raws = chunk.map((r) => ({
          externalId: r.external_id,
          url: r.url,
          title: r.title,
          summary: r.summary ?? "",
        }));
        const map = await reviewItems(raws as never).catch(() => null);
        if (!map) {
          console.log("[ai-review] 第 " + start + " 批失败，跳过");
          continue;
        }
        for (let i = 0; i < chunk.length; i += 1) {
          const row = chunk[i]!;
          const v = map.get(i);
          if (!v) continue;
          reviewed += 1;
          if (!v.keep) rejected += 1;
          run(
            "UPDATE items SET ai = ?, ai_keep = ?, score = ?, category = ? WHERE id = ?",
            JSON.stringify(v),
            v.keep ? 1 : 0,
            v.keep ? row.score : Math.round(row.score * 0.5),
            v.category || row.category,
            row.id,
          );
        }
        process.stdout.write(".");
      }
      console.log("");
      console.log("[ai-review] 送审 " + rows.length + "，有结论 " + reviewed + "，判非福利 " + rejected);
      break;
    }
    case "stats": {
      console.log(get("SELECT COUNT(*) AS items FROM items"));
      console.log(get("SELECT source_id, COUNT(*) AS n FROM items GROUP BY source_id"));
      break;
    }
    case "diagnose": {
      // 推送体检：确认全套筛选下没有非白嫖条目漏进来，并给出各维度分布
      const s = getPushSettings();
      console.log("筛选条件", JSON.stringify({ maxPrice: s.maxPrice, obtainModes: s.obtainModes, onlyAiKeep: s.onlyAiKeep, langMode: s.langMode, categories: s.categories }));
      const rows = all<{
        title: string;
        score: number;
        codes: string;
        price: number | null;
        is_free: number;
        obtain: string | null;
        ai: string | null;
        category: string | null;
      }>(
        `SELECT title, score, codes, price, is_free, obtain, ai, category FROM items
         WHERE status = 'active' AND pushed_at IS NULL AND COALESCE(published_at, first_seen_at) >= ?
         ORDER BY score DESC LIMIT 500`,
        new Date(Date.now() - 7 * 86_400_000).toISOString(),
      );
      const pass: Record<string, number> = {};
      for (const r of rows) {
        const aiKeep = r.ai ? (JSON.parse(r.ai) as { keep?: boolean }).keep ?? null : null;
        const ok = passesPushFilters(
          { title: r.title, score: r.score, codes: JSON.parse(r.codes || "[]"), price: r.price, isFree: r.is_free === 1, aiKeep, category: r.category, obtain: r.obtain },
          s,
        );
        if (ok) pass[r.obtain ?? "?"] = (pass[r.obtain ?? "?"] ?? 0) + 1;
      }
      console.log("候选池", rows.length, "通过筛选", JSON.stringify(pass));
      const leak = Object.keys(pass).filter((k) => k !== "free" && k !== "conditional");
      console.log(leak.length ? "⚠️  非白嫖泄漏: " + leak.join(",") : "✅ 没有抽奖/试用/推广/需付费条目漏进推送");
      break;
    }
    case "obtain": {
      // 重新判定全库获取方式（AI 提示词更新后跑一次）
      const rows = all<{ id: number; title: string; summary: string | null; ai: string | null }>(
        "SELECT id, title, summary, ai FROM items WHERE obtain IS NULL OR ? = 1",
        args.includes("--all") ? 1 : 0,
      );
      const dist: Record<string, number> = {};
      for (const r of rows) {
        let fromAi: string | null = null;
        if (r.ai) {
          try {
            fromAi = (JSON.parse(r.ai) as { obtain?: string }).obtain ?? null;
          } catch {
            fromAi = null;
          }
        }
        const mode = fromAi ?? guessObtain(r.title, r.summary ?? "");
        dist[mode] = (dist[mode] ?? 0) + 1;
        run("UPDATE items SET obtain = ? WHERE id = ?", mode, r.id);
      }
      console.log(`[obtain] ${rows.length} 条`, JSON.stringify(dist));
      break;
    }
    default:
      console.log(
        "usage: cli.ts <collect [sourceId...] | sources | enable <id...> | disable <id...> | config <id> <json> | reclassify | ai-review [limit] | obtain [--all] | diagnose | stats>",
      );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
