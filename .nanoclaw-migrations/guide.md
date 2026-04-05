# NanoClaw Migration Guide

Generated: 2026-04-05
Last upgrade: 2026-04-05
Base: 391b729623d9de6838960561f4b54eaa02746a42 (= upstream/main HEAD at generation)
HEAD at generation: 73c8f294bc7baa9f3d0548b1fa43dc4bf4b22528
HEAD after upgrade: e8bb06b2a0ef53774430e15b92678579e876a785
Upstream: 391b729623d9de6838960561f4b54eaa02746a42

> **Stash note:** `stash@{0}` ("pre-migration stash") still holds uncommitted
> customizations for: GitHub CLI in Dockerfile, GEMINI_API_KEY injection, enhanced agent logging,
> and groups/main/CLAUDE.md extra-mounts docs. Pop the stash after upgrade to restore these.

---

## Migration Plan

**Order of operations:**
1. Merge WhatsApp skill (`whatsapp/main`)
2. Merge Discord skill (`discord/main`)
3. Merge image-vision skill (`whatsapp/skill/image-vision`)
4. Validate build after skills
5. Apply Dockerfile additions (Python/uv, GitHub CLI)
6. Apply new source files (`src/transcription.ts`, `src/tts.ts`, `src/image.ts`)
7. Apply `src/config.ts` additions
8. Apply `src/container-runner.ts` changes
9. Apply `src/index.ts` integration (voice + image + TTS + ACK)
10. Apply container agent runner changes
11. Add new `.env.example` vars
12. Copy scripts, shims, monitor tool
13. Copy container skills
14. Copy `.claude/skills/` custom skills
15. Validate full build + tests
16. Pop stash to restore uncommitted customizations

**Staging:** Validate build after step 4. If skills fail to merge, stop — they may need manual resolution.

**Risk areas:**
- `src/index.ts` — heavily modified; voice, image, TTS, ACK all layered in. Most likely place for conflicts with future upstream changes.
- `container/agent-runner/src/index.ts` — image attachment multimodal support + stashed logging enhancements.
- `container/Dockerfile` — multiple additions (Python/uv committed; GitHub CLI in stash).

---

## Applied Skills

These were merged from **external remotes** (not standard upstream `upstream/skill/*` branches).
When upgrading, add and fetch these remotes, then merge:

```bash
git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git 2>/dev/null || true
git remote add discord  https://github.com/qwibitai/nanoclaw-discord.git  2>/dev/null || true
git fetch whatsapp && git fetch discord

git merge whatsapp/main --no-edit
git merge discord/main --no-edit
git merge whatsapp/skill/image-vision --no-edit
```

| Skill | Remote/Branch | Key files |
|-------|--------------|-----------|
| WhatsApp channel | `whatsapp/main` | `src/channels/whatsapp.ts`, `src/whatsapp-auth.ts`, `setup/whatsapp-auth.ts`, `setup/groups.ts`, `setup/index.ts` |
| Discord channel | `discord/main` | `src/channels/discord.ts` |
| Image vision | `whatsapp/skill/image-vision` | `src/image.ts`, container agent changes |

---

## Skill Interactions

### WhatsApp + Image Vision + TTS all touch src/index.ts

Each skill adds to the main message processing loop. After merging all three, manually apply the
combined integration described in **"Voice + Image + TTS integration in src/index.ts"** below —
the merged result may have partial or conflicting additions.

### Channel registration in src/channels/index.ts

Both WhatsApp and Discord add imports to this file. After merging both, verify both are present:

```typescript
import './discord.js';
import './whatsapp.js';
```

If only one was merged first, the second's import may not appear. Add manually if missing.

### Baileys version

WhatsApp skill pins `@whiskeysockets/baileys` at `^7.0.0-rc.9`. If upstream ships a different
version, pin to `7.0.0-rc.9` or later to preserve the `fetchLatestWaWebVersion` API used in
`setup/groups.ts`.

---

## Customizations

### New package dependencies

**Intent:** Required by Discord, TTS, image processing, and STT features.

**Files:** `package.json`

**How to apply:**
```bash
npm install discord.js@^14.18.0 franc-min@^6.2.0 pino@^9.6.0 pino-pretty@^13.0.0 sharp@^0.34.2 yaml@^2.8.2 zod@^4.3.6
npm install -D @types/qrcode-terminal@^0.12.0
```

Note: `@whiskeysockets/baileys` is added by the WhatsApp skill merge. Verify it appears after
merging; if not, add `"@whiskeysockets/baileys": "^7.0.0-rc.9"`.

