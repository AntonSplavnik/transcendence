// ==================== DOMAIN MODELS ====================

export interface User {
	created_at: string;
	email: string;
	id: number;
	nickname: string;
	totp_confirmed_at: string | null;
	totp_enabled: boolean;
	description: string;
}

export interface Session {
	access_expiry: string;
	created_at: string;
	device_name: string | null;
	ip_address: string | null;
	last_used_at: string;
	login_expiry: string;
	session_id: number;
	user_id: number;
}

// ==================== API RESPONSE TYPES ====================
// Only for responses that are returned and stored

export interface AuthResponse {
	user: User;
	session: Session;
}

export interface TwoFactorStartResponse {
	base32_secret: string;
	qr_base64: string;
	url: string;
}

export interface TwoFactorConfirmResponse {
	recovery_codes: string[];
}

// ==================== SHARED REQUEST TYPES ====================
// Only for complex payloads reused across multiple endpoints

export interface PasswordMfaPayload {
	password: string;
	mfa_code?: string;
}

export interface SessionManagementPayload extends PasswordMfaPayload {
	session_ids: number[];
}

export interface ChangePasswordPayload {
	password: string;
	new_password: string;
	mfa_code?: string;
	keep_other_sessions_logged_in: boolean;
}

// ==================== FRIENDS ====================

export interface PublicUser {
	id: number;
	nickname: string;
	created_at: string;
	online: boolean;
}

export interface FriendRequestResponse {
	id: number;
	sender: PublicUser;
	receiver: PublicUser;
	created_at: string;
	updated_at: string;
}

// ==================== API ERROR TYPES ====================

export interface ApiError {
	code: number;
	name: string;
	brief: string;
	detail?: string | null;
}

export interface ApiErrorResponse {
	error?: ApiError;
}
