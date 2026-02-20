import { describe, it, expect } from 'vitest';
import {
	validateNickname,
	validateEmail,
	validateMfaCode,
	validateTotpOnly,
} from '../../../src/utils/validation';

describe('validateNickname', () => {
	it('accepts valid nicknames', () => {
		expect(validateNickname('abc')).toBeNull();
		expect(validateNickname('a-b_c')).toBeNull();
		expect(validateNickname('Player_01')).toBeNull();
		expect(validateNickname('a'.repeat(16))).toBeNull();
		expect(validateNickname('A-Z_0-9')).toBeNull();
	});

	it('rejects leading whitespace', () => {
		expect(validateNickname(' abc')).toBe('Must not have leading or trailing whitespace.');
	});

	it('rejects trailing whitespace', () => {
		expect(validateNickname('abc ')).toBe('Must not have leading or trailing whitespace.');
	});

	it('rejects too short (< 3)', () => {
		expect(validateNickname('ab')).toBe('Must be between 3 and 16 characters long.');
		expect(validateNickname('a')).toBe('Must be between 3 and 16 characters long.');
		expect(validateNickname('')).toBe('Must be between 3 and 16 characters long.');
	});

	it('rejects too long (> 16)', () => {
		expect(validateNickname('a'.repeat(17))).toBe('Must be between 3 and 16 characters long.');
	});

	it('rejects internal whitespace', () => {
		expect(validateNickname('a b')).toBe('Must not contain whitespace.');
		expect(validateNickname('ab\tc')).toBe('Must not contain whitespace.');
	});

	it('rejects invalid characters', () => {
		const msg = 'Can only contain alphanumeric characters, underscores, or hyphens.';
		expect(validateNickname('abc!')).toBe(msg);
		expect(validateNickname('abc@d')).toBe(msg);
		expect(validateNickname('abc.def')).toBe(msg);
		expect(validateNickname('abc#')).toBe(msg);
	});
});

describe('validateEmail', () => {
	it('returns null for empty string (handled by required attr)', () => {
		expect(validateEmail('')).toBeNull();
	});

	it('accepts valid emails', () => {
		expect(validateEmail('a@b.co')).toBeNull();
		expect(validateEmail('user@domain.com')).toBeNull();
		expect(validateEmail('user+tag@domain.org')).toBeNull();
	});

	it('rejects missing @', () => {
		expect(validateEmail('noatsign')).toBe('Must be a valid email address.');
	});

	it('rejects multiple @', () => {
		expect(validateEmail('a@b@c.com')).toBe('Must be a valid email address.');
	});

	it('rejects empty local part', () => {
		expect(validateEmail('@domain.com')).toBe('Must be a valid email address.');
	});

	it('rejects no dot in domain', () => {
		expect(validateEmail('a@localhost')).toBe('Must be a valid email address.');
	});

	it('rejects domain too short', () => {
		expect(validateEmail('a@b')).toBe('Must be a valid email address.');
	});

	it('rejects control characters', () => {
		expect(validateEmail('a\x00b@c.com')).toBe('Must be a valid email address.');
	});

	it('rejects email longer than 254 chars', () => {
		const longEmail = 'a'.repeat(250) + '@b.co';
		expect(validateEmail(longEmail)).toBe('Must be a valid email address.');
	});

	it('rejects local part longer than 64 chars', () => {
		const longLocal = 'a'.repeat(65) + '@b.co';
		expect(validateEmail(longLocal)).toBe('Must be a valid email address.');
	});

	it('rejects spaces', () => {
		expect(validateEmail('a b@c.com')).toBe('Must be a valid email address.');
	});
});

describe('validateMfaCode', () => {
	it('rejects empty string', () => {
		expect(validateMfaCode('')).toBe('Authentication code is required.');
	});

	it('accepts valid 6-digit TOTP', () => {
		expect(validateMfaCode('123456')).toBeNull();
	});

	it('accepts valid 7-digit TOTP', () => {
		expect(validateMfaCode('1234567')).toBeNull();
	});

	it('accepts valid 8-digit TOTP', () => {
		expect(validateMfaCode('12345678')).toBeNull();
	});

	it('rejects too few digits (< 6)', () => {
		expect(validateMfaCode('12345')).toBe('TOTP code must be 6 to 8 digits.');
	});

	it('rejects too many digits (> 8)', () => {
		expect(validateMfaCode('123456789')).toBe('TOTP code must be 6 to 8 digits.');
	});

	it('accepts valid base64url recovery code', () => {
		expect(validateMfaCode('abcABC_-012')).toBeNull();
		expect(validateMfaCode('AbCdEfGhIjKlMnOpQrStUv')).toBeNull();
	});

	it('rejects recovery code with invalid chars', () => {
		expect(validateMfaCode('abc!@#')).toBe('Invalid recovery code format.');
		expect(validateMfaCode('abc def')).toBe('Invalid recovery code format.');
		expect(validateMfaCode('abc.def')).toBe('Invalid recovery code format.');
	});

	it('rejects input over 44 chars', () => {
		expect(validateMfaCode('a'.repeat(45))).toBe('Invalid code format.');
	});

	it('accepts input at exactly 44 chars', () => {
		expect(validateMfaCode('a'.repeat(44))).toBeNull();
	});
});

describe('validateTotpOnly', () => {
	it('rejects empty string', () => {
		expect(validateTotpOnly('')).toBe('Verification code is required.');
	});

	it('accepts exactly 6 digits', () => {
		expect(validateTotpOnly('123456')).toBeNull();
		expect(validateTotpOnly('000000')).toBeNull();
	});

	it('rejects too short', () => {
		expect(validateTotpOnly('12345')).toBe('Code must be 6 digits.');
	});

	it('rejects too long', () => {
		expect(validateTotpOnly('1234567')).toBe('Code must be 6 digits.');
	});

	it('rejects non-digit characters', () => {
		expect(validateTotpOnly('12345a')).toBe('Code must be 6 digits.');
		expect(validateTotpOnly('abcdef')).toBe('Code must be 6 digits.');
	});
});