---

### ACK response config

**Intent:** Immediately acknowledge the user with a 👌 when triggered, eliminating the silent wait before the container starts.

**Files:** `src/config.ts`

**How to apply:** Add to the exports section of `src/config.ts`:
```typescript
export const ACK_ENABLED = process.env.ACK_ENABLED !== 'false';
export const ACK_MESSAGE = process.env.ACK_MESSAGE || '👌';
```

---

### Voice transcription (whisper.cpp) — src/transcription.ts

**Intent:** WhatsApp voice messages are transcribed locally via whisper.cpp. The WhatsApp skill provides this file — verify it is present after merging `whatsapp/main`.

**Files:** `src/transcription.ts`

**How to apply:** Should be added by the WhatsApp skill merge. After merging, verify the file
exports these symbols:
```typescript
export async function transcribeAudioMessage(msg: WAMessage, sock: WASocket): Promise<string | null>
export function isVoiceMessage(msg: WAMessage): boolean
```

Configuration via env vars (add to `.env.example`):
```
WHISPER_BIN=whisper-cli
WHISPER_MODEL=data/models/ggml-base.bin
WHISPER_LANG=
```

---

### Text-to-speech (KittenTTS) — src/tts.ts

**Intent:** Agent responses to voice messages are synthesized back to an OGG voice note using local KittenTTS (Python). Language is auto-detected (FR/EN) to pick the right voice.

**Files:** `src/tts.ts` (new), `scripts/kittentts_synth.py` (new)

**How to apply:**

1. Copy `scripts/kittentts_synth.py` from the main tree. It reads text from stdin and writes a 24kHz WAV to a given path. Install its dependency once:
   ```bash
   uv pip install "https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl" soundfile
   ```

2. Create `src/tts.ts` with this implementation:
   ```typescript
   import { spawn } from 'child_process';
   import { franc } from 'franc-min';
   import fs from 'fs';
   import os from 'os';
   import path from 'path';

   const KITTENTTS_MODEL = process.env.KITTENTTS_MODEL ?? 'KittenML/kitten-tts-mini-0.8';
   const KITTENTTS_VOICE_FR = process.env.KITTENTTS_VOICE_FR ?? 'Jasper';
   const KITTENTTS_VOICE_EN = process.env.KITTENTTS_VOICE_EN ?? 'Jasper';

   export async function textToSpeechOgg(text: string): Promise<Buffer> {
     const voice = pickVoice(text);
     const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-'));
     const wavPath = path.join(tmpDir, 'out.wav');
     try {
       await runKittenTts(stripEmojis(text), wavPath, voice);
       return await wavToOgg(wavPath);
     } finally {
       fs.rmSync(tmpDir, { recursive: true, force: true });
     }
   }

   function pickVoice(text: string): string {
     const lang = franc(text, { minLength: 3 });
     return lang === 'fra' ? KITTENTTS_VOICE_FR : KITTENTTS_VOICE_EN;
   }

   function stripEmojis(text: string): string {
     return text.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').replace(/\s+/g, ' ').trim();
   }

   function runKittenTts(text: string, wavPath: string, voice: string): Promise<void> {
     return new Promise((resolve, reject) => {
       const scriptPath = path.join(process.cwd(), 'scripts', 'kittentts_synth.py');
       const proc = spawn('uv', ['run', 'python', scriptPath, wavPath, voice, KITTENTTS_MODEL], {
         stdio: ['pipe', 'pipe', 'pipe'],
       });
       proc.stdin.write(text);
       proc.stdin.end();
       proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`KittenTTS exited ${code}`))));
     });
   }

   function wavToOgg(wavPath: string): Promise<Buffer> {
     return new Promise((resolve, reject) => {
       const oggPath = wavPath.replace('.wav', '.ogg');
       const proc = spawn('ffmpeg', ['-y', '-i', wavPath, '-c:a', 'libopus', '-b:a', '32k', '-ar', '24000', oggPath]);
       proc.on('close', (code) => {
         if (code !== 0) return reject(new Error(`ffmpeg exited ${code}`));
         resolve(fs.readFileSync(oggPath));
       });
     });
   }
   ```

Add to `.env.example`:
```
KITTENTTS_MODEL=KittenML/kitten-tts-mini-0.8
KITTENTTS_VOICE_FR=Jasper
KITTENTTS_VOICE_EN=Jasper
```

---

### Voice + Image + TTS integration in src/index.ts

