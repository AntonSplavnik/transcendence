timed refresh token

review all current sessions in frontend overview page. make a top button to view your own profile and have a menu item on there to get to this management overview.
implement user session management page in frontend using the following endpoints:

- `/api/user/change-password` (POST): requires current password; can force reauth of other sessions
- `/api/user/logout` (POST): “deauths” the current session and removes cookies
- `/api/user/logout-sessions` (POST): requires password; deauth selected sessions
- `/api/user/logout-other-sessions` (POST): requires password; deauth all other sessions
- `/api/user/session` (GET): get current session info
- `/api/user/sessions` (POST): requires password; list sessions
- `/api/user/sessions` (DELETE): requires password; delete session records
