#!/usr/bin/env node
// prs: the engine of the changelog-videos plugin. Run `prs help` (or node cli/prs.mjs help).
import fs from 'node:fs';
import path from 'node:path';
import { guardOffline, timed } from './lib/common.mjs';

const HELP = `prs: the daily VS Code changelog video

  prs doctor [--samples]             check and install what a video needs (Chrome, the voice, Whisper, ffmpeg)
  prs digest new [--date YYYY-MM-DD | --run id | --file report.md] [--build auto|insiders|main]
                                     the #changelog report's top picks into videos/changelog-<date>/, with each PR and
                                     the VS Code build that has them (the installed Insiders, the newest Insiders, or a
                                     build of main in a release week)
  prs voice [slug] [--provider auto|mai|kokoro]   the narration (storyboard.json) and its word timing
  prs demo check                     whether VS Code starts here (demos work), in about 20 s
  prs demo <id> [--slug s]           record demos/<id>.mjs in VS Code (signed in on macOS: a copy of your profile)
  prs demo inspect <id> [--slug s]   the text on screen at the end of a recorded demo (what marks and proofs can use)
  prs digest check [slug]            what is missing or wrong: strings against the PRs, arrows, timing, length
  prs digest scenes                  the drawn scenes, their params and parts, and the icons
  prs digest stills [slug] [--at t1,t2]   single frames and a contact sheet
  prs digest review [slug]           a sheet per chapter of the moments to check, and the checklist
  prs digest render [slug]           the video, delivered with its captions and a contact sheet
  prs build [--at time | --commit sha]   VS Code built from main (what prs digest new does in a release week)

PRS_OFFLINE=1: no network (an agent sandbox): prs digest new runs before, then everything works from what it downloaded.
CHANGELOG_VIDEOS_HOME moves the home (~/.cache/changelog-videos): settings, the voice, builds and the work.
`;

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const [k, v] = a.slice(2).split('=');
			if (v !== undefined) {
				args[k] = v;
			} else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
				args[k] = argv[++i];
			} else {
				args[k] = true;
			}
		} else {
			args._.push(a);
		}
	}
	return args;
}

async function main() {
	guardOffline();
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	switch (cmd) {
		case undefined:
		case 'help':
		case '--help':
			console.log(HELP);
			return;
		case 'doctor': {
			const { doctor } = await import('./lib/doctor.mjs');
			process.exitCode = (await doctor({ samples: !!args.samples })) ? 0 : 1;
			return;
		}
		case 'digest': {
			const { digestCommand } = await import('./lib/digest.mjs');
			process.exitCode = await digestCommand(args);
			return;
		}
		case 'voice': {
			const { digestSlug } = await import('./lib/digest.mjs');
			const slug = digestSlug(args._[0]);
			const { voice } = await import('./lib/voice.mjs');
			await timed(slug, 'voice', () => voice(slug, { provider: args.provider, force: !!args.force, redo: typeof args.redo === 'string' ? args.redo : undefined }));
			return;
		}
		case 'demo': {
			const { demo, demoCheck } = await import('./lib/demo.mjs');
			const { digestSlug } = await import('./lib/digest.mjs');
			if (args._[0] === 'check') {
				process.exitCode = await demoCheck() ? 0 : 1;
				return;
			}
			if (args._[0] === 'inspect') {
				const { buildDir } = await import('./lib/common.mjs');
				const id = args._[1];
				const file = id && path.join(buildDir(digestSlug(args.slug)), 'demos', id, 'screen.txt');
				if (!file || !fs.existsSync(file)) {
					throw new Error('prs demo inspect <id> [--slug s]: the text on screen at the end of a recorded demo (run prs demo <id> first)');
				}
				console.log(fs.readFileSync(file, 'utf8'));
				return;
			}
			if (!args._[0]) {
				throw new Error('prs demo <id> [--slug changelog-<date>]: records videos/<slug>/demos/<id>.mjs');
			}
			await timed(null, 'demo', () => demo(digestSlug(args.slug), args._[0]));
			return;
		}
		case 'build': {
			const { buildFromSource } = await import('./lib/build.mjs');
			await buildFromSource({ commit: typeof args.commit === 'string' ? args.commit : null, at: typeof args.at === 'string' ? args.at : null });
			return;
		}
		default:
			console.error(`Unknown command "${cmd}".\n${HELP}`);
			process.exitCode = 2;
	}
}

main().catch(error => {
	console.error(`prs: ${error.message}`);
	if (process.env.PRS_DEBUG) {
		console.error(error.stack);
	}
	process.exitCode = 1;
});
