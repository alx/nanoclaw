# Add Reddit Pain Point Scanner

Configure the Reddit pain point scanner skill. This skill lets the agent respond to messages like "scan Notion in productivity,nocode" by running a Python analysis pipeline and returning structured results.

**Principle:** Run steps automatically. Only pause when user action is required (API credentials, path confirmation).

## Phase 1: Pre-flight

Check if already configured:

```bash
ls container/skills/reddit-painpoints/SKILL.md 2>/dev/null && echo "SKILL_INSTALLED" || echo "NOT_INSTALLED"
sqlite3 store/messages.db "SELECT config FROM registered_groups WHERE is_main=1" 2>/dev/null | grep -q "reddit-painpoints" && echo "MOUNT_CONFIGURED" || echo "MOUNT_MISSING"
```

If SKILL_INSTALLED and MOUNT_CONFIGURED: confirm with user — re-configure, update path, or skip.

Ask for the project path:

AskUserQuestion: "Where is your `reddit_painpoints` project?"
- `/home/alx/code/reddit_painpoints` (detected default)
- Another path (use Other to type it)

Verify the path:

```bash
test -f "{PROJECT_PATH}/scripts/scan_painpoints.py" && echo "OK" || echo "MISSING"
```

If MISSING: stop and tell the user the project wasn't found at that path.

## Phase 2: Apply Code Changes

Check if the Dockerfile already has uv:

```bash
grep -q 'UV_INSTALL_DIR' container/Dockerfile && echo "ALREADY_PATCHED" || echo "NEEDS_PATCH"
```

If NEEDS_PATCH: the skill branch must be merged. Run:

```bash
git fetch origin skill/reddit-painpoints
git merge origin/skill/reddit-painpoints
```

Resolve any conflicts (package-lock.json: keep HEAD via `git checkout --theirs package-lock.json`).

If ALREADY_PATCHED: continue.

Rebuild the container to install Python + uv:

```bash
./container/build.sh
```

**Note:** The build adds Python 3 and uv. First-run scans will also download Python 3.12 (cached in the project's `.venv/` on the host).

## Phase 3: Mount Allowlist

Read the current allowlist:

```bash
cat ~/.config/nanoclaw/mount-allowlist.json 2>/dev/null || echo "NOT_FOUND"
```

Add the project's parent directory as an allowed root. Preserve any existing `allowedRoots` entries and merge:

```bash
npx tsx setup/index.ts --step mounts -- --json '{"allowedRoots":[{"path":"{PROJECT_PARENT}","allowReadWrite":true}],"blockedPatterns":[],"nonMainReadOnly":true}'
```

where `{PROJECT_PARENT}` is the parent of the project path (e.g. `/home/alx/code` if project is `/home/alx/code/reddit_painpoints`).

**Important:** `nonMainReadOnly: true` means the mount is read-only in non-main groups. The scanner needs **read-write** access to write `out/` and `.venv/`. This skill configures it for the **main group only**. If you want to use it from a secondary group, you'll need to set `nonMainReadOnly: false` in the allowlist.

## Phase 4: Reddit API Credentials

Check for credentials in the project's `.env`:

```bash
grep -q REDDIT_CLIENT_ID "{PROJECT_PATH}/.env" 2>/dev/null && echo "OK" || echo "MISSING"
```

If MISSING: tell the user to:

1. Go to https://www.reddit.com/prefs/apps
2. Click **Create another app**
3. Choose type: **script** — no redirect URI needed
4. Copy the **client ID** (under the app name) and **client secret**
5. Add to `{PROJECT_PATH}/.env`:

```
REDDIT_CLIENT_ID=<your_client_id>
REDDIT_CLIENT_SECRET=<your_client_secret>
REDDIT_USER_AGENT=painpoint-scanner/1.0
```

Wait for confirmation before continuing.

## Phase 5: Configure Group Mount

Get the main group folder:

```bash
sqlite3 store/messages.db "SELECT folder FROM registered_groups WHERE is_main=1 LIMIT 1"
```

Read any existing config for the group:

```bash
sqlite3 store/messages.db "SELECT config FROM registered_groups WHERE is_main=1"
```

Build the new config JSON (merge with existing containerConfig if present — don't overwrite other keys). The mount path in the container will be `/workspace/extra/reddit-painpoints`:

```bash
sqlite3 store/messages.db "UPDATE registered_groups SET config=json_patch(COALESCE(config,'{}'), '{\"containerConfig\":{\"additionalMounts\":[{\"hostPath\":\"{PROJECT_PATH}\",\"containerPath\":\"reddit-painpoints\",\"readonly\":false}]}}') WHERE is_main=1"
```

If `json_patch` is not available (older SQLite), build the full JSON manually, preserving any existing top-level keys.

Verify:

```bash
sqlite3 store/messages.db "SELECT config FROM registered_groups WHERE is_main=1"
```

## Phase 6: Restart and Verify

Stop any running service, then restart:

```bash
# Linux (systemd)
systemctl --user restart nanoclaw

# macOS (launchd)
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

Tell the user to send a test message in the registered chat:

```
scan Notion
```

The agent should:
1. Reply: "Scanning Reddit for Notion pain points..."
2. After 1–3 minutes, return the scan summary + top 3 leaderboard entries

If no response: check `tail -f logs/nanoclaw.log` and `groups/whatsapp_main/logs/container-*.log`.

## Troubleshooting

**"Reddit scanner not mounted":** The group config may not have been saved. Re-run Phase 5 and restart.

**"Reddit API credentials not configured":** The `.env` file in the project directory is missing or incomplete. Re-run Phase 4.

**First scan very slow (>5 min):** uv is downloading Python 3.12 on first run. Subsequent scans use the cached venv and take ~1–3 min.

**"Scan failed: ...":** Check the error message. Common causes: rate-limited by Reddit (wait 60 s and retry), invalid subreddit name, network issue.
