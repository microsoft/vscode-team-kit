// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import { categories, selectEvents, sectionOutlines } from '/model.mjs';

const $ = id => document.getElementById(id);
let snapshot;
let revision = '';
let saveTimer;
let editing = false;
let saveVersion = 0;
let restoreFocus;
let matches = [];
let matchIndex = -1;
let findQuery = '';
let findTimer;
let findVersion = 0;
let pendingRender = false;
const findWorker = new Worker('/find-worker.mjs', { type: 'module' });
let view = { query: '', categories: [...categories], expanded: [], follow: false, announcements: true };
const headerObserver = new ResizeObserver(() => updateStickyHeaders());

function showError(error) {
	$('error').textContent = error instanceof Error ? error.message : String(error);
	$('error').hidden = false;
}

async function request(path, input) {
	const response = await fetch(path, input === undefined ? undefined : {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
	});
	if (!response.ok) {
		const result = await response.json();
		throw new Error(result.error ?? `Timeline request failed (${response.status}).`);
	}
	return response;
}

function save() {
	editing = true;
	const version = ++saveVersion;
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		void request('/api/view', view).then(() => {
			if (version === saveVersion) {
				editing = false;
			}
		}).catch(error => {
			if (version === saveVersion) {
				editing = false;
			}
			showError(error);
		});
	}, 150);
}

function highlighted(container, content) {
	const query = container.tagName === 'PRE' ? findQuery.toLocaleLowerCase() : '';
	const string = String(content ?? '');
	let index = 0;
	let match;
	while (query && (match = string.toLocaleLowerCase().indexOf(query, index)) !== -1) {
		container.append(document.createTextNode(string.slice(index, match)));
		const mark = document.createElement('mark');
		mark.textContent = string.slice(match, match + query.length);
		container.append(mark);
		index = match + query.length;
	}
	container.append(document.createTextNode(string.slice(index)));
}

function element(tag, className, content) {
	const node = document.createElement(tag);
	if (className) {
		node.className = className;
	}
	if (content !== undefined) {
		highlighted(node, content);
	}
	return node;
}

function showDialog(title, content) {
	restoreFocus = document.activeElement;
	$('dialog-title').textContent = title;
	$('dialog-content').textContent = content;
	$('dialog').showModal();
	$('dialog-content').focus();
}

function help() {
	showDialog('Session timeline help', [
		'Inspect the current session without sending a model request.',
		'Tab and Shift+Tab move between controls and event summaries.',
		'Enter or Space on an event summary expands its readable details and raw SDK records.',
		'Find highlights details without filtering the tree. Enter/Shift+Enter or Next/Previous navigate matches, including collapsed details.',
		'Category filters select matches; dimmed context labels identify retained ancestors.',
		'Parent and current event headers stack at the top while scrolling. Requests highlights the current user turn.',
		'Section outlines jump directly to readable details; raw tool JSON is available only inside expanded cards.',
		'Collapse all closes every expanded event, including events hidden by filters.',
		'Alt+F1 opens this help. Alt+F2 opens the filtered timeline as plain text.',
		'Escape closes this dialog and restores focus.',
		'Disable Announce updates to silence routine status announcements.',
		'Export events downloads SDK history, which may include sensitive prompts and tool output.',
	].join('\n\n'));
}

function visibleEvents() {
	return selectEvents(snapshot?.events ?? [], '', view.categories);
}

function updateStickyHeaders() {
	// Each header is constrained by its article, but stacks below all ancestor headers.
	const toolbarHeight = document.querySelector('.toolbar').getBoundingClientRect().height;
	document.documentElement.style.setProperty('--toolbar-height', `${toolbarHeight}px`);
	for (const article of $('events').querySelectorAll('article')) {
		const parent = article.parentElement.closest('article');
		const parentHeader = parent?.querySelector(':scope > .event-header');
		const top = parentHeader ? Number(parentHeader.dataset.stickyTop) + parentHeader.getBoundingClientRect().height : toolbarHeight;
		const header = article.querySelector(':scope > .event-header');
		header.dataset.stickyTop = String(top);
		header.style.top = `${top}px`;
		header.style.zIndex = String(100 - Number(article.dataset.depth));
		article.style.scrollMarginTop = `${top}px`;
		article.querySelector(':scope > .details').style.setProperty('--sticky-height', `${top + header.getBoundingClientRect().height}px`);
	}
	updateActiveRequest();
}

