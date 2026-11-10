// The VS Code changelog report: report.md, which microsoft/vscode-engineering's "Changelog PR Report" workflow makes
// every morning and the VS Code Bot posts to #changelog: up to 12 user-facing PRs, the top 5 first, then a ":::THREAD:::"
// line and the rest. Reading it needs a GitHub token that can read that repository (CHANGELOG_TOKEN, or an account gh is
// signed in to); anyone else passes the report as a file.
import { execFileSync } from 'node:child_process';
import { api, githubToken, runArtifact } from './github.mjs';

const SOURCE = { repo: 'microsoft/vscode-engineering', workflow: 'changelog-pr-report.lock.yml', artifact: 'changelog-pr-report', file: 'report.md' };
const TOP = 5;

/** The picks of a changelog report, in its order: rank, main message or thread, flag, PR, title, summary, author. */
export function parseReport(text) {
	const lines = String(text).split('\n');
	const heading = lines.find(l => /^#{1,6}\s/.test(l)) ?? '';
	const title = heading.replace(/^#+\s*/, '').replace(/\s+[—–-]\s+\[[^\]]*\]\([^)]*\)\s*$/, '').trim();
	const picks = [];
	let section = 'main';
	for (const line of lines) {
		if (line.trim() === ':::THREAD:::') {
			section = 'thread';
			continue;
		}
		const m = line.match(/^\s*(?<rank>\d+)\.\s+(?:(?<flag>[^\s\[]+)\s+)?\[#(?<number>\d+)\s+(?<title>.*?)\]\((?<url>https?:\/\/[^)\s]+)\)(?<rest>.*)$/u);
		if (!m || picks.some(p => p.number === Number(m.groups.number))) {
			continue;
		}
		const { rest, flag = null } = m.groups;
		picks.push({
			rank: Number(m.groups.rank), section, flag, warning: /⚠/u.test(flag ?? ''),
			repo: m.groups.url.match(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\//)?.[1] ?? 'microsoft/vscode',
			number: Number(m.groups.number), url: m.groups.url, title: m.groups.title.trim(),
			summary: rest.replace(/\s[—–-]\s+_@[^_]+_\s*$/u, '').replace(/^\s*[—–-]\s*/u, '').trim(),
			author: rest.match(/\s[—–-]\s+_@(?<login>[^_\s]+)_\s*$/u)?.groups.login ?? null,
		});
	}
	return { title, date: title.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null, picks };
}

/** The picks the video shows: the main message's (the top 5), not the thread's. */
export function topPicks(report) {
	return report.picks.filter(p => p.section === 'main').slice(0, TOP);
}

/**
 * The tokens to try for the report: CHANGELOG_TOKEN, else the one prs uses, then those of the other github.com accounts
 * gh is signed in to (a work account often can't read the report, and a personal one can).
 */
export function reportTokens(env = process.env) {
	if (env.CHANGELOG_TOKEN) {
		return [env.CHANGELOG_TOKEN];
	}
	const tokens = [githubToken()];
	try {
		const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim();
		const accounts = JSON.parse(gh('auth', 'status', '--json', 'hosts', '--hostname', 'github.com')).hosts?.['github.com'] ?? [];
		for (const a of accounts.filter(a => a.state === 'success').sort((a, b) => b.active - a.active)) {
			try {
				tokens.push(gh('auth', 'token', '--hostname', 'github.com', '--user', a.login));
			} catch {
				// That account has no token to give.
			}
		}
	} catch {
		// No gh, or one too old to list its accounts.
	}
	return [...new Set(tokens.filter(Boolean))];
}

/**
 * report.md of a Changelog PR Report run: the given one, the one of a date (YYYY-MM-DD, UTC), or else the latest
 * scheduled run that succeeded. Read with the first of `tokens` that can read it.
 */
export async function downloadReport({ run = null, date = null, tokens = reportTokens(), read = readReport } = {}) {
	if (!tokens.length) {
		throw new Error(`Reading the changelog report needs a GitHub token that can read ${SOURCE.repo} (sign in with gh, or set CHANGELOG_TOKEN), or pass the report as a file: prs digest new --file report.md`);
	}
	for (const token of tokens) {
		try {
			return await read({ run, date, token });
		} catch (error) {
			if (!/GitHub 40[134] /.test(error.message)) {
				throw error;
			}
		}
	}
	throw new Error(`Cannot read the changelog report in ${SOURCE.repo} with ${tokens.length > 1 ? `any of the ${tokens.length} accounts gh is signed in to` : 'this token'}: pass the report as a file (prs digest new --file report.md), or sign in with gh as an account that can read it`);
}

async function readReport({ run, date, token }) {
	if (!run) {
		// Filter here, not in the query: GitHub sometimes answers the filtered query with a list that is weeks old.
		const { workflow_runs: runs } = await api(`repos/${SOURCE.repo}/actions/workflows/${SOURCE.workflow}/runs?per_page=50`, { auth: token });
		const ok = runs.filter(r => r.event === 'schedule' && r.conclusion === 'success' && r.head_branch === 'main' && (!date || r.created_at.startsWith(date)));
		const latest = ok.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
		if (!latest) {
			throw new Error(`No successful scheduled run of ${SOURCE.workflow} in ${SOURCE.repo}${date ? ` on ${date}` : ''} among the last ${runs.length}`);
		}
		run = latest.id;
	}
	const report = (await runArtifact(SOURCE.repo, run, SOURCE.artifact, { token }))[SOURCE.file];
	if (!report?.length) {
		throw new Error(`The ${SOURCE.artifact} artifact of run ${run} has no ${SOURCE.file}`);
	}
	return { text: report.toString('utf8'), run: Number(run), url: `https://github.com/${SOURCE.repo}/actions/runs/${run}` };
}
