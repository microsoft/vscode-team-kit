// c5 · #342430: links that add a plugin marketplace or install a plugin now ask first. Both links are opened in the
// window (as if clicked on a web page), and both dialogs are cancelled: nothing is added or installed.
export default async function demo({ page, openUrl, click, mark, step, sleep, scheme, cue, hold }) {
	const dialogs = page.locator('.monaco-dialog-box');
	const dialog1 = dialogs.filter({ hasText: 'Add Plugin Marketplace' });
	const dialog2 = dialogs.filter({ hasText: 'Install Plugin' });
	mark('url', page.locator('.quick-input-widget input'));
	mark('dialog1', dialog1);
	mark('dialog1.primary', dialog1.getByRole('button', { name: 'Add Marketplace', exact: true }));
	mark('dialog2', dialog2);
	mark('dialog2.primary', dialog2.getByRole('button', { name: 'Add Marketplace and Install' }));
	mark('dialog2.warning', dialog2, { text: 'Plugins can run code on your machine.', tight: true });
	await openUrl(`${scheme}://chat-plugin/add-marketplace?ref=github/awesome-copilot`);
	await dialog1.waitFor({ state: 'visible', timeout: 15_000 });
	step('dialog 1');
	await cue('or install a plugin', { offset: 0.4 });
	await hold(2.2);   // however late the link opened it, the dialog stays long enough for its arrow
	await click(dialog1.getByRole('button', { name: 'Cancel' }));
	await dialog1.waitFor({ state: 'hidden', timeout: 10_000 });
	await openUrl(`${scheme}://chat-plugin/install?source=github/awesome-copilot&plugin=ai-ready`);
	await dialog2.waitFor({ state: 'visible', timeout: 15_000 });
	step('dialog 2');
	await cue.end();
	await click(dialog2.getByRole('button', { name: 'Cancel' }));
	await dialog2.waitFor({ state: 'hidden', timeout: 10_000 });
}
