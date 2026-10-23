// c2 · #342404: in the Agents window, a session row's first button is now New Nested Session (+), in place of Pin; one
// click starts a new chat inside the session. Setup makes a session (one short, harmless prompt) before the recording.
export async function setup({ openAgentsWindow, sleep }) {
	const agents = await openAgentsWindow();
	await agents.chat.send('Suggest a one-line tagline for a to-do list app. Reply with the tagline only.');
	await agents.chat.reply();
	await sleep(1500);
}

export default async function demo({ page, moveTo, click, mark, step, cue }) {
	const rows = page.locator('.monaco-list-row').filter({ visible: true });
	const row = rows.filter({ hasText: /tagline|to-do/i }).first();
	const plus = row.locator('a.action-label[aria-label^="New Nested Session"]');
	const tooltip = page.locator('.monaco-hover, .workbench-hover').filter({ visible: true }).filter({ hasText: 'New Nested Session' }).first();
	const nested = rows.filter({ hasText: 'New Session' }).first();
	mark('plus', plus);
	mark('tooltip', tooltip, { text: 'New Nested Session' });
	mark('nested', nested);
	await cue('a session\'s');
	await moveTo(row, 20);
	await cue('first button');
	await moveTo(plus, 15);
	await tooltip.waitFor({ state: 'visible', timeout: 10_000 });
	step('tooltip');
	// The tooltip stays up a moment after "One click" (its arrow needs a second), then the click.
	await cue('One click', { offset: 0.6 });
	await click(plus);
	await nested.waitFor({ state: 'visible', timeout: 15_000 });
	step('nested');
	await cue.end();
}
