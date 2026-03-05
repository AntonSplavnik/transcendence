import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
	plugins: [react()],
	test: {
		environment: 'jsdom',
		setupFiles: ['./vitest.setup.ts'],
		include: ['tests/**/*.test.{ts,tsx}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/**',
				'tests/**',
				'src/main.tsx',
				'src/**/*.d.ts',
				'src/components/GameBoard/**',
				'*.config.*',
			],
			thresholds: {
				statements: 70,
				lines: 70,
				functions: 70,
				branches: 65,
			},
		},
		globals: true,
	},
});
