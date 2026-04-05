---
name: reddit-post-comments
description: Analyze a Reddit post's comments using the Arctic Shift API. Filters above-average scored top-level comments and their qualifying replies, tracks unique authors, runs VADER sentiment analysis, and generates a self-contained HTML report. Activate on "analyze comments [URL]", "scan comments [URL]", "top comments [URL]", "filter comments [URL]", "comment analysis [URL]", "best comments [URL]".
allowed-tools: Bash
---

# Reddit Post Comments Skill

Use this skill when the user wants to:
- Analyze the comment section of a specific Reddit post
- See which comments scored above the mean (above-average quality)
- Identify top commenters and authors in a post
- Get a quality-filtered tree view of a post's discussion with sentiment labels

## Pre-flight checks

```bash
SCAN_DIR="/workspace/extra/reddit-painpoints"

# Check workspace mount
if [ ! -d "$SCAN_DIR" ]; then
  echo "ERROR: reddit-painpoints workspace not found at $SCAN_DIR"
  echo "Ensure the reddit-painpoints project is mounted at /workspace/extra/reddit-painpoints"
  exit 1
fi

# Check Arctic Shift API reachability (no credentials needed — public API)
if ! curl -sf "https://arctic-shift.photon-reddit.com/api/posts/ids?ids=t3_1" \
     -o /dev/null --max-time 10; then
  echo "ERROR: Cannot reach Arctic Shift API"
  echo "Check network connectivity inside the container."
  exit 1
fi

echo "Pre-flight OK"
```

## Parameter extraction

Extract from the user's message:
- **POST** (required): Reddit post URL or bare base36 ID
  - Full: `https://www.reddit.com/r/python/comments/1abc123/some_title/`
  - Short: `https://redd.it/1abc123`
  - Bare ID: `1abc123`
- **REPLY_MIN_SCORE** (optional): Integer minimum score for replies. Only set if the user explicitly mentions a score threshold like "only include replies with 5+ upvotes". If not specified, omit the flag and let the script use the mean reply score.

If no post URL or ID is present in the user's message, ask: "Please share the Reddit post URL you'd like to analyze."

## Execution

```bash
SCAN_DIR="/workspace/extra/reddit-painpoints"
POST="<extracted_post_url_or_id>"

uv run --project /opt/reddit-painpoints \
  python "$SCAN_DIR/scripts/analyze_post_comments.py" \
  --post "$POST"
```

With optional reply threshold:
```bash
uv run --project /opt/reddit-painpoints \
  python "$SCAN_DIR/scripts/analyze_post_comments.py" \
  --post "$POST" \
  --reply-min-score 5
```

Watch for lines starting with `PROGRESS:` — they contain the final summary.

## Reading results

After the script completes, read the JSON report:

```bash
# Extract post ID from URL (or use as-is if already a bare ID)
POST_ID=$(echo "$POST" | grep -oP 'comments/\K[A-Za-z0-9]+' || echo "$POST")
REPORT="$SCAN_DIR/out/posts/$POST_ID/report.json"

if [ -f "$REPORT" ]; then
  cat "$REPORT"
fi
```

Key fields in `report.json`:
- `stats.total_top_level` — total top-level comments fetched
- `stats.mean_score` — mean score threshold used for filtering
- `stats.filtered_count` — comments above the mean
- `stats.reply_threshold` — minimum score used to include replies
- `stats.reply_count` — qualifying replies included
- `stats.unique_authors` — unique authors across all included comments
- `authors` — `{username: comment_count}` dict, most active first
- `filtered_comments` — array of filtered comment objects (each with `replies` array)

## Reply format

Respond with a summary like:

```
📊 **Post Comments Analysis**
**[post title]** — r/[subreddit]
▲[post_score] upvotes · [num_comments] total comments

**Filter stats:**
• Mean score: ▲[mean_score] → [filtered_count] comments above mean
• Qualifying replies: [reply_count] (score ≥ [reply_threshold])
• Unique authors tracked: [unique_authors]

**Top filtered comments:**
1. ▲[score] **u/[author]** ([sentiment]): "[body_snippet]"
2. ▲[score] **u/[author]** ([sentiment]): "[body_snippet]"
... (up to 5)

**Most active authors:**
• u/[author1] — [N] comments
• u/[author2] — [N] comments
... (up to 5)

📁 HTML report: `out/posts/[post_id]/report.html`
```

If `filtered_count` is 0 or very small, note that the post may have few comments or a high mean score, and suggest the user try a post with more engagement.
