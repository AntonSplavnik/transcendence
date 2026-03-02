import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
	assetsInclude: ['**/*.glb'],
	server: {
		proxy: {
			'/api': {
				target: 'https://127.0.0.1:8443',
				changeOrigin: true,
				secure: false,
			},
		},
	},
	optimizeDeps: {
		exclude: ['@bokuweb/zstd-wasm'],
	},
})
