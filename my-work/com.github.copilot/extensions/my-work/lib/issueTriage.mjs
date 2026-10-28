import { execFile } from 'node:child_process';

const WORKFLOW_REPOSITORY = 'microsoft/vscode-engineering';
const WORKFLOW_FILE = 'issue-triage.lock.yml';
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]{1,100}$/;

function invalid(message) {
	return Object.assign(new Error(message), { status: 400 });
}

export function canRunIssueTriage(issue) {
	return issue?.type === 'Issue'
		&& String(issue.state || '').toUpperCase() === 'OPEN'
		&& Array.isArray(issue.labels)
		&& issue.labels.includes('triage-needed');
}

export function normalizeIssueTriageTarget(target) {
	const owner = String(target?.owner || '');
	const repo = String(target?.repo || '');
	const number = Number(target?.number);
	if (!OWNER_RE.test(owner)) throw invalid('invalid issue owner');
	if (!REPOSITORY_RE.test(repo)) throw invalid('invalid issue repository');
	if (!Number.isSafeInteger(number) || number <= 0) throw invalid('invalid issue number');
	return { owner, repo, number };
}

export function issueTriageWorkflowArgs(target) {
	const { owner, repo, number } = normalizeIssueTriageTarget(target);
	return [
		'workflow', 'run', WORKFLOW_FILE,
		'--repo', WORKFLOW_REPOSITORY,
		'-f', `issue_number=${number}`,
		'-f', `repo_name=${repo}`,
		'-f', `repo_owner=${owner}`,
	];
}

export function dispatchIssueTriageWorkflow(target, runner = execFile) {
	const normalized = normalizeIssueTriageTarget(target);
	const args = issueTriageWorkflowArgs(normalized);
	return new Promise((resolve, reject) => {
		runner('gh', args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
			if (error) {
				const detail = String(stderr || error.message || '').trim();
				reject(new Error(`Issue Triage workflow dispatch failed${detail ? `: ${detail}` : ''}`));
				return;
			}
			resolve({
				accepted: true,
				target: `${normalized.owner}/${normalized.repo}#${normalized.number}`,
				workflow: `${WORKFLOW_REPOSITORY}/.github/workflows/${WORKFLOW_FILE}`,
			});
		});
	});
}
