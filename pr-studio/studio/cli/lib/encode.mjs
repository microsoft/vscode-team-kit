// Encode: content frames + caption states (overlaid) + progress line (drawn by ffmpeg) + narration -> H.264/AAC mp4.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildDir, findFfmpeg, readJson } from './common.mjs';

const run = promisify(execFile);

export async function encode(slug, { draft = false, out }) {
	const bdir = buildDir(slug);
	const frames = path.join(bdir, draft ? 'frames-draft' : 'frames');
	const caps = path.join(bdir, draft ? 'captions-draft' : 'captions');
	const info = readJson(path.join(frames, 'render.json'));
	const { fps, scale, count, total } = info;
	const W = Math.round(1920 * scale), BAR = Math.max(2, Math.round(6 * scale));
	const narration = path.join(bdir, 'narration.wav');
	const hasAudio = fs.existsSync(narration);
	const filter = [
		`[0:v][1:v]overlay=0:${Math.round(940 * scale)}:format=rgb[a]`,
		`[a]drawbox=x=0:y=${Math.round(1080 * scale) - BAR}:w=${W}:h=${BAR}:color=0xeef0f3@1:t=fill[b]`,
		`[b][2:v]overlay=x='-w+w*t/${total}':y=${Math.round(1080 * scale) - BAR}:format=rgb:shortest=1[c]`,
		'[c]scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709[v]',
	].join(';');
	const args = [
		'-hide_banner', '-v', 'error', '-y',
		'-framerate', String(fps), '-i', path.join(frames, '%05d.png'),
		'-framerate', String(fps), '-i', path.join(caps, '%05d.png'),
		'-f', 'lavfi', '-i', `color=c=0x0078d4:s=${W}x${BAR}:r=${fps}`,
		...(hasAudio ? ['-i', narration] : []),
		'-filter_complex', filter, '-map', '[v]',
		...(hasAudio ? ['-map', '3:a', '-af', 'apad', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000'] : []),
		'-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=tv',
		'-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
		// Slides are mostly still frames: on a small machine (the 2-core cloud runner) 'faster' looks the same and saves a minute.
		'-crf', draft ? '28' : '23', '-maxrate', '3500k', '-bufsize', '7000k', '-preset', draft ? 'veryfast' : os.cpus().length <= 4 ? 'faster' : 'medium',
		'-frames:v', String(count), ...(hasAudio ? ['-shortest'] : []), '-movflags', '+faststart', out,
	];
	await run(findFfmpeg(), args, { maxBuffer: 16 * 1024 * 1024 });
	return { out, hasAudio };
}

/**
 * The same video as WebM (VP9 and Opus) for VS Code's chat, whose window can't decode MP4. Best effort: an ffmpeg
 * without these encoders only costs the preview, and the mp4 is delivered as usual. Returns whether it was written.
 */
export async function encodeWebm(mp4, webm) {
	try {
		await run(findFfmpeg(), ['-v', 'error', '-y', '-i', mp4, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '30', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-c:a', 'libopus', '-b:a', '96k', webm], { maxBuffer: 16 * 1024 * 1024 });
		return true;
	} catch (e) {
		fs.rmSync(webm, { force: true });
		console.warn(`no WebM for VS Code's chat preview (${String(e.message).split('\n')[0]}); the mp4 is delivered as usual`);
		return false;
	}
}
