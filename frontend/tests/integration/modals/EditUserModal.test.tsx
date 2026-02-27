import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent, fireEvent } from '../../helpers/render';
import EditUserModal from '../../../src/components/modals/EditUserModal';
import { server } from '../../helpers/msw-handlers';
import { http, HttpResponse } from 'msw';
import { createMockUser } from '../../fixtures/users';
import { createMockApiError } from '../../fixtures/errors';

vi.mock('../../../src/utils/avatarConverter', () => ({
	convertToAvatarAvif: vi.fn(),
}));

URL.createObjectURL = vi.fn(() => 'blob:mock-url');
URL.revokeObjectURL = vi.fn();

describe('EditUserModal', () => {
	const mockOnClose = vi.fn();
	const mockOnAvatarChanged = vi.fn();
	const mockOnDescriptionChanged = vi.fn();
	const mockUser = createMockUser();

	beforeEach(() => {
		vi.clearAllMocks();
		server.use(
			http.get('/api/avatar/:userId/:size', () => {
				return new HttpResponse(new Blob([''], { type: 'image/avif' }), {
					headers: { 'Content-Type': 'image/avif' },
				});
			}),
		);
	});

	const renderModal = (description = '') => render(
		<EditUserModal
			user={mockUser}
			description={description}
			onClose={mockOnClose}
			onAvatarChanged={mockOnAvatarChanged}
			onDescriptionChanged={mockOnDescriptionChanged}
		/>
	);

	// --- Render ---

	it('renders with title "Edit Profile"', () => {
		renderModal();
		expect(screen.getByText('Edit Profile')).toBeInTheDocument();
	});

	it('renders description textarea with initial value', () => {
		renderModal('Hello world');
		expect(screen.getByLabelText('Description')).toHaveValue('Hello world');
	});

	it('shows character count', () => {
		renderModal('Hello');
		expect(screen.getByText('5/50')).toBeInTheDocument();
	});

	it('updates character count as user types', async () => {
		const user = userEvent.setup();
		renderModal('');
		await user.type(screen.getByLabelText('Description'), 'Hi');
		expect(screen.getByText('2/50')).toBeInTheDocument();
	});

	// --- Description validation ---

	it('shows error when description exceeds 50 characters', async () => {
		const user = userEvent.setup();
		renderModal('');
		await user.type(screen.getByLabelText('Description'), 'a'.repeat(51));
		await user.click(screen.getByText('Save'));
		await waitFor(() => {
			expect(screen.getByText('Must be at most 50 characters long.')).toBeInTheDocument();
		});
	});

	it('clears description error when user edits field', async () => {
		const user = userEvent.setup();
		renderModal('');
		await user.type(screen.getByLabelText('Description'), 'a'.repeat(51));
		await user.click(screen.getByText('Save'));
		await waitFor(() => {
			expect(screen.getByText('Must be at most 50 characters long.')).toBeInTheDocument();
		});
		await user.type(screen.getByLabelText('Description'), 'x');
		expect(screen.queryByText('Must be at most 50 characters long.')).not.toBeInTheDocument();
	});

	// --- Description update ---

	it('calls onClose without API call when description is unchanged', async () => {
		const user = userEvent.setup();
		renderModal('Same text');
		await user.click(screen.getByText('Save'));
		await waitFor(() => {
			expect(mockOnClose).toHaveBeenCalled();
		});
		expect(mockOnDescriptionChanged).not.toHaveBeenCalled();
	});

	it('calls onDescriptionChanged and onClose on successful description update', async () => {
		server.use(
			http.put('/api/user/description', () => new HttpResponse(null, { status: 200 })),
		);
		const user = userEvent.setup();
		renderModal('Old');
		await user.clear(screen.getByLabelText('Description'));
		await user.type(screen.getByLabelText('Description'), 'New description');
		await user.click(screen.getByText('Save'));
		await waitFor(() => {
			expect(mockOnDescriptionChanged).toHaveBeenCalledWith('New description');
			expect(mockOnClose).toHaveBeenCalled();
		});
	});

	it('shows error and does not close when description update fails', async () => {
		server.use(
			http.put('/api/user/description', () =>
				HttpResponse.json(
					{ error: createMockApiError({ code: 500, brief: 'InternalError', detail: 'Server error' }) },
					{ status: 500 },
				),
			),
		);
		const user = userEvent.setup();
		renderModal('Old');
		await user.clear(screen.getByLabelText('Description'));
		await user.type(screen.getByLabelText('Description'), 'New');
		await user.click(screen.getByText('Save'));
		await waitFor(() => {
			expect(screen.getByText('Failed to update description')).toBeInTheDocument();
		});
		expect(mockOnClose).not.toHaveBeenCalled();
	});

	it('shows loading state during description update', async () => {
		server.use(
			http.put('/api/user/description', async () => {
				await new Promise(resolve => setTimeout(resolve, 100));
				return new HttpResponse(null, { status: 200 });
			}),
		);
		const user = userEvent.setup();
		renderModal('Old');
		await user.clear(screen.getByLabelText('Description'));
		await user.type(screen.getByLabelText('Description'), 'New');
		await user.click(screen.getByText('Save'));
		expect(screen.getByText('Saving...')).toBeInTheDocument();
	});

	// --- Avatar delete ---

	it('calls onAvatarChanged(null, null) on successful delete', async () => {
		server.use(
			http.delete('/api/avatar', () => new HttpResponse(null, { status: 204 })),
		);
		const user = userEvent.setup();
		renderModal();
		await user.click(screen.getByText('x delete'));
		await waitFor(() => {
			expect(mockOnAvatarChanged).toHaveBeenCalledWith(null, null);
		});
	});

	it('shows error when avatar delete fails', async () => {
		server.use(
			http.delete('/api/avatar', () =>
				HttpResponse.json(
					{ error: createMockApiError({ code: 500, brief: 'InternalError' }) },
					{ status: 500 },
				),
			),
		);
		const user = userEvent.setup();
		renderModal();
		await user.click(screen.getByText('x delete'));
		await waitFor(() => {
			expect(screen.getByText('Failed to delete avatar')).toBeInTheDocument();
		});
	});

	// --- Avatar file validation ---

	it('shows error when a non-image file is selected', async () => {
		renderModal();
		const file = new File(['content'], 'document.pdf', { type: 'application/pdf' });
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		fireEvent.change(input);
		await waitFor(() => {
			expect(screen.getByText('File must be an image.')).toBeInTheDocument();
		});
	});

	it('shows error when image file exceeds 10 MB', async () => {
		renderModal();
		const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'big.png', { type: 'image/png' });
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [largeFile], configurable: true });
		fireEvent.change(input);
		await waitFor(() => {
			expect(screen.getByText('File must be smaller than 10 MB.')).toBeInTheDocument();
		});
	});

	// --- Avatar upload ---

	it('calls onAvatarChanged with blob URLs on successful upload', async () => {
		const { convertToAvatarAvif } = await import('../../../src/utils/avatarConverter');
		vi.mocked(convertToAvatarAvif).mockResolvedValueOnce({
			success: true,
			data: {
				large: new Blob(['large'], { type: 'image/avif' }),
				small: new Blob(['small'], { type: 'image/avif' }),
			},
		});
		server.use(
			http.post('/api/avatar', () => new HttpResponse(null, { status: 200 })),
		);
		renderModal();
		const file = new File(['img'], 'photo.png', { type: 'image/png' });
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		fireEvent.change(input);
		await waitFor(() => {
			expect(mockOnAvatarChanged).toHaveBeenCalledWith('blob:mock-url', 'blob:mock-url');
		});
	});

	it('shows error when avatar conversion fails', async () => {
		const { convertToAvatarAvif } = await import('../../../src/utils/avatarConverter');
		vi.mocked(convertToAvatarAvif).mockResolvedValueOnce({
			success: false,
			error: { type: 'decode', message: 'Conversion failed' },
		});
		renderModal();
		const file = new File(['img'], 'photo.png', { type: 'image/png' });
		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		Object.defineProperty(input, 'files', { value: [file], configurable: true });
		fireEvent.change(input);
		await waitFor(() => {
			expect(screen.getByText('Conversion failed')).toBeInTheDocument();
		});
	});
});
