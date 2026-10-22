// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

export const categories = ['system', 'user', 'assistant', 'tool', 'subagent'];

const completionTypes = new Map([
	['tool.execution_start', 'tool.execution_complete'],
	['external_tool.requested', 'external_tool.completed'],
	['subagent.started', 'subagent.completed'],
]);

export function readable(value) {
	return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
}

export function sectionOutlines(sections) {
	const groups = new Map();
	for (const [index, section] of sections.entries()) {
		let label = section.label;
		let count = 1;
		if (label === 'Advertised skills') {
			count = section.content.split('\n').filter(Boolean).length;
		} else if (label.startsWith('Tool guidance:')) {
			label = 'Tool guidance';
		} else if (label === 'Tool requests') {
			count = section.count ?? 0;
		} else if (label.startsWith('Instruction:')) {
			label = 'Instructions';
		}
		const group = groups.get(label) ?? { label, count: 0, index };
		group.count += count;
		groups.set(label, group);
	}
	return [...groups.values()].map(group => {
		if (['Content', 'Response'].includes(group.label)) {
			const bytes = new TextEncoder().encode(sections[group.index].content).byteLength;
			const size = bytes < 1000 ? `${bytes}B` : `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1000)}kB`;
			return { ...group, text: `${group.label} ${size}` };
		}
		if (group.label === 'Model') {
			return { ...group, text: sections[group.index].content };
		}
		const showCount = ['Advertised skills', 'Tool guidance', 'Instructions', 'Tool requests'].includes(group.label) || group.count > 1;
		return { ...group, text: showCount ? `${group.label} ${group.count}` : group.label };
	});
}

function text(value) {
	return typeof value === 'string' ? value : '';
}

function key(record, id) {
	return JSON.stringify([record.agentId ?? '', id]);
}

function correlationId(record) {
	return record.type.startsWith('external_tool.') ? record.data.requestId : record.data.toolCallId;
}

function section(label, value) {
	return { label, content: readable(value) };
}

function toolSummary(value) {
	const compact = item => item.slice(0, 300);
	const args = typeof value === 'string' ? (() => {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	})() : value;
	if (!args || typeof args !== 'object' || Array.isArray(args)) {
		return typeof args === 'string' ? compact(args) : '';
	}
	const preferred = ['description', 'path', 'filePath', 'file', 'uri', 'url', 'query', 'command', 'pattern', 'symbol'];
	const entries = preferred
		.map(name => [name, args[name]])
		.filter(([, item]) => typeof item === 'string' && item.trim())
		.map(([name, item]) => [name, compact(item)])
		.slice(0, 4);
	if (!entries.length) {
		return '';
	}
	return entries.map(([name, item]) => `${name}: ${item}`).join(' · ');
}

