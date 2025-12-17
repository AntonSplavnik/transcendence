request resend of token before logout request?

timed refresh token

2fa implenentation in frontend
on login request, if response is #[error("Two-factor authentication required")]
(see @pub enum AuthError in backend)
open new dialog to input 2fa code
if wrong input, show error message and allow reinput

- `/api/user/2fa/start` (POST): start 2FA enrollment (returns secret + QR)
- `/api/user/2fa/confirm` (POST): confirm enrollment (returns recovery codes once)
- `/api/user/2fa/disable` (POST): disable 2FA (requires password + `mfa_code`)

display error message coming from server in case of 401 (see @pub enum ApiError in backend)
(except for the reauth required error, for that handle it with the token refresh logic)

greet user by name in top right corner
review all current sessions in frontend overview page. make a top button to view your own profile and have a menu item on there to get to this management overview.
implement user session management page in frontend using the following endpoints:

- `/api/user/me` (GET): returns user + current session info
- `/api/user/change-password` (POST): requires current password; can force reauth of other sessions
- `/api/user/logout` (POST): “deauths” the current session and removes cookies
- `/api/user/logout-sessions` (POST): requires password; deauth selected sessions
- `/api/user/logout-other-sessions` (POST): requires password; deauth all other sessions
- `/api/user/session` (GET): get current session info
- `/api/user/sessions` (POST): requires password; list sessions
- `/api/user/sessions` (DELETE): requires password; delete session records
