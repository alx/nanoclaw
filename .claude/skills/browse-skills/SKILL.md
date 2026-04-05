---
name: browse-skills
description: Show all available NanoClaw skills grouped by category, explain what each does, and help the user pick and run the right one. Triggers on "browse skills", "what can you do", "list skills", "show skills", "help", "what skills are available", or when the user seems unsure what command to use.
---

# Browse Skills

Present the full skills menu below organized by category. After showing it, ask the user what they want to do and offer to invoke the right skill directly.

## Channels

Add or manage messaging channels:

- `/add-whatsapp` — Add WhatsApp via QR code or pairing code authentication
- `/add-telegram` — Add Telegram (can replace WhatsApp or run alongside it)
- `/add-slack` — Add Slack via Socket Mode (no public URL needed)
- `/add-discord` — Add a Discord bot channel
- `/add-gmail` — Add Gmail as a tool (agent reads/sends email) or full inbound channel
- `/claw` — Install the claw CLI to trigger NanoClaw from the terminal without a chat app

## Voice

Add voice message support:

- `/add-stt-tts` — Local STT (whisper.cpp) + TTS (KittenTTS): voice messages trigger the agent, responses come back as voice notes. No cloud APIs required.
- `/add-voice-transcription` — Cloud STT via OpenAI Whisper API: transcribes WhatsApp voice notes to text
- `/use-local-whisper` — Switch an existing voice-transcription install from OpenAI to local whisper.cpp

## Media & Attachments

- `/add-image-vision` — Process WhatsApp image attachments using Claude's vision
- `/add-pdf-reader` — Extract text from PDF attachments, URLs, or local files

## Messaging Enhancements

- `/add-ack-response` — Send an immediate acknowledgment (default: 👌) the moment a trigger is detected, before the container starts — eliminates the silent wait
- `/add-reactions` — Enable WhatsApp emoji reactions: receive, send, store, and search them
- `/add-compact` — Add a `/compact` command for manual context compaction in long sessions

## AI Extensions

- `/add-ollama-tool` — Connect a local Ollama instance as an MCP tool inside agent containers for cheaper/faster local model calls
- `/add-parallel` — Add Parallel AI integration
- `/add-telegram-swarm` — Agent Swarm for Telegram: each sub-agent gets its own bot identity in the group (requires Telegram to be set up first)

## Research & Integrations

- `/add-reddit-painpoints` — Reddit pain point scanner: scan subreddits for product complaints and frustration signals, with SQLite persistence
- `/x-integration` — Post tweets, like, reply, retweet, and quote from WhatsApp
- `/agentcash` — Pay-per-call access to premium APIs: people/company search, social media data, image/video generation, email sending, and more

## Setup & Maintenance

- `/setup` — First-time install: dependencies, channel authentication, service configuration
- `/customize` — Add new capabilities or modify behavior after initial setup
- `/debug` — Diagnose container failures, authentication issues, or log inspection
- `/update-nanoclaw` — Pull upstream NanoClaw updates into your customized install with preview and conflict resolution
- `/update-skills` — Check for and apply updates to installed skill branches

## Developer Tools

- `/claude-api` — Build apps with the Claude API or Anthropic SDK
- `/get-qodo-rules` — Load org/repo coding rules from Qodo before code tasks
- `/qodo-pr-resolver` — Fetch and fix Qodo PR review issues interactively or in batch
- `/simplify` — Review recently changed code for reuse, quality, and efficiency

---

After displaying the menu, ask:

> "What would you like to do? I can walk you through any of these or run the skill for you."

If the user names a goal (e.g. "I want voice messages", "how do I add Telegram"), map it to the right skill and invoke it immediately.