function updateActiveRequest() {
	const toolbarBottom = document.querySelector('.toolbar').getBoundingClientRect().bottom;
	const requests = [...$('events').querySelectorAll('article.event-user')].filter(article => !article.dataset.agent);
	const active = requests.find(article => {
		const rect = article.getBoundingClientRect();
		return rect.top <= toolbarBottom + 1 && rect.bottom > toolbarBottom;
	}) ?? requests.find(article => article.getBoundingClientRect().bottom > 0);
	for (const link of $('requests').querySelectorAll('a')) {
		if (link.dataset.requestId === active?.id) {
			link.setAttribute('aria-current', 'location');
		} else {
			link.removeAttribute('aria-current');
		}
	}
}

function updateFind() {
	if (matchIndex >= matches.length) {
		matchIndex = matches.length - 1;
	}
	$('find-count').textContent = matchIndex >= 0 ? `${matchIndex + 1} of ${matches.length}` : `${matches.length} matches`;
	$('find-next').disabled = $('find-prev').disabled = matches.length === 0;
}

function scheduleFind() {
	clearTimeout(findTimer);
	const id = ++findVersion;
	findWorker.postMessage({ type: 'cancel' });
	matches = [];
	matchIndex = -1;
	updateFind();
	$('events').querySelector('mark.current-match')?.classList.remove('current-match');
	if (!view.query) {
		findQuery = '';
		return;
	}
	$('find-count').textContent = 'Searching...';
	findTimer = setTimeout(() => {
		findWorker.postMessage({ type: 'find', query: view.query, id });
	}, 200);
}

findWorker.onmessage = ({ data }) => {
	if (data.id !== findVersion) {
		return;
	}
	findQuery = data.query;
	matches = data.matches;
	matchIndex = -1;
	updateFind();
};
findWorker.onerror = event => {
	clearTimeout(findTimer);
	$('find-count').textContent = 'Find failed';
	showError(new Error(`Background Find failed: ${event.message}`));
};

function moveMatch(direction) {
	if (!matches.length) {
		return;
	}
	matchIndex = matchIndex < 0 ? (direction > 0 ? 0 : matches.length - 1) : (matchIndex + direction + matches.length) % matches.length;
	const match = matches[matchIndex];
	const details = $(`details-${encodeURIComponent(match.id)}`);
	const toggle = details.parentElement.querySelector(':scope > .event-header .event-toggle');
	// Populate only the visited card rather than all matching records on every keystroke.
	details.replaceChildren();
	details.dispatchEvent(new Event('populate'));
	const mark = details.querySelectorAll('pre')[match.section]?.querySelectorAll('mark')[match.occurrence];
	if (!mark) {
		showError(new Error('The selected Find match is no longer available. Try finding again.'));
		return;
	}
	$('events').querySelector('mark.current-match')?.classList.remove('current-match');
	mark.classList.add('current-match');
	details.hidden = false;
	toggle.setAttribute('aria-expanded', 'true');
	if (!view.expanded.includes(toggle.dataset.eventId)) {
		view.expanded.push(toggle.dataset.eventId);
		save();
	}
	updateFind();
	updateStickyHeaders();
	const offset = parseFloat(details.style.getPropertyValue('--sticky-height')) || 0;
	window.scrollTo(0, window.scrollY + mark.getBoundingClientRect().top - offset - 4);
}

function textView() {
	showDialog('Timeline text view', visibleEvents().map(event => [
		`${event.category === 'user' ? `${event.timestamp} ` : ''}${['user', 'system', 'assistant'].includes(event.category) ? event.title : `${event.category.toUpperCase()}: ${event.title}`}`,
		event.summary, event.status,
		...event.sections.map(section => `${section.label}\n${section.content}`),
	].filter(Boolean).join('\n\n')).join('\n\n----------------\n\n') || 'No matching events.');
}

