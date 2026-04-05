---
name: reddit-author-persona
description: Analyze a Reddit user's comment history via Arctic Shift API. Builds a persona profile (karma, sentiment, activity patterns, top subreddits, top comments) and assigns a persona label. Generates an individual profile page and a photobook-style HTML index of all analyzed authors with JS sort and filter. Activate on "analyze author u/[name]", "persona u/[name]", "who is u/[name] on reddit", "author analysis [name]", "author index", "author board", "show author profiles", "reddit author leaderboard".
allowed-tools: Bash
---

# Reddit Author Persona Skill

Use this skill when the user wants to:
- Profile a specific Reddit user (comment history, persona, top activity)
- See a photobook/dashboard of all previously analyzed Reddit authors
- Re-render the author index after multiple profiles have been built

## Modes

**Mode 1 — Single author:** User mentions a Reddit username (u/username or just username).

**Mode 2 — Author index only:** User asks for "author index", "author board", "show author profiles", "reddit author leaderboard", or similar — no specific username mentioned.

---

## Pre-flight checks

```bash
SCAN_DIR="/workspace/extra/reddit-painpoints"

if [ ! -d "$SCAN_DIR" ]; then
  echo "ERROR: reddit-painpoints workspace not found at $SCAN_DIR"
  exit 1
fi

if ! curl -sf "https://arctic-shift.photon-reddit.com/api/posts/ids?ids=t3_1" \
     -o /dev/null --max-time 10; then
  echo "ERROR: Cannot reach Arctic Shift API"
  exit 1
fi

echo "Pre-flight OK"
```

---

## Mode 1: Single author analysis

### Parameter extraction

- **USERNAME** (required): Reddit username. Strip leading `u/` if present. Ask if not found in message.
- **LIMIT** (optional): Number of comments to fetch. Default 500. Use a smaller value (e.g. 100) if user says "quick" or "fast". Max practical: 1000.

### Execution

```bash
SCAN_DIR="/workspace/extra/reddit-painpoints"
USERNAME="<extracted_username>"

uv run --project /opt/reddit-painpoints \
  python "$SCAN_DIR/scripts/analyze_author.py" \
  --username "$USERNAME" \
  --limit 500
```

Watch for lines starting with `PROGRESS:` — they contain the final summary.

### Reading results

```bash
PROFILE="$SCAN_DIR/out/authors/$USERNAME/profile.json"
if [ -f "$PROFILE" ]; then
  cat "$PROFILE"
fi
```

Key fields in `profile.json`:
- `persona_label` — one of: Domain Expert, Power User, Niche Specialist, Helpful Answerer, Controversy Seeker, Casual Contributor
- `total_comments_fetched` — comments analyzed
- `total_karma` — sum of all comment scores
- `avg_score` — mean score per comment
- `avg_controversiality` — mean controversiality (0–1)
- `top_subreddits` — `[{name, count, avg_score}]` sorted by activity
- `sentiment_distribution` — `{label: count}` for 5 sentiment levels
- `top_comments` — top 5 comments by score with body, subreddit, url
- `activity_hours` — `{"0"..  "23": count}` hour-of-day distribution
- `avg_comment_length` — mean character count
- `first_seen` / `last_seen` — unix timestamps

### Persona label definitions

| Label | Criteria |
|---|---|
| Niche Specialist | >80% of comments in one subreddit |
| Domain Expert | Top subreddit >60% AND avg score >10 |
| Power User | ≥200 comments, ≥5 subreddits, avg score >5 |
| Helpful Answerer | avg score ≥15, >50% positive sentiment |
| Controversy Seeker | >40% negative sentiment OR avg controversiality >0.3 |
| Casual Contributor | All other cases |

### Reply format

```
👤 **u/[username]** — [PERSONA_LABEL]

📊 [total] comments · ▲[total_karma] karma · avg ▲[avg_score]
🏠 Top subreddit: r/[top_sub] ([pct]% of activity)
😐 Sentiment: [pos]% positive · [neg]% negative
📝 Avg length: [avg_len] chars · Active: [first_seen] → [last_seen]

🏆 Top comment (▲[top_score]):
"[top_comment_body]…"
r/[top_sub] — [link]

📁 Profile: `out/authors/[username]/profile.html`
📚 Author index: `out/authors/index.html`
```

---

## Mode 2: Author index only

Use when the user asks for the author board/index without specifying a username.

### Execution

```bash
SCAN_DIR="/workspace/extra/reddit-painpoints"

uv run --project /opt/reddit-painpoints \
  python "$SCAN_DIR/scripts/analyze_author.py" \
  --index-only
```

### Reply format

```
📚 **Author Index updated**

[N] authors in the database.

**Personas represented:**
• [count]× Domain Expert
• [count]× Power User
• [count]× Niche Specialist
... etc.

📁 Open: `out/authors/index.html`

The index has sortable columns (karma, avg score, comment count, last seen)
and filter chips by persona and top subreddit.
```

If the DB is empty (no profiles yet), tell the user to analyze at least one author first:
`"No author profiles found. Try: 'analyze author u/someusername'"`
