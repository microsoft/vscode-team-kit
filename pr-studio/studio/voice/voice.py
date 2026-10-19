"""Narration for a PR video: synthesize each beat, align every word, snap to the real pauses, mix.

  python voice/voice.py synth --video videos/<slug> [--provider auto|mai|kokoro|recording] [--force]
  python voice/voice.py check-sync <final.mp4> <project.json>
  python voice/voice.py srt <timeline.json> <out.srt>
  python voice/voice.py samples --out DIR [--text "..."]

Providers
  mai        Azure Speech MAI-Voice-2 (key from AZURE_SPEECH_KEY, or an `az` lookup configured in ~/.cache/pr-studio/config.json)
  kokoro     Kokoro-82M (Apache-2.0), offline on CPU via ONNX; the default when no Azure key is available
  recording  your own voice: videos/<slug>/recording/<beat id>.(wav|m4a|mp3|aiff), or one file recording/full.*
All providers go through the same Whisper alignment and pause snapping, so captions stay exact whatever the voice.
"""
from __future__ import annotations

import argparse
from array import array
import concurrent.futures as cf
import difflib
import hashlib
import io
import json
import math
import os
import re
import shutil
import statistics
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

ROOT = Path(__file__).resolve().parents[1]
CACHE = Path.home() / '.cache' / 'pr-studio'
DEFAULT_GAP = 0.35
DEFAULT_LEAD_IN = 0.6
DEFAULT_TAIL = 2.5
TARGET_LUFS = -16.0
TARGET_TRUE_PEAK = -1.5
TARGET_LRA = 7.0
PLACEHOLDER_RE = re.compile(r"\{\{([^{}]+)\}\}")
ALNUM_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)
TOKEN_EDGE_PUNCTUATION_RE = re.compile(r"(^[^A-Za-z0-9_]+)|([^A-Za-z0-9_]+$)")
SAMPLE_RATE = 24000


def log(message: str) -> None:
	print(message, file=sys.stderr, flush=True)


def ffmpeg_path() -> str:
	for candidate in [os.environ.get('PRS_FFMPEG'), str(CACHE / 'bin' / 'ffmpeg'), shutil.which('ffmpeg')]:
		if candidate and Path(candidate).exists():
			return candidate
	raise RuntimeError('ffmpeg not found; run prs doctor')


def run_ffmpeg(ffmpeg: str, args: Sequence[str], capture_output: bool = False) -> subprocess.CompletedProcess[str]:
	return subprocess.run([ffmpeg, '-hide_banner', '-nostdin', *args], check=True, capture_output=capture_output, text=True)


def load_json(path: Path) -> Any:
	with path.open('r', encoding='utf-8') as handle:
		return json.load(handle)


def write_json(path: Path, data: Any) -> None:
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_suffix(path.suffix + '.tmp')
	tmp.write_text(json.dumps(data, indent=1) + '\n', encoding='utf-8')
	tmp.replace(path)


def load_config() -> dict[str, Any]:
	config = {'voice': {'provider': 'auto', 'pace': 1.1, 'kokoro': {'voice': 'am_michael', 'speed': 1.0}, 'mai': {'voice': 'en-US-Grant:MAI-Voice-2', 'region': 'eastus2'}}}
	home = os.environ.get('PRS_HOME')
	path = (Path(home) if home else Path.home() / '.cache' / 'pr-studio') / 'config.json'
	if path.exists():
		user = load_json(path)
		for key, value in user.get('voice', {}).items():
			if isinstance(value, dict):
				config['voice'].setdefault(key, {}).update(value)
			else:
				config['voice'][key] = value
	return config


def take_rate(provider: str, config: dict[str, Any]) -> float:
	"""How fast a take plays against the voice's own pace: Kokoro speaks at its speed times voice.pace, a MAI take is
	retimed by voice.pace, a recording keeps its pace."""
	if provider not in ('kokoro', 'mai'):
		return 1.0
	pace = float(config['voice'].get('pace', 1.0))
	if not 0.5 <= pace <= 2.0:
		raise RuntimeError(f'voice.pace must be between 0.5 and 2 (it is {pace:g})')
	return pace * float(config['voice'].get('kokoro', {}).get('speed', 1.0)) if provider == 'kokoro' else pace

@dataclass
class DisplayToken:
	index: int
	display: str
	spoken: str
	normalized_display: str
	normalized_spoken: str


@dataclass
class AsrWord:
	text: str
	start: float
	end: float
	normalized: str


def strip_edge_punctuation(token: str) -> str:
	return TOKEN_EDGE_PUNCTUATION_RE.sub('', token)


def split_token_affixes(token: str) -> tuple[str, str, str]:
	start = 0
	end = len(token)
	while start < end and not token[start].isalnum() and token[start] != '_':
		start += 1
	while end > start and not token[end - 1].isalnum() and token[end - 1] != '_':
		end -= 1
	return token[:start], token[start:end], token[end:]


def normalize_token(value: str) -> str:
	return ''.join(ALNUM_RE.findall(value.lower()))


def get_nested_value(root: Any, path_parts: Sequence[str], expression: str) -> Any:
	current = root
	for raw_part in path_parts:
		part = raw_part.strip()
		if isinstance(current, dict):
			if part not in current:
				raise KeyError(f"Placeholder '{expression}' references missing key '{part}'")
			current = current[part]
		elif isinstance(current, (list, str)) and part == 'length':
			# {{facts.linkedIssues.length}}: the same as in JavaScript, where prs check resolves it.
			current = len(current)
		elif isinstance(current, list):
			try:
				index = int(part)
			except ValueError as exc:
				raise KeyError(f"Placeholder '{expression}' expected numeric list index, got '{part}'") from exc
			try:
				if index < 0:
					raise IndexError(index)
				current = current[index]
			except IndexError as exc:
				raise KeyError(f"Placeholder '{expression}' references missing index {index}") from exc
		else:
			raise KeyError(f"Placeholder '{expression}' cannot descend into '{part}'")
	return current


def format_placeholder_value(value: Any, fmt: str | None, expression: str) -> str:
	if fmt is None or fmt == '' or fmt == 'words':
		return str(value)
	if fmt == 'n':
		if isinstance(value, bool):
			raise ValueError(f"Placeholder '{expression}' cannot format a boolean with '|n'")
		if isinstance(value, int):
			return f'{value:,}'
		if isinstance(value, float):
			if value.is_integer():
				return f'{int(value):,}'
			return f'{value:,}'
		text = str(value).strip().replace(',', '')
		try:
			number = int(text)
			return f'{number:,}'
		except ValueError as exc:
			raise ValueError(f"Placeholder '{expression}' cannot format non-numeric value '{value}' with '|n'") from exc
	raise ValueError(f"Unsupported placeholder format '{fmt}' in '{expression}'")


