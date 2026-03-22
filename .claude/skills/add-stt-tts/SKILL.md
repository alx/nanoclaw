---
name: add-stt-tts
description: Add local voice transcription (whisper.cpp) and TTS (KittenTTS) to NanoClaw. Voice messages auto-trigger the agent; the agent's response is sent back as a voice note. WhatsApp only. No cloud APIs required.
---

# Add STT + TTS (whisper.cpp + KittenTTS)

Adds two-way voice to NanoClaw's WhatsApp channel:
- **STT**: incoming voice notes are transcribed locally via `whisper.cpp`
- **TTS**: agent responses are synthesized via KittenTTS and sent back as voice notes

**Prerequisite**: WhatsApp skill must be applied first.

## Phase 1: Pre-flight

### Check if already applied

```bash
test -f src/transcription.ts && echo "Already applied" || echo "Not applied"
```

If already applied, skip to Phase 3 (Configure).

### Check dependencies

```bash
whisper-cli --help >/dev/null 2>&1 && echo "WHISPER_OK" || echo "WHISPER_MISSING"
ffmpeg -version >/dev/null 2>&1 && echo "FFMPEG_OK" || echo "FFMPEG_MISSING"
uv --version >/dev/null 2>&1 && echo "UV_OK" || echo "UV_MISSING"
```

Install any missing tools:
```bash
# macOS
brew install whisper-cpp ffmpeg

# uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh
```

## Phase 2: Apply Code Changes

### Copy new source files

```bash
cp "${CLAUDE_SKILL_DIR}/transcription.ts" src/transcription.ts
cp "${CLAUDE_SKILL_DIR}/tts.ts" src/tts.ts
cp "${CLAUDE_SKILL_DIR}/kittentts_synth.py" scripts/kittentts_synth.py
```

### Patch `src/channels/whatsapp.ts`

**1. Add imports** at the top (after existing imports):

```typescript
import {
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import { isVoiceMessage, transcribeAudioMessage } from '../transcription.js';
```

Note: `downloadMediaMessage` may already be imported — only add if missing.

**2. Add `sentVoiceNoteIds` property** to the `WhatsAppChannel` class (after other private properties):

```typescript
private sentVoiceNoteIds = new Set<string>();
```

**3. In the `messages.upsert` handler**, replace:
```typescript
// Skip protocol messages with no text content (encryption keys, read receipts, etc.)
if (!content) continue;
```
with:
```typescript
// Allow voice messages through even without text content
if (!content && !isVoiceMessage(msg)) continue;

// Skip voice notes sent by the bot itself — Baileys echoes sent messages back
const msgId = msg.key.id || '';
if (isVoiceMessage(msg) && this.sentVoiceNoteIds.has(msgId)) {
  this.sentVoiceNoteIds.delete(msgId);
  continue;
}
```

**4. After the `isBotMessage` line**, add transcription before storing the message. Replace the section that calls `this.opts.onMessage` so it passes `finalContent` instead of `content`:

```typescript
// Transcribe voice messages before storing
let finalContent = content;
if (isVoiceMessage(msg)) {
  try {
    const transcript = await transcribeAudioMessage(msg, this.sock);
    if (transcript) {
      finalContent = `[Voice: ${transcript}]`;
      logger.info({ chatJid, length: transcript.length }, 'Transcribed voice message');
    } else {
      finalContent = '[Voice Message - transcription unavailable]';
    }
  } catch (err) {
    logger.error({ err }, 'Voice transcription error');
    finalContent = '[Voice Message - transcription failed]';
  }
}

this.opts.onMessage(chatJid, {
  id: msg.key.id || '',
  chat_jid: chatJid,
  sender,
  sender_name: senderName,
  content: finalContent,
  timestamp,
  is_from_me: fromMe,
  is_bot_message: isBotMessage,
});
```

**5. Add `sendVoiceNote` method** to the `WhatsAppChannel` class, after `sendMessage`:

```typescript
async sendVoiceNote(jid: string, audio: Buffer): Promise<void> {
  if (!this.connected) {
    logger.warn({ jid }, 'WA disconnected, dropping voice note');
    return;
  }
  const sent = await this.sock.sendMessage(jid, {
    audio,
    ptt: true,
    mimetype: 'audio/ogg; codecs=opus',
  });
  if (sent?.key.id) this.sentVoiceNoteIds.add(sent.key.id);
  logger.info({ jid }, 'Voice note sent');
}
```

