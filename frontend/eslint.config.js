import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default defineConfig([
	globalIgnores(['dist']),
	{
		files: ['**/*.{ts,tsx}'],
		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
			reactHooks.configs.flat.recommended,
			reactRefresh.configs.vite,
		],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		rules: {
			// Why this exists:
			// The default rule errors on every unused variable, even when the unused
			// identifier is intentionally kept to document a function signature or to
			// keep a placeholder that matches a future extension point.
			//
			// What this changes:
			// We do NOT weaken the rule globally. We only treat identifiers that
			// start with `_` as intentionally unused. Example:
			//   - `payload`   -> still an error if unused
			//   - `_payload`  -> allowed
			//
			// Why that is acceptable here:
			// Requiring the `_` prefix makes intent explicit in code review and keeps
			// accidental dead code visible. This replaces scattered inline
			// `eslint-disable` comments with one auditable convention.
			//
			// Alternative considered:
			//   1. Remove the parameter entirely.
			//      Not always desirable, because some functions intentionally keep the
			//      full signature as documentation or as a stable extension point.
			//   2. Add one-off `eslint-disable` comments.
			//      We prefer not to suppress the rule inline when a narrower config
			//      can express the policy more clearly and more safely.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
				},
			],
		},
	},
	{
		files: ['src/contexts/*Context.tsx'],
		rules: {
			// Why this exists:
			// `react-refresh/only-export-components` warns when a file exports values
			// that are not React components, because certain export shapes can make
			// Fast Refresh preserve state incorrectly or fall back to a full reload.
			//
			// Our context modules intentionally use the standard React Context shape:
			// one file contains both the provider component and the matching hook:
			//   - `AuthProvider` + `useAuth`
			//   - `StreamProvider` + `useStream`
			//   - `NotificationProvider` + `useNotifications`
			//
			// Keeping each pair together makes the API easier to discover for less
			// experienced React developers: the provider and the hook that depends on
			// it live in the same file and are reviewed together.
			//
			// What this changes exactly:
			// We keep the rule enabled, but only allow these three reviewed hook
			// names next to provider components inside `src/contexts/*Context.tsx`.
			// Any other non-component export in those files will still warn.
			// The rest of the codebase still uses the normal Vite preset unchanged.
			//
			// About `allowConstantExport`:
			// The Vite preset already enables this because constant exports are safe
			// for Fast Refresh. We repeat it here so this scoped override does not
			// accidentally become stricter or behave differently from the preset.
			//
			// Alternative considered:
			// Split every hook into its own separate file only to satisfy the rule.
			// That would remove the override, but it would also spread one small
			// concept across more files without improving runtime behaviour.
			// A narrow file-pattern override is stricter and clearer than multiple
			// inline `eslint-disable` comments.
			'react-refresh/only-export-components': [
				'warn',
				{
					allowConstantExport: true,
					allowExportNames: ['useAuth', 'useStream', 'useNotifications', 'useChat'],
				},
			],
		},
	},
	eslintConfigPrettier,
]);
