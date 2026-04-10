import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	esbuild: {
		pure: ['console.log', 'console.debug', 'console.info', 'console.warn'],
	},
	optimizeDeps: {
		exclude: ['@jsquash/resize', '@jsquash/avif', '@bokuweb/zstd-wasm'],
	},
	worker: {
		format: 'es'
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/api': {
				target: 'https://127.0.0.1:8443',
				changeOrigin: true,
				secure: false,
			},
		},
	},
})
