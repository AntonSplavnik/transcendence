import { describe, it, expect, vi } from 'vitest';
import { render, screen, userEvent, fireEvent } from '../../helpers/render';
import { Dropdown, DropdownItem } from '../../../src/components/ui/Dropdown';

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Render a Dropdown with three labelled items and a named trigger. */
function renderDropdown() {
	return render(
		<Dropdown trigger={<span>Menu</span>}>
			<DropdownItem onClick={vi.fn()}>Alpha</DropdownItem>
			<DropdownItem onClick={vi.fn()}>Beta</DropdownItem>
			<DropdownItem onClick={vi.fn()}>Gamma</DropdownItem>
		</Dropdown>,
		{ withAuth: false },
	);
}

function getTrigger() {
	return screen.getByRole('button', { name: 'Menu' });
}

function getItem(name: string) {
	return screen.getByRole('menuitem', { name });
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('Dropdown keyboard navigation', () => {
	it('focuses the first menu item when the menu opens', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger());

		expect(getItem('Alpha')).toHaveFocus();
	});

	it('moves focus to the next item on ArrowDown', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger()); // Alpha focused
		fireEvent.keyDown(document, { key: 'ArrowDown' });

		expect(getItem('Beta')).toHaveFocus();
	});

	it('wraps ArrowDown forward from the last item to the first', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger()); // Alpha
		fireEvent.keyDown(document, { key: 'ArrowDown' }); // Beta
		fireEvent.keyDown(document, { key: 'ArrowDown' }); // Gamma
		fireEvent.keyDown(document, { key: 'ArrowDown' }); // wraps → Alpha

		expect(getItem('Alpha')).toHaveFocus();
	});

	it('moves focus to the previous item on ArrowUp', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger()); // Alpha
		fireEvent.keyDown(document, { key: 'ArrowDown' }); // Beta
		fireEvent.keyDown(document, { key: 'ArrowUp' }); // back to Alpha

		expect(getItem('Alpha')).toHaveFocus();
	});

	it('wraps ArrowUp backward from the first item to the last', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger()); // Alpha (first)
		fireEvent.keyDown(document, { key: 'ArrowUp' }); // wraps → Gamma (last)

		expect(getItem('Gamma')).toHaveFocus();
	});

	it('jumps to the first item on Home', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger()); // Alpha
		fireEvent.keyDown(document, { key: 'ArrowDown' }); // Beta
		fireEvent.keyDown(document, { key: 'ArrowDown' }); // Gamma
		fireEvent.keyDown(document, { key: 'Home' }); // → Alpha

		expect(getItem('Alpha')).toHaveFocus();
	});

	it('jumps to the last item on End', async () => {
		const user = userEvent.setup();
		renderDropdown();

		await user.click(getTrigger()); // Alpha
		fireEvent.keyDown(document, { key: 'End' }); // → Gamma

		expect(getItem('Gamma')).toHaveFocus();
	});

	it('closes the menu and restores focus to the trigger on Escape', async () => {
		const user = userEvent.setup();
		renderDropdown();

		const trigger = getTrigger();
		await user.click(trigger);
		expect(screen.getByRole('menu')).toBeInTheDocument();

		fireEvent.keyDown(document, { key: 'Escape' });

		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
	});

	it('closes the menu on Tab without restoring focus to the trigger', async () => {
		const user = userEvent.setup();
		render(
			<>
				<Dropdown trigger={<span>Menu</span>}>
					<DropdownItem onClick={vi.fn()}>Alpha</DropdownItem>
				</Dropdown>
				<button data-testid="next-btn">Next</button>
			</>,
			{ withAuth: false },
		);

		await user.click(getTrigger());
		expect(screen.getByRole('menu')).toBeInTheDocument();

		await user.tab(); // Tab closes menu and moves focus naturally

		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		// Tab should NOT restore focus to the trigger — natural tab flow takes over
		expect(getTrigger()).not.toHaveFocus();
	});
});