def resolve_placeholders(text: str, facts: dict[str, Any]) -> str:
	def replace(match: re.Match[str]) -> str:
		expression = match.group(1).strip()
		path_expression, _, fmt = expression.partition('|')
		path_parts = path_expression.strip().split('.')
		if len(path_parts) < 2 or path_parts[0] != 'facts' or any(not part.strip() for part in path_parts):
			raise ValueError(f"Invalid placeholder '{{{{{expression}}}}}'")
		root = facts
		path_parts = path_parts[1:]
		value = get_nested_value(root, path_parts, expression)
		return format_placeholder_value(value, fmt or None, expression)

	return PLACEHOLDER_RE.sub(replace, text)


def partition_spoken_words(words: list[str], display_words: Sequence[str]) -> list[list[str]]:
	slots = len(display_words)
	if slots <= 0:
		return []
	if not words:
		return [[] for _ in range(slots)]
	assignments: list[list[str]] = []
	position = 0
	remaining_words = len(words)
	for slot in range(slots):
		remaining_slots = slots - slot
		if remaining_words <= 0:
			count = 0
		elif remaining_words >= remaining_slots:
			count = math.ceil(remaining_words / remaining_slots)
			if remaining_slots > 1:
				normalized_prefix = ''
				for prefix_length in range(1, remaining_words - remaining_slots + 2):
					normalized_prefix += normalize_token(words[position + prefix_length - 1])
					if normalized_prefix == normalize_token(display_words[slot]):
						count = prefix_length
						break
		else:
			count = 1 if slot < len(words) else 0
		assignments.append(words[position:position + count])
		position += count
		remaining_words -= count
	return assignments


def apply_pronunciations(text: str, pronounce: dict[str, str]) -> list[DisplayToken]:
	raw_tokens = text.split()
	pronunciation_entries = []
	for key, replacement in pronounce.items():
		if not isinstance(key, str) or not key.strip() or not isinstance(replacement, str) or not replacement.strip():
			raise ValueError('Pronunciation keys and replacements must be non-empty strings')
		key_tokens = key.split()
		pronunciation_entries.append((key_tokens, replacement.split(), key))
	pronunciation_entries.sort(key=lambda item: -len(item[2]))
	display_tokens: list[DisplayToken] = []
	index = 0
	while index < len(raw_tokens):
		match_length = 0
		replacement_chunks: list[list[str]] | None = None
		for key_tokens, replacement_words, _ in pronunciation_entries:
			if index + len(key_tokens) > len(raw_tokens):
				continue
			segment = raw_tokens[index:index + len(key_tokens)]
			if [strip_edge_punctuation(token) for token in segment] == key_tokens:
				match_length = len(key_tokens)
				replacement_chunks = partition_spoken_words(replacement_words, key_tokens)
				break
		if replacement_chunks is None:
			token = raw_tokens[index]
			display_tokens.append(
				DisplayToken(
					index=len(display_tokens),
					display=token,
					spoken=token,
					normalized_display=normalize_token(token),
					normalized_spoken=normalize_token(token),
				)
			)
			index += 1
			continue
		for offset in range(match_length):
			raw_token = raw_tokens[index + offset]
			spoken_words = replacement_chunks[offset]
			spoken = ' '.join(spoken_words)
			prefix, _core, suffix = split_token_affixes(raw_token)
			if prefix:
				spoken = prefix + spoken
			if suffix:
				spoken = spoken + suffix
			display_tokens.append(
				DisplayToken(
					index=len(display_tokens),
					display=raw_token,
					spoken=spoken,
					normalized_display=normalize_token(raw_token),
					normalized_spoken=normalize_token(spoken),
				)
			)
		index += match_length
	return display_tokens


def spoken_text_from_tokens(tokens: Sequence[DisplayToken]) -> str:
	return ' '.join(token.spoken for token in tokens if token.spoken).strip()


def sha256_text(*values: str) -> str:
	hash_value = hashlib.sha256()
	for value in values:
		hash_value.update(value.encode('utf-8'))
		hash_value.update(b'\0')
	return hash_value.hexdigest()


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
		raise RuntimeError('Beat audio must be 24 kHz, 16-bit mono PCM WAV; rebuild invalid cached audio with --force')
	if handle.getnframes() <= 0:
		raise RuntimeError('Beat audio contains no samples')


def read_wav_duration_seconds(path: Path) -> float:
	with wave.open(str(path), 'rb') as handle:
		validate_beat_wav(handle)
		return handle.getnframes() / handle.getframerate()


def extract_loudnorm_stats(stderr: str) -> dict[str, float]:
	match = re.search(r'(\{\s*"input_i".*?\})', stderr, re.DOTALL)
	if not match:
		raise RuntimeError(f'Unable to parse loudnorm stats from ffmpeg output:\n{stderr}')
	stats = json.loads(match.group(1))
	return {
		'input_i': float(stats['input_i']),
		'input_lra': float(stats['input_lra']),
		'input_tp': float(stats['input_tp']),
		'input_thresh': float(stats['input_thresh']),
		'target_offset': float(stats['target_offset']),
	}


def measure_peak_dbfs(path: Path) -> float:
	with wave.open(str(path), 'rb') as handle:
		if handle.getsampwidth() != 2:
			raise RuntimeError(f'Expected 16-bit PCM output, got {handle.getsampwidth() * 8}-bit at {path}')
		raw = handle.readframes(handle.getnframes())
	samples = array('h')
	samples.frombytes(raw)
	if sys.byteorder != 'little':
		samples.byteswap()
	if not samples:
		return float('-inf')
	peak = max(abs(sample) for sample in samples) / 32768.0
	if peak <= 0:
		return float('-inf')
	return 20.0 * math.log10(peak)


