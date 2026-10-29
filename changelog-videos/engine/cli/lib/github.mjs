// GitHub REST/GraphQL client that works with or without the gh CLI.
// Token: PRS_GITHUB_TOKEN, GH_TOKEN or GITHUB_TOKEN from the environment, else `gh auth token`, else none (public data
// only, 60 requests/hour). GET responses are cached with their ETag: a repeated request answered 304 doesn't count
// against the rate limit, so re-running a step costs nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { CACHE, isOffline } from './common.mjs';

const HTTP_CACHE = path.join(CACHE, 'http');
let token;

export function githubToken() {
	if (token === undefined) {
		token = process.env.PRS_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null;
		if (!token) {
			try {
				token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || null;
			} catch {
				token = null;
			}
		}
	}
	return token;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function cacheFile(url, accept) {
	return path.join(HTTP_CACHE, `${crypto.createHash('sha1').update(`${accept}\n${url}`).digest('hex')}.json`);
}

/**
 * GET a GitHub URL. Returns { body (text), headers, blocked }. auth: false never sends a token (public hosts); a string
 * is the token to use (another account's, e.g. CHANGELOG_TOKEN).
 * When the Copilot agent's firewall blocks the host (or the network is down), a cached response is returned with
 * blocked: true: the setup steps prefetch the session's PRs outside the firewall (prs prefetch). In offline mode
 * (PRS_OFFLINE) it never touches the network: the cached response, or an error at once.
 */
export async function request(url, { accept = 'application/vnd.github+json', auth: useToken = true } = {}) {
	const cached = cacheFile(url, accept);
	if (isOffline()) {
		if (!fs.existsSync(cached)) {
			throw new Error(`Offline (PRS_OFFLINE): ${url} was not downloaded before this run`);
		}
		const saved = JSON.parse(fs.readFileSync(cached, 'utf8'));
		return { body: saved.body, headers: new Headers(saved.headers), offline: true };
	}
	const headers = { Accept: accept, 'User-Agent': 'changelog-videos', 'X-GitHub-Api-Version': '2022-11-28' };
	const auth = typeof useToken === 'string' ? useToken : useToken ? githubToken() : null;
	if (auth) {
		headers.Authorization = `Bearer ${auth}`;
	}
	let previous = null;
	if (fs.existsSync(cached)) {
		previous = JSON.parse(fs.readFileSync(cached, 'utf8'));
		if (previous.etag) {
			headers['If-None-Match'] = previous.etag;
		}
	}
	for (let attempt = 0; ; attempt++) {
		let res;
		try {
			res = await fetch(url, { headers });
		} catch (error) {
			if (attempt < 3) {
				await sleep(800 * 2 ** attempt);
				continue;
			}
			if (previous) {
				return { body: previous.body, headers: new Headers(previous.headers), blocked: true };
			}
			throw new Error(`Cannot reach ${new URL(url).host}: ${error.cause?.code ?? error.message}`);
		}
		if (res.status === 304 && previous) {
			return { body: previous.body, headers: new Headers(previous.headers) };
		}
		if (res.ok) {
			const body = await res.text();
			const keep = Object.fromEntries(['link', 'etag', 'content-type'].filter(h => res.headers.has(h)).map(h => [h, res.headers.get(h)]));
			if (res.headers.get('etag')) {
				fs.mkdirSync(HTTP_CACHE, { recursive: true });
				fs.writeFileSync(cached, JSON.stringify({ etag: res.headers.get('etag'), headers: keep, body }));
			}
			return { body, headers: res.headers };
		}
		if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
			const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
			throw new Error(`GitHub rate limit reached${auth ? '' : ' (no token: set PRS_GITHUB_TOKEN or sign in with gh)'}; it resets at ${reset.toISOString().slice(11, 16)} UTC`);
		}
		if (res.status >= 500 && attempt < 3) {
			await sleep(1000 * 2 ** attempt);
			continue;
		}
		const text = await res.text();
		if (/Blocked by DNS monitoring proxy/i.test(text)) {
			if (previous) {
				return { body: previous.body, headers: new Headers(previous.headers), blocked: true };
			}
			const host = new URL(url).host;
			throw new Error(`${host} is blocked by the agent's firewall (allow ${host === 'api.github.com' ? 'https://api.github.com/repos/' : host} in the firewall settings of the repository the agent runs in)`);
		}
		throw new Error(`GitHub ${res.status} for ${url.replace(/^https:\/\/api\.github\.com\//, '')}: ${text.slice(0, 200)}`);
	}
}