function render() {
	const events = visibleEvents();
	const focusedId = document.activeElement?.dataset.eventId;
	const scrollY = window.scrollY;
	const byId = new Map(events.map(event => [event.id, event]));
	const children = new Map();
	for (const event of events) {
		const parent = byId.has(event.parentEventId) ? event.parentEventId : undefined;
		const siblings = children.get(parent) ?? [];
		siblings.push(event);
		children.set(parent, siblings);
	}
	const fragment = document.createDocumentFragment();
	headerObserver.disconnect();
	function appendEvents(parentId, container, ancestors = new Set()) {
		for (const event of children.get(parentId) ?? []) {
			if (ancestors.has(event.id)) {
				continue;
			}
			const article = element('article');
			const eventKey = encodeURIComponent(event.id);
			article.id = `event-${eventKey}`;
			article.className = `event event-${event.category}`;
			article.dataset.depth = String(ancestors.size);
			article.dataset.agent = event.agentId ?? '';
			const expanded = view.expanded.includes(event.id);
			const header = element('header', 'event-header');
			const toggle = element('button', 'event-toggle');
			toggle.type = 'button';
			toggle.dataset.eventId = event.id;
			toggle.setAttribute('aria-expanded', String(expanded));
			toggle.setAttribute('aria-controls', `details-${eventKey}`);
			const titleLine = element('span', 'event-title-line');
			if (!['user', 'system', 'assistant'].includes(event.category)) {
				titleLine.append(element('span', 'category', event.category));
			}
			titleLine.append(element('span', 'title', event.title));
			if (event.category === 'user') {
				const time = element('time', 'event-time', new Date(event.timestamp).toLocaleString());
				time.dateTime = event.timestamp;
				titleLine.append(time);
			}
			toggle.append(titleLine);
			if (event.status) {
				titleLine.append(element('span', 'status-pill', event.status));
			}
			const metadata = [event.duration !== undefined ? `${event.duration.toLocaleString()} ms` : '', event.agentId ? `Agent ${event.agentId}` : ''].filter(Boolean).join(' · ');
			if (metadata) {
				titleLine.append(element('span', 'meta', metadata));
			}
			const preview = event.category === 'system' ? '' : event.category === 'assistant' ? event.sections.find(section => section.label === 'Response')?.content : event.summary;
			const matching = view.categories.includes(event.category);
			if (!matching) {
				toggle.append(element('span', 'context', 'Context for matching activity'));
			}
			header.append(toggle);
			if (preview) {
				const previewNode = element('div', 'summary', preview);
				previewNode.addEventListener('click', () => toggle.click());
				header.append(previewNode);
			}
			const outline = element('div', 'section-outline');
			outline.setAttribute('role', 'group');
			outline.setAttribute('aria-label', `${event.title} sections`);
			for (const item of sectionOutlines(event.sections)) {
				const link = element('a', '', item.text);
				link.href = `#section-${eventKey}-${item.index}`;
				link.addEventListener('click', click => {
					click.preventDefault();
					click.stopPropagation();
					if (!view.expanded.includes(event.id)) {
						view.expanded = [...view.expanded, event.id];
						save();
					}
					toggle.setAttribute('aria-expanded', 'true');
					content.hidden = false;
					populate();
					$('collapse').disabled = false;
					updateStickyHeaders();
					document.getElementById(`section-${eventKey}-${item.index}`)?.scrollIntoView({ block: 'start' });
				});
				outline.append(link);
			}
			const content = element('div', 'details');
			content.id = `details-${eventKey}`;
			content.hidden = !expanded;
			function populate() {
				if (content.childNodes.length) {
					return;
				}
				const navigation = element('div', 'controls');
				for (const [index, section] of [...event.sections, { label: 'Raw SDK records', content: JSON.stringify(event.rawRecords, null, 2) }].entries()) {
					const heading = element('h3', '', section.label);
					heading.id = `section-${eventKey}-${index}`;
					const link = element('a', '', section.label);
					link.href = `#${heading.id}`;
					navigation.append(link);
					content.append(heading, element('pre', index === event.sections.length ? 'raw-records' : '', section.content));
				}
				content.prepend(navigation);
			}
			content.addEventListener('populate', populate);
			if (expanded) {
				populate();
			}
			toggle.addEventListener('click', () => {
				const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
				if (!isExpanded) {
					populate();
				}
				const expanded = new Set(view.expanded);
				if (isExpanded) {
					expanded.delete(event.id);
				} else {
					expanded.add(event.id);
				}
				view.expanded = [...expanded];
				content.hidden = isExpanded;
				toggle.setAttribute('aria-expanded', String(!isExpanded));
				$('collapse').disabled = view.expanded.length === 0;
				updateFind();
				updateStickyHeaders();
				save();
			});
			if (outline.childNodes.length) {
				header.append(outline);
			}
			article.append(header, content);
			if (children.has(event.id)) {
				const nested = element('div', 'children');
				appendEvents(event.id, nested, new Set([...ancestors, event.id]));
				article.append(nested);
			}
			container.append(article);
			headerObserver.observe(header);
		}
	}
	appendEvents(undefined, fragment);
	if (!events.length) {
		fragment.append(element('p', '', 'No matching events. Adjust the search or category filters.'));
	}
	$('events').replaceChildren(fragment);
	const links = events.filter(event => event.category === 'user' && !event.agentId).map((event, index) => {
		const li = element('li');
		const link = element('a', '', `${index + 1}. ${event.summary || 'User request'}`);
		link.href = `#event-${encodeURIComponent(event.id)}`;
		link.title = event.summary;
		link.dataset.requestId = `event-${encodeURIComponent(event.id)}`;
		li.append(link);
		return li;
	});
	$('requests').replaceChildren(...links);
	$('status').textContent = `${snapshot.totalRecords.toLocaleString()} records · ${events.length.toLocaleString()} of ${snapshot.events.length.toLocaleString()} timeline events`;
	$('session').textContent = snapshot.sessionId;
	if (document.activeElement !== $('search') && $('search').value !== view.query) {
		$('search').value = view.query;
	}
	for (const checkbox of $('filters').querySelectorAll('input')) {
		checkbox.checked = view.categories.includes(checkbox.value);
	}
	$('follow').checked = view.follow;
	$('announcements').checked = view.announcements;
	$('collapse').disabled = view.expanded.length === 0;
	$('status').setAttribute('aria-live', view.announcements ? 'polite' : 'off');
	findWorker.postMessage({ type: 'index', events });
	scheduleFind();
	updateStickyHeaders();
	if (focusedId) {
		[...$('events').querySelectorAll('[data-event-id]')].find(node => node.dataset.eventId === focusedId)?.focus({ preventScroll: true });
	}
	if (view.follow && !focusedId) {
		window.scrollTo(0, document.body.scrollHeight);
	} else {
		window.scrollTo(0, scrollY);
	}
}

