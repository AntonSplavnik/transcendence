/*
 * Chat command registry — purely client-side command parsing.
 *
 * ALL input starting with '/' is consumed here and never reaches the server
 * as SendText. Unrecognised commands return feedback but are still consumed.
 *
 * The registry is a plain Record, extensible for Part 2 REST commands.
 */

import type { ChatPreferences } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Context passed to every command handler. */
export interface CommandContext {
	updatePreferences: (patch: Partial<ChatPreferences>) => void;
}

/** Result returned by handleCommand. */
export interface CommandResult {
	/** True when the input was a command (started with '/') — never send to server. */
	consumed: boolean;
	/** Optional feedback to display locally. */
	feedback?: string;
}

type CommandHandler = (args: string, ctx: CommandContext) => CommandResult;

// ─── Registry ─────────────────────────────────────────────────────────────────

const COMMANDS: Record<string, CommandHandler> = {
	global_off: (_args, ctx) => {
		ctx.updatePreferences({ globalEnabled: false });
		return { consumed: true, feedback: 'Global chat hidden.' };
	},
	global_on: (_args, ctx) => {
		ctx.updatePreferences({ globalEnabled: true });
		return { consumed: true, feedback: 'Global chat visible.' };
	},
	// Part 2 stubs (REST endpoints not yet implemented):
	// leave, block, unblock — will be added when backend endpoints exist.
};

/** All known command names — used by the autocomplete popup. */
export const COMMAND_NAMES: string[] = Object.keys(COMMANDS);

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse and execute a chat command.
 *
 * Returns `{ consumed: false }` when input does not start with '/'.
 * Returns `{ consumed: true }` for ALL '/...' strings — unrecognised
 * commands are consumed with an error message, never reaching the server.
 */
export function handleCommand(input: string, ctx: CommandContext): CommandResult {
	if (!input.startsWith('/')) {
		return { consumed: false };
	}

	const withoutSlash = input.slice(1).trimStart();
	const spaceIdx = withoutSlash.indexOf(' ');
	const name = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
	const args = spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1);

	const handler = COMMANDS[name];
	if (!handler) {
		return {
			consumed: true,
			feedback: name ? `Unknown command: /${name}` : 'Type a command after /.',
		};
	}

	return handler(args, ctx);
}
