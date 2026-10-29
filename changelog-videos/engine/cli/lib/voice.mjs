// prs voice: narration audio + word timing for the storyboard (runs voice/voice.py in the engine's voice environment).
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { ROOT, buildDir, findFfmpeg, isOffline, loadConfig, readJson, storyboardVoiceHash, venvPython, videoDir, voiceEnv, writeJson } from './common.mjs';
import { estimateTimeline, resolvePlaceholders } from './timeline.mjs';

function writeScript(slug, storyboard, facts) {
	const dir = path.join(videoDir(slug), 'recording');
	fs.mkdirSync(dir, { recursive: true });
	const lines = ['# Script to record', '', 'Read each beat as written. Either one file per beat (recording/<beat id>.wav or .m4a),', 'or the whole script in one take as recording/full.wav (pause a second between beats).', ''];
	for (const b of storyboard.beats) {
		lines.push(`## ${b.id}`, '', resolvePlaceholders(b.say, facts), '');
	}
	fs.writeFileSync(path.join(dir, 'SCRIPT.md'), lines.join('\n'));
	return dir;
}

export async function voice(slug, { provider, force = false, redo } = {}) {
	const vdir = videoDir(slug), bdir = buildDir(slug);
	fs.mkdirSync(bdir, { recursive: true });
	const storyboard = readJson(path.join(vdir, 'storyboard.json'));
	const facts = readJson(path.join(vdir, 'pr.json')).facts;
	let chosen = provider ?? loadConfig().voice.provider;
	if (isOffline() && (!chosen || chosen === 'auto')) {
		chosen = 'kokoro'; // MAI-Voice-2 needs Azure
	}
	if (chosen === 'recording') {
		const dir = writeScript(slug, storyboard, facts);
		const has = fs.existsSync(dir) && fs.readdirSync(dir).some(f => /\.(wav|m4a|mp3|aiff?|flac|ogg)$/i.test(f));
		if (!has) {
			console.log(`Record the script in ${path.join(dir, 'SCRIPT.md')}, save the audio in ${dir}, then run prs voice --provider recording again.`);
			return null;
		}
	}
	if (chosen === 'silent') {
		// Captions only: provisional timing at reading pace, and a silent track so the encoder has audio.
		const timeline = estimateTimeline(storyboard, facts, { leadIn: 0.6, gap: 0.6, tail: 2.5 });
		timeline.voice = { provider: 'silent', name: 'none' };
		delete timeline.estimated;
		writeJson(path.join(bdir, 'timeline.json'), timeline);
		execFileSync(findFfmpeg(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', String(timeline.total), '-c:a', 'pcm_s16le', path.join(bdir, 'narration.wav')]);
		writeJson(path.join(bdir, 'voice.json'), { provider: 'silent', voice: 'none', storyboard: storyboardVoiceHash(storyboard), at: new Date().toISOString() });
		console.log(`silent narration: ${timeline.total.toFixed(1)} s of captions at reading pace`);
		return timeline;
	}
	const py = venvPython();
	const args = [path.join(ROOT, 'voice', 'voice.py'), 'synth', '--video', vdir, ...(chosen && chosen !== 'auto' ? ['--provider', chosen] : []), ...(force ? ['--force'] : []), ...(redo ? ['--redo', String(redo)] : [])];
	await new Promise((resolve, reject) => {
		const child = spawn(py, args, { stdio: ['ignore', 'inherit', 'inherit'], env: voiceEnv() });
		child.on('error', reject);
		child.on('close', code => (code === 0 ? resolve() : reject(new Error(`voice.py exited with ${code}`))));
	});
	const timeline = readJson(path.join(bdir, 'timeline.json'));
	writeJson(path.join(bdir, 'voice.json'), { provider: timeline.voice.provider, voice: timeline.voice.name, storyboard: storyboardVoiceHash(storyboard), at: new Date().toISOString() });
	const seconds = Math.max(0, ...timeline.beats.flatMap(b => b.words.map(w => w.b)));
	console.log(`narration ready: the last word ends at ${seconds.toFixed(1)} s (${timeline.voice.provider}); prs digest check says how long the video runs`);
	return timeline;
}
