import type { Collector, RawItem } from "./types.ts";

type RepoSpec = { repo: string; path?: string; limit?: number };

type Parsed = { title: string; url: string; description: string; section: string };

/** free-for-dev 这类清单按二级标题分节，节名就是天然的分类提示。 */
const SECTION_RULES: [RegExp, string][] = [
  [/generative ai|apis, data, and ml/i, "ai"],
  [/domain|dns|web hosting/i, "domain"],
  [/education/i, "edu"],
  [/source code|artifact|code generation|code quality|code search|ci and cd|testing|issue tracking|management system|low-code|forms|cms|translation|feature toggle|crash|monitoring|log management|messaging|security|authentication|mobile app|tools for teams|tunneling|font|email|search/i, "software"],
  [/cloud|paas|baas|iaas|cdn|storage|managed data/i, "cloud"],
];

function mapSection(section: string): string {
  for (const [re, category] of SECTION_RULES) if (re.test(section)) return category;
  return "cloud";
}

function parseMarkdownList(markdown: string, limit: number): Parsed[] {
  const out: Parsed[] = [];
  const seen = new Set<string>();
  let section = "";
  for (const line of markdown.split("\n")) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line);
    if (heading) {
      section = (heading[1] ?? "").trim();
      continue;
    }
    if (out.length >= limit) break;
    const m = /^\s*[-*+]\s+\[(.+?)\]\((https?:\/\/[^)\s]+)\)\s*[-–—:]?\s*(.*)$/.exec(line);
    if (!m) continue;
    const title = (m[1] ?? "").replace(/\*\*/g, "").trim();
    const url = (m[2] ?? "").trim();
    if (!title || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title,
      url,
      description: (m[3] ?? "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim(),
      section,
    });
  }
  return out;
}

export const githubCollector: Collector = {
  kind: "github-readme",
  label: "GitHub · 免费清单仓库",
  defaults: { config: { repos: [{ repo: "ripienaar/free-for-dev", limit: 60 }] } },
  async collect(ctx) {
    const repos = (ctx.config.repos as RepoSpec[] | undefined) ?? [{ repo: "ripienaar/free-for-dev", limit: 60 }];
    const headers: Record<string, string> = { accept: "application/vnd.github.raw" };
    const token = String(ctx.config.token ?? "") || process.env.GITHUB_TOKEN || "";
    if (token) headers.authorization = "Bearer " + token;

    const items: RawItem[] = [];
    const problems: string[] = [];

    for (const spec of repos) {
      const limit = Math.min(spec.limit ?? 60, ctx.maxItems);
      const api = "https://api.github.com/repos/" + spec.repo + "/contents/" + (spec.path ?? "README.md");
      try {
        const res = await ctx.http.text(api, { headers });
        if (res.status !== 200) {
          problems.push(spec.repo + " HTTP " + res.status);
          continue;
        }
        const parsed = parseMarkdownList(res.body, limit);
        ctx.log(spec.repo + " parsed " + parsed.length + " entries");
        for (const p of parsed) {
          items.push({
            externalId: p.url,
            url: p.url,
            title: p.title + (p.description ? " — " + p.description.slice(0, 80) : ""),
            summary: p.description,
            author: spec.repo.split("/")[0] ?? null,
            publishedAt: null,
            tags: ["github", spec.repo],
            categoryHint: mapSection(p.section),
            raw: { repo: spec.repo, section: p.section },
          });
        }
      } catch (err) {
        problems.push(spec.repo + " " + (err instanceof Error ? err.message : String(err)));
      }
    }

    return {
      items: items.slice(0, ctx.maxItems),
      cursor: null,
      degraded: problems.length ? problems.join("; ") : null,
    };
  },
};
