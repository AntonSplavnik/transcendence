import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '../../helpers/render';
import { server, mockAuthenticatedUser } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockUser, createMockSession } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';
import SessionManagement from '../../../src/components/SessionManagement';
import type { Session } from '../../../src/api/types';

// ==================== FIXTURES ====================

const mockOnBack = vi.fn();
const mockOnLogout = vi.fn();

const currentSession = createMockSession({ session_id: 1 });
const otherSession = createMockSession({
	session_id: 2,
	device_name: 'Firefox on Windows',
	ip_address: '192.168.1.100',
	created_at: '2024-06-15T10:00:00Z',
	last_used_at: '2024-06-16T14:30:00Z',
});

const multipleSessions: Session[] = [currentSession, otherSession];

// ==================== HELPERS ====================

async function renderPage(opts: { totp_enabled?: boolean } = {}) {
	const user = createMockUser({ totp_enabled: opts.totp_enabled ?? false });
	const session = currentSession;
	mockAuthenticatedUser(user, session);

	render(
		<SessionManagement onBack={mockOnBack} onLogout={mockOnLogout} />
	);

	await waitFor(() => {
		expect(screen.getByText('Session Management')).toBeInTheDocument();
	});
}

/** Unlock the sessions section by entering password and clicking Unlock */
async function unlockSessions(
	user: ReturnType<typeof userEvent.setup>,
	sessions: Session[] = multipleSessions,
) {
	server.use(
		http.post('/api/user/sessions', () => {
			return HttpResponse.json(sessions);
		}),
	);

	await user.type(screen.getByLabelText('Password'), 'correctpassword');
	await user.click(screen.getByRole('button', { name: /unlock sessions/i }));

	await waitFor(() => {
		expect(screen.getAllByText(/Session #/).length).toBeGreaterThan(0);
	});
}

// ==================== TESTS ====================

describe('SessionManagement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ==================== RENDERING & LAYOUT ====================

	describe('Rendering & layout', () => {
		it('renders page heading and back/logout buttons', async () => {
			await renderPage();

			expect(screen.getByText('Session Management')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /log out/i })).toBeInTheDocument();
		});

		it('shows current session info', async () => {
			await renderPage();

			expect(screen.getByText('Current Session')).toBeInTheDocument();
			expect(screen.getByText('Session ID')).toBeInTheDocument();
			expect(screen.getByText('Last Used')).toBeInTheDocument();
			expect(screen.getByText('Created')).toBeInTheDocument();
			expect(screen.getByText('Session Expiry')).toBeInTheDocument();
			expect(screen.getByText('Device Info')).toBeInTheDocument();
		});

		it('shows "Change Password" section with inputs', async () => {
			await renderPage();

			expect(screen.getByRole('heading', { name: /change password/i })).toBeInTheDocument();
			expect(screen.getByLabelText('Current Password')).toBeInTheDocument();
			expect(screen.getByLabelText('New Password')).toBeInTheDocument();
			expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();
		});

		it('shows locked "All Sessions" section with password gate', async () => {
			await renderPage();

			expect(screen.getByText('All Sessions')).toBeInTheDocument();
			expect(screen.getByText(/enter your password to view/i)).toBeInTheDocument();
			expect(screen.getByLabelText('Password')).toBeInTheDocument();
			expect(screen.getByRole('button', { name: /unlock sessions/i })).toBeInTheDocument();
		});
	});

	// ==================== CHANGE PASSWORD FORM ====================

	describe('Change password form', () => {
		it('validates empty fields', async () => {
			await renderPage();
			const user = userEvent.setup();

			await user.click(screen.getByRole('button', { name: /change password/i }));

			expect(screen.getByText('Please fill in all required fields.')).toBeInTheDocument();
		});

		it('validates short password', async () => {
			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Current Password'), 'oldpass');
			await user.type(screen.getByLabelText('New Password'), 'short');
			await user.type(screen.getByLabelText('Confirm New Password'), 'short');

			await user.click(screen.getByRole('button', { name: /change password/i }));

			expect(screen.getByText(/at least 8 characters/)).toBeInTheDocument();
		});

		it('validates same password', async () => {
			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Current Password'), 'samepassword');
			await user.type(screen.getByLabelText('New Password'), 'samepassword');
			await user.type(screen.getByLabelText('Confirm New Password'), 'samepassword');

			await user.click(screen.getByRole('button', { name: /change password/i }));

			expect(screen.getByText(/must differ from your current password/)).toBeInTheDocument();
		});

		it('validates mismatch', async () => {
			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Current Password'), 'oldpassword');
			await user.type(screen.getByLabelText('New Password'), 'newpassword1');
			await user.type(screen.getByLabelText('Confirm New Password'), 'newpassword2');

			await user.click(screen.getByRole('button', { name: /change password/i }));

			expect(screen.getByText('New passwords do not match.')).toBeInTheDocument();
		});

		it('successful change shows success alert and clears fields', async () => {
			server.use(
				http.post('/api/user/change-password', () => {
					return new HttpResponse(null, { status: 204 });
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Current Password'), 'oldpassword');
			await user.type(screen.getByLabelText('New Password'), 'newpassword123');
			await user.type(screen.getByLabelText('Confirm New Password'), 'newpassword123');

			await user.click(screen.getByRole('button', { name: /change password/i }));

			await waitFor(() => {
				expect(screen.getByText('Password changed successfully.')).toBeInTheDocument();
			});

			// Fields should be cleared
			expect(screen.getByLabelText('Current Password')).toHaveValue('');
			expect(screen.getByLabelText('New Password')).toHaveValue('');
			expect(screen.getByLabelText('Confirm New Password')).toHaveValue('');
		});

		it('API failure shows error message', async () => {
			server.use(
				http.post('/api/user/change-password', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: 'Current password is incorrect' }) },
						{ status: 401 },
					);
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Current Password'), 'wrongpassword');
			await user.type(screen.getByLabelText('New Password'), 'newpassword123');
			await user.type(screen.getByLabelText('Confirm New Password'), 'newpassword123');

			await user.click(screen.getByRole('button', { name: /change password/i }));

			await waitFor(() => {
				expect(screen.getByText('Current password is incorrect')).toBeInTheDocument();
			});
		});

		it('Enter key submits form', async () => {
			server.use(
				http.post('/api/user/change-password', () => {
					return new HttpResponse(null, { status: 204 });
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Current Password'), 'oldpassword');
			await user.type(screen.getByLabelText('New Password'), 'newpassword123');
			await user.type(screen.getByLabelText('Confirm New Password'), 'newpassword123');
			await user.keyboard('{Enter}');

			await waitFor(() => {
				expect(screen.getByText('Password changed successfully.')).toBeInTheDocument();
			});
		});

		it('shows MFA input when totp_enabled is true', async () => {
			await renderPage({ totp_enabled: true });

			// There should be an MFA Code input in the change password section
			const mfaInputs = screen.getAllByLabelText('MFA Code');
			expect(mfaInputs.length).toBeGreaterThanOrEqual(1);
		});

		it('re-locks sessions section after successful password change', async () => {
			server.use(
				http.post('/api/user/change-password', () => {
					return new HttpResponse(null, { status: 204 });
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			// First unlock sessions
			await unlockSessions(user);
			expect(screen.getByText(/Session #2/)).toBeInTheDocument();

			// Now change password
			await user.type(screen.getByLabelText('Current Password'), 'oldpassword');
			await user.type(screen.getByLabelText('New Password'), 'newpassword123');
			await user.type(screen.getByLabelText('Confirm New Password'), 'newpassword123');
			await user.click(screen.getByRole('button', { name: /change password/i }));

			await waitFor(() => {
				expect(screen.getByText('Password changed successfully.')).toBeInTheDocument();
			});

			// Sessions should be re-locked
			expect(screen.getByText(/enter your password to view/i)).toBeInTheDocument();
			expect(screen.queryByText(/Session #2/)).not.toBeInTheDocument();
		});
	});

	// ==================== SESSION UNLOCKING ====================

	describe('Session unlocking', () => {
		it('entering password and clicking "Unlock Sessions" fetches and shows sessions', async () => {
			server.use(
				http.post('/api/user/sessions', () => {
					return HttpResponse.json(multipleSessions);
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Password'), 'correctpassword');
			await user.click(screen.getByRole('button', { name: /unlock sessions/i }));

			await waitFor(() => {
				expect(screen.getByText(/Session #1/)).toBeInTheDocument();
				expect(screen.getByText(/Session #2/)).toBeInTheDocument();
			});
		});

		it('unlock failure shows error alert', async () => {
			server.use(
				http.post('/api/user/sessions', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 401, brief: 'InvalidCredentials', detail: 'Invalid password' }) },
						{ status: 401 },
					);
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			await user.type(screen.getByLabelText('Password'), 'wrongpassword');
			await user.click(screen.getByRole('button', { name: /unlock sessions/i }));

			await waitFor(() => {
				expect(screen.getByText('Invalid password')).toBeInTheDocument();
			});
		});

		it('shows MFA input in unlock form when totp_enabled is true', async () => {
			await renderPage({ totp_enabled: true });

			// The unlock section should have an MFA Code input
			// Change password section also has one, so there should be at least 2
			const mfaInputs = screen.getAllByLabelText('MFA Code');
			expect(mfaInputs.length).toBeGreaterThanOrEqual(2);
		});
	});

	// ==================== SESSION LIST (UNLOCKED) ====================

	describe('Session list (unlocked state)', () => {
		it('renders session rows with details', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			expect(screen.getByText(/Session #1/)).toBeInTheDocument();
			expect(screen.getByText(/Session #2/)).toBeInTheDocument();
		});

		it('current session row shows "Current" badge and is not selectable', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			expect(screen.getByText('Current')).toBeInTheDocument();

			const currentCheckbox = screen.getByRole('checkbox', { name: /select session 1/i });
			expect(currentCheckbox).toBeDisabled();
		});

		it('clicking non-current session row toggles checkbox selection', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			const sessionRow = screen.getByRole('button', { name: /toggle session 2/i });
			await user.click(sessionRow);

			const checkbox = screen.getByRole('checkbox', { name: /select session 2/i });
			expect(checkbox).toBeChecked();

			// Click again to deselect
			await user.click(sessionRow);
			expect(checkbox).not.toBeChecked();
		});

		it('"Log Out Selected" disabled when nothing selected, enabled when selected', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			const logoutBtn = screen.getByRole('button', { name: /log out selected/i });
			expect(logoutBtn).toBeDisabled();

			// Select a session
			await user.click(screen.getByRole('button', { name: /toggle session 2/i }));
			expect(logoutBtn).toBeEnabled();
		});

		it('"Log Out All Others" disabled when only current session exists', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user, [currentSession]);

			const othersBtn = screen.getByRole('button', { name: /log out all others/i });
			expect(othersBtn).toBeDisabled();
		});

		it('"Delete Selected Records" disabled when nothing selected', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			const deleteBtn = screen.getByRole('button', { name: /delete selected records/i });
			expect(deleteBtn).toBeDisabled();
		});
	});

	// ==================== ACTION MODAL ====================

	describe('Action modal', () => {
		it('clicking "Log Out Selected" opens confirmation modal with description', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			// Select session 2
			await user.click(screen.getByRole('button', { name: /toggle session 2/i }));

			await user.click(screen.getByRole('button', { name: /log out selected/i }));

			await waitFor(() => {
				expect(screen.getByText('Log Out Sessions')).toBeInTheDocument();
				expect(screen.getByText(/log out 1 selected session/i)).toBeInTheDocument();
			});
		});

		it('modal shows MFA input when totp_enabled is true', async () => {
			await renderPage({ totp_enabled: true });
			const user = userEvent.setup();

			// Unlock with MFA
			server.use(
				http.post('/api/user/sessions', () => {
					return HttpResponse.json(multipleSessions);
				}),
			);
			await user.type(screen.getByLabelText('Password'), 'correctpassword');
			// There are multiple MFA Code inputs; type in the unlock one (last one)
			const mfaInputs = screen.getAllByLabelText('MFA Code');
			await user.type(mfaInputs[mfaInputs.length - 1], '123456');
			await user.click(screen.getByRole('button', { name: /unlock sessions/i }));

			await waitFor(() => {
				expect(screen.getByText(/Session #2/)).toBeInTheDocument();
			});

			// Select session and open modal
			await user.click(screen.getByRole('button', { name: /toggle session 2/i }));
			await user.click(screen.getByRole('button', { name: /log out selected/i }));

			await waitFor(() => {
				expect(screen.getByText('Log Out Sessions')).toBeInTheDocument();
			});

			// Modal should have an MFA input
			const modalMfaInputs = screen.getAllByLabelText('MFA Code');
			expect(modalMfaInputs.length).toBeGreaterThanOrEqual(1);
		});

		it('confirming action shows success alert and refreshes list', async () => {
			server.use(
				http.post('/api/user/logout-sessions', () => {
					return new HttpResponse(null, { status: 204 });
				}),
				http.post('/api/user/sessions', () => {
					return HttpResponse.json([currentSession]);
				}),
			);

			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			// Select session 2
			await user.click(screen.getByRole('button', { name: /toggle session 2/i }));
			await user.click(screen.getByRole('button', { name: /log out selected/i }));

			await waitFor(() => {
				expect(screen.getByText('Log Out Sessions')).toBeInTheDocument();
			});

			// Confirm — pick the modal's "Log Out" button (not the header one)
			const logOutButtons = screen.getAllByRole('button', { name: /^log out$/i });
			await user.click(logOutButtons[logOutButtons.length - 1]);

			await waitFor(() => {
				expect(screen.getByText(/logged out 1 session/i)).toBeInTheDocument();
			});

			// Modal should be closed
			expect(screen.queryByText('Log Out Sessions')).not.toBeInTheDocument();
		});

		it('modal cancel closes modal', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			await user.click(screen.getByRole('button', { name: /toggle session 2/i }));
			await user.click(screen.getByRole('button', { name: /log out selected/i }));

			await waitFor(() => {
				expect(screen.getByText('Log Out Sessions')).toBeInTheDocument();
			});

			await user.click(screen.getByRole('button', { name: /cancel/i }));

			expect(screen.queryByText('Log Out Sessions')).not.toBeInTheDocument();
		});

		it('modal API error shows error in modal', async () => {
			server.use(
				http.post('/api/user/logout-sessions', () => {
					return HttpResponse.json(
						{ error: createMockApiError({ code: 500, detail: 'Internal server error' }) },
						{ status: 500 },
					);
				}),
			);

			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			await user.click(screen.getByRole('button', { name: /toggle session 2/i }));
			await user.click(screen.getByRole('button', { name: /log out selected/i }));

			await waitFor(() => {
				expect(screen.getByText('Log Out Sessions')).toBeInTheDocument();
			});

			const logOutButtons = screen.getAllByRole('button', { name: /^log out$/i });
			await user.click(logOutButtons[logOutButtons.length - 1]);

			await waitFor(() => {
				expect(screen.getByText('Internal server error')).toBeInTheDocument();
			});

			// Modal should still be open
			expect(screen.getByText('Log Out Sessions')).toBeInTheDocument();
		});
	});

	// ==================== REFRESH BUTTON ====================

	describe('Refresh button', () => {
		it('refresh button visible when unlocked', async () => {
			await renderPage();
			const user = userEvent.setup();
			await unlockSessions(user);

			expect(screen.getByRole('button', { name: /refresh sessions/i })).toBeInTheDocument();
		});

		it('click refresh (no MFA) refreshes sessions directly', async () => {
			const refreshedSessions = [currentSession];
			let callCount = 0;

			server.use(
				http.post('/api/user/sessions', () => {
					callCount++;
					if (callCount <= 1) {
						return HttpResponse.json(multipleSessions);
					}
					return HttpResponse.json(refreshedSessions);
				}),
			);

			await renderPage();
			const user = userEvent.setup();

			// Unlock
			await user.type(screen.getByLabelText('Password'), 'correctpassword');
			await user.click(screen.getByRole('button', { name: /unlock sessions/i }));

			await waitFor(() => {
				expect(screen.getByText(/Session #2/)).toBeInTheDocument();
			});

			// Click refresh — no modal should appear for non-MFA users
			await user.click(screen.getByRole('button', { name: /refresh sessions/i }));

			await waitFor(() => {
				expect(screen.queryByText(/Session #2/)).not.toBeInTheDocument();
			});
		});

		it('click refresh (with MFA) opens modal, confirm refreshes', async () => {
			await renderPage({ totp_enabled: true });
			const user = userEvent.setup();

			// Unlock with MFA
			server.use(
				http.post('/api/user/sessions', () => {
					return HttpResponse.json(multipleSessions);
				}),
			);

			await user.type(screen.getByLabelText('Password'), 'correctpassword');
			const mfaInputs = screen.getAllByLabelText('MFA Code');
			await user.type(mfaInputs[mfaInputs.length - 1], '123456');
			await user.click(screen.getByRole('button', { name: /unlock sessions/i }));

			await waitFor(() => {
				expect(screen.getByText(/Session #2/)).toBeInTheDocument();
			});

			// Click refresh — should open modal for MFA users
			await user.click(screen.getByRole('button', { name: /refresh sessions/i }));

			await waitFor(() => {
				expect(screen.getByText('Refresh Sessions')).toBeInTheDocument();
				expect(screen.getByText(/confirm your mfa code/i)).toBeInTheDocument();
			});

			// Confirm — the modal has a "Refresh" confirm button
			const modalButtons = screen.getAllByRole('button', { name: /refresh/i });
			// The confirm button is the last one (inside the modal footer)
			await user.click(modalButtons[modalButtons.length - 1]);

			await waitFor(() => {
				expect(screen.queryByText('Refresh Sessions')).not.toBeInTheDocument();
			});
		});
	});

	// ==================== CALLBACKS ====================

	describe('Callbacks', () => {
		it('back button calls onBack', async () => {
			await renderPage();
			const user = userEvent.setup();

			await user.click(screen.getByRole('button', { name: /back to dashboard/i }));

			expect(mockOnBack).toHaveBeenCalledOnce();
		});

		it('logout button calls onLogout', async () => {
			await renderPage();
			const user = userEvent.setup();

			await user.click(screen.getByRole('button', { name: /log out/i }));

			expect(mockOnLogout).toHaveBeenCalledOnce();
		});
	});
});
