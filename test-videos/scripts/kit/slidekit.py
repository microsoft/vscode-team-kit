"""Drawing, picture and voice helpers shared by cards.py (the verdict and end slides) and flags.py (the in-video flags)."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

import env

KIT = Path(__file__).resolve().parent
FFMPEG = env.ffmpeg()
W, H, BAND, FPS = 1920, 1330, 250, 30

FONTS = Path('/Applications/Microsoft Word.app/Contents/Resources/DFonts')
if not FONTS.exists():
	FONTS = Path('/Applications/Microsoft PowerPoint.app/Contents/Resources/DFonts')
SYMBOLS = '/System/Library/Fonts/SFNS.ttf'
MONO = '/System/Library/Fonts/Menlo.ttc'
SYMBOL_CHARS = set('\u2318\u21e7\u2325\u2303\u21b5\u238b')

BG, LINE, GRAY, TEXT, SOFT = (13, 17, 23), (48, 54, 61), (139, 148, 158), (240, 246, 252), (201, 209, 217)
BLUE, CODE_BG, CODE_FG, FRAME = (88, 166, 255), (33, 38, 45), (255, 166, 87), (110, 118, 129)
GREEN, RED, AMBER, AMBER_TEXT = (35, 134, 54), (218, 54, 51), (158, 106, 3), (210, 153, 34)


def font(name, size):
	path = FONTS / name
	return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.truetype(SYMBOLS, size)


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


def layout(text, f, size, mono_size, width):
	"""The text's lines, each a list of (token, is code, width), wrapped to `width` pixels."""
	mono = ImageFont.truetype(MONO, mono_size)
	space = f.getlength(' ')
	lines, line, used = [], [], 0
	for tok, code in tokens(text):
		tw = mono.getlength(tok) + 16 if code else text_width(tok, f, size)
		add = tw + (space if line else 0)
		if line and used + add > width:
			lines.append(line)
			line, used, add = [], 0, tw
		line.append((tok, code, tw))
		used += add
	if line:
		lines.append(line)
	return lines


def draw_rich(d, x, y, text, f, size, mono_size, color, max_x, line_h, max_lines):
	"""Draws `text` wrapped between x and max_x, with `code` spans as in the band; returns the y below it."""
	mono = ImageFont.truetype(MONO, mono_size)
	space = f.getlength(' ')
	lines = layout(text, f, size, mono_size, max_x - x)
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


def words(text):
	return len(text.replace('`', ' ').split())


def pill(d, x, y, text, color, size):
	"""A rounded tag; returns the y below it."""
	f = font('Aptos-Bold.ttf', size)
	tw = f.getlength(text)
	d.rounded_rectangle((x, y, x + tw + 2 * size * 0.7, y + size * 1.9), radius=int(size * 0.95), fill=color)
	d.text((x + size * 0.7, y + size * 0.42), text, font=f, fill=(255, 255, 255))
	return int(y + size * 1.9)


def dashed_rect(d, x, y, w, h, color=AMBER_TEXT, dash=14, gap=9, width=4):
	for x0, y0, x1, y1 in ((x, y, x + w, y), (x + w, y, x + w, y + h), (x, y + h, x + w, y + h), (x, y, x, y + h)):
		length = max(abs(x1 - x0), abs(y1 - y0))
		pos = 0
		while pos < length:
			end = min(pos + dash, length)
			if x0 == x1:
				d.line((x0, y0 + pos, x1, y0 + end), fill=color, width=width)
			else:
				d.line((x0 + pos, y0, x0 + end, y1), fill=color, width=width)
			pos = end + gap


