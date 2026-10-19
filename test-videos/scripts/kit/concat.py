"""Joins composed how-to videos (for example one part per window) into one video.

    $PY concat.py <work dir of the result> <work dir of part 1> <work dir of part 2> [...]

Each part is a work folder already composed (out/<name>.mp4 and .srt). The result's name comes from the first
argument's captions.json ("name"); writes <result>/out/<name>.mp4, .srt and .webm. Number the steps across the parts
in captions.json ("STEP 4 OF 5" in part 2), so the joined video reads as one.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

import env  # noqa: E402

FFMPEG = env.ffmpeg()


def composed(work):
	captions = json.loads((work / 'captions.json').read_text())
	name = captions.get('name') or f'{work.name}-how-to-test'
	return work / 'out' / f'{name}.mp4', work / 'out' / f'{name}.srt', name


def stamp(s):
	ms = int(round(s * 1000))
	return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


result = Path(sys.argv[1]).resolve()
parts = [Path(p).resolve() for p in sys.argv[2:]]
if len(parts) < 2:
	raise SystemExit('Give at least two parts')
_, _, name = composed(result)
out = result / 'out'
out.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory() as tmp:
	listing = Path(tmp) / 'parts.txt'
	listing.write_text(''.join(f"file '{composed(p)[0]}'\n" for p in parts))
	mp4 = out / f'{name}.mp4'
	# Re-encoded, so parts with slightly different timing parameters join cleanly.
	subprocess.run([FFMPEG, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(mp4)], check=True)
cues, offset = [], 0.0
timeline = {'duration': 0.0, 'steps': [], 'looks': [], 'cuts': [], 'parts': []}
marked = []
for part in parts:
	video, srt, _ = composed(part)
	part_looks = part / 'out' / 'looks.json'
	if part_looks.exists():
		marked += [dict(look, t=round(look['t'] + offset, 2)) for look in json.loads(part_looks.read_text())]
	for block in srt.read_text().strip().split('\n\n'):
		lines = block.split('\n')
		a, b = (env.secs(x.strip()) for x in lines[1].split('-->'))
		cues.append((a + offset, b + offset, ' '.join(lines[2:])))
	part_timeline = part / 'out' / 'timeline-out.json'
	t = json.loads(part_timeline.read_text()) if part_timeline.exists() else {}
	timeline['steps'] += [[s + offset, i] for s, i in t.get('steps', [])]
	timeline['looks'] += [[look[0] + offset, *look[1:]] for look in t.get('looks', [])]
	timeline['cuts'] += [[c + offset, label] for c, label in t.get('cuts', [])]
	# A part that is itself joined lists its own parts: keep those, so check.py finds each step's band text.
	timeline['parts'] += [[o + offset, p] for o, p in t['parts']] if t.get('parts') else [[offset, str(part)]]
	offset += env.duration(video)
timeline['duration'] = offset
(out / 'timeline-out.json').write_text(json.dumps(timeline, indent=1))
(out / 'looks.json').write_text(json.dumps(marked, indent=1))
(out / f'{name}.srt').write_text(''.join(f'{i}\n{stamp(a)} --> {stamp(b)}\n{text}\n\n' for i, (a, b, text) in enumerate(cues, start=1)))
subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(mp4), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '96k', str(out / f'{name}.webm')], check=True)
print(f'{len(parts)} parts, {offset:.1f} s: {mp4}')