def mix_narration_in_directory(ffmpeg_path: str, beat_audio: list[tuple[str, float, Path]], total_duration: float, output_path: Path, temp_dir: Path) -> float:
	temp_raw = temp_dir / 'premix.wav'
	temp_normalized = temp_dir / 'normalized.wav'
	filter_parts: list[str] = []
	input_args: list[str] = []
	for index, (_, start, audio_path) in enumerate(beat_audio):
		input_args.extend(['-i', str(audio_path)])
		delay_ms = max(0, int(round(start * 1000)))
		filter_parts.append(f'[{index}:a]aresample=48000,adelay={delay_ms}:all=1[a{index}]')
	mix_inputs = ''.join(f'[a{index}]' for index in range(len(beat_audio)))
	filter_parts.append(f'{mix_inputs}amix=inputs={len(beat_audio)}:normalize=0,apad=whole_dur={total_duration}[out]')
	run_ffmpeg(
		ffmpeg_path,
		[
			'-y',
			'-v',
			'error',
			*input_args,
			'-filter_complex',
			';'.join(filter_parts),
			'-map',
			'[out]',
			'-ac',
			'1',
			'-ar',
			'48000',
			'-c:a',
			'pcm_s16le',
			'-t',
			f'{total_duration:.3f}',
			str(temp_raw),
		],
	)
	first_pass = run_ffmpeg(
		ffmpeg_path,
		[
			'-v',
			'info',
			'-i',
			str(temp_raw),
			'-af',
			f'loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK}:LRA={TARGET_LRA}:print_format=json',
			'-f',
			'null',
			'-',
		],
		capture_output=True,
	)
	stats = extract_loudnorm_stats(first_pass.stderr)
	loudnorm_filter = (
		f'loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK}:LRA={TARGET_LRA}:'
		f'measured_I={stats["input_i"]}:'
		f'measured_LRA={stats["input_lra"]}:'
		f'measured_TP={stats["input_tp"]}:'
		f'measured_thresh={stats["input_thresh"]}:'
		f'offset={stats["target_offset"]}:linear=true:print_format=json'
	)
	run_ffmpeg(
		ffmpeg_path,
		[
			'-y',
			'-v',
			'error',
			'-i',
			str(temp_raw),
			'-af',
			loudnorm_filter,
			'-ac',
			'1',
			'-ar',
			'48000',
			'-c:a',
			'pcm_s16le',
			str(temp_normalized),
		],
	)
	peak_dbfs = measure_peak_dbfs(temp_normalized)
	if peak_dbfs >= -1.0:
		attenuation = peak_dbfs + 1.05
		attenuated_path = temp_dir / 'attenuated.wav'
		run_ffmpeg(
			ffmpeg_path,
			[
				'-y',
				'-v',
				'error',
				'-i',
				str(temp_normalized),
				'-af',
				f'volume=-{attenuation:.3f}dB',
				'-ac',
				'1',
				'-ar',
				'48000',
				'-c:a',
				'pcm_s16le',
				str(attenuated_path),
			],
		)
		attenuated_path.replace(temp_normalized)
		peak_dbfs = measure_peak_dbfs(temp_normalized)
	if peak_dbfs >= -1.0:
		raise RuntimeError(f'Peak level verification failed for {output_path}: {peak_dbfs:.2f} dBFS')
	verification = run_ffmpeg(
		ffmpeg_path,
		['-v', 'info', '-i', str(temp_normalized), '-af',
		 f'loudnorm=I={TARGET_LUFS}:TP={TARGET_TRUE_PEAK}:LRA={TARGET_LRA}:print_format=json', '-f', 'null', '-'],
		capture_output=True,
	)
	final_stats = extract_loudnorm_stats(verification.stderr)
	if not math.isfinite(final_stats['input_i']) or abs(final_stats['input_i'] - TARGET_LUFS) > 1.0:
		raise RuntimeError(f'Final loudness is {final_stats["input_i"]:.2f} LUFS, expected approximately {TARGET_LUFS}')
	if not math.isfinite(final_stats['input_tp']) or final_stats['input_tp'] >= -1.0:
		raise RuntimeError(f'Final true peak is {final_stats["input_tp"]:.2f} dBTP, expected below -1 dBTP')
	temp_normalized.replace(output_path)
	print(f'narration loudness {final_stats["input_i"]:.2f} LUFS; true peak {final_stats["input_tp"]:.2f} dBTP', file=sys.stderr)
	return peak_dbfs


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


def align_tokens(tokens: Sequence[DisplayToken], asr_words: Sequence[AsrWord], duration: float) -> tuple[list[dict[str, Any]], float]:
	script_chars: list[str] = []
	token_char_ranges: list[tuple[int, int]] = []
	for token in tokens:
		start = len(script_chars)
		for character in token.normalized_spoken:
			script_chars.append(character)
		token_char_ranges.append((start, len(script_chars)))
	asr_chars: list[str] = []
	asr_char_times: list[tuple[float, float]] = []
	for word in asr_words:
		for character in word.normalized:
			asr_chars.append(character)
			asr_char_times.append((word.start, word.end))
	script_string = ''.join(script_chars)
	asr_string = ''.join(asr_chars)
	matched_times: list[tuple[float, float] | None] = [None] * len(script_chars)
	matched_asr_indices: list[int | None] = [None] * len(script_chars)
	matcher = difflib.SequenceMatcher(a=script_string, b=asr_string, autojunk=False)
	matched_characters = 0
	for opcode, script_start, script_end, asr_start, _asr_end in matcher.get_opcodes():
		if opcode != 'equal':
			continue
		for offset in range(script_end - script_start):
			matched_times[script_start + offset] = asr_char_times[asr_start + offset]
			matched_asr_indices[script_start + offset] = asr_start + offset
		matched_characters += script_end - script_start
	align_score = 1.0 if not script_chars else matched_characters / len(script_chars)
	aligned_words: list[dict[str, Any]] = []
	for token in tokens:
		range_start, range_end = token_char_ranges[token.index]
		token_times = [matched_times[i] for i in range(range_start, range_end) if matched_times[i] is not None]
		if token.normalized_spoken.isdigit():
			indices = matched_asr_indices[range_start:range_end]
			# Partial digit matches elsewhere in the transcript must not anchor a spoken-out number.
			if not indices or indices[0] is None or indices != list(range(indices[0], indices[0] + len(indices))):
				token_times = []
		if token_times:
			start = min(time_range[0] for time_range in token_times)
			end = max(time_range[1] for time_range in token_times)
		else:
			start = None
			end = None
		aligned_words.append(
			{
				'i': token.index,
				'display': token.display,
				'spoken': token.spoken,
				'a': start,
				'b': end,
				'weight': max(1, len(token.normalized_spoken)),
			}
		)

	def fill_run(start_index: int, end_index: int) -> None:
		left_index = start_index - 1
		while left_index >= 0 and aligned_words[left_index]['a'] is None:
			left_index -= 1
		right_index = end_index + 1
		while right_index < len(aligned_words) and aligned_words[right_index]['a'] is None:
			right_index += 1
		left_time = 0.0 if left_index < 0 else float(aligned_words[left_index]['b'])
		right_time = duration if right_index >= len(aligned_words) else float(aligned_words[right_index]['a'])
		right_time = max(right_time, left_time)
		total_weight = sum(int(aligned_words[index]['weight']) for index in range(start_index, end_index + 1))
		cursor = left_time
		for index in range(start_index, end_index + 1):
			weight = int(aligned_words[index]['weight'])
			portion = 0.0 if total_weight == 0 else (right_time - left_time) * weight / total_weight
			aligned_words[index]['a'] = cursor
			aligned_words[index]['b'] = cursor + portion
			cursor += portion

	run_start: int | None = None
	for index, word in enumerate(aligned_words):
		if word['a'] is None:
			run_start = index if run_start is None else run_start
			continue
		if run_start is not None:
			fill_run(run_start, index - 1)
			run_start = None
	if run_start is not None:
		fill_run(run_start, len(aligned_words) - 1)

	for word in aligned_words:
		word['a'] = round(max(0.0, min(duration, float(word['a']))), 3)
		word['b'] = round(max(word['a'], min(duration, float(word['b']))), 3)
		del word['weight']
	return aligned_words, align_score