### Patch `src/index.ts`

**1. In `processGroupMessages`**, replace the trigger check block (currently only checks `hasTrigger`) with a version that also accepts voice messages:

Find:
```typescript
  const allowlistCfg = loadSenderAllowlist();
  const hasTrigger = missedMessages.some(
    (m) =>
      TRIGGER_PATTERN.test(m.content.trim()) &&
      (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
  );
  if (!hasTrigger) return true;
```

Replace with:
```typescript
  const allowlistCfg = loadSenderAllowlist();
  const hasVoice = missedMessages.some((m) =>
    m.content.startsWith('[Voice:'),
  );
  const hasTrigger = missedMessages.some(
    (m) =>
      TRIGGER_PATTERN.test(m.content.trim()) &&
      (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
  );
  if (!hasVoice && !hasTrigger) return true;
```

**2. In `processGroupMessages`**, add voice state before `runAgent`. Find the line:

```typescript
  await channel.setTyping?.(chatJid, true);
```

Insert before it:
```typescript
  const hasVoiceTrigger = missedMessages.some((m) =>
    m.content.startsWith('[Voice:'),
  );
  const voiceChunks: string[] = [];

```

**3. In the `runAgent` streaming callback**, replace the direct `sendMessage` inside `if (text)`:

Find:
```typescript
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
```

Replace with:
```typescript
      if (text) {
        if (hasVoiceTrigger) {
          voiceChunks.push(text); // buffer — send as one voice note at the end
        } else {
          await channel.sendMessage(chatJid, text);
          outputSentToUser = true;
        }
      }
```

**4. In the `runAgent` streaming callback**, add TTS flush after `queue.notifyIdle`. Find:

```typescript
    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }
```

Replace with:
```typescript
    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
      if (hasVoiceTrigger && voiceChunks.length > 0) {
        const fullText = voiceChunks.splice(0).join('\n\n');
        outputSentToUser = true;
        if ('sendVoiceNote' in channel) {
          try {
            logger.info({ group: group.name, textLength: fullText.length }, 'Starting TTS synthesis');
            const { textToSpeechOgg } = await import('./tts.js');
            const oggBuffer = await textToSpeechOgg(fullText);
            logger.info({ group: group.name, bytes: oggBuffer.length }, 'TTS synthesis complete, sending voice note');
            await (channel as any).sendVoiceNote(chatJid, oggBuffer);
          } catch (err) {
            logger.warn({ err, group: group.name }, 'TTS failed');
          }
        }
        await channel.sendMessage(chatJid, fullText);
      }
    }
```

**5. After the `runAgent` call completes** (post-`await channel.setTyping?.(chatJid, false)`), add a fallback flush in case chunks weren't sent via the callback. Insert before the `if (output === 'error' || hadError)` block:

```typescript
  // Fallback: flush any buffered voice chunks not yet sent (e.g. if agent exited without success status)
  if (hasVoiceTrigger && voiceChunks.length > 0) {
    const fullText = voiceChunks.join('\n\n');
    outputSentToUser = true;
    if ('sendVoiceNote' in channel) {
      try {
        const { textToSpeechOgg } = await import('./tts.js');
        const oggBuffer = await textToSpeechOgg(fullText);
        await (channel as any).sendVoiceNote(chatJid, oggBuffer);
      } catch (err) {
        logger.warn({ err, group: group.name }, 'TTS failed');
      }
    }
    await channel.sendMessage(chatJid, fullText);
  }
```

**6. In `startMessageLoop`**, apply the same voice trigger pattern. Find:

```typescript
          const hasVoice = groupMessages.some((m) =>
            m.content.startsWith('[Voice:'),
          );
          const hasTrigger = groupMessages.some(
```

If this pattern doesn't exist yet (it's not in current main), find:

```typescript
          const hasTrigger = groupMessages.some(
            (m) =>
              TRIGGER_PATTERN.test(m.content.trim()) &&
              (m.is_from_me ||
                isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
          );
          if (!hasVoice && !hasTrigger) continue;
```

And ensure the `hasVoice` variable is declared before `hasTrigger` and that the condition uses `!hasVoice && !hasTrigger`. If currently `if (!hasTrigger) continue;`, update it to:

