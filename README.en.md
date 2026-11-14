<div align="center">
  <img src="docs/logo.svg" alt="Resource Radar Logo" width="88" height="88" />
  <h1>Resource Radar · 资源雷达</h1>
  <p><strong>Self-hosted multi-interest aggregator &amp; AI-routed radar for freebies, deals, group buys, open-source projects, and news</strong></p>
  <p>5 Content Kinds · 21 Channel-Aware Categories · Unified Blocklist · Multi-Route Telegram Push · Zero External DB</p>

  <p>
    <a href="README.md">简体中文</a> · <a href="README.en.md">English</a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Node.js-%E2%89%A522.5-339933?logo=nodedotjs&logoColor=white" alt="Node.js" />
    <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready" />
    <img src="https://img.shields.io/badge/SQLite-Built--in-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
    <img src="https://img.shields.io/badge/React-19%20%2B%20Vite-61DAFB?logo=react&logoColor=black" alt="React" />
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License" />
  </p>
</div>

---

**Resource Radar (`freebie-radar`)** is a lightweight, self-hosted workbench that aggregates, classifies, and routes items from developer communities, gaming platforms, software giveaway feeds, GitHub, Reddit, Bluesky, Telegram channels, and custom RSS feeds.

Instead of forcing every feed into a single freebie-only filter or dumping raw RSS noise, it separates **content kind** (`freebie | deal | opensource | info | noise`), **vertical category** (21 domains), and **obtain mode** (`free | conditional | lottery | trial | promo | paid`):

- Want **strictly verified freebies**? The default **Verified Freebies** channel stays locked to AI-verified `freebie` items (`free` + `conditional`), completely isolated from paid deals, carpools, secondhand listings, or news.
- Want **Black Friday VPS deals, carpool seats, open-source releases, or tech & major news**? Switch channels in one click to get channel-specific sub-categories, noise-free live counts, responsive image-card views, and dedicated Telegram push routes.

---

> Live Demo: <https://radar.zichuanlan.top>

---

## Screenshots

| Workbench List View (Channel Tabs, Cross-Source Clustering & Code Copy) | 3-Column Visual Grid (Zero-Request Cover Extraction & 2/3-Col Cards) |
| :---: | :---: |
| ![Workbench List View](docs/ui-public.png) | ![3-Column Visual Grid](docs/ui-grid.png) |

| Multi-Route Push Editor (Per-Topic Instant/Batch Routing & Diagnostics) | AI Semantic Engine (21-Category Routing, Learning & 0-Token Reclassify) |
| :---: | :---: |
| ![Multi-Route Push Editor](docs/ui-push-panel.png) | ![AI Semantic Engine](docs/ui-ai-panel.png) |

| Mobile Responsive (<640px Collapsible Filters, Touch Targets & Compact Rows) |
| :---: |
| ![Mobile Responsive](docs/ui-mobile.png) |

---

## Key Features

### 1. Multi-Interest Channels & Orthogonal Taxonomy (`kind × category × obtain`)
- **5 Content Kinds**: `freebie` (free giveaways & credits), `deal` (Black Friday VPS, historical lows, group-buy carpools, secondhand trades), `opensource` (GitHub & self-hosted tools), `info` (breaking/finance/tech news & guides), and `noise` (filtered chatter/requests).
- **21 Categories**: `ai`, `vps`, `cloud`, `domain`, `opensource`, `software`, `dev`, `design`, `security`, `hardware`, `media`, `game`, `carpool`, `trade`, `headline`, `finance`, `news`, `goods`, `invite`, `edu`, `other`.
- **Channel-Aware Sub-Categories**: Each channel displays only its relevant sub-categories with live noise-free counts (e.g., *News* maps to `headline`, `finance`, `ai`, `dev`, `opensource`, `security`, `hardware`, while *Verified Freebies* excludes `carpool`, `trade`, and `news`). Switching channels automatically resets incompatible filters.
- **6 Obtain Modes**: Separates `free` and `conditional` from `lottery`, `trial` (including free demos), `promo`, and `paid`.

### 2. Unified Blocklist, AI Grading & Zero-Token Reclassification
- **Unified Blocklist Saves LLM Tokens**: Keyword/regex/per-source rules defined in **Subscriptions & Blocklist** hide items from the web feed, block pushes/digests, **and skip AI review & backfill** at ingestion time.
- **AI Semantic Review**: Works with any OpenAI-compatible endpoint; outputs `keep`, `kind`, `category`, `obtain`, `quality` (1–5), and a concise reason. Supports skipping pure-freebie sources, supplementary prompt rules, and adaptive preference learning from starred/ignored items.
- **Zero-Token Reclassify**: Re-run updated keyword rules across historical `other` items in one click (`POST /api/ai/reclassify`) without spending LLM tokens.

