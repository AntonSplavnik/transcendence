import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, userEvent, waitFor } from '../../helpers/render';
import { http, HttpResponse } from 'msw';
import { server } from '../../helpers/msw-handlers';
import { createMockApiError } from '../../fixtures/errors';
import AddFriendForm from '../../../src/components/friends/AddFriendForm';

describe('AddFriendForm', () => {
	const mockOnRequestSent = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
	});

	const renderForm = (isOpen = true) => {
		return render(<AddFriendForm isOpen={isOpen} onRequestSent={mockOnRequestSent} />, {
			withAuth: false,
		});
	};

	// ─── Rendering ───────────────────────────────────────────────────────

	it('renders input and submit button', () => {
		renderForm();

		expect(screen.getByLabelText("Friend's nickname")).toBeInTheDocument();
		expect(screen.getByLabelText('Send friend request')).toBeInTheDocument();
	});

	it('submit button is disabled when input is empty', () => {
		renderForm();

		expect(screen.getByLabelText('Send friend request')).toBeDisabled();
	});

	// ─── Validation ──────────────────────────────────────────────────────

	it('enables submit button with valid nickname', async () => {
		const user = userEvent.setup();
		renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'Alice');

		expect(screen.getByLabelText('Send friend request')).toBeEnabled();
	});

	it('keeps submit disabled for too-short nickname', async () => {
		const user = userEvent.setup();
		renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'Ab');

		expect(screen.getByLabelText('Send friend request')).toBeDisabled();
	});

	it('keeps submit disabled for too-long nickname', async () => {
		const user = userEvent.setup();
		renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'A'.repeat(17));

		expect(screen.getByLabelText('Send friend request')).toBeDisabled();
	});

	// ─── Successful submission ───────────────────────────────────────────

	it('shows success message and clears input on success', async () => {
		const user = userEvent.setup();
		renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'Alice');
		await user.click(screen.getByLabelText('Send friend request'));

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Request sent to Alice!');
		});

		expect(screen.getByLabelText("Friend's nickname")).toHaveValue('');
		expect(mockOnRequestSent).toHaveBeenCalledTimes(1);
	});

	// ─── Failed submission ───────────────────────────────────────────────

	it('shows error message on failure', async () => {
		server.use(
			http.post('/api/friends/request', () => {
				return HttpResponse.json(
					{
						error: createMockApiError({
							code: 404,
							brief: 'UserNotFound',
							detail: 'User not found',
						}),
					},
					{ status: 404 },
				);
			}),
		);

		const user = userEvent.setup();
		renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'Unknown');
		await user.click(screen.getByLabelText('Send friend request'));

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeInTheDocument();
		});
	});

	// ─── Reset on close ──────────────────────────────────────────────────

	it('clears nickname and message when drawer closes', async () => {
		const user = userEvent.setup();
		const { rerender } = renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'Alice');
		await user.click(screen.getByLabelText('Send friend request'));

		await waitFor(() => {
			expect(screen.getByRole('status')).toBeInTheDocument();
		});

		rerender(<AddFriendForm isOpen={false} onRequestSent={mockOnRequestSent} />);

		expect(screen.getByLabelText("Friend's nickname")).toHaveValue('');
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	// ─── Message clears on typing ────────────────────────────────────────

	it('clears message when user types', async () => {
		const user = userEvent.setup();
		renderForm();

		await user.type(screen.getByLabelText("Friend's nickname"), 'Alice');
		await user.click(screen.getByLabelText('Send friend request'));

		await waitFor(() => {
			expect(screen.getByRole('status')).toBeInTheDocument();
		});

		await user.type(screen.getByLabelText("Friend's nickname"), 'B');

		expect(screen.queryByRole('status')).not.toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	// ─── Accessibility ──────────────────────────────────────────────────

	it('has accessible labels on input and button', () => {
		renderForm();

		expect(screen.getByLabelText("Friend's nickname")).toHaveAttribute('type', 'text');
		expect(screen.getByLabelText('Send friend request')).toHaveAttribute('type', 'submit');
	});

	it('submits on Enter key', async () => {
		const user = userEvent.setup();
		renderForm();

		const input = screen.getByLabelText("Friend's nickname");
		await user.type(input, 'Alice{Enter}');

		await waitFor(() => {
			expect(screen.getByRole('status')).toHaveTextContent('Request sent to Alice!');
		});
	});
});