def resolve_phrase_occurrence(words: Sequence[dict[str, Any]], phrase: str, nth: int) -> int:
	phrase_tokens = [token for token in (normalize_token(part) for part in phrase.split()) if token]
	if not phrase_tokens:
		raise ValueError(f'Cue phrase "{phrase}" does not contain any searchable tokens')
	searchable_words = [(index, normalize_token(word['display'])) for index, word in enumerate(words)]
	searchable_words = [(index, token) for index, token in searchable_words if token]
	matches: list[int] = []
	for start in range(0, len(searchable_words) - len(phrase_tokens) + 1):
		window = [token for _, token in searchable_words[start:start + len(phrase_tokens)]]
		if window == [token.lower() for token in phrase_tokens]:
			matches.append(searchable_words[start][0])
	if nth < 0 or nth >= len(matches):
		beat_word_list = ' '.join(word['display'] for word in words)
		raise RuntimeError(
			f'Cue phrase "{phrase}" occurrence {nth} was not found. Beat words: {beat_word_list}'
		)
	return matches[nth]


def resolve_cues(cues: dict[str, Any], words: Sequence[dict[str, Any]], facts: dict[str, Any]) -> dict[str, float]:
	resolved: dict[str, float] = {}
	for name, cue_value in cues.items():
		if isinstance(cue_value, str):
			phrase = resolve_placeholders(cue_value, facts)
			nth = 0
			offset = 0.0
		elif isinstance(cue_value, dict):
			if not isinstance(cue_value.get('phrase'), str):
				raise ValueError(f'Cue "{name}" must contain a string phrase')
			phrase = resolve_placeholders(cue_value['phrase'], facts)
			nth = cue_value.get('nth', 0)
			offset = cue_value.get('offset', 0.0)
			if type(nth) is not int or nth < 0:
				raise ValueError(f'Cue "{name}" nth must be a non-negative integer')
			if isinstance(offset, bool) or not isinstance(offset, (int, float)) or not math.isfinite(offset):
				raise ValueError(f'Cue "{name}" offset must be a finite number')
		else:
			raise RuntimeError(f'Cue "{name}" must be a string or object')
		match_index = resolve_phrase_occurrence(words, phrase, nth)
		resolved[name] = round(float(words[match_index]['a']) + offset, 3)
	return resolved

# ── providers ──────────────────────────────────────────────────────────────

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


class KokoroMissing(RuntimeError):
	"""The offline voice is needed (no MAI-Voice-2 key could be found) but not installed: prs voice installs it."""


# The exit code of `synth` when it needs Kokoro and Kokoro isn't installed.
KOKORO_MISSING = 3


def kokoro_model():
	try:
		from kokoro_onnx import Kokoro
	except ImportError:
		raise KokoroMissing('the offline voice (Kokoro) is not installed') from None
	directory = CACHE / 'kokoro'
	for name in KOKORO_FILES:
		if not (directory / name).exists():
			raise KokoroMissing(f'Kokoro model file {name} is missing')
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


def convert_recording(ffmpeg: str, source: Path, out: Path) -> None:
	out.parent.mkdir(parents=True, exist_ok=True)
	run_ffmpeg(ffmpeg, ['-v', 'error', '-y', '-i', str(source), '-ac', '1', '-ar', str(SAMPLE_RATE), '-c:a', 'pcm_s16le', str(out)])


def find_recording(folder: Path, stem: str) -> Path | None:
	for ext in ('wav', 'm4a', 'mp3', 'aiff', 'aif', 'flac', 'ogg'):
		candidate = folder / f'{stem}.{ext}'
		if candidate.exists():
			return candidate
	return None


