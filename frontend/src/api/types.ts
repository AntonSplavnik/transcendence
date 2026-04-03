// ==================== DOMAIN MODELS ====================

export interface User {
	created_at: string;
	email: string;
	id: number;
	nickname: string;
	totp_confirmed_at: string | null;
	totp_enabled: boolean;
	description: string;
	tos_accepted_at: string | null;
	email_confirmed_at: string | null;
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

export interface TosInfo {
	current_tos_timestamp: string;
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
	description: string;
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

// ==================== GDPR TYPES ====================

export interface GdprInitiateResponse {
	token: string;
	email_confirmation_required: boolean;
	expires_at: string;
}

export interface DataExport {
	exported_at: string;
	user: ExportUser;
	sessions: ExportSession[];
	friend_requests: ExportFriendRequest[];
	notifications: ExportNotification[];
	avatar_large_base64: string | null;
	avatar_small_base64: string | null;
}

export interface ExportUser {
	id: number;
	email: string;
	nickname: string;
	totp_enabled: boolean;
	totp_confirmed_at: string | null;
	created_at: string;
	description: string;
	tos_accepted_at: string | null;
	email_confirmed_at: string | null;
	pending_email_change: string | null;
}

export interface ExportSession {
	id: number;
	user_id: number;
	device_id: string;
	device_name: string | null;
	ip_address: string | null;
	created_at: string;
	refreshed_at: string;
	last_used_at: string;
	last_authenticated_at: string;
}

export interface ExportFriendRequest {
	id: number;
	sender_id: number;
	receiver_id: number;
	status: string;
	created_at: string;
	updated_at: string;
}

export interface ExportNotification {
	id: number;
	payload: unknown;
	created_at: string;
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
