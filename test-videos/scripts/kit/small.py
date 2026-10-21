"""Small JPEGs (at most 1280 px wide) to look at instead of full-size pictures, which stay in an agent's history.

    $PY small.py <image> [--crop x,y,w,h]
        One image -> <image>-small.jpg, or <image>-crop-x-y-w-h.jpg: a crop in the image's own pixels, in full detail.
        A tall image becomes pages of at most 1400 px: -small-1.jpg, -small-2.jpg, ...
    $PY small.py --video <mp4> <out dir> [--every <s>] [--from <s>] [--to <s>]
        Frames every <s> seconds (default 1), six to a page, each labeled with its time: <out dir>/sheet-01.jpg, ...
"""
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.dont_write_bytecode = True

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

import env

MAX_W = 1280
MAX_H = 1400
QUALITY = 72
THUMB = (638, 442)  # two to a 1280 px row, at the videos' 1920 x 1330 aspect
GAP = 4
PER_PAGE = 6


def save_small(image, path):
	"""Saves `image` as a JPEG at most MAX_W wide; a taller one than MAX_H becomes pages <stem>-1.jpg, ... Returns the paths."""
	image = image.convert('RGB')
	if image.width > MAX_W:
		image = image.resize((MAX_W, round(image.height * MAX_W / image.width)), Image.LANCZOS)
	path = Path(path)
	if image.height <= MAX_H:
		image.save(path, quality=QUALITY)
		return [path]
	pages = []
	for n, top in enumerate(range(0, image.height, MAX_H), start=1):
		page = path.with_name(f'{path.stem}-{n}.jpg')
		image.crop((0, top, image.width, min(top + MAX_H, image.height))).save(page, quality=QUALITY)
		pages.append(page)
	return pages


def _label_font():
	try:
		return ImageFont.load_default(size=20)
	except TypeError:
		return ImageFont.load_default()


def thumb(image, label):
	"""A sheet thumbnail of `image` with `label` (its time) in the bottom-left corner."""
	im = image.convert('RGB').resize(THUMB, Image.LANCZOS)
	d = ImageDraw.Draw(im)
	font = _label_font()
	x0, y0, x1, y1 = d.textbbox((0, 0), label, font=font)
	d.rectangle((0, THUMB[1] - (y1 - y0) - 10, x1 - x0 + 12, THUMB[1]), fill=(0, 0, 0))
	d.text((6 - x0, THUMB[1] - (y1 - y0) - 5 - y0), label, fill=(255, 255, 0), font=font)
	return im


def write_sheets(thumbs, folder, prefix):
	"""Tiles thumbnails six to a page into <folder>/<prefix>-01.jpg, ... (old pages removed). Returns the paths."""
	folder = Path(folder)
	folder.mkdir(parents=True, exist_ok=True)
	for old in folder.glob(f'{prefix}-*.jpg'):
		old.unlink()
	pages = []
	for n, first in enumerate(range(0, len(thumbs), PER_PAGE), start=1):
		chunk = thumbs[first:first + PER_PAGE]
		rows = (len(chunk) + 1) // 2
		page = Image.new('RGB', (2 * THUMB[0] + GAP, rows * THUMB[1] + (rows - 1) * GAP), (60, 60, 60))
		for i, im in enumerate(chunk):
			page.paste(im, ((i % 2) * (THUMB[0] + GAP), (i // 2) * (THUMB[1] + GAP)))
		path = folder / f'{prefix}-{n:02d}.jpg'
		page.save(path, quality=QUALITY)
		pages.append(path)
	return pages


def duration_of(mp4):
	return env.duration(mp4)


def frames_at(mp4, moments):
	"""The frames of `mp4` at each moment (seconds), as thumbnails labeled with their time."""
	with tempfile.TemporaryDirectory() as tmp:
		def grab(i_m):
			i, m = i_m
			frame = Path(tmp) / f'{i:05d}.png'
			subprocess.run([env.ffmpeg(), '-v', 'error', '-y', '-ss', f'{m:.3f}', '-i', str(mp4), '-frames:v', '1', str(frame)], check=True)
			return thumb(Image.open(frame), f'{m:g} s') if frame.exists() else None
		with ThreadPoolExecutor(max_workers=4) as pool:
			return [t for t in pool.map(grab, enumerate(moments)) if t is not None]


def video_sheets(mp4, folder, every=1.0, start=0.0, end=None):
	duration = duration_of(mp4)
	end = min(end if end is not None else duration, duration - 0.05)
	moments = []
	m = start
	while m <= end + 1e-6:
		moments.append(round(m, 2))
		m += every
	return write_sheets(frames_at(mp4, moments), folder, 'sheet')


def main(argv):
	def option(name, default):
		return float(argv[argv.index(name) + 1]) if name in argv else default
	if argv and argv[0] == '--video':
		mp4, folder = Path(argv[1]), Path(argv[2])
		pages = video_sheets(mp4, folder, option('--every', 1.0), option('--from', 0.0), option('--to', None))
		print(f'{len(pages)} sheets: {folder}/sheet-01.jpg ... {pages[-1].name}' if pages else 'no frames')
		return
	if not argv:
		raise SystemExit(__doc__)
	source = Path(argv[0])
	image = Image.open(source)
	if '--crop' in argv:
		x, y, w, h = (int(v) for v in argv[argv.index('--crop') + 1].split(','))
		image = image.crop((x, y, x + w, y + h))
		target = source.with_name(f'{source.stem}-crop-{x}-{y}-{w}-{h}.jpg')
	else:
		target = source.with_name(f'{source.stem}-small.jpg')
	for path in save_small(image, target):
		print(path)


if __name__ == '__main__':
	main(sys.argv[1:])
