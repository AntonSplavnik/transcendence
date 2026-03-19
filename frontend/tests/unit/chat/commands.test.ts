import { describe, it, expect, vi } from 'vitest';
import { handleCommand, COMMAND_NAMES } from '../../../src/chat/commands';
import type { CommandContext } from '../../../src/chat/commands';

function makeCtx(): CommandContext {
	return { updatePreferences: vi.fn() };
}

describe('handleCommand', () => {
	// ── Non-commands ─────────────────────────────────────────────────────

	describe('non-command input', () => {
		it('returns consumed: false for plain text', () => {
			const result = handleCommand('hello world', makeCtx());
			expect(result.consumed).toBe(false);
		});

		it('returns consumed: false for empty string', () => {
			const result = handleCommand('', makeCtx());
			expect(result.consumed).toBe(false);
		});
	});

	// ── Known commands ───────────────────────────────────────────────────

	describe('/global_off', () => {
		it('disables global chat and returns feedback', () => {
			const ctx = makeCtx();
			const result = handleCommand('/global_off', ctx);
			expect(result.consumed).toBe(true);
			expect(result.feedback).toBe('Global chat hidden.');
			expect(ctx.updatePreferences).toHaveBeenCalledWith({ globalEnabled: false });
		});
	});

	describe('/global_on', () => {
		it('enables global chat and returns feedback', () => {
			const ctx = makeCtx();
			const result = handleCommand('/global_on', ctx);
			expect(result.consumed).toBe(true);
			expect(result.feedback).toBe('Global chat visible.');
			expect(ctx.updatePreferences).toHaveBeenCalledWith({ globalEnabled: true });
		});
	});

	// ── Unknown commands ─────────────────────────────────────────────────

	describe('unknown commands', () => {
		it('consumes input and shows error for unknown command', () => {
			const result = handleCommand('/foobar', makeCtx());
			expect(result.consumed).toBe(true);
			expect(result.feedback).toBe('Unknown command: /foobar');
		});

		it('consumes bare slash and shows guidance', () => {
			const result = handleCommand('/', makeCtx());
			expect(result.consumed).toBe(true);
			expect(result.feedback).toBe('Type a command after /.');
		});

		it('never leaks unknown commands to server (consumed is always true)', () => {
			const commands = ['/test', '/help', '/invite alice', '/leave'];
			for (const cmd of commands) {
				expect(handleCommand(cmd, makeCtx()).consumed).toBe(true);
			}
		});
	});

	// ── Parsing edge cases ───────────────────────────────────────────────

	describe('parsing', () => {
		it('handles leading whitespace after slash', () => {
			const ctx = makeCtx();
			const result = handleCommand('/  global_off', ctx);
			expect(result.consumed).toBe(true);
			expect(ctx.updatePreferences).toHaveBeenCalledWith({ globalEnabled: false });
		});

		it('passes args after the command name', () => {
			// Currently no commands use args, but the parser extracts them.
			// Unknown commands with args are still consumed.
			const result = handleCommand('/unknown arg1 arg2', makeCtx());
			expect(result.consumed).toBe(true);
			expect(result.feedback).toBe('Unknown command: /unknown');
		});
	});
});

describe('COMMAND_NAMES', () => {
	it('exports all registered command names', () => {
		expect(COMMAND_NAMES).toContain('global_off');
		expect(COMMAND_NAMES).toContain('global_on');
	});

	it('is a plain array of strings', () => {
		expect(Array.isArray(COMMAND_NAMES)).toBe(true);
		for (const name of COMMAND_NAMES) {
			expect(typeof name).toBe('string');
		}
	});
});