def load_picture(spec, folder, main_mp4, work):
	"""A picture for a slide or a flag: a frame of the finished video ("from": "video", "t"), a screenshot ("from": "shot",
	"path"), or a "pair" of those; optionally cropped ("crop": [x, y, w, h]) and with dashed "marks"."""
	if 'pair' in spec:
		ims = [load_picture(s, folder, main_mp4, work) for s in spec['pair']]
		gap = 28
		if spec.get('direction', 'column') == 'row':
			height = max(i.height for i in ims)
			ims = [i.resize((round(i.width * height / i.height), height), Image.LANCZOS) for i in ims]
			out = Image.new('RGB', (sum(i.width for i in ims) + gap * (len(ims) - 1), height), BG)
			spots = [(sum(i.width + gap for i in ims[:k]), 0) for k in range(len(ims))]
		else:
			width = max(i.width for i in ims)
			ims = [i.resize((width, round(i.height * width / i.width)), Image.LANCZOS) for i in ims]
			out = Image.new('RGB', (width, sum(i.height for i in ims) + gap * (len(ims) - 1)), BG)
			spots = [(0, sum(i.height + gap for i in ims[:k])) for k in range(len(ims))]
		d = ImageDraw.Draw(out)
		f = font('Aptos-Bold.ttf', max(14, out.width // 72))
		for im, (x, y), s in zip(ims, spots, spec['pair']):
			out.paste(im, (x, y))
			d.rectangle((x, y, x + im.width - 1, y + im.height - 1), outline=FRAME, width=2)
			if s.get('label'):
				# Top right, where it rarely covers the start of a line of text.
				tw = f.getlength(s['label'])
				x1 = x + im.width - 10
				ly = y + im.height - 16 - f.size * 1.2 if s.get('label_at') == 'bottom' else y + 8
				d.rounded_rectangle((x1 - tw - 20, ly, x1, ly + 8 + f.size * 1.2), radius=8, fill=(18, 18, 18), outline=(255, 255, 255), width=2)
				d.text((x1 - tw - 10, ly + 3), s['label'], font=f, fill=(255, 255, 255))
		return out
	if spec['from'] == 'video':
		frame = Path(folder) / f'frame-{spec["t"]:.2f}.png'
		subprocess.run([FFMPEG, '-v', 'error', '-y', '-ss', f'{spec["t"]:.3f}', '-i', str(main_mp4), '-frames:v', '1', str(frame)], check=True)
		im = Image.open(frame).convert('RGB')
	else:
		path = Path(spec['path'])
		im = Image.open(path if path.is_absolute() else Path(work) / path).convert('RGB')
	ox, oy = 0, 0
	if spec.get('crop'):
		ox, oy, w, h = spec['crop']
		im = im.crop((ox, oy, ox + w, oy + h))
	for x, y, w, h in spec.get('marks', []):
		dashed_rect(ImageDraw.Draw(im), x - ox, y - oy, w, h)
	return im


def find_title(work, captions):
	"""The video's title: its captions.json "title", or the first part's (joined videos)."""
	if captions.get('title'):
		return captions['title']
	timeline = json.loads((Path(work) / 'out/timeline-out.json').read_text())
	for _, part in timeline.get('parts', []):
		title = json.loads((Path(part) / 'captions.json').read_text()).get('title')
		if title:
			return title
	return ''


def srt_time(s):
	ms = int(round(s * 1000))
	return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def srt_secs(ts):
	h, m, rest = ts.split(':')
	s, ms = rest.split(',')
	return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


def read_srt(path):
	cues = []
	for block in Path(path).read_text().strip().split('\n\n'):
		lines = block.split('\n')
		if len(lines) >= 3:
			a, b = (srt_secs(x.strip()) for x in lines[1].split('-->'))
			cues.append((a, b, ' '.join(lines[2:])))
	return cues


def write_srt(path, cues):
	cues = sorted(cues)
	Path(path).write_text(''.join(f'{i}\n{srt_time(a)} --> {srt_time(min(b, cues[i][0]) if i < len(cues) else b)}\n{text}\n\n' for i, (a, b, text) in enumerate(cues, start=1)))


def sentences(take):
	timed = take['words']
	written = take['text'].split()
	if len(written) == len(timed):
		timed = [dict(w, w=text) for w, text in zip(timed, written)]
	chunk = []
	for w in timed:
		chunk.append(w)
		if w['w'][-1] in '.!?:' or (w['w'][-1] == ',' and len(chunk) >= 7):
			yield chunk
			chunk = []
	if chunk:
		yield chunk


def silences(media, noise='-38dB', min_seconds=0.1):
	"""The silent stretches of a file's audio, as (start, end) pairs."""
	log = subprocess.run([FFMPEG, '-v', 'info', '-i', str(media), '-af', f'silencedetect=noise={noise}:d={min_seconds}', '-f', 'null', '-'], capture_output=True, text=True).stderr
	starts = [float(m) for m in re.findall(r'silence_start: (-?[\d.]+)', log)]
	ends = [float(m) for m in re.findall(r'silence_end: ([\d.]+)', log)]
	duration = env.duration(media)
	return [(max(0.0, s), ends[i] if i < len(ends) else duration) for i, s in enumerate(starts)]


def pause_ends(wav):
	"""Where the take's pauses end: speech after a pause starts there (the transcriber often times it a little early)."""
	return [e for _, e in silences(wav)]


def cues_for(take, wav, lead):
	"""Caption cues for a voiced line placed `lead` seconds into its part, each snapped to where its speech starts."""
	ends = pause_ends(wav)
	snap = lambda a: next((e for e in ends if a <= e <= a + 0.5), a)
	return [(lead + snap(c[0]['a']), lead + c[-1]['b'] + 0.25, ' '.join(w['w'] for w in c)) for c in sentences(take)]


def voice_take(folder, line_id, say):
	"""Voices `say` as voice/<line_id>.wav in `folder` (again only when the text changed); returns the take."""
	folder = Path(folder)
	(folder / 'voice').mkdir(parents=True, exist_ok=True)
	lines_path = folder / 'voice/lines.json'
	takes_path = folder / 'voice/takes.json'
	previous = json.loads(lines_path.read_text()) if lines_path.exists() else {}
	takes = json.loads(takes_path.read_text()) if takes_path.exists() else {}
	if previous.get(line_id) != say or line_id not in takes or not (folder / 'voice' / f'{line_id}.wav').exists():
		lines_path.write_text(json.dumps({line_id: say}, indent=1))
		subprocess.run([sys.executable, str(KIT / 'voice.py'), str(folder)], check=True)
		takes = json.loads(takes_path.read_text())
	take = takes[line_id]
	if take['heard'] != 'as written':
		print(f'  {line_id}: the voice was heard differently ({take["heard"]}): reword "say" if that matters, and run again')
	return take
