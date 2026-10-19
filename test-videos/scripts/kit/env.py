"""Where the kit's tools are: the plugin's cache folder (filled by scripts/setup.mjs), ffmpeg, media lengths, and the
folder finished videos are delivered to."""
import os
import shutil
import subprocess
from pathlib import Path

HOME = Path(os.environ.get('TEST_VIDEOS_HOME') or Path.home() / '.cache' / 'test-videos')
DELIVERY = Path(os.environ.get('TEST_VIDEOS_DELIVERY') or Path.home() / 'Downloads' / 'test-videos')


def ffmpeg() -> str:
	"""The ffmpeg setup.mjs links into the cache, else one on PATH."""
	for candidate in (os.environ.get('TEST_VIDEOS_FFMPEG'), str(HOME / 'bin' / 'ffmpeg'), shutil.which('ffmpeg')):
		if candidate and Path(candidate).exists():
			return candidate
	raise SystemExit('ffmpeg not found: run the plugin\'s scripts/setup.mjs')


def duration(media) -> float:
	"""A media file's length in seconds: ffprobe when there is one (the bundled ffmpeg has none), else PyAV."""
	probe = shutil.which('ffprobe')
	if probe:
		out = subprocess.run([probe, '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(media)], capture_output=True, text=True, check=True).stdout
		return float(out)
	import av
	with av.open(str(media)) as container:
		return container.duration / 1_000_000
