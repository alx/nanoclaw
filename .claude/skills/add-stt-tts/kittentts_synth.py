"""
KittenTTS synthesis wrapper — reads text from stdin, writes 24kHz WAV to -f path.
Used by NanoClaw's tts.ts as a drop-in replacement for Piper.

Install dependencies before first use:
  uv pip install https://github.com/KittenML/KittenTTS/releases/download/0.8.1/kittentts-0.8.1-py3-none-any.whl soundfile
"""

import argparse
import sys

import soundfile as sf
from kittentts import KittenTTS

parser = argparse.ArgumentParser(description='Synthesize text to WAV via KittenTTS')
parser.add_argument('-m', '--model', default='KittenML/kitten-tts-mini-0.8',
                    help='KittenTTS model name (default: kitten-tts-mini-0.8)')
parser.add_argument('-v', '--voice', default='Jasper',
                    help='Voice name: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo')
parser.add_argument('-f', '--output', required=True,
                    help='Output WAV file path')
args = parser.parse_args()

text = sys.stdin.read().strip()
if not text:
    sys.exit(0)

tts = KittenTTS(args.model)
audio = tts.generate(text, voice=args.voice)
sf.write(args.output, audio, 24000)
