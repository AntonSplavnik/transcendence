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

// ==================== STATS ====================

export interface UserStats {
	user_id: number;
	xp: number;
	level: number;
	xp_in_level: number;
	xp_to_next: number;
	progress_percent: number;
	games_played: number;
	games_won: number;
	games_lost: number;
	win_rate: number;
	current_win_streak: number;
	best_win_streak: number;
}

// ==================== ACHIEVEMENTS ====================

export interface AchievementWithProgress {
	id: number;
	code: string;
	name: string;
	description: string;
	category: string;
	bronze_threshold: number;
	silver_threshold: number;
	gold_threshold: number;
	base_xp_reward: number;
	current_progress: number;
	bronze_unlocked: boolean;
	silver_unlocked: boolean;
	gold_unlocked: boolean;
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
