import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../src/contexts/AuthContext';
import type { ReactElement, ReactNode } from 'react';

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
	initialRoute?: string;
	withAuth?: boolean;
}

function createWrapper({ initialRoute = '/', withAuth = true }: CustomRenderOptions) {
	return function Wrapper({ children }: { children: ReactNode }) {
		const content = (
			<MemoryRouter initialEntries={[initialRoute]}>
				{children}
			</MemoryRouter>
		);

		if (withAuth) {
			return <AuthProvider>{content}</AuthProvider>;
		}

		return content;
	};
}

export function render(
	ui: ReactElement,
	options: CustomRenderOptions = {}
) {
	const { initialRoute, withAuth, ...renderOptions } = options;
	return rtlRender(ui, {
		wrapper: createWrapper({ initialRoute, withAuth }),
		...renderOptions,
	});
}

export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
