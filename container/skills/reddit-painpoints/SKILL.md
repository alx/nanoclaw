---
name: reddit-painpoints
description: Scan Reddit for product pain points and user complaints. Activate when the user says "scan <product>", "pain points <product>", "analyze <product> on reddit", "check complaints <product>", "what do people say about <product>", or "scan <product> in <subreddits>".
allowed-tools: Bash
---

# Reddit Pain Point Scanner

Scan Reddit for complaints, frustrations, and pain points about a product. Runs a Python analysis pipeline and reports structured results back to the chat.

## When to activate

Activate on any of these patterns:

```
scan <product> in <subreddits>
scan painpoints <product> <subreddits>
pain points <product>
analyze <product> on reddit
check complaints <product>
what do people say about <product>
scan <product>
```

Examples:
```
scan Notion in productivity,nocode,startups
scan Salesforce in saas,sales,entrepreneur limit 500
pain points Figma
analyze Stripe on reddit
scan Excel
```

## Pre-flight

Check the scanner is mounted:

```bash
test -d /workspace/extra/reddit-painpoints && echo "MOUNTED" || echo "NOT_MOUNTED"
```

If NOT_MOUNTED: reply "Reddit scanner not mounted. Ask the admin to run `/add-reddit-painpoints` to set it up." and stop.

Check credentials:

```bash
grep -q REDDIT_CLIENT_ID /workspace/extra/reddit-painpoints/.env 2>/dev/null && echo "OK" || echo "MISSING"
```

If MISSING: reply "❌ Scan aborted — Reddit API credentials not configured in `reddit_painpoints/.env`." and stop.

## Parameter extraction

Parse the message to extract:

| Parameter | Source | Default |
|-----------|--------|---------|
| `PRODUCT` | noun after scan/analyze/about | required — ask if unclear |
| `SUBREDDITS` | comma list after `in`/`on` | see category defaults |
| `LIMIT` | `limit N` or `top N` | `300` |
| `MIN_SCORE` | `min-score N` or `threshold N` | `3` |
| `MIN_REDDIT_SCORE` | `min-upvotes N` | `0` |

Strip `r/` prefix from subreddits if present.

**Subreddit defaults by detected product category:**

| Category | Default subreddits |
|----------|--------------------|
| SaaS / productivity tool | `productivity,nocode,entrepreneur,startups,SideProject` |
| Finance / trading | `algotrading,investing,personalfinance,financialmodelling,SecurityAnalysis` |
| Data / developer tool | `datascience,learnpython,datasets,programming,webdev` |
| SMB / business | `smallbusiness,Entrepreneur,startups,juststart` |
| Generic fallback | `entrepreneur,startups,smallbusiness,SideProject,nocode` |

## Execution

First, send an acknowledgement:

```
Scanning Reddit for {PRODUCT} pain points across r/{SUBREDDITS}... (1–3 min)
```

Then run the scanner:

```bash
cd /workspace/extra/reddit-painpoints && \
uv run --project /workspace/extra/reddit-painpoints \
  python scripts/scan_painpoints.py \
  --product "{PRODUCT}" \
  --subreddits "{SUBREDDITS}" \
  --limit {LIMIT} \
  --min-score {MIN_SCORE} \
  --min-reddit-score {MIN_REDDIT_SCORE} \
  --top-comments 5
```

**First run only:** uv will download Python 3.12 (takes ~30–60 s). Subsequent runs use the cached venv.

Output directory: `out/{product_slug}-{YYYYMM}/` where `{product_slug}` = product lowercased, spaces → hyphens.

## Reading results

```bash
OUT="out/$(echo '{PRODUCT}' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g')-$(date +%Y%m)"
cd /workspace/extra/reddit-painpoints

TOTAL_RAW=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['total_raw'])")
TOTAL_FILTERED=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['total_filtered'])")
TOTAL_SOFT=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['total_soft_signals'])")
TOP_PHRASE=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['top_phrases'][0][0] if d['top_phrases'] else 'none')")
TOP_PHRASE_N=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['top_phrases'][0][1] if d['top_phrases'] else 0)")
VERY_NEG=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['sentiment_breakdown'].get('Very Negative',0))")
NEGATIVE=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(d['sentiment_breakdown'].get('Negative',0))")
RANK1=$(python3 -c "import json; d=json.load(open('$OUT/leaderboard.json')); e=d['entries']; print(e[0]['title'][:60] if e else 'none')")
RANK1_URL=$(python3 -c "import json; d=json.load(open('$OUT/leaderboard.json')); e=d['entries']; print(e[0]['url'] if e else '')")
RANK1_SCORE=$(python3 -c "import json; d=json.load(open('$OUT/leaderboard.json')); e=d['entries']; print(e[0]['composite_score'] if e else 0)")
SUBREDDITS_SUMMARY=$(python3 -c "import json; d=json.load(open('$OUT/report.json')); print(', '.join(f\"r/{s['name']}({s['count']})\" for s in d['subreddit_breakdown'][:5]))")
```

## Reply format

Send the summary (use `send_message` tool so it goes immediately):

```
📊 *{PRODUCT} Pain Point Scan — Complete*

📥 Collected: {TOTAL_RAW} posts
🔥 Pain posts: {TOTAL_FILTERED} (score ≥ {MIN_SCORE})
📡 Soft signals: {TOTAL_SOFT} (in publish_report.json)

🗣️ Top phrase: *"{TOP_PHRASE}"* × {TOP_PHRASE_N}
😠 Sentiment: {VERY_NEG} very negative · {NEGATIVE} negative

📌 Leaderboard #1:
"{RANK1}"
↗ composite score {RANK1_SCORE} · {RANK1_URL}

📂 Subreddits: {SUBREDDITS_SUMMARY}

📁 Output: out/{product_slug}-{YYYYMM}/
  • report.json — full pain posts
  • leaderboard.json — ranked list
  • publish_report.json — soft signals
  • report.html — visual report
```

Then send the top 3 leaderboard entries as individual messages:

```bash
python3 -c "
import json
d = json.load(open('$OUT/leaderboard.json'))
for i, e in enumerate(d['entries'][:3], 1):
    phrases = ', '.join(e.get('matched_phrases', [])[:3])
    print(f\"🥇 #{i} *{e['title'][:80]}*\nr/{e['subreddit']} · ▲{e['reddit_score']} · 💬{e['num_comments']}\nPain: {e['pain_score']} · Sentiment: {e.get('sentiment_label','')}\nPhrases: {phrases}\n{e['url']}\")
    print('---')
"
```

Send each entry as a separate `send_message` call.

## Error handling

| Condition | Action |
|-----------|--------|
| Script exits non-zero | Reply: `❌ Scan failed: {first 200 chars of stderr}` |
| `total_filtered == 0` | Reply: `⚠️ No pain posts found for {PRODUCT} in {SUBREDDITS}. Try broader subreddits or lower --min-score.` |
| Output dir missing after run | Reply: `❌ Scan produced no output. Check logs.` |
| Subreddit 404 (PRAW) | Log, skip that subreddit, continue |
