// Mirror of backend StreamType enum (serde default = externally tagged)
// Unit variants serialize as { "VariantName": null }
export type StreamType =
	| { Ctrl: { connection_id: number; challenge: string } }
	| { Notifications: null };

// Mirror of backend NotificationPayload enum (serde default = externally tagged)
export type NotificationPayload =
	| { ServerHello: null }
	| { FriendRequestReceived: { request_id: number; sender_id: number } }
	| { FriendRequestAccepted: { request_id: number; friend_id: number } }
	| { FriendRequestRejected: { request_id: number } }
	| { FriendRequestCancelled: { request_id: number } }
	| { FriendRemoved: { user_id: number } };

// Mirror of backend WireNotification
export interface WireNotification {
	payload: NotificationPayload;
	created_at: string;
}
