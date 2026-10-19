"""Voices a how-to video's narration: <work>/voice/lines.json ({ step id: sentence }) -> voice/<step>.wav and
voice/takes.json (each take's length and word timings), with a listener check.

    $PY voice.py <work> [--only step,step] [--pace 1.2]

The voice is MAI-Voice-2 (played at 1.2x) when an Azure Speech key is available (AZURE_SPEECH_KEY, or voice.mai in
~/.cache/test-videos/config.json), else Kokoro, offline (at 1.1x).

A take reported other than "as written" was heard wrong: reword that line and voice it again (--only <step>).
"""
import difflib
import json
import subprocess
import sys
import time
import wave
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import env  # noqa: E402
import voice_engine as v  # noqa: E402

args = sys.argv[1:]
work = Path(args[0]).resolve()
only = args[args.index('--only') + 1].split(',') if '--only' in args else None

lines = json.loads((work / 'voice/lines.json').read_text())
takes_path = work / 'voice/takes.json'
takes = json.loads(takes_path.read_text()) if takes_path.exists() else {}
config = v.load_config()
mai = config['voice']['mai']
key = v.get_speech_key(mai)
# A key looked up with `az` sometimes fails for a moment when several runs ask at once: try again, only then.
for _ in range(3 if mai.get('azResource') else 0):
	if key:
		break
	time.sleep(20)
	key = v.get_speech_key(mai)
provider = 'mai' if key else 'kokoro'
pace = float(args[args.index('--pace') + 1]) if '--pace' in args else (1.2 if provider == 'mai' else 1.1)
ffmpeg = env.ffmpeg()
model = v.get_whisper_model()


def norm(text):
	return ''.join(ch for ch in text.lower() if ch.isalnum() or ch == "'")


def aligned(text, heard):
	"""Every written word with a time: the heard word it matches, or one shared out between its matched neighbours."""
	written = text.split()
	matcher = difflib.SequenceMatcher(a=[norm(w) for w in written], b=[norm(h.text) for h in heard], autojunk=False)
	times = [None] * len(written)
	for block in matcher.get_matching_blocks():
		for k in range(block.size):
			h = heard[block.b + k]
			times[block.a + k] = (h.start, h.end)
	matched = sum(t is not None for t in times)
	# Unmatched runs: split the gap between the known neighbours evenly.
	i = 0
	while i < len(written):
		if times[i] is not None:
			i += 1
			continue
		j = i
		while j < len(written) and times[j] is None:
			j += 1
		lo = times[i - 1][1] if i else (heard[0].start if heard else 0.0)
		hi = times[j][0] if j < len(written) else (heard[-1].end if heard else lo + 0.3 * (j - i))
		step = max(0.05, (hi - lo) / (j - i))
		for k in range(i, j):
			times[k] = (lo + step * (k - i), lo + step * (k - i + 1))
		i = j
	return [{'w': w, 'a': round(a, 3), 'b': round(b, 3)} for w, (a, b) in zip(written, times)], matched


todo = [(name, text) for name, text in lines.items() if not only or name in only]
(work / 'voice').mkdir(parents=True, exist_ok=True)
if provider == 'kokoro':
	kokoro = config['voice']['kokoro']
	v.synthesize_kokoro([(text, work / 'voice' / f'{name}.wav') for name, text in todo], kokoro['voice'], pace, workers=4)
for name, text in todo:
	wav = work / 'voice' / f'{name}.wav'
	if provider == 'mai':
		v.synthesize_azure_speech(text, mai['voice'], mai.get('region', 'eastus2'), key, wav)
		v.retime_wav(ffmpeg, wav, pace)
	# Trim the silence a take starts with: the step's narration (and its captions) should start when the step does.
	trimmed = wav.with_suffix('.trim.wav')
	subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(wav), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(trimmed)], check=True)
	trimmed.replace(wav)
	with wave.open(str(wav)) as handle:
		seconds = handle.getnframes() / handle.getframerate()
	# Transcribed without the script as a prompt: with it, Whisper sometimes skips the opening words.
	heard_words = v.transcribe_words(model, wav, None)
	words, matched = aligned(text, heard_words)
	heard = v.heard_report(model, wav, text)
	takes[name] = {'text': text, 'seconds': round(seconds, 3), 'words': words, 'heard': heard}
	print(f'{name}: {seconds:.2f}s, {matched} of {len(words)} words timed from the audio: {heard}')
for name in list(takes):
	if name not in lines:
		del takes[name]
takes_path.write_text(json.dumps(takes, indent=1))
print(f'narration: {sum(t["seconds"] for t in takes.values()):.1f}s in {len(takes)} takes, {provider} at {pace}x')
