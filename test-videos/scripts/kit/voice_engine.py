# The voice helpers of the pr-studio engine (https://github.com/federicobrancasi/pr-studio, voice/voice.py), MIT License,
# Copyright (c) 2026 Federico Brancasi: see voice_engine.LICENSE. Trimmed to what voice.py and check.py use; changed to
# use this plugin's cache folder and setup, and to accept an ordinal said in words and transcribed in digits.
"""Voices (Kokoro offline, or MAI-Voice-2 through Azure Speech) and Whisper word timings for the test-videos kit."""
from __future__ import annotations
import concurrent.futures as cf
import difflib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence
from xml.sax.saxutils import escape

CACHE = Path(os.environ.get('TEST_VIDEOS_HOME') or Path.home() / '.cache' / 'test-videos')
ALNUM_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)
SAMPLE_RATE = 24000


def run_ffmpeg(ffmpeg: str, args: Sequence[str], capture_output: bool = False) -> subprocess.CompletedProcess[str]:
	return subprocess.run([ffmpeg, '-hide_banner', '-nostdin', *args], check=True, capture_output=capture_output, text=True)


def load_json(path: Path) -> Any:
	with path.open('r', encoding='utf-8') as handle:
		return json.load(handle)


def load_config() -> dict[str, Any]:
	config = {'voice': {'provider': 'auto', 'pace': 1.1, 'kokoro': {'voice': 'am_michael', 'speed': 1.0}, 'mai': {'voice': 'en-US-Grant:MAI-Voice-2', 'region': 'eastus2'}}}
	path = CACHE / 'config.json'
	if path.exists():
		user = load_json(path)
		for key, value in user.get('voice', {}).items():
			if isinstance(value, dict):
				config['voice'].setdefault(key, {}).update(value)
			else:
				config['voice'][key] = value
	return config


@dataclass
class AsrWord:
	text: str
	start: float
	end: float
	normalized: str


def normalize_token(value: str) -> str:
	return ''.join(ALNUM_RE.findall(value.lower()))


def synthesize_azure_speech(spoken_text: str, voice_name: str, region: str, speech_key: str, output_path: Path) -> None:
	output_path.parent.mkdir(parents=True, exist_ok=True)
	escaped_voice = escape(voice_name, {'"': '&quot;'})
	ssml = (
		f'<speak version="1.0" xml:lang="en-US">'
		f'<voice name="{escaped_voice}">{escape(spoken_text)}</voice>'
		f'</speak>'
	).encode('utf-8')
	request = urllib.request.Request(
		f'https://{region}.tts.speech.microsoft.com/cognitiveservices/v1',
		data=ssml,
		headers={
			'Ocp-Apim-Subscription-Key': speech_key,
			'Content-Type': 'application/ssml+xml',
			'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
		},
	)
	last_failure = ''
	for attempt in range(6):
		try:
			with urllib.request.urlopen(request, timeout=90) as response:
				audio = response.read()
			break
		except urllib.error.HTTPError as error:
			last_failure = f'HTTP {error.code}'
			if error.code != 429 and not 500 <= error.code < 600:
				raise RuntimeError(f'Azure Speech synthesis failed: {last_failure}') from None
			retry_after = error.headers.get('Retry-After', '') if error.headers else ''
		except (urllib.error.URLError, TimeoutError):
			last_failure = 'network error or timeout'
			retry_after = ''
		if attempt == 5:
			raise RuntimeError(f'Azure Speech synthesis failed after 6 attempts: {last_failure}') from None
		sleep_for = max(2 ** attempt, min(120.0, float(retry_after))) if retry_after.isdigit() else 2 ** attempt
		print(f'warning: Azure Speech {last_failure}; retrying in {sleep_for:g}s', file=sys.stderr)
		time.sleep(sleep_for)
	with wave.open(io.BytesIO(audio), 'rb') as handle:
		validate_beat_wav(handle)
	temp_path: Path | None = None
	try:
		with tempfile.NamedTemporaryFile(dir=output_path.parent, delete=False) as handle:
			temp_path = Path(handle.name)
			handle.write(audio)
		temp_path.replace(output_path)
	finally:
		if temp_path is not None:
			temp_path.unlink(missing_ok=True)