export async function api(apiPath, opts) {
	return JSON.parse((await request(`https://api.github.com/${apiPath.replace(/^\//, '')}`, opts)).body);
}

/** All pages of a list endpoint. */
export async function paginate(apiPath) {
	let url = `https://api.github.com/${apiPath.replace(/^\//, '')}${apiPath.includes('?') ? '&' : '?'}per_page=100`;
	const out = [];
	while (url) {
		const { body, headers } = await request(url);
		out.push(...JSON.parse(body));
		const next = (headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/);
		url = next ? next[1] : null;
	}
	return out;
}

/** GraphQL needs a token; returns null without one or when it fails (callers fall back to REST data). */
export async function graphql(query, variables) {
	if (isOffline()) {
		return null;
	}
	const auth = githubToken();
	if (!auth) {
		return null;
	}
	try {
		const res = await fetch('https://api.github.com/graphql', {
			method: 'POST',
			headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', 'User-Agent': 'changelog-videos' },
			body: JSON.stringify({ query, variables }),
		});
		const json = res.ok ? await res.json() : null;
		return json && !json.errors ? json.data : null;
	} catch {
		return null; // blocked (the agent firewall may only allow api.github.com/repos/) or offline
	}
}

/** The PR's diff: from patch-diff.githubusercontent.com (no API quota, allowed by the agent firewall), else the API. */
export async function prDiff(full, number) {
	try {
		return (await request(`https://patch-diff.githubusercontent.com/raw/${full}/pull/${number}.diff`, { accept: 'text/plain', auth: false })).body;
	} catch {
		return (await request(`https://api.github.com/repos/${full}/pulls/${number}`, { accept: 'application/vnd.github.v3.diff' })).body;
	}
}

/** A file's text at a commit: raw.githubusercontent.com (no API quota), else the contents API. */
export async function fileAt(full, ref, filePath) {
	const enc = filePath.split('/').map(encodeURIComponent).join('/');
	try {
		return (await request(`https://raw.githubusercontent.com/${full}/${ref}/${enc}`, { accept: '*/*' })).body;
	} catch (error) {
		if (/GitHub 404/.test(error.message)) {
			throw new Error(`${filePath} does not exist at ${ref.slice(0, 9)}`);
		}
		return (await request(`https://api.github.com/repos/${full}/contents/${enc}?ref=${ref}`, { accept: 'application/vnd.github.raw' })).body;
	}
}

/** The files in a zip archive (stored or deflated entries) as { name: Buffer }: enough for Actions artifacts. */
export function unzip(buffer) {
	const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (end < 0) {
		throw new Error('not a zip archive');
	}
	const files = {};
	let at = buffer.readUInt32LE(end + 16);
	for (let left = buffer.readUInt16LE(end + 10); left > 0; left--) {
		if (buffer.readUInt32LE(at) !== 0x02014b50) {
			throw new Error('damaged zip archive');
		}
		const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20), local = buffer.readUInt32LE(at + 42);
		const nameLength = buffer.readUInt16LE(at + 28);
		const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
		const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
		const data = buffer.subarray(start, start + size);
		if (method === 8) {
			files[name] = zlib.inflateRawSync(data);
		} else if (method === 0) {
			files[name] = Buffer.from(data);
		}
		at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
	}
	return files;
}

/** The files of a workflow run's artifact (as unzip returns them). token: one that can read the repository's Actions. */
export async function runArtifact(full, runId, name, { token = githubToken() } = {}) {
	const { artifacts } = await api(`repos/${full}/actions/runs/${runId}/artifacts?per_page=100`, { auth: token || false });
	const artifact = artifacts.find(a => a.name === name);
	if (!artifact || artifact.expired) {
		throw new Error(`Run ${runId} of ${full} has no ${artifact ? 'unexpired ' : ''}artifact "${name}"`);
	}
	const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'changelog-videos' };
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	// The API answers with a redirect to the archive; fetch drops the token when it follows it to another host.
	const res = await fetch(artifact.archive_download_url, { headers });
	if (!res.ok) {
		throw new Error(`GitHub ${res.status} downloading the "${name}" artifact of ${full} run ${runId}`);
	}
	return unzip(Buffer.from(await res.arrayBuffer()));
}