function promptSections(content) {
	const sections = [];
	const skills = [...content.matchAll(/<skill>\s*[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/skill>/gi)]
		.map(match => match[1].trim()).filter(Boolean);
	if (skills.length) {
		sections.push(section('Advertised skills', [...new Set(skills)].join('\n')));
	}
	const toolsBlock = /<tools(?:\s[^>]*)?>([\s\S]*?)<\/tools>/i.exec(content);
	if (toolsBlock) {
		for (const tool of ['bash', 'view', 'skill', 'ask_user', 'sql', 'rg', 'task']) {
			const guidance = new RegExp(`<${tool}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tool}>`, 'i').exec(toolsBlock[1]);
			if (guidance) {
				sections.push(section(`Tool guidance: ${tool}`, guidance[1].trim()));
			}
		}
	}
	const blocks = [];
	for (const match of content.matchAll(/<([A-Za-z_][A-Za-z0-9_.-]*)(?:\s[^>]*)?>/g)) {
		const name = match[1];
		const end = content.indexOf(`</${name}>`, match.index + match[0].length);
		if (end >= 0) {
			blocks.push({ name, start: match.index, end: end + name.length + 3, content: content.slice(match.index + match[0].length, end) });
		}
	}
	for (const block of blocks.filter(block => block.name !== 'tools' && block.name !== 'available_skills'
		&& !blocks.some(parent => parent.start < block.start && parent.end >= block.end))) {
		sections.push(section(`Instruction: ${block.name.replace(/[_.-]+/g, ' ')}`, block.content.trim()));
	}
	return sections;
}

export function validateEvent(event) {
	if (!event || typeof event !== 'object' || typeof event.id !== 'string'
		|| typeof event.type !== 'string' || typeof event.timestamp !== 'string'
		|| (event.parentId !== null && typeof event.parentId !== 'string')
		|| (event.agentId !== undefined && typeof event.agentId !== 'string')
		|| !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) {
		throw new Error('The SDK returned an invalid session event envelope.');
	}
	return event;
}

/** Build semantic ownership without mistaking the chronological parentId chain for a tree. */
export function createTimelineModel(records) {
	const completions = new Map();
	const starts = new Map();
	const owners = new Map();
	for (const record of records) {
		validateEvent(record);
		const { data, type } = record;
		if (type === 'assistant.message') {
			for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) {
				if (request && typeof request === 'object') {
					owners.set(key(record, request.toolCallId ?? request.id), record.id);
				}
			}
		}
		if (type === 'tool.execution_start') {
			starts.set(key(record, data.toolCallId), record.id);
		}
		if ([...completionTypes.values(), 'subagent.failed'].includes(type)) {
			completions.set(`${type}:${key(record, correlationId(record))}`, record);
		}
	}
	const paired = new Set();
	const state = new Map();
	const events = [];
	for (const record of records) {
		if (paired.has(record.id)) {
			continue;
		}
		const { type, data } = record;
		const agent = record.agentId ?? '';
		const current = state.get(agent) ?? {};
		state.set(agent, current);
		// Child assistant/tool records identify the spawning call, whose owner is in the parent agent.
		const parentCall = data.parentToolCallId;
		const parentTool = parentCall
			? starts.get(key(record, parentCall)) ?? starts.get(key({ agentId: undefined }, parentCall))
				?? [...starts.entries()].find(([id]) => JSON.parse(id)[1] === parentCall)?.[1]
			: undefined;
		const event = {
			id: record.id, category: '', title: '', summary: '', timestamp: record.timestamp,
			agentId: record.agentId, parentEventId: undefined, sections: [], rawRecords: [record],
			status: '', duration: undefined,
		};
		if (type === 'user.message') {
			event.category = 'user';
			event.title = 'User';
			event.summary = text(data.content);
			event.parentEventId = parentTool;
			event.sections.push(section('User request', data.content));
			if (data.transformedContent && data.transformedContent !== data.content) {
				event.sections.push(section('Transformed prompt', data.transformedContent));
			}
			if (data.attachments?.length) {
				event.sections.push(section('Attachments', data.attachments));
			}
			current.user = record.id;
			current.system = undefined;
			current.assistant = undefined;
		} else if (type === 'system.message') {
			event.category = 'system';
			event.title = 'System';
			event.summary = text(data.content);
			event.parentEventId = current.user ?? parentTool;
			event.sections = [...promptSections(text(data.content)), section('Content', data.content)];
			current.system = record.id;
		} else if (type === 'assistant.message') {
			event.category = 'assistant';
			event.title = 'Assistant';
			event.summary = text(data.content);
			event.parentEventId = parentTool ?? current.system ?? current.user;
			for (const [label, value] of [['Response', data.content], ['Reasoning', data.reasoningText], ['Tool requests', data.toolRequests], ['Model', data.model]]) {
				if (value) {
					event.sections.push({ ...section(label, value), ...(label === 'Tool requests' && Array.isArray(value) ? { count: value.length } : {}) });
				}
			}
			current.assistant = record.id;
		} else if (completionTypes.has(type)) {
			const id = correlationId(record);
			const completionKey = `${completionTypes.get(type)}:${key(record, id)}`;
			const completion = completions.get(completionKey)
				?? (type === 'subagent.started' ? completions.get(`subagent.failed:${key(record, id)}`) : undefined);
			if (completion) {
				paired.add(completion.id);
				event.rawRecords.push(completion);
				const duration = Date.parse(completion.timestamp) - Date.parse(record.timestamp);
				if (Number.isFinite(duration) && duration >= 0) {
					event.duration = duration;
				}
			}
			event.category = type === 'subagent.started' ? 'subagent' : 'tool';
			event.title = event.category === 'subagent'
				? text(data.agentDisplayName) || text(data.agentName) || 'Subagent'
				: text(data.toolName) || 'Tool';
			event.summary = event.category === 'subagent'
				? text(data.agentDescription)
				: toolSummary(data.arguments);
			event.parentEventId = parentTool
				?? (event.category === 'subagent' ? starts.get(key(record, data.toolCallId)) : undefined)
				?? owners.get(key(record, data.toolCallId)) ?? current.assistant ?? current.user;
			event.status = !completion ? 'Running' : completion.type === 'subagent.failed' || completion.data.success === false ? 'Failed' : 'Completed';
			event.sections.push(section(event.category === 'tool' ? 'Arguments' : 'Agent details', event.category === 'tool' ? data.arguments : data));
			if (completion) {
				event.sections.push(section(event.status === 'Failed' ? 'Error' : 'Result', completion.data.result ?? completion.data.error ?? completion.data));
			}
		} else if ([...completionTypes.values(), 'subagent.failed'].includes(type)) {
			event.category = type.startsWith('subagent.') ? 'subagent' : 'tool';
			event.title = type === 'subagent.failed' ? 'Subagent failed' : 'Unpaired completion';
			event.summary = 'No matching start event is present in this history.';
			event.parentEventId = current.assistant ?? current.user;
			event.sections.push(section('Details', data));
		} else {
			continue;
		}
		event.searchText = [event.title, event.summary, ...event.sections.map(s => `${s.label}\n${s.content}`), readable(event.rawRecords)].join('\n');
		events.push(event);
	}
	return { totalRecords: records.length, events };
}

export function selectEvents(events, query, selectedCategories) {
	const byId = new Map(events.map(event => [event.id, event]));
	const selected = new Set(selectedCategories);
	const visible = new Set();
	const search = query.toLocaleLowerCase();
	for (const event of events) {
		if (!selected.has(event.category) || !event.searchText.toLocaleLowerCase().includes(search)) {
			continue;
		}
		let ancestor = event;
		while (ancestor && !visible.has(ancestor.id)) {
			visible.add(ancestor.id);
			ancestor = byId.get(ancestor.parentEventId);
		}
	}
	return events.filter(event => visible.has(event.id));
}
