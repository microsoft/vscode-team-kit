"""Adds a verdict slide at the start of a finished how-to video and, when there are likely bugs, "worth a look" slides
at the end.

    $PY cards.py <work dir>

<work dir> holds the finished video (captions.json "name", out/<name>.mp4, .srt and timeline-out.json, as written by
compose.py or concat.py) and cards.json:

{
	"verdict": {
		"status": "verified",                            verified | issues (verified, some checks fail) | changed (verified with a
		                                                    changed setup) | partial (some steps not run) | failed (couldn't verify)
		"headline": "All 8 steps passed, each checked in the app.",
		"build": "Insiders 1.143.0 · e9f10b90b5 · Oct 16",
		"why": ["…"],                                      failed or changed: what went wrong and why, 1-3 short lines
		"not_covered": "a screen reader; Windows",        optional: what the video leaves out
		"image": {"from": "video", "t": 36.2, "crop": [x, y, w, h], "caption": "…"},
		"say": "Verified: every step passes on the October 16 Insiders."
	},
	"watch_footer": "…",                                  optional: replaces the end slides' "Not part of this test's pass/fail" line
	"watch_per_slide": 2,                                 optional: items per end slide (1-3; 3 for short items)
	"recap": {                                            optional: one text slide after the video listing what it
		"items": [{"flag": 1, "kind": "bug", "title": "…"}],      flagged (flags.py); "flag": N fills in its time in the final
		                                                           video ("at": "0:30" sets it by hand);
		"say": "…", "footer": "…"                                  use it instead of repeating flagged items in "watch",
	},                                                           which then keeps only findings the video doesn't show
	"watch": [                                             optional: likely bugs seen while testing, at most 2 per slide
		{"tag": "LIKELY BUG", "title": "…", "detail": "…", "image": {"from": "shot", "path": "/abs/x.png", "crop": [x, y, w, h], "caption": "…"}, "say": "…"}
	]
}

An image is a frame of the finished video ("from": "video", at "t" seconds, "crop" in its 1920x1330 pixels) or a
screenshot ("from": "shot", "path", "crop" in its pixels). {"pair": [image, image], "direction": "row" | "column"}
shows two (for example before and after), each with an optional "label" (top right; "label_at": "bottom" moves it);
the caption goes on the pair. "marks":
[[x, y, w, h], ...] draws dashed amber rectangles (in the same pixels as "crop"), for example where something was. Text can mark code with `backticks`. Each slide is voiced
(voice.py) and stays up for its voice plus a pause, or long enough to read at 4.5 words a second, whichever is longer.

Writes <work>/carded/out/<name>.mp4, .srt, .webm and timeline-out.json: the slides joined with the video. Check it
with `$PY check.py <work>/carded`, then deliver that mp4.
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

from slidekit import (AMBER, AMBER_TEXT, BG, BLUE, FFMPEG, FPS, FRAME, GRAY, GREEN, H, KIT, LINE, RED, SOFT, TEXT, W, cues_for,
	draw_rich, find_title, font, layout, load_picture, pill, voice_take, words, write_srt)
from small import save_small

WORK = Path(sys.argv[1]).resolve()
LEAD, TAIL, READ_RATE, MIN_SECONDS = 0.25, 0.85, 4.5, 2.5
STATUS = {
	'verified': ('VERIFIED', GREEN),
	'issues': ('VERIFIED, WITH ISSUES', AMBER),
	'changed': ('VERIFIED WITH A CHANGE', AMBER),
	'partial': ('PARTLY VERIFIED', AMBER),
	'failed': ("COULDN'T VERIFY", RED),
}
LEFT, RIGHT, PIC_X = 96, W - 96, 1060


captions = json.loads((WORK / 'captions.json').read_text())
NAME = captions['name']
MAIN_MP4 = WORK / 'out' / f'{NAME}.mp4'
cards = json.loads((WORK / 'cards.json').read_text())


TITLE = find_title(WORK, captions)
PER_SLIDE = min(3, max(1, int(cards.get('watch_per_slide', 2))))
FLAGGED = WORK / 'flagged'


def picture(spec, folder):
	return load_picture(spec, folder, MAIN_MP4, WORK)


def place_picture(im, pic, caption, x0, x1, y0, y1):
	"""The picture, as large as fits (up to 2.5x), centred in the box, with a frame and its caption below."""
	d = ImageDraw.Draw(im)
	cf = font('Aptos.ttf', 26)
	caption_h = len(layout(caption, cf, 26, 21, x1 - x0)) * 36 + 14 if caption else 0
	box_w, box_h = x1 - x0, y1 - y0 - caption_h
	scale = min(box_w / pic.width, box_h / pic.height, 2.5)
	pw, ph = int(pic.width * scale), int(pic.height * scale)
	# Left-aligned in its box, so the caption below starts under it.
	px, py = x0, y0 + (box_h - ph) // 2
	im.paste(pic.resize((pw, ph), Image.LANCZOS), (px, py))
	d.rectangle((px - 2, py - 2, px + pw + 1, py + ph + 1), outline=FRAME, width=2)
	if caption:
		draw_rich(d, x0, py + ph + 14, caption, cf, 26, 21, GRAY, x1, 36, 3)


WIDE = 2.6


def below_height(pic, max_h):
	"""The height a wide picture takes when placed full width under the text."""
	return int(min(pic.height * min((RIGHT - LEFT) / pic.width, 2.5), max_h))


def caption_height(caption, width):
	return len(layout(caption, font('Aptos.ttf', 26), 26, 21, width)) * 36 + 14 if caption else 0


def header(d, label, color):
	f = font('Aptos-Bold.ttf', 24)
	d.text((LEFT, 46), label, font=f, fill=color)
	d.text((LEFT + f.getlength(label) + 20, 46), TITLE, font=font('Aptos.ttf', 24), fill=GRAY)
	d.line((LEFT, 96, RIGHT, 96), fill=LINE, width=2)


def verdict_slide(v, folder):
	"""The verdict: status, headline, build, why, not covered (left) and an optional picture (right)."""
	im = Image.new('RGB', (W, H), BG)
	header(ImageDraw.Draw(im), 'VERDICT', BLUE)
	pic = picture(v['image'], folder) if v.get('image') else None
	wide = pic is not None and pic.width / pic.height >= WIDE
	right = PIC_X - 60 if pic and not wide else RIGHT
	layer = Image.new('RGB', (W, H), BG)
	d = ImageDraw.Draw(layer)
	label, color = STATUS[v['status']]
	y = pill(d, LEFT, 0, label, color, 30) + 30
	y = draw_rich(d, LEFT, y, v['headline'], font('Aptos-SemiBold.ttf', 52), 52, 40, TEXT, right, 66, 3)
	read = [label, v['headline']]
	if v.get('build'):
		y = draw_rich(d, LEFT, y + 8, v['build'], font('Aptos.ttf', 30), 30, 24, GRAY, right, 42, 2)
		read.append(v['build'])
	for i, line in enumerate(v.get('why', [])):
		if not i:
			y += 34
			d.text((LEFT, y), 'WHY', font=font('Aptos-Bold.ttf', 22), fill=GRAY)
			y += 38
		d.text((LEFT, y), '\u2022', font=font('Aptos.ttf', 34), fill=SOFT)
		y = draw_rich(d, LEFT + 32, y, line, font('Aptos.ttf', 34), 34, 27, SOFT, right, 46, 4) + 8
		read.append(line)
	if v.get('not_covered'):
		y += 30
		label_font = font('Aptos-Bold.ttf', 22)
		d.text((LEFT, y + 8), 'NOT COVERED', font=label_font, fill=GRAY)
		y = draw_rich(d, LEFT + int(label_font.getlength('NOT COVERED')) + 20, y, v['not_covered'], font('Aptos.ttf', 30), 30, 24, SOFT, right, 42, 3)
		read.append(v['not_covered'])
	below = 0
	if wide:
		caption = v['image'].get('caption')
		room = H - 190 - y - 44 - caption_height(caption, RIGHT - LEFT)
		below = 44 + below_height(pic, max(300, min(640, room))) + caption_height(caption, RIGHT - LEFT)
	top = max(140, (H - y - below) // 2 + 30)
	if top + y + below > H - 50:
		raise SystemExit('The verdict slide is too full: shorten its text')
	im.paste(layer.crop((0, 0, W, y)), (0, top))
	if wide:
		place_picture(im, pic, v['image'].get('caption'), LEFT, RIGHT, top + y + 44, top + y + below)
	elif pic:
		place_picture(im, pic, v['image'].get('caption'), PIC_X, RIGHT, 140, H - 60)
	if pic:
		read.append(v['image'].get('caption', ''))
	return im, ' '.join(read)


RECAP_TAGS = {'fail': RED, 'change': AMBER, 'bug': AMBER, 'check': AMBER}


def flag_times(verdict_seconds):
	"""Each flag's start in the final video: the verdict slide, then the flagged video's "flagN" steps."""
	timeline = FLAGGED / 'out/timeline-out.json'
	if not timeline.exists():
		return {}
	steps = json.loads(timeline.read_text())['steps']
	return {int(name[4:]): verdict_seconds + start for start, name in steps if name.startswith('flag') and name[4:].isdigit()}


def with_times(recap, verdict_seconds):
	"""The recap with "at" filled in for items that name a flag ("flag": N)."""
	times = flag_times(verdict_seconds)
	items = []
	for item in recap['items']:
		item = dict(item)
		if 'flag' in item:
			if int(item['flag']) not in times:
				raise SystemExit(f'recap item "{item["title"]}" names flag {item["flag"]}, which the flagged video does not have')
			t = times[int(item['flag'])]
			item['at'] = f'{int(t // 60)}:{int(t % 60):02d}'
		items.append(item)
	return dict(recap, items=items)


def recap_slide(recap):
	"""One text slide listing what the video flagged, each with its time, tag and title: the end-of-video summary of
	problems already shown (and explained) where they happen, so the end doesn't repeat them with pictures."""
	im = Image.new('RGB', (W, H), BG)
	d = ImageDraw.Draw(im)
	header(d, recap.get('label', 'TO REPORT'), AMBER_TEXT)
	items = recap['items']
	row_h = min(150, (H - 300) // max(1, len(items)))
	layer = Image.new('RGB', (W, H), BG)
	ld = ImageDraw.Draw(layer)
	time_font = font('Aptos-SemiBold.ttf', 30)
	y = 0
	read = []
	for item in items:
		x = LEFT
		if item.get('at'):
			ld.text((x, y + 6), item['at'], font=time_font, fill=GRAY)
		x += 110
		tag = item.get('tag', {'fail': 'FAILS', 'change': 'CHANGED', 'bug': 'LIKELY BUG', 'check': 'CHECK THIS'}[item.get('kind', 'bug')])
		f = font('Aptos-Bold.ttf', 20)
		tw = f.getlength(tag)
		ld.rounded_rectangle((x, y + 4, x + tw + 28, y + 42), radius=19, fill=RECAP_TAGS.get(item.get('kind', 'bug'), AMBER))
		ld.text((x + 14, y + 12), tag, font=f, fill=(255, 255, 255))
		x += tw + 48
		bottom = draw_rich(ld, x, y, item['title'], font('Aptos-SemiBold.ttf', 34), 34, 27, TEXT, RIGHT, 46, 2)
		y = max(bottom, y + 46) + max(18, row_h - 46 - (bottom - y))
		read += [item.get('at', ''), tag, item['title']]
	if recap.get('footer'):
		y += 10
		y = draw_rich(ld, LEFT, y, recap['footer'], font('Aptos.ttf', 28), 28, 22, GRAY, RIGHT, 38, 3)
		read.append(recap['footer'])
	top = max(140, (H - y) // 2)
	im.paste(layer.crop((0, 0, W, y)), (0, top))
	return im, ' '.join(r for r in read if r)


def watch_slide(items, folder):
	"""Likely bugs, one or two per slide: tag, title and detail (left), and a picture (right)."""
	im = Image.new('RGB', (W, H), BG)
	d = ImageDraw.Draw(im)
	header(d, 'WORTH A LOOK', AMBER_TEXT)
	top, bottom = 120, H - 110
	row_h = (bottom - top) // len(items)
	read = []
	for i, item in enumerate(items):
		y0 = top + i * row_h
		if i:
			d.line((LEFT, y0, RIGHT, y0), fill=LINE, width=1)
		pic = picture(item['image'], folder) if item.get('image') else None
		wide = pic is not None and pic.width / pic.height >= WIDE
		right = PIC_X - 60 if pic and not wide else RIGHT
		layer = Image.new('RGB', (W, row_h), BG)
		ld = ImageDraw.Draw(layer)
		y = pill(ld, LEFT, 0, item.get('tag', 'LIKELY BUG'), RED if item.get('kind') == 'fail' else AMBER, 24) + 22
		y = draw_rich(ld, LEFT, y, item['title'], font('Aptos-SemiBold.ttf', 42), 42, 32, TEXT, right, 54, 3)
		if item.get('detail'):
			y = draw_rich(ld, LEFT, y + 10, item['detail'], font('Aptos.ttf', 30), 30, 24, SOFT, right, 42, 5)
		below = 0
		if wide:
			caption = item['image'].get('caption')
			below = 36 + below_height(pic, max(80, min(420, row_h - y - 120))) + caption_height(caption, RIGHT - LEFT)
		if y + below > row_h - 20:
			raise SystemExit(f'The "{item["title"]}" item is too long for its slide: shorten it')
		text_top = y0 + (row_h - y - below) // 2
		im.paste(layer.crop((0, 0, W, y)), (0, text_top))
		if wide:
			place_picture(im, pic, item['image'].get('caption'), LEFT, RIGHT, text_top + y + 36, text_top + y + below)
		elif pic:
			place_picture(im, pic, item['image'].get('caption'), PIC_X, RIGHT, y0 + 20, y0 + row_h - 16)
		read += [item['title'], item.get('detail', ''), item.get('image', {}).get('caption', '')]
	d.text((LEFT, H - 78), cards.get('watch_footer', "Not part of this test's pass/fail: report it if you see it too."), font=font('Aptos.ttf', 26), fill=GRAY)
	return im, ' '.join(r for r in read if r)


def build_part(folder, slide_id, image, say, text):
	"""A slide as a composed part (out/<name>.mp4, .srt, timeline-out.json, captions.json) that concat.py can join."""
	part_name = f'{NAME}-{slide_id}'
	(folder / 'out').mkdir(parents=True, exist_ok=True)
	take = voice_take(folder, slide_id, say)
	read_words = words(text)
	seconds = max(LEAD + take['seconds'] + TAIL, read_words / READ_RATE + 0.15, MIN_SECONDS)
	png = folder / 'slide.png'
	image.save(png)
	mp4 = folder / 'out' / f'{part_name}.mp4'
	wav = folder / 'voice' / f'{slide_id}.wav'
	subprocess.run([
		FFMPEG, '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-i', str(png), '-i', str(wav),
		'-filter_complex', f'[1:a]aresample=48000,adelay={int(LEAD * 1000)}:all=1,apad,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]',
		'-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', str(FPS),
		'-c:a', 'aac', '-b:a', '160k', '-ac', '1', '-t', f'{seconds:.3f}', '-movflags', '+faststart', str(mp4),
	], check=True)
	cues = cues_for(take, wav, LEAD)
	write_srt(folder / 'out' / f'{part_name}.srt', [(a, min(b, seconds), t) for a, b, t in cues])
	(folder / 'out/timeline-out.json').write_text(json.dumps({'duration': seconds, 'steps': [[0.0, slide_id]], 'looks': [], 'cuts': []}, indent=1))
	# What's on the slide, for check.py's reading-speed check.
	(folder / 'captions.json').write_text(json.dumps({'name': part_name, 'title': TITLE, 'steps': {slide_id: {'label': slide_id.upper(), 'do': text}}}, indent=1))
	print(f'  {slide_id}: {seconds:.1f} s ({take["seconds"]:.1f} s of voice, {read_words} words to read)')
	return folder, seconds


def main_part():
	"""The video to put the slides around: the flagged one (flags.py) when the item has flags."""
	if not (WORK / 'flags.json').exists():
		return WORK
	flagged_mp4 = FLAGGED / 'out' / f'{NAME}.mp4'
	if not flagged_mp4.exists() or flagged_mp4.stat().st_mtime < (WORK / 'flags.json').stat().st_mtime:
		raise SystemExit(f'flags.json is newer than the flagged video: run {sys.executable} {KIT / "flags.py"} {WORK} first')
	return FLAGGED


def main():
	carded = WORK / 'carded'
	slides = carded / 'slides'
	slides.mkdir(parents=True, exist_ok=True)
	if '--preview' in sys.argv:
		# Only the slide pictures, small, to look at before voicing and joining.
		for old in slides.glob('preview-*'):
			old.unlink()
		image, text = verdict_slide(cards['verdict'], slides)
		save_small(image, slides / 'preview-verdict.jpg')
		if cards.get('recap'):
			last = slides / 'verdict/out/timeline-out.json'
			estimate = json.loads(last.read_text())['duration'] if last.exists() else 0.0
			save_small(recap_slide(with_times(cards['recap'], estimate))[0], slides / 'preview-recap.jpg')
		watch = cards.get('watch', [])
		for n, start in enumerate(range(0, len(watch), PER_SLIDE), start=1):
			save_small(watch_slide(watch[start:start + PER_SLIDE], slides)[0], slides / f'preview-watch{n}.jpg')
		print(f'previews: {sorted(str(p) for p in slides.glob("preview-*.jpg"))}; verdict: {len(text.split())} words to read')
		return
	(carded / 'captions.json').write_text(json.dumps({'name': NAME, 'title': TITLE}, indent=1))
	verdict = cards['verdict']
	image, read = verdict_slide(verdict, slides)
	verdict_part, verdict_seconds = build_part(slides / 'verdict', 'verdict', image, verdict['say'], read)
	parts = [verdict_part, main_part()]
	if cards.get('recap'):
		image, read = recap_slide(with_times(cards['recap'], verdict_seconds))
		parts.append(build_part(slides / 'recap', 'recap', image, cards['recap']['say'], read)[0])
	watch = cards.get('watch', [])
	for n, start in enumerate(range(0, len(watch), PER_SLIDE), start=1):
		items = watch[start:start + PER_SLIDE]
		image, read = watch_slide(items, slides)
		parts.append(build_part(slides / f'watch{n}', f'watch{n}', image, ' '.join(item['say'] for item in items), read)[0])
	subprocess.run([sys.executable, str(KIT / 'concat.py'), str(carded), *map(str, parts)], check=True)
	print(f'carded: {carded / "out" / f"{NAME}.mp4"}; check it with: {sys.executable} {KIT / "check.py"} {carded}')


main()