**Intent:** Integrates voice transcription, image attachments, ACK message, and TTS synthesis into the main processing loop. Voice messages trigger the agent without a text trigger word; responses to voice are synthesized back as a voice note.

**Files:** `src/index.ts`

**How to apply:** After skills are merged, apply these changes to `src/index.ts`:

**1. Add imports at the top:**
```typescript
import { ACK_ENABLED, ACK_MESSAGE } from './config.js';
import { parseImageReferences } from './image.js';
```

**2. Update `runAgent()` signature** to accept image attachments:
```typescript
async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  imageAttachments: Array<{ relativePath: string; mediaType: string }>,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'>
```

**3. Inside `runAgent()`, pass imageAttachments to ContainerInput:**
```typescript
assistantName: ASSISTANT_NAME,
...(imageAttachments.length > 0 && { imageAttachments }),
```

**4. In `processGroupMessages()`, before the trigger check, add:**
```typescript
const hasVoice = missedMessages.some((m) =>
  m.content.startsWith('[Voice:'),
);
const imageAttachments = parseImageReferences(missedMessages);

// Voice bypasses text trigger requirement:
if (!hasVoice && !hasTrigger) return true;
```

**5. After the trigger check, set up voice buffering:**
```typescript
const lastMessage = missedMessages[missedMessages.length - 1];
const hasVoiceTrigger = !!lastMessage?.content.startsWith('[Voice:');
const voiceChunks: string[] = [];
```

**6. In the `onOutput` callback passed to `runAgent`, buffer voice responses:**
```typescript
if (hasVoiceTrigger) {
  voiceChunks.push(text); // buffer — send as one voice note at the end
} else {
  await channel.sendMessage(chatJid, text);
}
```

**7. After `result.status === 'success'`, synthesize voice note if applicable:**
```typescript
if (result.status === 'success') {
  queue.notifyIdle(chatJid);
  if (hasVoiceTrigger && voiceChunks.length > 0) {
    const fullText = voiceChunks.splice(0).join('\n\n');
    outputSentToUser = true;
    await channel.sendMessage(chatJid, fullText);
    if ('sendVoiceNote' in channel) {
      (async () => {
        try {
          const { textToSpeechOgg } = await import('./tts.js');
          const oggBuffer = await textToSpeechOgg(fullText);
          await (channel as any).sendVoiceNote(chatJid, oggBuffer);
        } catch (err) {
          logger.warn({ err, group: group.name }, 'TTS failed');
        }
      })();
    }
  }
}
```

**8. In `startMessageLoop()`, apply the same voice detection and trigger bypass, plus ACK:**
```typescript
const hasVoice = missedMessages.some((m) =>
  m.content.startsWith('[Voice:'),
);
if (!hasVoice && !hasTrigger) continue;

// After trigger confirmed:
if (ACK_ENABLED) {
  channel
    .sendMessage(chatJid, ACK_MESSAGE)
    .catch((err) =>
      logger.warn({ chatJid, err }, 'Failed to send ack message'),
    );
}
```

---

### GitHub credentials injection into containers

**Intent:** Pass `GITHUB_TOKEN` and `GITHUB_USER` to containers so the agent can use `gh` CLI and `git push`.

**Files:** `src/container-runner.ts`

**How to apply:**

Add import:
```typescript
import { readEnvFile } from './env.js';
```

Add `imageAttachments` to the `ContainerInput` interface:
```typescript
imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
```

In the container args-building section, after existing `-e` env vars:
```typescript
const ghEnv = readEnvFile(['GITHUB_TOKEN', 'GITHUB_USER']);
if (ghEnv.GITHUB_TOKEN) {
  args.push('-e', `GH_TOKEN=${ghEnv.GITHUB_TOKEN}`);
  args.push('-e', `GITHUB_TOKEN=${ghEnv.GITHUB_TOKEN}`);
}
if (ghEnv.GITHUB_USER) {
  args.push('-e', `GITHUB_USER=${ghEnv.GITHUB_USER}`);
}
```

---

### Gemini API key injection into containers (in stash)

**Intent:** Pass `GEMINI_API_KEY` / `GOOGLE_AI_API_KEY` to containers for Google AI services.

**Files:** `src/container-runner.ts`

**Note:** This is in `stash@{0}` (pre-migration stash). It will be restored when the stash is popped after upgrade.

