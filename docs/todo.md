request resend of token before logout request?

timed refresh token

2fa implenentation in frontend
on login request, if response is #[error("Two-factor authentication required")]
(see @pub enum AuthError in backend)
open new dialog to input 2fa code
if wrong input, show error message and allow reinput

write a wrapper around request handler to request new jwt token if message: #[error("Reauthentication required")]
with api/auth/session-management/refresh-jwt
pub fn router(path: &str) -> Router {
Router::with_path("refresh-jwt")

display error message coming from server in case of 401 (see @pub enum ApiError in backend)
(except for the reauth required error, for that handle it with the token refresh logic)

review all current sessions in frontend overview page. make a top button to view your own profile and have a menu item on there to get to this management overview.
it will use the api/
