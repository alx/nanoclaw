import { spawn } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { franc } from 'franc-min';

import { logger } from './logger.js';
import { readEnvFile } from './env.js';

const KITTENTTS_SCRIPT = resolve(process.cwd(), 'scripts/kittentts_synth.py');
const _env = readEnvFile(['KITTENTTS_MODEL', 'KITTENTTS_VOICE_FR', 'KITTENTTS_VOICE_EN']);
const KITTENTTS_MODEL = _env.KITTENTTS_MODEL ?? 'KittenML/kitten-tts-mini-0.8';

const LANG_VOICES: Record<string, string> = {
  fra: _env.KITTENTTS_VOICE_FR ?? 'Jasper',
  eng: _env.KITTENTTS_VOICE_EN ?? 'Jasper',
};
const DEFAULT_VOICE = LANG_VOICES.fra;

function pickVoice(text: string): string {
  const lang = franc(text, { minLength: 5, only: ['fra', 'eng'] });
  return LANG_VOICES[lang] ?? DEFAULT_VOICE;
}

function stripEmojis(text: string): string {
  return text
    .replace(/\p{Emoji}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function textToSpeechOgg(text: string): Promise<Buffer> {
  const clean = stripEmojis(text);
  const voice = pickVoice(clean);
  const tmpDir = await mkdtemp(join(tmpdir(), 'nanoclaw-tts-'));
  try {
    const wavPath = join(tmpDir, 'output.wav');
    await runKittenTts(clean, wavPath, voice);
    return await wavToOgg(wavPath);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

function runKittenTts(text: string, wavPath: string, voice: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Pass text via stdin to avoid shell-escaping issues with special characters
    const proc = spawn(
      'uv',
      [
        'run',
        'python',
        KITTENTTS_SCRIPT,
        '-m',
        KITTENTTS_MODEL,
        '-v',
        voice,
        '-f',
        wavPath,
      ],
      { timeout: 120_000 },
    );
    proc.stdin.write(text);
    proc.stdin.end();
    proc.stderr.on('data', (d: Buffer) =>
      logger.debug({ msg: d.toString().trim() }, 'kittentts stderr'),
    );
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`kittentts_synth exited ${code}`)),
    );
    proc.on('error', reject);
  });
}

function wavToOgg(wavPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const proc = spawn(
      'ffmpeg',
      [
        '-i',
        wavPath,
        '-acodec',
        'libopus',
        '-b:a',
        '32k',
        '-ar',
        '24000',
        '-f',
        'ogg',
        'pipe:1',
      ],
      { timeout: 30_000 },
    );
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.on('close', (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg exited ${code}`)),
    );
    proc.on('error', reject);
  });
}
