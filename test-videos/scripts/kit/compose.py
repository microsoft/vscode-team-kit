"""Composes a how-to-test video from a run of run.mjs.

Above the recorded window (none of its pixels hidden), a band shows the step, what to do (DO), what to look for
(LOOK FOR, or another tag such as USER SETTINGS), and, unless the step turns it off, the spot the pointer is looking
at zoomed in. Each step's narration starts when the step starts; the captions come from the narration's word timings.

    $PY compose.py <work dir>

Reads <work>/captions.json, voice/takes.json, voice/<step>.wav, run/timeline.json and run/recording.webm.
Writes <work>/out/<name>.mp4, .webm and .srt (name: captions.json "name", default <work folder name>-how-to-test), and
out/timeline-out.json (step, zoom and cut times in the video, for check.py). Stretches the scenario wrapped in
ctx.cut() are left out, with a badge showing the cut's label where each one was.

captions.json: {
	"name": "tpi-341821-how-to-test",
	"title": "How to test TPI #<n> · <title> · Insiders from <date> or newer",
	"steps": { "<step id>": { "label": "STEP 1 OF 3", "do": "...", "look": "...", "tag2": "LOOK FOR",
	                          "zoom": 2 (or 1.5, or false: no zoom; the text takes the whole band), "dy": 12 } }
}
In "do" and "look", `backticks` mark code (settings, file names); ⌘ ⇧ ⌥ ⌃ are drawn with the system font.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import env

WORK = Path(sys.argv[1]).resolve()
OUT = WORK / 'out'
FFMPEG = env.ffmpeg()
W, H, BAND, FPS = 1920, 1080, 250, 30

FONTS = Path('/Applications/Microsoft Word.app/Contents/Resources/DFonts')
if not FONTS.exists():
	FONTS = Path('/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts')
SYMBOLS = '/System/Library/Fonts/SFNS.ttf'
MONO = '/System/Library/Fonts/Menlo.ttc'
SYMBOL_CHARS = set('\u2318\u21e7\u2325\u2303\u21b5\u238b')

BG, LINE, GRAY, TEXT, SOFT = (13, 17, 23), (48, 54, 61), (139, 148, 158), (240, 246, 252), (201, 209, 217)
BLUE, CODE_BG, CODE_FG = (88, 166, 255), (33, 38, 45), (255, 166, 87)
DO_TAG, LOOK_TAG = (31, 111, 235), (35, 134, 54)
INSET = (1236, 46, 640, 170)


def font(name, size):
	path = FONTS / name
	return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.truetype(SYMBOLS, size)


timeline = json.loads((WORK / 'run/timeline.json').read_text())
video_start = timeline['videoStartedAt']
events = [dict(e, v=(e['t'] - video_start) / 1000) for e in timeline['events']]
takes = json.loads((WORK / 'voice/takes.json').read_text())
captions = json.loads((WORK / 'captions.json').read_text())
NAME = captions.get('name') or f"{WORK.name}-how-to-test"
steps = [e for e in events if e['kind'] == 'step' and e['id'] in captions['steps']]
if not steps:
	raise SystemExit('No captioned steps in run/timeline.json')
START = steps[0]['v']
END_RAW = next(e['v'] for e in events if e['kind'] == 'end') + 0.6 - START
SCALE = W / next(e for e in events if e['kind'] == 'viewport')['size'][0]

# Cuts: stretches the scenario cut out of the video (ctx.cut); a badge shows the label where each one was.
cuts = []
for e in events:
	if e['kind'] == 'cut-start':
		cuts.append([e['v'] - START, None, e.get('label', '')])
	elif e['kind'] == 'cut-end' and cuts and cuts[-1][1] is None:
		cuts[-1][1] = e['v'] - START
cuts = [(a, b, label) for a, b, label in cuts if b is not None and b > a >= 0]


def out_time(t):
	"""Seconds from the first step in the recording to seconds in the video, the cut stretches removed."""
	removed = 0.0
	for a, b, _ in cuts:
		if t >= b:
			removed += b - a
		elif t > a:
			return a - removed
	return t - removed


def in_cut(t):
	return any(a <= t < b for a, b, _ in cuts)


DURATION = out_time(END_RAW)
CUT_BADGES = [(out_time(a), label) for a, _, label in cuts]
step_times = [(out_time(e['v'] - START), e['id']) for e in steps]


def step_at(t):
	current = step_times[0][1]
	for st, step_id in step_times:
		if t >= st:
			current = step_id
	return current


def look_point(e):
	box = e['box']
	t = out_time(e['v'] - START)
	dy = e.get('dy', captions['steps'].get(step_at(t), {}).get('dy', 0))
	return (t, (box['x'] + box['width'] / 2) * SCALE, (box['y'] + box['height'] / 2) * SCALE + dy)


looks = sorted(look_point(e) for e in events if e['kind'] == 'look')
# When the layout changes, things move: the zoom goes to where the next thing looked at is, as soon as it changes.
for layout in [e for e in events if e['kind'] == 'layout']:
	moved = out_time(layout['v'] - START)
	following = next((look for look in looks if look[0] > moved), None)
	if following:
		looks.append((moved, following[1], following[2]))
looks.sort()
if not looks:
	looks = [(0, W / 2, H / 2)]


def draw_text(d, x, y, text, f, color, size):
	"""Text in Aptos, with the characters Aptos lacks (the modifier keys) in San Francisco."""
	symbols = ImageFont.truetype(SYMBOLS, size)
	run = ''
	for ch in text + '\0':
		if ch in SYMBOL_CHARS or ch == '\0':
			if run:
				d.text((x, y), run, font=f, fill=color)
				x += f.getlength(run)
				run = ''
			if ch in SYMBOL_CHARS:
				d.text((x, y + size * 0.06), ch, font=symbols, fill=color)
				x += symbols.getlength(ch)
		else:
			run += ch
	return x


def text_width(text, f, size):
	symbols = ImageFont.truetype(SYMBOLS, size)
	return sum(symbols.getlength(ch) if ch in SYMBOL_CHARS else f.getlength(ch) for ch in text)


def tokens(text):
	out = []
	for i, part in enumerate(text.split('`')):
		if i % 2:
			out.append((part, True))
		else:
			out += [(w, False) for w in part.split(' ') if w]
	return out


def draw_rich(d, x, y, text, f, size, mono_size, color, max_x, line_h, max_lines):
	mono = ImageFont.truetype(MONO, mono_size)
	space = f.getlength(' ')
	lines, line, width = [], [], 0
	for tok, code in tokens(text):
		tw = mono.getlength(tok) + 16 if code else text_width(tok, f, size)
		add = tw + (space if line else 0)
		if line and x + width + add > max_x:
			lines.append(line)
			line, width, add = [], 0, tw
		line.append((tok, code, tw))
		width += add
	if line:
		lines.append(line)
	if len(lines) > max_lines:
		raise SystemExit(f'Too long ({len(lines)} lines, at most {max_lines}): {text}')
	for line in lines:
		cx = x
		for tok, code, tw in line:
			if code:
				d.rounded_rectangle((cx, y + 3, cx + tw, y + line_h - 3), radius=7, fill=CODE_BG)
				d.text((cx + 8, y + (line_h - mono_size) / 2 - 2), tok, font=mono, fill=CODE_FG)
			else:
				draw_text(d, cx, y, tok, f, color, size)
			cx += tw + space
		y += line_h
	return y


def zoom_of(step_id):
	z = captions['steps'][step_id].get('zoom', 2)
	return float(z) if z else 0


def band(step_id):
	c = captions['steps'][step_id]
	im = Image.new('RGB', (W, BAND), BG)
	d = ImageDraw.Draw(im)
	d.line((0, BAND - 1, W, BAND - 1), fill=LINE, width=2)
	x = 48
	max_x = 1150 if zoom_of(step_id) else W - 48
	label = font('Aptos-Bold.ttf', 22)
	d.text((x, 20), c['label'], font=label, fill=BLUE)
	d.text((x + label.getlength(c['label']) + 18, 20), captions['title'], font=font('Aptos.ttf', 22), fill=GRAY)
	tag = font('Aptos-Bold.ttf', 17)

	def pill(y, text, color):
		tw = tag.getlength(text)
		d.rounded_rectangle((x, y + 7, x + tw + 22, y + 33), radius=13, fill=color)
		d.text((x + 11, y + 10), text, font=tag, fill=(255, 255, 255))
		return x + tw + 36

	y = draw_rich(d, pill(58, 'DO', DO_TAG), 58, c['do'], font('Aptos-SemiBold.ttf', 32), 32, 24, TEXT, max_x, 42, 3)
	if c.get('look'):
		y += 10
		y = draw_rich(d, pill(y, c.get('tag2', 'LOOK FOR'), LOOK_TAG), y + 1, c['look'], font('Aptos.ttf', 27), 27, 21, SOFT, max_x, 36, 3)
	if y > BAND - 10:
		raise SystemExit(f'The {step_id} captions do not fit the band: shorten them')
	if zoom_of(step_id):
		d.text((INSET[0], 18), f'ZOOMED IN {zoom_of(step_id):g}\u00d7', font=font('Aptos-Bold.ttf', 16), fill=GRAY)
	return im


BANDS = {step_id: band(step_id) for _, step_id in step_times}


def zoom_center(t):
	"""Where the zoom looks: at the thing the pointer is going to, panning there as it travels."""
	current = looks[0]
	for i, look in enumerate(looks):
		if t < look[0] - 0.4:
			break
		if t < look[0] and i:
			p = (t - (look[0] - 0.4)) / 0.4
			p = p * p * (3 - 2 * p)
			a = looks[i - 1]
			return a[1] + (look[1] - a[1]) * p, a[2] + (look[2] - a[2]) * p
		current = look
	return current[1], current[2]


def sentences(step_id):
	# The words as written (the transcriber's timing, the script's spelling) when the two line up one to one.
	words = takes[step_id]['words']
	written = takes[step_id]['text'].split()
	if len(written) == len(words):
		words = [dict(w, w=text) for w, text in zip(words, written)]
	chunk = []
	for w in words:
		chunk.append(w)
		if w['w'][-1] in '.!?:' or (w['w'][-1] == ',' and len(chunk) >= 7):
			yield chunk
			chunk = []
	if chunk:
		yield chunk


def srt_time(s):
	ms = int(round(s * 1000))
	return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main():
	OUT.mkdir(parents=True, exist_ok=True)
	webm = WORK / 'run/recording.webm'
	mp4 = OUT / f'{NAME}.mp4'
	audio_inputs, filters, labels = [], [], []
	for i, (st, step_id) in enumerate([s for s in step_times if s[1] in takes], start=1):
		audio_inputs += ['-i', str(WORK / 'voice' / f'{step_id}.wav')]
		filters.append(f'[{i}:a]aresample=48000,adelay={int((st + 0.05) * 1000)}:all=1[a{i}]')
		labels.append(f'[a{i}]')
	filters.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,apad,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]")
	decoder = subprocess.Popen([FFMPEG, '-v', 'error', '-ss', f'{START:.3f}', '-i', str(webm), '-t', f'{END_RAW:.3f}', '-vf', f'fps={FPS},scale={W}:{H}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
	encoder = subprocess.Popen([
		FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H + BAND}', '-r', str(FPS), '-i', '-',
		*audio_inputs, '-filter_complex', ';'.join(filters), '-map', '0:v', '-map', '[a]',
		'-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
		'-t', f'{DURATION:.3f}', '-movflags', '+faststart', str(mp4),
	], stdin=subprocess.PIPE)
	size = W * H * 3
	n = raw_n = 0
	badge_font = font('Aptos-Bold.ttf', 34)
	while True:
		raw = decoder.stdout.read(size)
		if len(raw) < size:
			break
		raw_n += 1
		if in_cut((raw_n - 1) / FPS):
			continue
		t = n / FPS
		frame = Image.frombytes('RGB', (W, H), raw)
		canvas = Image.new('RGB', (W, H + BAND))
		step_id = step_at(t)
		canvas.paste(BANDS[step_id], (0, 0))
		canvas.paste(frame, (0, BAND))
		z = zoom_of(step_id)
		if z:
			source = (int(INSET[2] / z), int(INSET[3] / z))
			cx, cy = zoom_center(t)
			left = int(min(max(cx - source[0] / 2, 0), W - source[0]))
			top = int(min(max(cy - source[1] / 2, 0), H - source[1]))
			canvas.paste(frame.crop((left, top, left + source[0], top + source[1])).resize(INSET[2:], Image.LANCZOS), INSET[:2])
			ImageDraw.Draw(canvas).rectangle((INSET[0] - 2, INSET[1] - 2, INSET[0] + INSET[2] + 1, INSET[1] + INSET[3] + 1), outline=(110, 118, 129), width=2)
		for at, label in CUT_BADGES:
			if at <= t < at + 1.4:
				text = f'\u00bb  {label}'
				tw = badge_font.getlength(text)
				x0, y0 = (W - tw) / 2 - 26, BAND + H - 170
				d = ImageDraw.Draw(canvas)
				d.rounded_rectangle((x0, y0, x0 + tw + 52, y0 + 64), radius=14, fill=(18, 18, 18), outline=(255, 255, 255), width=2)
				d.text((x0 + 26, y0 + 13), text, font=badge_font, fill=(255, 255, 255))
		encoder.stdin.write(canvas.tobytes())
		n += 1
	encoder.stdin.close()
	decoder.wait()
	if encoder.wait() != 0:
		raise SystemExit('encoding failed')
	cues = []
	for st, step_id in step_times:
		if step_id not in takes:
			continue
		for chunk in sentences(step_id):
			cues.append((st + 0.05 + chunk[0]['a'], st + 0.05 + chunk[-1]['b'] + 0.25, ' '.join(w['w'] for w in chunk)))
	(OUT / 'timeline-out.json').write_text(json.dumps({'duration': DURATION, 'steps': step_times, 'looks': looks, 'cuts': CUT_BADGES}, indent=1))
	(OUT / f'{NAME}.srt').write_text(''.join(f'{i}\n{srt_time(a)} --> {srt_time(min(b, cues[i][0] if i < len(cues) else b))}\n{text}\n\n' for i, (a, b, text) in enumerate(cues, start=1)))
	subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(mp4), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '96k', str(OUT / f'{NAME}.webm')], check=True)
	print(f'{n} frames, {DURATION:.1f} s: {mp4}')


main()
