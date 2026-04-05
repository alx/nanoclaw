---
name: add-ack-response
description: Send an immediate acknowledgment message when a user triggers NanoClaw, before the container starts processing. Eliminates the silent wait between trigger and response.
---

# Add Ack Response

Sends a quick ack message (default: `👌`) the moment a trigger is detected — before the container starts. Eliminates the "did it hear me?" dead time during container cold starts.

## Phase 1: Pre-flight

Check if already applied:

```bash
grep -q 'ACK_ENABLED' src/config.ts && echo "Already applied" || echo "Not applied"
```

If already applied, skip to Phase 3 (Verify).

## Phase 2: Apply

Merge the skill branch:

```bash
git fetch upstream skill/ack-response
git merge upstream/skill/ack-response
```

> **Note:** `upstream` is the remote pointing to `qwibitai/nanoclaw`. Substitute if your remote name differs.

### Configure (optional)

Add to `.env` to customize:

```
ACK_ENABLED=true    # set to false to disable without removing the code
ACK_MESSAGE=👌      # any short string or emoji
```

Default: `👌` enabled.

### Build and restart

```bash
npm run build
# macOS: launchctl kickstart -k gui/$(id -u)/com.nanoclaw
# Linux: systemctl --user restart nanoclaw
```

## Phase 3: Verify

1. Run `npm run dev`
2. From a registered group, send `@<assistant> hello`
3. Verify:
   - The ack (`👌` or your configured message) arrives within ~1 second
   - The full agent response follows
   - The ack does not appear in container logs (it's sent by the host, not the agent)
4. Set `ACK_ENABLED=false` in `.env`, restart, trigger again
5. Verify no ack is sent

## What This Does NOT Do

- No changes to container behavior or container image
- No ack for scheduled tasks (host-initiated, not user-triggered)
- No per-group configuration (global toggle only via env var)
