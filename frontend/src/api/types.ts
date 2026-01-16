// ==================== API RESPONSE TYPES ====================

export interface User {
	id:  number;
	email: string;
	nickname: string;
	avatar_url:  string | null;
	is_online: boolean;
	totp_enabled: boolean;
	totp_confirmed_at: string | null;
	created_at:  string;
	last_seen: string | null;
}

export interface SessionInfo {
	session_id: number;
	user_id: number;
	device_name: string | null;
	ip_address: string | null;
	created_at:  string;
	last_used_at: string;
	jwt_valid_until: string;
	logged_in_until: string;
}

export interface UserStats {
	id: number;
	user_id: number;
	games_played: number;
	total_kills: number;
	total_time_played: number;
	last_game_at: string | null;
	last_game_kills: number;
	last_game_time: number;
	created_at: string;
	updated_at: string;
}

export interface UserSessionInfo {
	user: User;
	session: SessionInfo;
	stats: UserStats;
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
	nickname:  string;
	password: string;
}

export interface ReauthRequest {
	password: string;
	mfa_code?:  string;
}