def split_full_recording(ffmpeg: str, model: Any, source: Path, beats: list['PreparedBeat'], audio_dir: Path) -> None:
	"""One take of the whole script: align it, cut at the middle of each pause between beats."""
	whole = audio_dir / '_full.wav'
	convert_recording(ffmpeg, source, whole)
	duration = read_wav_duration_seconds(whole)
	all_tokens: list[DisplayToken] = []
	bounds: list[tuple[int, int]] = []
	for beat in beats:
		start = len(all_tokens)
		for token in beat.tokens:
			all_tokens.append(DisplayToken(len(all_tokens), token.display, token.spoken, token.normalized_display, token.normalized_spoken))
		bounds.append((start, len(all_tokens) - 1))
	asr = transcribe_words(model, whole, ' '.join(b.spoken_text for b in beats))
	words, score = align_tokens(all_tokens, asr, duration)
	if score < 0.8:
		raise RuntimeError(f'The recording does not follow the script closely enough (match {score:.2f}); re-record or record per beat')
	cuts = [0.0]
	for (s0, e0), (s1, _e1) in zip(bounds, bounds[1:]):
		cuts.append((words[e0]['b'] + words[s1]['a']) / 2)
	cuts.append(duration)
	for k, beat in enumerate(beats):
		a, b = max(0.0, cuts[k] - 0.05), cuts[k + 1]
		run_ffmpeg(ffmpeg, ['-v', 'error', '-y', '-ss', f'{a:.3f}', '-to', f'{b:.3f}', '-i', str(whole), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ac', '1', '-ar', str(SAMPLE_RATE), '-c:a', 'pcm_s16le', str(audio_dir / f'{beat.id}.wav')])
	whole.unlink(missing_ok=True)


# ── refine: snap word and cue times to the real pauses (ported from the first video's verified pipeline) ──

def silences(ffmpeg: str, path: Path, noise: str = '-38dB', d: float = 0.10) -> tuple[list[tuple[float, float]], float]:
	err = subprocess.run([ffmpeg, '-hide_banner', '-i', str(path), '-af', f'silencedetect=noise={noise}:d={d}', '-vn', '-f', 'null', '-'], capture_output=True, text=True).stderr
	st = [float(x) for x in re.findall(r'silence_start: (-?[\d.]+)', err)]
	en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
	m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', err)
	dur = float(m.group(1)) * 3600 + float(m.group(2)) * 60 + float(m.group(3))
	return [(max(0.0, s), en[i] if i < len(en) else dur) for i, s in enumerate(st)], dur


def piecewise(points: list[tuple[float, float]]):
	cleaned: list[tuple[float, float]] = []
	for o, n in sorted(points):
		if cleaned and (o <= cleaned[-1][0] or n <= cleaned[-1][1]):
			continue
		cleaned.append((o, n))

	def f(x: float) -> float:
		if x <= cleaned[0][0]:
			return x + (cleaned[0][1] - cleaned[0][0])
		for (o0, n0), (o1, n1) in zip(cleaned, cleaned[1:]):
			if x <= o1:
				return n0 + (x - o0) * (n1 - n0) / (o1 - o0)
		return x + (cleaned[-1][1] - cleaned[-1][0])
	return f


def refine(timeline: dict[str, Any], narration: Path, ffmpeg: str) -> list[str]:
	"""Snap words and cues to the pauses of the final mixed narration (the audio the sync gate checks)."""
	report = []
	everything, _total = silences(ffmpeg, narration)
	for b in timeline['beats']:
		start = b['start']
		dur = b['end'] - b['start']
		sil = [(max(0.0, s0 - start), min(dur, s1 - start)) for s0, s1 in everything if s1 > start and s0 < b['end']]
		sil = [s for s in sil if s[1] > s[0]]
		words = b['words']
		onset = sil[0][1] if sil and sil[0][0] < 0.02 else 0.0
		offset = sil[-1][0] if sil and sil[-1][1] >= dur - 0.02 and sil[-1][0] > 0.5 else dur
		inner = sorted(s for s in sil if s[0] > onset + 0.05 and s[1] < dur - 0.02)
		points = [(words[0]['a'], start + onset)]
		gaps = []
		for i in range(len(words) - 1):
			punct = bool(re.search(r'[.!?;:,]["\')]*$', words[i]['display']))
			if punct or words[i + 1]['a'] - words[i]['b'] >= 0.12:
				gaps.append((i, words[i]['b'] - start, words[i + 1]['a'] - start))
		used: set[int] = set()
		overrides: dict[int, tuple[float, float]] = {}
		for s0, s1 in inner:
			if s1 - s0 < 0.12:
				continue
			mid = (s0 + s1) / 2
			cand = [(abs((g[1] + g[2]) / 2 - mid), g) for g in gaps if g[0] not in used and abs((g[1] + g[2]) / 2 - mid) <= 0.7]
			if not cand:
				continue
			_, (i, _ge, _gn) = min(cand, key=lambda x: x[0])
			if start + s0 <= points[-1][1] + 0.03:
				continue
			used.add(i)
			overrides[i] = (start + s0, start + s1)
			if words[i + 1]['a'] - words[i]['b'] > 0.02:
				points.append((words[i]['b'], start + s0))
				points.append((words[i + 1]['a'], start + s1))
		points.append((words[-1]['b'], start + offset))
		f = piecewise(points)
		old_a = [w['a'] for w in words]
		for w in words:
			w['a'] = round(f(w['a']), 3)
			w['b'] = round(f(w['b']), 3)
		cue_fix: dict[float, float] = {}
		for i, (e, st) in overrides.items():
			words[i]['b'] = round(e, 3)
			cue_fix[old_a[i + 1]] = round(st, 3)
			words[i + 1]['a'] = round(st, 3)
		closed = 0
		for i in range(len(words) - 1):
			if i in overrides:
				continue
			if words[i + 1]['a'] - words[i]['b'] >= 0.12:
				mid = round((words[i]['b'] + words[i + 1]['a']) / 2, 3)
				words[i]['b'] = mid
				cue_fix.setdefault(old_a[i + 1], mid)
				words[i + 1]['a'] = mid
				closed += 1
		for w in words:
			if w['b'] <= w['a']:
				w['b'] = round(w['a'] + 0.04, 3)
		b['cues'] = {k: next((new for old, new in cue_fix.items() if abs(old - v) < 1e-6), round(f(v), 3)) for k, v in b['cues'].items()}
		report.append(f"{b['id']}: {len(overrides)} pauses anchored, {closed} invented pauses closed")
	return report


# ── synth ──────────────────────────────────────────────────────────────────

@dataclass
class PreparedBeat:
	id: str
	text: str
	tokens: list[DisplayToken]
	spoken_text: str
	cues: dict[str, Any]
	gap_before: float | None


DIGIT_WORDS = ['oh', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
SAY_AS = {'JSON': 'jason', 'README': 'read me', 'GUID': 'goo id', 'UUID': 'U U I D', 'SQL': 'sequel', 'GIF': 'gif', 'ASCII': 'ask ee', 'NaN': 'not a number'}


def auto_spoken(core: str) -> str | None:
	"""Spoken form for code-like words: camelCase, ACRONYMS, dotted.names and long numbers."""
	if core in SAY_AS:
		return SAY_AS[core]
	# An ordinary word with an apostrophe (it's, don't, dialog's) is read as written, not split in two.
	if re.fullmatch(r"[A-Za-z]+(?:['\u2019][A-Za-z]+)+", core):
		return None
	if re.fullmatch(r'\d{5,}', core):
		return ' '.join(DIGIT_WORDS[int(c)] for c in core)
	if re.fullmatch(r'v?\d+(\.\d+)+', core):
		return None
	if re.fullmatch(r'[A-Z]{2,5}', core) and core != 'OK':
		return ' '.join(core)
	if re.fullmatch(r'[A-Z]{2,5}s', core):
		return ' '.join(core[:-1]) + "'s"
	parts = re.split(r'[._/]+', core)
	if len(parts) > 1 and all(parts) and re.fullmatch(r'[\w./-]+', core) and not re.fullmatch(r'[\d.]+', core):
		return ' dot '.join(' '.join(_camel_words(p)) for p in parts) if '.' in core and '/' not in core and '_' not in core else ' '.join(w for p in parts for w in _camel_words(p))
	words = _camel_words(core)
	if len(words) > 1:
		return ' '.join(words)
	return None


def _camel_words(word: str) -> list[str]:
	pieces = re.findall(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|\d+', word)
	out = []
	for p in pieces:
		if p in SAY_AS:
			out.append(SAY_AS[p])
		elif p.isupper() and 2 <= len(p) <= 5:
			out.append(' '.join(p))
		else:
			out.append(p.lower() if not p.isupper() else p)
	return out if pieces else [word]


def apply_auto_pronunciations(tokens: list[DisplayToken], pronounce: dict[str, str] | None = None) -> list[DisplayToken]:
	# One-word pronounce entries also reach the parts of a split name: "subagent" covers CopilotSubagentTracking.
	words = {k.lower(): v for k, v in (pronounce or {}).items() if isinstance(k, str) and isinstance(v, str) and k.strip() and ' ' not in k.strip()}
	out = []
	for token in tokens:
		if token.spoken == token.display:
			prefix, core, suffix = split_token_affixes(token.display)
			spoken = auto_spoken(core) if core else None
			if spoken and words:
				# The plural of an entry too: "subagent" covers the "Subagents" in a name.
				part = lambda w: words.get(w.lower()) or (words[w.lower()[:-1]] + 's' if w.lower().endswith('s') and w.lower()[:-1] in words else w)
				spoken = ' '.join(part(w) for w in spoken.split())
			if spoken:
				full = f'{prefix}{spoken}{suffix}'
				token = DisplayToken(token.index, token.display, full, token.normalized_display, normalize_token(full))
		out.append(token)
	return out


def prepare_beats(storyboard: dict[str, Any], facts: dict[str, Any]) -> list[PreparedBeat]:
	pronounce = storyboard.get('pronounce', {}) or {}
	beats = []
	for beat in storyboard['beats']:
		text = resolve_placeholders(beat['say'], facts)
		tokens = apply_auto_pronunciations(apply_pronunciations(text, pronounce), pronounce)
		beats.append(PreparedBeat(beat['id'], text, tokens, spoken_text_from_tokens(tokens), beat.get('cues', {}) or {}, beat.get('gapBefore')))
	return beats


def get_whisper_model():
	from faster_whisper import WhisperModel
	return WhisperModel('small.en', compute_type='int8')


def resolve_provider(requested: str | None, config: dict[str, Any], video: Path) -> tuple[str, str | None]:
	provider = requested or config['voice'].get('provider', 'auto')
	key = None
	if provider in ('auto', 'mai'):
		key = get_speech_key(config['voice'].get('mai', {}))
		if provider == 'mai' and not key:
			raise RuntimeError('MAI-Voice-2 needs AZURE_SPEECH_KEY (or voice.mai.azResource/azResourceGroup in ~/.cache/pr-studio/config.json)')
		if provider == 'auto':
			provider = 'mai' if key else 'kokoro'
	return provider, key


NUMBER_WORDS = set('zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million point and a'.split())
DIGIT_OF = {'zero': '0', 'oh': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'}
# Number words, also run together the way normalization leaves them ("thirty-four" becomes "thirtyfour").
NUMBER_RE = re.compile('(?:' + '|'.join(sorted(NUMBER_WORDS, key=len, reverse=True)) + ')+')


def numbers_match(said: str, got: str) -> bool:
	"""A number in words on one side and in digits on the other is the same thing; said digit by digit (a PR number),
	the digits must match too."""
	for words, digits in ((said, got), (got, said)):
		if words and digits and re.fullmatch(r'[\d.,%]+', digits.replace(' ', '')) and all(NUMBER_RE.fullmatch(t) or t.isdigit() for t in words.split()):
			parts = [DIGIT_OF.get(t, t if t.isdigit() else None) for t in words.split()]
			return None in parts or ''.join(parts) == re.sub(r'\D', '', digits)
	return False


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
		if numbers_match(said, got):
			continue
		if got:
			wrong.append(f'"{said or "-"}" heard as "{got}"')
		else:
			skipped.append(f'"{said}"')
	parts = ([f"heard differently: {'; '.join(wrong[:6])}"] if wrong else []) + ([f"missing: {'; '.join(skipped[:4])}"] if skipped else [])
	return '  '.join(parts) if parts else 'as written'


def synth(video: Path, provider_arg: str | None, force: bool, workers: int, redo: Sequence[str] = ()) -> dict[str, Any]:
	config = load_config()
	storyboard = load_json(video / 'storyboard.json')
	facts = load_json(video / 'pr.json')['facts']
	beats = prepare_beats(storyboard, facts)
	build = video / 'build'
	audio_dir = build / 'audio'
	audio_dir.mkdir(parents=True, exist_ok=True)
	ffmpeg = ffmpeg_path()
	provider, key = resolve_provider(provider_arg, config, video)
	mai = config['voice'].get('mai', {})
	kok = config['voice'].get('kokoro', {})
	voice_name = {'mai': mai.get('voice', 'en-US-Grant:MAI-Voice-2'), 'kokoro': kok.get('voice', 'am_michael'), 'recording': 'recording'}[provider]
	log(f'voice: {provider} ({voice_name})')
	rate = take_rate(provider, config)
	voice_key = f'{voice_name}@{rate:g}' if rate != 1.0 else voice_name
	t0 = time.time()
	stale: list[PreparedBeat] = []
	for beat in beats:
		h = sha256_text(provider, voice_key, beat.spoken_text)
		wav, hash_file = audio_dir / f'{beat.id}.wav', audio_dir / f'{beat.id}.hash'
		if force or beat.id in redo or provider == 'recording' or not wav.exists() or not hash_file.exists() or hash_file.read_text().strip() != h:
			stale.append(beat)
	unknown = [r for r in redo if r not in {b.id for b in beats}]
	if unknown:
		raise RuntimeError(f'--redo: no beat {", ".join(unknown)} (beats: {", ".join(b.id for b in beats)})')
	model = None
	if provider == 'kokoro' and stale:
		synthesize_kokoro([(b.spoken_text, audio_dir / f'{b.id}.wav') for b in stale], voice_name, rate, workers)
	elif provider == 'mai' and stale:
		def one(b: PreparedBeat) -> None:
			synthesize_azure_speech(b.spoken_text, voice_name, mai.get('region', 'eastus2'), key, audio_dir / f'{b.id}.wav')
			if rate != 1.0:
				retime_wav(ffmpeg, audio_dir / f'{b.id}.wav', rate)
		with cf.ThreadPoolExecutor(3) as pool:
			list(pool.map(one, stale))
	elif provider == 'recording':
		folder = video / 'recording'
		per_beat = [find_recording(folder, b.id) for b in beats]
		if all(per_beat):
			for b, src in zip(beats, per_beat):
				convert_recording(ffmpeg, src, audio_dir / f'{b.id}.wav')
		else:
			full = find_recording(folder, 'full')
			if not full:
				raise RuntimeError(f'No recording found: put recording/<beat id>.wav for every beat, or one recording/full.wav (see {folder / "SCRIPT.md"})')
			model = get_whisper_model()
			split_full_recording(ffmpeg, model, full, beats, audio_dir)
		stale = beats
	for b in stale:
		(audio_dir / f'{b.id}.hash').write_text(sha256_text(provider, voice_key, b.spoken_text) + '\n')
	log(f'synthesized {len(stale)} of {len(beats)} beats in {time.time() - t0:.1f}s')
	t1 = time.time()
	model = model or get_whisper_model()
	current = DEFAULT_LEAD_IN
	timeline_beats = []
	inputs = []
	for k, beat in enumerate(beats):
		wav = audio_dir / f'{beat.id}.wav'
		duration = read_wav_duration_seconds(wav)
		asr = transcribe_words(model, wav, beat.spoken_text)
		words, score = align_tokens(beat.tokens, asr, duration)
		if score < 0.9:
			log(f'warning: beat {beat.id} alignment score {score:.3f}: the take likely skipped or slurred words (see the heard line); take it again with --redo {beat.id}, or reword it')
		log(f"heard {beat.id}: {heard_report(model, wav, beat.spoken_text)}")
		if k:
			current += DEFAULT_GAP if beat.gap_before is None else beat.gap_before
		elif beat.gap_before is not None:
			current += beat.gap_before
		start, end = round(current, 3), round(current + duration, 3)
		absolute = [{'i': w['i'], 'display': w['display'], 'spoken': w['spoken'], 'a': round(start + float(w['a']), 3), 'b': round(start + float(w['b']), 3)} for w in words]
		timeline_beats.append({'id': beat.id, 'start': start, 'end': end, 'text': beat.text, 'words': absolute, 'cues': resolve_cues(beat.cues, absolute, facts), 'alignScore': round(score, 4)})
		inputs.append((beat.id, start, wav))
		current = end
	timeline = {'total': round(current + DEFAULT_TAIL, 3), 'voice': {'provider': provider, 'name': voice_name}, 'beats': timeline_beats}
	write_json(build / 'timeline.unrefined.json', timeline)
	log(f'aligned in {time.time() - t1:.1f}s')
	with tempfile.TemporaryDirectory(prefix='voice-mix-', dir=build) as tmp:
		mix_narration_in_directory(ffmpeg, inputs, timeline['total'], build / 'narration.wav', Path(tmp))
	for line in refine(timeline, build / 'narration.wav', ffmpeg):
		log(f'  {line}')
	write_json(build / 'timeline.json', timeline)
	last = max((w['b'] for b in timeline['beats'] for w in b['words']), default=0)
	log(f'voice done in {time.time() - t0:.1f}s: the last word ends at {last:.1f}s (the file without the end card runs {timeline["total"]:.1f}s)')
	return timeline


# ── sync gate (ported from the first video) ───────────────────────────────

def check_sync(mp4: str, project_path: str) -> int:
	ffmpeg = ffmpeg_path()
	p = load_json(Path(project_path))
	err = subprocess.run([ffmpeg, '-hide_banner', '-i', mp4, '-af', 'silencedetect=noise=-38dB:d=0.10', '-vn', '-f', 'null', '-'], capture_output=True, text=True).stderr
	st = [float(x) for x in re.findall(r'silence_start: (-?[\d.]+)', err)]
	en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', err)]
	sil = [(max(0, s), en[i]) for i, s in enumerate(st) if i < len(en)]
	fail = []

	def is_silent(t: float) -> bool:
		return any(s[0] - 0.01 <= t <= s[1] + 0.01 for s in sil)
	onsets, claimed_bad, real_bad = [], [], []
	checked = 0
	for b in p['beats']:
		ws = b['words']
		c = min(sil, key=lambda s: abs(s[1] - ws[0]['a']))
		onsets.append((b['id'], round(c[1] - ws[0]['a'], 3)))
		for i, w in enumerate(ws[:-1]):
			if ws[i + 1]['a'] - w['b'] >= 0.15:
				checked += 1
				mid = (w['b'] + ws[i + 1]['a']) / 2
				if not is_silent(mid):
					claimed_bad.append((b['id'], w['display'], round(mid, 2)))
		lo, hi = ws[0]['a'] + 0.05, ws[-1]['b'] - 0.05
		for s0, s1 in sil:
			if s1 - s0 >= 0.2 and lo < (s0 + s1) / 2 < hi:
				mid = (s0 + s1) / 2
				for w in ws:
					if w['a'] + 0.03 < mid < w['b'] - 0.03 and (w['b'] - w['a']) > 0.12:
						real_bad.append((b['id'], w['display'], round(mid, 2)))
	print('beat onsets (real speech start - caption first word):', onsets)
	print(f'captions claim {checked} pauses; {len(claimed_bad)} are not silent in the audio: {claimed_bad}')
	print(f'audio has real pauses with a caption word running through them: {len(real_bad)} {real_bad}')
	if any(abs(o[1]) > 0.12 for o in onsets):
		fail.append('beat onset')
	if len(claimed_bad) > 1:
		fail.append('caption pause not silent (the voice ran through a comma: drop the comma, or prs voice --redo the beat)')
	if len(real_bad) > 1:
		fail.append('audio pause under a caption word (the voice stopped inside a word, often before a name: reword, or --redo the beat)')
	model = get_whisper_model()
	tot_s = tot_m = 0
	with tempfile.TemporaryDirectory() as tmp:
		chunk = os.path.join(tmp, 'chunk.wav')
		for b in p['beats']:
			t0, t1 = b['words'][0]['a'] - 0.3, b['words'][-1]['b'] + 0.3
			subprocess.run([ffmpeg, '-v', 'error', '-y', '-ss', str(max(0, t0)), '-t', str(t1 - t0), '-i', mp4, '-ac', '1', '-ar', '16000', chunk], check=True)
			segs, _ = model.transcribe(chunk, beam_size=5, language='en', condition_on_previous_text=False)
			heard = gate_words(' '.join(s.text for s in segs))
			said = gate_words(' '.join(w.get('spoken') or w['display'] for w in b['words']))
			sm = difflib.SequenceMatcher(None, said, heard)
			# Spacing-only differences ("find commit" => "findcommit") are the same speech: left out of the list.
			miss = [' '.join(said[i1:i2]) + ' => ' + ' '.join(heard[j1:j2]) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal' and ''.join(said[i1:i2]) != ''.join(heard[j1:j2])]
			# Compare characters without spaces: "S W E" vs "SWE" or "copilot" vs "co pilot" are the same speech.
			a, h = ''.join(said), ''.join(heard)
			cm = difflib.SequenceMatcher(None, a, h, autojunk=False)
			tot_s += len(a)
			tot_m += sum(i2 - i1 for tag, i1, i2, j1, j2 in cm.get_opcodes() if tag == 'equal')
			print(f"{b['id']:12s} text match {cm.ratio():.3f}  differences: {miss[:8]}")
	ratio = tot_m / max(1, tot_s)
	print(f'overall speech matched {ratio:.3f}')
	if ratio < 0.93:
		fail.append('text (the voice said words other than the captions: see the differences above; fix them with pronounce or other words, then --redo)')
	print('SYNC GATE:', 'FAIL ' + ', '.join(fail) if fail else 'PASS')
	return 1 if fail else 0


NUMBER_WORDS = {w: str(i) for i, w in enumerate(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])} | {'oh': '0'}


def gate_words(text: str) -> list[str]:
	"""Words for the text comparison: lower case, no punctuation, digits spelled or not end up the same."""
	raw = re.sub(r'[^a-z0-9 ]', ' ', text.lower().replace('-', ' ')).split()
	out: list[str] = []
	for w in raw:
		w = NUMBER_WORDS.get(w, w)
		if w.isdigit() and out and out[-1].isdigit():
			out[-1] += w
		else:
			out.append(w)
	return out


def write_srt(timeline_path: str, out: str) -> None:
	tl = load_json(Path(timeline_path))

	def ts(t: float) -> str:
		return f"{int(t // 3600):02d}:{int(t % 3600 // 60):02d}:{t % 60:06.3f}".replace('.', ',')
	cues = []
	ends = re.compile(r'[.!?;:,]["\')\u201d]*$')
	for b in tl['beats']:
		ws = b['words']
		chunk = []
		size = 9
		for i, w in enumerate(ws):
			if not chunk:
				# A phrase longer than 9 words splits evenly, as on screen (10 words make 5 + 5, not 9 + 1).
				last = i
				while last < len(ws) - 1 and not ends.search(ws[last]['display']):
					last += 1
				run = last - i + 1
				size = -(-run // -(-run // 9)) if run > 9 else 9
			chunk.append(w)
			if i == len(ws) - 1 or len(chunk) >= size or ends.search(w['display']):
				cues.append((chunk[0]['a'], chunk[-1]['b'] + 0.15, ' '.join(x['display'] for x in chunk)))
				chunk = []
	# A cue ends before the next one starts, so no player shows two lines at once.
	cues = [(a, min(b, cues[n + 1][0] - 0.001) if n + 1 < len(cues) else b, t) for n, (a, b, t) in enumerate(cues)]
	Path(out).write_text('\n'.join(f'{n}\n{ts(a)} --> {ts(b)}\n{t}\n' for n, (a, b, t) in enumerate(cues, 1)), encoding='utf-8')
	print(f'{len(cues)} subtitle cues -> {out}')


def samples(out: Path, text: str) -> None:
	voices = ['am_michael', 'am_fenrir', 'am_puck', 'bm_george', 'af_heart', 'af_bella', 'bf_emma']
	synthesize_kokoro([(text, out / f'kokoro-{v}.wav') for v in voices[:1]], voices[0], 1.0, 1)
	for v in voices[1:]:
		synthesize_kokoro([(text, out / f'kokoro-{v}.wav')], v, 1.0, 1)
	print(f'{len(voices)} samples in {out}')


def main(argv: Sequence[str]) -> int:
	parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
	sub = parser.add_subparsers(dest='cmd', required=True)
	s = sub.add_parser('synth')
	s.add_argument('--video', required=True)
	s.add_argument('--provider')
	s.add_argument('--force', action='store_true')
	s.add_argument('--workers', type=int, default=6)
	s.add_argument('--redo', default='', help='comma-separated beat ids to voice again (a fresh take)')
	c = sub.add_parser('check-sync')
	c.add_argument('mp4')
	c.add_argument('project')
	r = sub.add_parser('srt')
	r.add_argument('timeline')
	r.add_argument('out')
	m = sub.add_parser('samples')
	m.add_argument('--out', required=True)
	m.add_argument('--text', default='Pull request three two five eight oh four: authenticating to a locked Private Marketplace. Five hundred thirty lines added across thirteen files.')
	args = parser.parse_args(argv)
	if args.cmd == 'synth':
		try:
			synth(Path(args.video), args.provider, args.force, args.workers, [b for b in args.redo.split(',') if b])
		except KokoroMissing as error:
			print(f'voice: {error}', file=sys.stderr)
			return KOKORO_MISSING
		except (ValueError, RuntimeError, FileNotFoundError) as error:
			print(f'voice: {error}', file=sys.stderr)
			return 1
		return 0
	if args.cmd == 'check-sync':
		return check_sync(args.mp4, args.project)
	if args.cmd == 'srt':
		write_srt(args.timeline, args.out)
		return 0
	if args.cmd == 'samples':
		samples(Path(args.out), args.text)
		return 0
	return 2


if __name__ == '__main__':
	sys.exit(main(sys.argv[1:]))
