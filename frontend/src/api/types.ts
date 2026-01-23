// ==================== API RESPONSE TYPES ====================

export interface UserInfo {
	"created_at": string;
	"email": string;
	"id": number;
	"nickname": string;
	"totp_confirmed_at": string | null;
	"totp_enabled": boolean;
}

export interface SessionInfo {
	"access_expiry": string;
	"created_at": string;
	"device_name": string | null;
	"ip_address": string | null;
	"last_used_at": string;
	"login_expiry": string;
	"session_id": number;
	"user_id": number;
}

export interface UserSessionInfo {
	user: UserInfo;
	session: SessionInfo;
}

// ==================== API ERROR TYPES ====================

export interface ApiError {
	name: string;
	brief: string;
	detail: string;
	cause: string;
	code: number;
}

// ==================== REQUEST PAYLOAD TYPES ====================

export interface LoginRequest {
	email: string;
	password: string;
	mfa_code?: string;
}

export interface RegisterRequest {
	email: string;
	nickname: string;
	password: string;
}

export interface ReauthRequest {
	password: string;
	mfa_code?: string;
}