**How to apply manually if needed:** In the same block as GitHub credentials:
```typescript
const geminiEnv = readEnvFile(['GEMINI_API_KEY']);
if (geminiEnv.GEMINI_API_KEY) {
  args.push('-e', `GEMINI_API_KEY=${geminiEnv.GEMINI_API_KEY}`);
  args.push('-e', `GOOGLE_AI_API_KEY=${geminiEnv.GEMINI_API_KEY}`);
}
```

---

### Python + uv in container Dockerfile

**Intent:** Container needs Python + uv to run Reddit analysis skills and KittenTTS synthesis.

**Files:** `container/Dockerfile`

**How to apply:** Add to the apt-get install block and after it:
```dockerfile
RUN apt-get install -y python3 python3-venv \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv

ENV UV_CACHE_DIR=/home/node/.cache/uv
RUN mkdir -p /home/node/.cache/uv && chown node:node /home/node/.cache/uv
```

---

### GitHub CLI in container Dockerfile (in stash)

**Intent:** `gh` CLI available inside containers for GitHub operations.

**Files:** `container/Dockerfile`

**Note:** This is in `stash@{0}` (pre-migration stash). Will be restored when stash is popped.

**How to apply manually if needed:** Add to the apt-get install block:
```dockerfile
RUN apt-get install -y gh
```
And in the entrypoint / startup section, configure git credential helper:
```bash
gh auth setup-git
```
(Check the exact stash diff with `git stash show -p stash@{0} -- container/Dockerfile` for the precise placement.)

---

### Enhanced container agent logging (in stash)

**Intent:** Agent message loop logs show tool names and result previews for easier debugging.

**Files:** `container/agent-runner/src/index.ts`

**Note:** In `stash@{0}`. Will be restored when stash is popped.

**How to apply manually if needed:** In `runQuery()`, replace the simple log line:
```typescript
log(`[msg #${messageCount}] type=${msgType}`);
```
with:
```typescript
const msgType = message.type === 'system' ? `system/${(message as { subtype?: string }).subtype}` : message.type;
let msgDetail = '';
if (message.type === 'assistant') {
  const content = (message as { message?: { content?: unknown[] } }).message?.content;
  if (Array.isArray(content)) {
    const toolUses = content.filter((b: unknown) => (b as { type?: string }).type === 'tool_use');
    const textBlocks = content.filter((b: unknown) => (b as { type?: string }).type === 'text');
    if (toolUses.length > 0) {
      msgDetail = ` tools=[${toolUses.map((b: unknown) => (b as { name?: string }).name).join(',')}]`;
    } else if (textBlocks.length > 0) {
      const text = (textBlocks[0] as { text?: string }).text || '';
      msgDetail = ` text=${JSON.stringify(text.slice(0, 120))}`;
    }
  }
} else if (message.type === 'user') {
  const content = (message as { message?: { content?: unknown[] } }).message?.content;
  if (Array.isArray(content)) {
    const toolResults = content.filter((b: unknown) => (b as { type?: string }).type === 'tool_result');
    if (toolResults.length > 0) {
      msgDetail = ` tool_results=[${toolResults.map((b: unknown) => {
        const r = b as { tool_use_id?: string; content?: unknown };
        const preview = typeof r.content === 'string' ? r.content.slice(0, 80) : JSON.stringify(r.content).slice(0, 80);
        return `${r.tool_use_id?.slice(-6)}:${JSON.stringify(preview)}`;
      }).join(', ')}]`;
    }
  }
}
log(`[msg #${messageCount}] type=${msgType}${msgDetail}`);
```

---

### Image vision in container agent runner

**Intent:** Load image attachments as base64 and inject as multimodal content blocks into the agent's message stream.

**Files:** `container/agent-runner/src/index.ts`

**How to apply:** Should be added by the `whatsapp/skill/image-vision` merge. After merging, verify:

1. `ContainerInput` has the field:
   ```typescript
   imageAttachments?: Array<{ relativePath: string; mediaType: string }>;
   ```

2. Content block interfaces exist:
   ```typescript
   interface ImageContentBlock {
     type: 'image';
     source: { type: 'base64'; media_type: string; data: string };
   }
   interface TextContentBlock { type: 'text'; text: string; }
   type ContentBlock = ImageContentBlock | TextContentBlock;
   ```

3. `MessageStream` has `pushMultimodal(content: ContentBlock[]): void` method.

4. In `runQuery()`, before the message loop, image loading block:
   ```typescript
   if (containerInput.imageAttachments?.length) {
     const blocks: ContentBlock[] = [];
     for (const img of containerInput.imageAttachments) {
       const imgPath = path.join('/workspace/group', img.relativePath);
       try {
         const data = fs.readFileSync(imgPath).toString('base64');
         blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data } });
       } catch (err) {
         log(`Failed to load image: ${imgPath}`);
       }
     }
     if (blocks.length > 0) stream.pushMultimodal(blocks);
   }
   ```

---

### xdg-open OAuth URL capture shim

**Intent:** Enables headless OAuth inside containers — captures the callback URL to a file instead of opening a browser.

**Files:** `container/shims/xdg-open`

**How to apply:** Create `container/shims/xdg-open`:
```bash
#!/bin/bash
echo "$1" > /workspace/auth-ipc/.oauth-url
exit 0
```
Make executable: `chmod +x container/shims/xdg-open`

---

### Monitor script

**Intent:** Single command to tail all NanoClaw logs (app, error, systemd journal, Docker containers) with labeled prefixes.

**Files:** `monitor_nanoclaw.sh`

**How to apply:** Copy from main tree:
```bash
cp "$PROJECT_ROOT/monitor_nanoclaw.sh" "$WORKTREE/monitor_nanoclaw.sh"
chmod +x "$WORKTREE/monitor_nanoclaw.sh"
```

---

### New .env.example variables

**Intent:** Document all new environment variables added by the custom features.

**Files:** `.env.example`

**How to apply:** Add to `.env.example`:
```
# WhatsApp
ASSISTANT_HAS_OWN_NUMBER=