def validate_beat_wav(handle: wave.Wave_read) -> None:
	if (handle.getframerate(), handle.getsampwidth(), handle.getnchannels(), handle.getcomptype()) != (24000, 2, 1, 'NONE'):
		raise RuntimeError('Beat audio must be 24 kHz, 16-bit mono PCM WAV')
	if handle.getnframes() <= 0:
		raise RuntimeError('Beat audio contains no samples')


def transcribe_words(model: WhisperModel, audio_path: Path, prompt: str | None) -> list[AsrWord]:
	segments, _info = model.transcribe(
		str(audio_path),
		word_timestamps=True,
		beam_size=1,
		language='en',
		initial_prompt=prompt,
	)
	words: list[AsrWord] = []
	for segment in segments:
		for word in segment.words or []:
			normalized = normalize_token(word.word)
			words.append(
				AsrWord(
					text=word.word.strip(),
					start=float(word.start),
					end=float(word.end),
					normalized=normalized,
				)
			)
	return words


def get_speech_key(mai: dict[str, Any]) -> str | None:
	key = os.environ.get('AZURE_SPEECH_KEY')
	if key:
		return key
	if not mai.get('azResource') or not mai.get('azResourceGroup') or not shutil.which('az'):
		return None
	command = ['az', 'cognitiveservices', 'account', 'keys', 'list', '--name', mai['azResource'], '--resource-group', mai['azResourceGroup'], '--query', 'key1', '-o', 'tsv']
	if mai.get('azSubscription'):
		command += ['--subscription', mai['azSubscription']]
	result = subprocess.run(command, capture_output=True, text=True)
	# Never echo key-command output.
	return result.stdout.strip() or None if result.returncode == 0 else None


def write_pcm16(path: Path, samples: Any, rate: int = SAMPLE_RATE) -> None:
	import numpy as np
	data = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
	pcm = (data * 32767.0).astype('<i2').tobytes()
	path.parent.mkdir(parents=True, exist_ok=True)
	with wave.open(str(path), 'wb') as handle:
		handle.setnchannels(1)
		handle.setsampwidth(2)
		handle.setframerate(rate)
		handle.writeframes(pcm)


