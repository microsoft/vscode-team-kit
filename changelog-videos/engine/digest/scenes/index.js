// The scene kit: drawn VS Code pieces for the changes a demo can't record (signed out, outside the window, a build
// without the change), and a card for changes with no UI to show. `prs digest scenes` lists them. Each scene says
// when its parts are on screen (windows) and which of its strings must be the PR's (proofs): prs digest check.
import buttonSwap from './button-swap.js';
import appBadge from './app-badge.js';
import listActions from './list-actions.js';
import slashMenu from './slash-menu.js';
import dialog from './dialog.js';
import setting from './setting.js';
import commandPalette from './command-palette.js';
import notification from './notification.js';
import picker from './picker.js';
import editor from './editor.js';
import card from './card.js';

export const SCENES = Object.fromEntries([buttonSwap, appBadge, listActions, slashMenu, dialog, setting, commandPalette, notification, picker, editor, card].map(s => [s.name, s]));

// What an "icon" param can be (Fluent icons, and "github" for the GitHub mark): prs digest check verifies them.
export { ICON_NAMES } from '../../theme/icons.js';