# Discord
DISCORD_BOT_TOKEN=

# Voice transcription (whisper.cpp)
WHISPER_BIN=whisper-cli
WHISPER_MODEL=data/models/ggml-base.bin
WHISPER_LANG=

# Text-to-speech (KittenTTS)
KITTENTTS_MODEL=KittenML/kitten-tts-mini-0.8
KITTENTTS_VOICE_FR=Jasper
KITTENTTS_VOICE_EN=Jasper
```

---

### Agent personas: Satoshi (global) and Andy (main)

**Intent:** "Satoshi" is the default assistant persona for all groups. "Andy" is the elevated-privilege control identity for the main group (has access to group management, db operations, etc.).

**Files:** `groups/global/CLAUDE.md`, `groups/main/CLAUDE.md`

**How to apply:** These live in `groups/` which is a data directory never touched during upgrade.
They are automatically preserved. No action needed.

If for any reason they need to be copied:
```bash
cp "$PROJECT_ROOT/groups/global/CLAUDE.md" "$WORKTREE/groups/global/CLAUDE.md"
cp "$PROJECT_ROOT/groups/main/CLAUDE.md"   "$WORKTREE/groups/main/CLAUDE.md"
```

---

### Container skills (custom, copy as-is)

**Intent:** User-created container skills for Reddit analysis and property listing management.

**Files:** `container/skills/reddit-painpoints/`, `container/skills/reddit-author-persona/`, `container/skills/reddit-post-comments/`, `container/skills/3615samui/`

**Notes:**
- `container/skills/3615samui/` is **untracked in git** — must be copied from the live tree, not from git.
- All four skills use the Arctic Shift API and Python uv environment added to the Dockerfile.

**How to apply:**
```bash
cp -r "$PROJECT_ROOT/container/skills/reddit-painpoints"    "$WORKTREE/container/skills/"
cp -r "$PROJECT_ROOT/container/skills/reddit-author-persona" "$WORKTREE/container/skills/"
cp -r "$PROJECT_ROOT/container/skills/reddit-post-comments"  "$WORKTREE/container/skills/"
cp -r "$PROJECT_ROOT/container/skills/3615samui"             "$WORKTREE/container/skills/"
```

---

### Claude skills (custom, copy as-is)

**Intent:** User-created operational and setup skills that ship with the fork.

**Files:** `.claude/skills/add-stt-tts/`, `.claude/skills/add-ack-response/`, `.claude/skills/browse-skills/`, `.claude/skills/add-reddit-painpoints/`

**How to apply:**
```bash
cp -r "$PROJECT_ROOT/.claude/skills/add-stt-tts"          "$WORKTREE/.claude/skills/"
cp -r "$PROJECT_ROOT/.claude/skills/add-ack-response"      "$WORKTREE/.claude/skills/"
cp -r "$PROJECT_ROOT/.claude/skills/browse-skills"         "$WORKTREE/.claude/skills/"
cp -r "$PROJECT_ROOT/.claude/skills/add-reddit-painpoints" "$WORKTREE/.claude/skills/"
```