```typescript
          const hasVoice = groupMessages.some((m) =>
            m.content.startsWith('[Voice:'),
          );
          const hasTrigger = groupMessages.some(
            (m) =>
              TRIGGER_PATTERN.test(m.content.trim()) &&
              (m.is_from_me ||
                isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
          );
          if (!hasVoice && !hasTrigger) continue;
```

### Install dependency and build

```bash
npm install franc-min
npm run build
```

Fix any TypeScript errors before proceeding. Common issue: `downloadMediaMessage` import already exists in whatsapp.ts — remove the duplicate.

## Phase 3: Configure

### Download whisper model

```bash
mkdir -p data/models
curl -L -o data/models/ggml-base.bin \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin"
```

Model sizes (trade speed for accuracy):
- `ggml-base.bin` (148MB) — default, good balance
- `ggml-small.bin` (466MB) — better accuracy
- `ggml-medium.bin` (1.5GB) — best accuracy, slowest

### Install KittenTTS

```bash
uv pip install \
  "https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl" \
  soundfile
```

### Configure environment

Add to `.env`:

```
WHISPER_BIN=whisper-cli
WHISPER_MODEL=data/models/ggml-base.bin
WHISPER_LANG=
KITTENTTS_MODEL=KittenML/kitten-tts-mini-0.8
KITTENTTS_VOICE_FR=Jasper
KITTENTTS_VOICE_EN=Jasper
```

Available voices: `Bella`, `Jasper`, `Luna`, `Bruno`, `Rosie`, `Hugo`, `Kiki`, `Leo`

Available models:
- `KittenML/kitten-tts-mini-0.8` (80M) — default, recommended
- `KittenML/kitten-tts-micro-0.8` (40M) — faster, lighter
- `KittenML/kitten-tts-nano-0.8` (15M) — fastest, lowest quality

Sync env to container:

```bash
mkdir -p data/env && cp .env data/env/env
```

### Build and restart

```bash
npm run build

# macOS
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# Linux
systemctl --user restart nanoclaw
```

### Ensure launchd PATH includes Homebrew (macOS only)

The launchd service has a restricted PATH. Check it includes `/opt/homebrew/bin`:

```bash
grep -A1 'PATH' ~/Library/LaunchAgents/com.nanoclaw.plist
```

If missing, add `/opt/homebrew/bin` to the PATH string in the plist, then reload:

```bash
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
```

## Phase 4: Verify

### Test transcription

Send a voice note in any registered WhatsApp group. The agent should receive it as `[Voice: <transcript>]` and respond to its content.

### Test TTS

After sending a voice note, the agent's response should arrive as a voice note followed by the same text as a message.

### Check logs

```bash
tail -f logs/nanoclaw.log | grep -i -E "voice|tts|transcri|whisper"
```

Look for:
- `Transcribed voice message` — successful STT
- `TTS synthesis complete, sending voice note` — successful TTS
- `whisper.cpp transcription failed` — check binary PATH and model file
- `TTS failed` — check KittenTTS installation and `scripts/kittentts_synth.py`

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_BIN` | `whisper-cli` | Path to whisper.cpp binary |
| `WHISPER_MODEL` | `data/models/ggml-base.bin` | Path to GGML model file |
| `WHISPER_LANG` | (auto) | Force language code, e.g. `fr`, `en` |
| `KITTENTTS_MODEL` | `KittenML/kitten-tts-mini-0.8` | KittenTTS model name |
| `KITTENTTS_VOICE_FR` | `Jasper` | Voice for French text |
| `KITTENTTS_VOICE_EN` | `Jasper` | Voice for English text |

## Troubleshooting

**Voice note shows "[Voice Message - transcription unavailable]"**: Run `whisper-cli --help` and `ffmpeg -version` to confirm both are in PATH. For launchd, verify PATH includes `/opt/homebrew/bin`.

**TTS fails silently**: Run manually to see errors:
```bash
echo "hello world" | uv run python scripts/kittentts_synth.py -f /tmp/test.wav
```

**First TTS call is slow**: KittenTTS downloads the model on first use from Hugging Face. Subsequent calls are fast.

**Agent doesn't respond to voice notes**: Confirm the chat is registered (`/debug` skill) and that the transcription line `[Voice:` appears in the logs.
