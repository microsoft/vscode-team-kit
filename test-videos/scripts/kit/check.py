"""Checks a composed how-to video: the voice against the captions, and a contact sheet to look at.

    $PY check.py <work dir>

Prints the length, what a listener hears, how far each caption is from its spoken words (at most 0.3 s is good),
and each band that's too fast to read (more than 4.5 words/s; aim for 4). Writes <work>/out/contact-01.jpg, ...: the band
and the window at each step's start and at each "look" moment, six to a page.
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import env  # noqa: E402
import voice_engine as v  # noqa: E402
from small import frames_at, write_sheets  # noqa: E402

work = Path(sys.argv[1]).resolve()
captions = json.loads((work / 'captions.json').read_text())
name = captions.get('name') or f'{work.name}-how-to-test'
mp4 = work / 'out' / f'{name}.mp4'
srt = work / 'out' / f'{name}.srt'
ffmpeg = env.ffmpeg()

duration = env.duration(mp4)
with tempfile.TemporaryDirectory() as tmp:
	audio = Path(tmp) / 'audio.wav'
	subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', str(mp4), '-vn', '-ac', '1', '-ar', '16000', str(audio)], check=True)
	words = v.transcribe_words(v.get_whisper_model(), audio, None)


def secs(ts):
	h, m, rest = ts.split(':')
	s, ms = rest.split(',')
	return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def norm(text):
	return re.sub(r"[^a-z0-9']", '', text.lower())


worst = 0
cues = srt.read_text().strip().split('\n\n')
for cue in cues:
	lines = cue.split('\n')
	start = secs(lines[1].split('-->')[0].strip())
	first = norm(lines[2].split()[0])
	offset = min((abs(w.start - start) for w in words if norm(w.text) == first and abs(w.start - start) < 1.5), default=None)
	worst = max(worst, offset if offset is not None else 9)
	if offset is None or offset > 0.3:
		print(f'  caption at {start:.2f}s is {"not heard" if offset is None else f"{offset:.2f}s off"}: {lines[2]}')
print(f'length {duration:.1f}s; {len(cues)} captions, worst offset {worst:.2f}s ({"good" if worst <= 0.3 else "CHECK"})')
print('heard:', ' '.join(w.text for w in words))

out_timeline = json.loads((work / 'out/timeline-out.json').read_text())

# Reading speed: each band's DO and LOOK FOR words over the time the band is on screen. Viewers read about 4 words/s; more than 4.5 is flagged.
# A joined video (concat.py) lists its parts, whose captions.json hold the band texts; step ids may repeat across parts.
parts = out_timeline.get('parts') or [[0.0, str(work)]]
bands = {}
shown_total, word_count = {}, {}
for i, (start, step) in enumerate(out_timeline['steps']):
	part = max((p for p in parts if p[0] <= start + 0.001), key=lambda p: p[0], default=parts[0])[1]
	if part not in bands:
		bands[part] = json.loads((Path(part) / 'captions.json').read_text()).get('steps', {})
	band = bands[part].get(step, {})
	shown = (out_timeline['steps'][i + 1][0] if i + 1 < len(out_timeline['steps']) else duration) - start
	# A band interrupted by a pause (flags.py) is on screen in two pieces: add them up.
	shown_total[(part, step)] = shown_total.get((part, step), 0.0) + shown
	word_count[(part, step)] = len(re.sub(r'[`*]', '', f"{band.get('do', '')} {band.get('look', '')}").split())
too_fast = []
for (part, step), shown in shown_total.items():
	count = word_count[(part, step)]
	if count / max(shown, 0.1) > 4.5:
		too_fast.append(f'{step} has {count} words in {shown:.1f}s ({count / max(shown, 0.1):.1f}/s; {int(4 * shown)} words fit)')
print('bands: all readable (at most 4.5 words/s)' if not too_fast else 'bands TOO FAST, trim the words (hold longer only if trimming can\'t): ' + '; '.join(too_fast))

# The contact sheet: each step's start (+1 s), each "look" moment (+0.4 s) and each cut (+0.6 s), in video time.
# Small JPEG pages (small.py): every image an agent opens stays in the session's history.
moments = sorted({round(t + 1.0, 1) for t, _ in out_timeline['steps']} | {round(look[0] + 0.4, 1) for look in out_timeline['looks']} | {round(t + 0.6, 1) for t, _ in out_timeline['cuts']})
moments = [m for m in moments if 0 <= m < duration - 0.1]
(work / 'out/contact.png').unlink(missing_ok=True)
pages = write_sheets(frames_at(mp4, moments), work / 'out', 'contact')
print(f'contact sheet: {len(pages)} pages, {work / "out"}/contact-01.jpg ... {pages[-1].name if pages else ""} ({len(moments)} frames)')
