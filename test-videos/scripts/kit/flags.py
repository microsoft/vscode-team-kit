"""Pauses a finished how-to video at each problem in flags.json (its fields are in the skill's slides.md): the frame
holds, everything but the problem dims, the problem is outlined, a callout explains it and the voice says it.

    $PY flags.py <work dir> [--preview]

Writes flagged/out/<name>.mp4, .srt and timeline-out.json, which cards.py then uses. --preview only writes
flagged/preview-<n>.jpg (each paused frame with its flag) and prints where each pause snapped.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from PIL import Image, ImageDraw  # noqa: E402

import env

from slidekit import (AMBER, AMBER_TEXT, BAND, FFMPEG, FPS, GRAY, H, RED, SOFT, TEXT, W, cues_for, dashed_rect,
	draw_rich, find_title, font, load_picture, pill, read_srt, silences, voice_take, words, write_srt)
from small import save_small

WORK = Path(sys.argv[1]).resolve()
PREVIEW = '--preview' in sys.argv
LEAD, TAIL, READ_RATE, MIN_SECONDS, MAX_SNAP, FADE = 0.3, 0.8, 4.5, 2.6, 1.5, 8
KINDS = {
	'fail': ('FAILS HERE', RED, (248, 81, 73)),
	'change': ('CHANGED FROM THE TEST', AMBER, AMBER_TEXT),
	'bug': ('LIKELY BUG', AMBER, AMBER_TEXT),
	'check': ('CHECK THIS', AMBER, AMBER_TEXT),
}
PANEL_W, PAD, MARGIN, GAP = 720, 28, 24, 34
PANEL_BG, DIM = (13, 17, 23), 0.55

captions = json.loads((WORK / 'captions.json').read_text())
NAME = captions['name']
TITLE = find_title(WORK, captions)
MAIN_MP4 = WORK / 'out' / f'{NAME}.mp4'
MAIN_SRT = WORK / 'out' / f'{NAME}.srt'
TIMELINE = json.loads((WORK / 'out/timeline-out.json').read_text())
FLAGS = json.loads((WORK / 'flags.json').read_text())['flags']
if not FLAGS:
	print('no flags: nothing to pause; cards.py uses out/ as it is')
	sys.exit(0)
OUT = WORK / 'flagged'


def frame_at(t, path):
	subprocess.run([FFMPEG, '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', str(MAIN_MP4), '-frames:v', '1', str(path)], check=True)
	return Image.open(path).convert('RGB')


def snap(t, gaps):
	"""The pause point: `t` if it falls in a gap in the voice, else the nearest point inside one (frame-aligned)."""
	best = None
	for start, end in gaps:
		a, b = start + 0.04, end - 0.04
		if b < a:
			continue
		point = min(max(t, a), b)
		if best is None or abs(point - t) < abs(best - t):
			best = point
	if best is None or abs(best - t) > MAX_SNAP:
		raise SystemExit(f'No gap in the voice within {MAX_SNAP} s of {t:.2f} s: pick another "t", or set "snap": false')
	return round(best * FPS) / FPS


def panel(flag, tag, tag_color):
	"""The callout: its tag, a PAUSED mark, the title, the detail and an optional picture, on a dark rounded panel."""
	inner = PANEL_W - 2 * PAD
	im = Image.new('RGB', (PANEL_W, 1400), PANEL_BG)
	d = ImageDraw.Draw(im)
	y = pill(d, PAD, PAD, tag, tag_color, 21)
	pause_font = font('Aptos-Bold.ttf', 17)
	px = PANEL_W - PAD - pause_font.getlength('PAUSED')
	d.text((px, PAD + 10), 'PAUSED', font=pause_font, fill=GRAY)
	d.rectangle((px - 26, PAD + 11, px - 21, PAD + 27), fill=GRAY)
	d.rectangle((px - 16, PAD + 11, px - 11, PAD + 27), fill=GRAY)
	y = draw_rich(d, PAD, y + 16, flag['title'], font('Aptos-SemiBold.ttf', 34), 34, 26, TEXT, PAD + inner, 44, 3)
	if flag.get('detail'):
		y = draw_rich(d, PAD, y + 8, flag['detail'], font('Aptos.ttf', 27), 27, 21, SOFT, PAD + inner, 36, 6)
	read = [flag['title'], flag.get('detail', '')]
	if flag.get('image'):
		pic = load_picture(flag['image'], OUT, MAIN_MP4, WORK)
		scale = min(inner / pic.width, 260 / pic.height, 2.0)
		pic = pic.resize((int(pic.width * scale), int(pic.height * scale)), Image.LANCZOS)
		y += 16
		im.paste(pic, (PAD, y))
		d.rectangle((PAD - 2, y - 2, PAD + pic.width + 1, y + pic.height + 1), outline=(110, 118, 129), width=2)
		y += pic.height
		caption = flag['image'].get('caption')
		if caption:
			y = draw_rich(d, PAD, y + 10, caption, font('Aptos.ttf', 22), 22, 18, GRAY, PAD + inner, 30, 2)
			read.append(caption)
	return im.crop((0, 0, PANEL_W, y + PAD)), ' '.join(r for r in read if r)


def overlaps(a, b):
	return max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))


def place(box, size, keep_clear, at):
	"""Where the callout goes: beside everything that must stay visible (the problem and its marks), inside the
	recording area; on the side that fits, or the one asked for."""
	x0 = min(k[0] for k in keep_clear)
	y0 = min(k[1] for k in keep_clear)
	x1 = max(k[2] for k in keep_clear)
	y1 = max(k[3] for k in keep_clear)
	w, h = size
	area = (MARGIN, BAND + MARGIN, W - MARGIN, H - MARGIN)
	clamp_x = lambda x: min(max(x, area[0]), area[2] - w)
	clamp_y = lambda y: min(max(y, area[1]), area[3] - h)
	cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
	spots = {
		'right': (x1 + GAP, clamp_y(cy - h / 2)),
		'left': (x0 - GAP - w, clamp_y(cy - h / 2)),
		'below': (clamp_x(cx - w / 2), y1 + GAP),
		'above': (clamp_x(cx - w / 2), y0 - GAP - h),
	}
	order = [at] + [n for n in ['right', 'left', 'below', 'above'] if n != at] if at else ['right', 'left', 'below', 'above']
	best = None
	for name in order:
		x, y = spots[name]
		rect = (clamp_x(x), clamp_y(y), clamp_x(x) + w, clamp_y(y) + h)
		fits = area[0] <= x and x + w <= area[2] and area[1] <= y and y + h <= area[3]
		cost = sum(overlaps(rect, k) for k in keep_clear) + (0 if fits else 1)
		if cost == 0:
			return rect[:2]
		if best is None or cost < best[0]:
			best = (cost, rect[:2])
	return best[1]


def flagged_frame(base, flag):
	"""The paused frame: dimmed except the problem, the problem outlined, any marks dashed, and the callout."""
	tag, tag_color, outline = KINDS[flag['kind']]
	tag = flag.get('tag', tag)
	x, y, w, h = flag['box']
	box = (x - 6, y - 6, x + w + 6, y + h + 6)
	out = base.copy()
	shade = Image.new('L', (W, H), 0)
	sd = ImageDraw.Draw(shade)
	sd.rectangle((0, BAND, W, H), fill=int(255 * DIM))
	sd.rounded_rectangle(box, radius=10, fill=0)
	out = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), out, shade)
	d = ImageDraw.Draw(out)
	for mx, my, mw, mh in flag.get('marks', []):
		dashed_rect(d, mx, my, mw, mh, color=(255, 255, 255), width=4)
	d.rounded_rectangle(box, radius=10, outline=outline, width=5)
	callout, read = panel(flag, tag, tag_color)
	keep_clear = [box] + [(mx - 12, my - 12, mx + mw + 12, my + mh + 12) for mx, my, mw, mh in flag.get('marks', [])]
	px, py = place(box, callout.size, keep_clear, flag.get('at'))
	px, py = int(px), int(py)
	mask = Image.new('L', callout.size, 0)
	ImageDraw.Draw(mask).rounded_rectangle((0, 0, callout.width - 1, callout.height - 1), radius=16, fill=255)
	out.paste(callout, (px, py), mask)
	d.rounded_rectangle((px, py, px + callout.width - 1, py + callout.height - 1), radius=16, outline=outline, width=2)
	return out, read


def encode_pause(folder, part_name, base, final, seconds, wav):
	"""The pause as a clip: the frame fades into its flag, holds while the voice plays, and fades back."""
	n = round(seconds * FPS)
	mp4 = folder / 'out' / f'{part_name}.mp4'
	encoder = subprocess.Popen([
		FFMPEG, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-', '-i', str(wav),
		'-filter_complex', f'[1:a]aresample=48000,adelay={int(LEAD * 1000)}:all=1,apad,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]',
		'-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p',
		'-c:a', 'aac', '-b:a', '160k', '-ac', '1', '-t', f'{n / FPS:.3f}', '-movflags', '+faststart', str(mp4),
	], stdin=subprocess.PIPE)
	held = final.tobytes()
	for i in range(n):
		alpha = min(1.0, (i + 1) / FADE, (n - i) / FADE)
		encoder.stdin.write(held if alpha >= 1 else Image.blend(base, final, alpha).tobytes())
	encoder.stdin.close()
	if encoder.wait() != 0:
		raise SystemExit(f'encoding the pause {part_name} failed')
	return mp4, n / FPS


def main():
	OUT.mkdir(parents=True, exist_ok=True)
	gaps = silences(MAIN_MP4, min_seconds=0.15)
	flags = []
	for i, flag in enumerate(FLAGS, start=1):
		cut = round(flag['t'] * FPS) / FPS if flag.get('snap') is False else snap(flag['t'], gaps)
		flags.append(dict(flag, n=i, cut=cut))
	flags.sort(key=lambda f: (f['cut'], f['n']))
	for flag in flags:
		folder = OUT / 'flags' / f'flag{flag["n"]}'
		(folder / 'out').mkdir(parents=True, exist_ok=True)
		base = frame_at(flag['cut'], folder / 'frame.png')
		final, read = flagged_frame(base, flag)
		final.save(folder / 'flag.png')
		flag.update(folder=folder, base=base, final=final, read=read)
		if PREVIEW:
			preview = save_small(final, OUT / f'preview-{flag["n"]}.jpg')[0]
			print(f'flag {flag["n"]}: t {flag["t"]:.2f} s -> pause at {flag["cut"]:.2f} s; {words(read)} words to read; {preview}')
	if PREVIEW:
		return

	# Each pause: voice, clip, captions, and the band text for check.py.
	for flag in flags:
		folder, flag_id = flag['folder'], f'flag{flag["n"]}'
		part_name = f'{NAME}-{flag_id}'
		take = voice_take(folder, flag_id, flag['say'])
		wav = folder / 'voice' / f'{flag_id}.wav'
		seconds = max(LEAD + take['seconds'] + TAIL, words(flag['read']) / READ_RATE + 0.3, MIN_SECONDS)
		mp4, seconds = encode_pause(folder, part_name, flag['base'], flag['final'], seconds, wav)
		flag.update(id=flag_id, mp4=mp4, seconds=seconds, cues=[(a, min(b, seconds), t) for a, b, t in cues_for(take, wav, LEAD)])
		tag = flag.get('tag', KINDS[flag['kind']][0])
		(folder / 'captions.json').write_text(json.dumps({'name': part_name, 'title': TITLE, 'steps': {flag_id: {'label': tag, 'do': flag['read']}}}, indent=1))
		print(f'  {flag_id}: pause at {flag["cut"]:.2f} s for {seconds:.1f} s ({take["seconds"]:.1f} s of voice, {words(flag["read"])} words to read)')
		if seconds > 8:
			print(f'  {flag_id}: a {seconds:.1f} s pause is long: shorten its "say" to one sentence, or its title and detail')

	# One pass: the video cut at each pause, with the pauses in between.
	cuts = sorted({f['cut'] for f in flags})
	bounds = [0.0] + cuts + [None]
	inputs, chains, labels = ['-i', str(MAIN_MP4)], [], []
	segments = len(bounds) - 1
	chains.append(f'[0:v]split={segments}' + ''.join(f'[vs{k}]' for k in range(segments)))
	chains.append(f'[0:a]asplit={segments}' + ''.join(f'[as{k}]' for k in range(segments)))
	for k in range(segments):
		a, b = bounds[k], bounds[k + 1]
		end = f':end={b:.6f}' if b is not None else ''
		chains.append(f'[vs{k}]trim=start={a:.6f}{end},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v{k}]')
		chains.append(f'[as{k}]atrim=start={a:.6f}{end},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=mono[a{k}]')
		labels.append(f'[v{k}][a{k}]')
		if b is not None:
			for flag in [f for f in flags if f['cut'] == b]:
				j = len(inputs) // 2
				inputs += ['-i', str(flag['mp4'])]
				chains.append(f'[{j}:v]setpts=PTS-STARTPTS,setsar=1,format=yuv420p[fv{j}]')
				chains.append(f'[{j}:a]asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=mono[fa{j}]')
				labels.append(f'[fv{j}][fa{j}]')
	chains.append(f'{"".join(labels)}concat=n={len(labels)}:v=1:a=1[v][a]')
	(OUT / 'out').mkdir(parents=True, exist_ok=True)
	mp4 = OUT / 'out' / f'{NAME}.mp4'
	subprocess.run([
		FFMPEG, '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(chains), '-map', '[v]', '-map', '[a]', '-r', str(FPS),
		'-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ac', '1',
		'-movflags', '+faststart', str(mp4),
	], check=True)

	# Times in the flagged video: everything at or after a pause moves by the pauses before it.
	def shift(t):
		return t + sum(f['seconds'] for f in flags if f['cut'] <= t + 1e-6)

	starts = {}
	for cut in cuts:
		offset = shift(cut) - sum(f['seconds'] for f in flags if f['cut'] == cut)
		for f in [f for f in flags if f['cut'] == cut]:
			starts[f['n']] = offset
			offset += f['seconds']

	def active(entries, t):
		"""The entry in effect at t (the last one starting at or before it)."""
		return max((e for e in entries if e[0] <= t + 1e-6), key=lambda e: e[0], default=entries[0])

	steps = [[shift(s), step] for s, step in TIMELINE['steps']]
	parts_in = TIMELINE.get('parts') or [[0.0, str(WORK)]]
	parts = [[shift(o), p] for o, p in parts_in]
	looks = [[shift(look[0]), *look[1:]] for look in TIMELINE.get('looks', [])]
	for flag in flags:
		start = starts[flag['n']]
		steps.append([start, flag['id']])
		parts.append([start, str(flag['folder'])])
		x, y, w, h = flag['box']
		looks.append([start + 0.01, x + w / 2, y + h / 2 - BAND])
	for cut in cuts:
		# After the last pause at a cut, the band and the part in effect before it come back.
		back = shift(cut)
		steps.append([back, active(TIMELINE['steps'], cut)[1]])
		parts.append([back, active(parts_in, cut)[1]])
	timeline = {
		'duration': shift(TIMELINE['duration']),
		'steps': sorted(steps, key=lambda e: e[0]),
		'looks': sorted(looks, key=lambda e: e[0]),
		'cuts': [[shift(c), label] for c, label in TIMELINE.get('cuts', [])],
		'parts': sorted(parts, key=lambda e: e[0]),
	}
	(OUT / 'out/timeline-out.json').write_text(json.dumps(timeline, indent=1))

	cues = []
	for a, b, text in read_srt(MAIN_SRT):
		# A caption runs until the next pause at the latest; the pause is in a gap in the voice.
		inside = [c for c in cuts if a < c <= b]
		moved = shift(a) - a
		cues.append((a + moved, (inside[0] if inside else b) + moved, text))
	for flag in flags:
		cues += [(starts[flag['n']] + a, starts[flag['n']] + b, text) for a, b, text in flag['cues']]
	write_srt(OUT / 'out' / f'{NAME}.srt', cues)
	(OUT / 'captions.json').write_text(json.dumps({'name': NAME, 'title': TITLE}, indent=1))
	duration = env.duration(mp4)
	print(f'flagged: {mp4} ({duration:.1f} s, {len(flags)} pauses; timeline says {timeline["duration"]:.1f} s)')


main()
