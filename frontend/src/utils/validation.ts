/**
 * Lightweight client-side pre-validation aligned with backend rules.
 * See backend/src/validate.rs, backend/src/auth/router.rs, and
 * backend/src/auth/two_factor.rs for the authoritative validation logic.
 */

export function validateNickname(value: string): string | null {
	if (value !== value.trim()) {
		return 'Must not have leading or trailing whitespace.';
	}
	if (value.length < 3 || value.length > 16) {
		return 'Must be between 3 and 16 characters long.';
	}
	if (/\s/.test(value)) {
		return 'Must not contain whitespace.';
	}
	// Only allow ASCII alphanumeric, underscore, hyphen — matches backend
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		const isAlnum =
			(c >= 48 && c <= 57) || // 0-9
			(c >= 65 && c <= 90) || // A-Z
			(c >= 97 && c <= 122); // a-z
		if (!isAlnum && c !== 45 && c !== 95) {
			// - and _
			return 'Can only contain alphanumeric characters, underscores, or hyphens.';
		}
	}
	return null;
}

export function validateEmail(value: string): string | null {
	if (!value) return null;
	if (value.length > 254) {
		return 'Must be a valid email address.';
	}
	// Split on @ — must have exactly one @, non-empty local and domain parts
	const atIndex = value.indexOf('@');
	if (atIndex < 1 || atIndex !== value.lastIndexOf('@')) {
		return 'Must be a valid email address.';
	}
	const local = value.slice(0, atIndex);
	const domain = value.slice(atIndex + 1);
	if (local.length > 64 || domain.length < 3 || !domain.includes('.')) {
		return 'Must be a valid email address.';
	}
	// Reject whitespace and control characters anywhere
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (c <= 0x1f || c === 0x7f || c === 0x20 || c === 0x09) {
			return 'Must be a valid email address.';
		}
	}
	return null;
}

export function validateMfaCode(value: string): string | null {
	if (!value) {
		return 'Authentication code is required.';
	}
	// Hard cap length to reject obviously invalid input early
	if (value.length > 22) {
		return 'Invalid code format.';
	}
	// Check if all digits → TOTP code (6-8 digits)
	let allDigits = true;
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (c < 48 || c > 57) {
			allDigits = false;
			break;
		}
	}
	if (allDigits) {
		if (value.length < 6 || value.length > 8) {
			return 'TOTP code must be 6 to 8 digits.';
		}
	} else {
		// Recovery code — base64url of 16 bytes = exactly 22 chars [A-Za-z0-9_-]
		if (value.length !== 22) {
			return 'Invalid recovery code format.';
		}
		for (let i = 0; i < value.length; i++) {
			const c = value.charCodeAt(i);
			const valid =
				(c >= 48 && c <= 57) || // 0-9
				(c >= 65 && c <= 90) || // A-Z
				(c >= 97 && c <= 122) || // a-z
				c === 45 ||
				c === 95; // - _
			if (!valid) {
				return 'Invalid recovery code format.';
			}
		}
	}
	return null;
}

/** Max accepted input file size before even attempting to decode/convert. */
const MAX_AVATAR_INPUT_BYTES = 10 * 1024 * 1024; // 10 MB

export function validateAvatarFile(file: File): string | null {
	if (!file.type.startsWith('image/')) {
		return 'File must be an image.';
	}
	if (file.size > MAX_AVATAR_INPUT_BYTES) {
		return 'File must be smaller than 10 MB.';
	}
	return null;
}

export function validateDescription(value: string): string | null {
	// Count Unicode code points, not UTF-16 code units — matches backend chars().count()
	if ([...value].length > 50) {
		return 'Must be at most 50 characters long.';
	}
	return null;
}

export function validateTotpOnly(value: string): string | null {
	if (!value) {
		return 'Verification code is required.';
	}
	if (value.length !== 6) {
		return 'Code must be 6 digits.';
	}
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (c < 48 || c > 57) {
			return 'Code must be 6 digits.';
		}
	}
	return null;
}