for (const category of categories) {
	const label = element('label');
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.value = category;
	checkbox.checked = true;
	label.append(checkbox, document.createTextNode(category[0].toUpperCase() + category.slice(1)));
	$('filters').append(label);
}
$('filters').addEventListener('change', () => {
	view.categories = [...$('filters').querySelectorAll('input:checked')].map(input => input.value);
	save();
	if (snapshot) {
		render();
	}
});
$('search').addEventListener('input', () => {
	view.query = $('search').value;
	matchIndex = -1;
	save();
	scheduleFind();
});
$('find-next').addEventListener('click', () => moveMatch(1));
$('find-prev').addEventListener('click', () => moveMatch(-1));
$('search').addEventListener('keydown', event => {
	if (event.key === 'Enter') {
		event.preventDefault();
		moveMatch(event.shiftKey ? -1 : 1);
	}
});
window.addEventListener('scroll', updateActiveRequest, { passive: true });
new ResizeObserver(() => updateStickyHeaders()).observe(document.querySelector('.toolbar'));
for (const id of ['follow', 'announcements']) {
	$(id).addEventListener('change', () => { view[id] = $(id).checked; save(); });
}
$('refresh').addEventListener('click', async () => {
	$('refresh').disabled = true;
	try {
		await request('/api/refresh', {});
		revision = '';
	} catch (error) {
		showError(error);
	} finally {
		$('refresh').disabled = false;
	}
});
$('collapse').addEventListener('click', () => {
	view.expanded = [];
	save();
	if (snapshot) {
		render();
	}
});
$('help').addEventListener('click', help);
$('text').addEventListener('click', textView);
$('dialog').addEventListener('close', () => {
	if (document.activeElement === document.body || $('dialog').contains(document.activeElement)) {
		restoreFocus?.focus();
	}
});
document.addEventListener('keydown', event => {
	if (event.altKey && ['F1', 'F2'].includes(event.key) && !$('dialog').open) {
		event.preventDefault();
		(event.key === 'F1' ? help : textView)();
	}
});
async function poll() {
	try {
		const response = await request(`/api/state?revision=${encodeURIComponent(revision)}`);
		const finding = ['search', 'find-next', 'find-prev'].includes(document.activeElement?.id);
		if (response.status !== 204) {
			snapshot = await response.json();
			revision = snapshot.revision;
			if (!editing) {
				const query = view.query;
				view = snapshot.view;
				if (finding) {
					view = { ...view, query };
				}
			}
			$('error').hidden = !snapshot.error;
			$('error').textContent = snapshot.error;
			if (finding) {
				pendingRender = true;
			} else {
				pendingRender = false;
				render();
			}
		} else if (pendingRender && !finding) {
			pendingRender = false;
			render();
		}
	} catch (error) {
		showError(error);
	} finally {
		setTimeout(() => void poll(), 1000);
	}
}
void poll();