### 3. Compact List + Responsive 2/3-Column Image Cards
- Switch between **Compact List**, **2-Column Grid**, and **3-Column Grid** with persistent layout preference.
- Extracts cover images with zero extra HTTP requests across 10 collector paths (Epic, Steam, GamerPower, CheapShark, GOG, RSS `<media:content>` / `<img>`, Telegram, LINUX DO, V2EX, local CDP) and collapses the media slot cleanly on text-only items.

### 4. Multi-Route Telegram Push
- Configure global rules or create/edit independent **Topic Push Routes** (e.g., Verified Freebies Instant, Black Friday VPS Deals, Open-Source Batch Digest, News Morning Brief) with per-route kinds, categories, obtain modes, keywords, price cap, min score, instant vs. batch mode, and custom header prefix.
- Supports **Wait for AI before pushing** or **Instant-first** with automatic backfill push, plus `strict` / `rule_fallback` / `ignore_ai` fallback modes, quiet hours, and pre-send DB/blocklist re-validation.

### 5. Lightweight Stack & Single-Token Admin Gate
- Runs native TypeScript on `node:24-alpine` with built-in `node:sqlite` (WAL mode, Schema v17 auto-migration, < 100MB typical memory).
- **63 Built-in Sources (33 High-Signal Curated Enabled by Default)** plus custom RSS and local browser/Tampermonkey ingestion for login-gated sites (Zhihu, Xiaohongshu, Xiaoheihe).
- Set `ADMIN_TOKEN` to keep browsing & daily digests public while protecting all configuration and mutation endpoints.

---

## Quick Start

### Docker Compose (Recommended)

Works out of the box **even without copying `.env` first**:

```bash
git clone https://github.com/ZiChuanLan/freebie-radar.git
cd freebie-radar

# Optional: customize ADMIN_TOKEN, Telegram bot, proxy, AI, etc.
cp .env.example .env

# Start on http://127.0.0.1:8788
docker compose up -d --build
```

To also spin up **FlareSolverr** for Cloudflare-protected sources:

```bash
# Set FLARESOLVERR_URL=http://flaresolverr:8191 in .env
docker compose --profile cf up -d --build
```

Verify health & logs:

```bash
curl http://127.0.0.1:8788/health
docker compose logs -f --tail 50
```

Data persists in `./data/radar.db`. Upgrades (`git pull && docker compose up -d --build`) run SQLite migrations automatically.

### From Source (Node.js ≥ 22.5 + pnpm 10)

```bash
git clone https://github.com/ZiChuanLan/freebie-radar.git
cd freebie-radar

pnpm install
cp .env.example .env
pnpm build
pnpm start
```

Development mode:

```bash
pnpm dev        # Backend API :8788
pnpm dev:web    # Vite frontend :5173 (proxies /api to 8788)
```

---

## Configuration (`.env`)

Most policies (AI endpoint/model/prompts, multi-route push rules, block rules, source toggles/intervals, retention) are configured live in the Web Admin UI without restarts. Key process-level `.env` variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` / `HOST` | `8788` / `0.0.0.0` | HTTP listen port and host |
| `DATABASE_PATH` | `./data/radar.db` | SQLite path (`/data/radar.db` in Docker) |
| `ADMIN_TOKEN` | empty (open) | Password protecting admin tabs & write endpoints |
| `FLARESOLVERR_URL` | empty | Optional FlareSolverr URL (e.g. `http://flaresolverr:8191`) |
| `HTTP_PROXY` / `HTTPS_PROXY` | empty | Outbound proxy for collectors |
| `PUSH_CHANNEL` | `none` | Set to `telegram` to enable Telegram push |
| `TELEGRAM_BOT_TOKEN` | empty | Telegram bot token (`@BotFather`) |
| `TELEGRAM_CHAT_ID` | empty | Target Telegram chat ID |
| `TELEGRAM_PROXY` | empty | Proxy used only for Telegram requests |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | empty | Optional initial OpenAI-compatible LLM config |
| `INGEST_TOKEN` | empty | Bearer token for `POST /api/ingest` (`scripts/pw-collect.mjs` / userscript) |
| `GITHUB_TOKEN` | empty | Optional token raising GitHub API quota from 60/h to 5000/h |
| `ENABLE_SCHEDULER` | `true` | Enable built-in collection, batch push, digest & cleanup scheduler |

---

## CLI Utilities

```bash
pnpm tsx src/server/cli.ts sources              # List all 63 sources and run stats
pnpm tsx src/server/cli.ts collect [sourceId]   # Run collection immediately
pnpm tsx src/server/cli.ts enable <id...>       # Enable source(s)
pnpm tsx src/server/cli.ts disable <id...>      # Disable source(s)
pnpm tsx src/server/cli.ts reclassify           # Re-run rule classification & dedupe keys
pnpm tsx src/server/cli.ts ai-review [limit]    # Backfill AI review on pending items
pnpm tsx src/server/cli.ts daily [--dry-run]    # Run or preview daily digest
pnpm tsx src/server/cli.ts diagnose             # Diagnose push filter hits & drops
```

---

## License

[MIT](LICENSE)