KOKORO_FILES = {
	'kokoro-v1.0.int8.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx',
	'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}


def kokoro_model():
	from kokoro_onnx import Kokoro
	directory = CACHE / 'kokoro'
	for name in KOKORO_FILES:
		if not (directory / name).exists():
			raise RuntimeError(f'Kokoro model file {name} is missing; run scripts/setup.mjs of the test-videos plugin')
	return Kokoro(str(directory / 'kokoro-v1.0.int8.onnx'), str(directory / 'voices-v1.0.bin'))


def synthesize_kokoro(jobs: list[tuple[str, Path]], voice: str, speed: float, workers: int) -> None:
	"""jobs: (spoken text, output wav). Each worker thread owns an ONNX session; that is ~3x faster than one session."""
	def one(job: tuple[str, Path]) -> None:
		text, out = job
		model = kokoro_model()
		samples, rate = model.create(text, voice=voice, speed=speed, lang='en-us')
		if rate != SAMPLE_RATE:
			raise RuntimeError(f'Kokoro returned {rate} Hz audio')
		write_pcm16(out, samples, rate)
	# Each ONNX session already uses every core: more sessions than half the cores only fight (a 2-core runner gets one).
	with cf.ThreadPoolExecutor(max(1, min(workers, len(jobs), (os.cpu_count() or 2) // 2))) as pool:
		list(pool.map(one, jobs))


def retime_wav(ffmpeg: str, path: Path, tempo: float) -> None:
	"""Plays a take `tempo` times as fast at the same pitch. MAI-Voice-2 honours an SSML prosody rate only in part
	(1.1 gave 1.05)."""
	temp = path.with_name(f'{path.stem}.tempo.wav')
	try:
		run_ffmpeg(ffmpeg, ['-v', 'error', '-y', '-i', str(path), '-filter:a', f'atempo={tempo:g}', '-ac', '1', '-ar', str(SAMPLE_RATE), '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', str(temp)])
		temp.replace(path)
	finally:
		temp.unlink(missing_ok=True)


def get_whisper_model():
	from faster_whisper import WhisperModel
	return WhisperModel('small.en', compute_type='int8')


NUMBER_WORDS = set('zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million point and a'.split())
DIGIT_OF = {'zero': '0', 'oh': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'}
NUMBER_RE = re.compile('(?:' + '|'.join(sorted(NUMBER_WORDS, key=len, reverse=True)) + ')+')


def numbers_match(said: str, got: str) -> bool:
	"""A number in words on one side and in digits on the other is the same thing; said digit by digit (a PR number),
	the digits must match too."""
	for words, digits in ((said, got), (got, said)):
		if words and digits and re.fullmatch(r'[\d.,%]+', digits.replace(' ', '')) and all(NUMBER_RE.fullmatch(t) or t.isdigit() for t in words.split()):
			parts = [DIGIT_OF.get(t, t if t.isdigit() else None) for t in words.split()]
			return None in parts or ''.join(parts) == re.sub(r'\D', '', digits)
	return False


ORDINAL_WORDS = {'first': 'one', 'second': 'two', 'third': 'three', 'fifth': 'five', 'eighth': 'eight', 'ninth': 'nine', 'twelfth': 'twelve'}


def ordinals_match(said: str, got: str) -> bool:
	"""An ordinal said in words and transcribed in digits ("eighteenth", "18th") is the same thing (test-videos)."""
	digits = re.fullmatch(r'(\d+)(?:st|nd|rd|th)', got.replace(' ', ''))
	words = said.split()
	if not digits or not words:
		return False
	last = words[-1]
	base = ORDINAL_WORDS.get(last) or (last[:-4] + 'y' if last.endswith('ieth') else re.sub(r'th$', '', last))
	return numbers_match(' '.join(words[:-1] + [base]), digits.group(1))


def same_word(a: str, b: str) -> bool:
	"""Possessive and plural forms of the same word ("repository's", "repositories") sound alike: not a mistake."""
	stem = lambda w: re.sub(r'(ies|s)$', '', re.sub(r'ies$', 'y', w))
	wa, wb = a.split(), b.split()
	return len(wa) == len(wb) and all(stem(x) == stem(y) for x, y in zip(wa, wb))


def heard_report(model: WhisperModel, wav: Path, spoken: str) -> str:
	"""What a listener hears in a beat, against what the voice was asked to say. The transcription is not prompted
	with the script (that would hide mistakes), the way the sync gate in prs publish listens."""
	segments, _info = model.transcribe(str(wav), beam_size=5, language='en', condition_on_previous_text=False)
	meant = [t for t in (normalize_token(x) for x in spoken.split()) if t]
	heard = [t for t in (normalize_token(x) for seg in segments for x in seg.text.split()) if t]
	wrong, skipped = [], []
	for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, meant, heard, autojunk=False).get_opcodes():
		said, got = ' '.join(meant[i1:i2]), ' '.join(heard[j1:j2])
		if tag == 'equal' or said.replace(' ', '') == got.replace(' ', '') or same_word(said, got):
			continue
		if numbers_match(said, got) or ordinals_match(said, got):
			continue
		if got:
			wrong.append(f'"{said or "-"}" heard as "{got}"')
		else:
			skipped.append(f'"{said}"')
	parts = ([f"heard differently: {'; '.join(wrong[:6])}"] if wrong else []) + ([f"missing: {'; '.join(skipped[:4])}"] if skipped else [])
	return '  '.join(parts) if parts else 'as written'

