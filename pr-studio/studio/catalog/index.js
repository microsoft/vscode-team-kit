// The diagram catalog. Each export is a namespace of treatments for one explanation need:
//   import { title, concept, exchange, rules, architecture, status } from '../../catalog/index.js';
//   exchange.lifelines({ ... })
// `prs catalog` lists every treatment with its params; `prs catalog --sheet <file.png>` draws one picture of each.
export * as title from './title.js';
export * as concept from './concept.js';
export * as exchange from './exchange.js';
export * as flow from './flow.js';
export * as rules from './rules.js';
export * as compare from './compare.js';
export * as architecture from './architecture.js';
export * as code from './code.js';
export * as numbers from './numbers.js';
export * as state from './state.js';
export * as ui from './ui.js';
export * as status from './status.js';
