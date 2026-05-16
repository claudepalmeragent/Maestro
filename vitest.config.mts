import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./src/__tests__/setup.ts'],
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		exclude: [
			'node_modules',
			'dist',
			'release',
			// Exclude integration tests that require real API calls or long timeouts,
			// but allow mock-only integration tests (e.g. claude-pty.integration.test.ts).
			'src/__tests__/integration/provider-integration.test.ts',
			'src/__tests__/integration/group-chat-integration.test.ts',
			'src/__tests__/integration/group-chat.integration.test.ts',
			'src/__tests__/integration/cost-tracking.integration.test.ts',
			'src/__tests__/integration/symphony.integration.test.ts',
			'src/__tests__/integration/remote-control.integration.test.ts',
			'src/__tests__/e2e/**',
			'src/__tests__/performance/**',
		],
		testTimeout: 10000,
		hookTimeout: 10000,
		teardownTimeout: 5000,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'text-summary', 'json', 'html'],
			reportsDirectory: './coverage',
			include: ['src/**/*.{ts,tsx}'],
			exclude: [
				'node_modules',
				'dist',
				'src/__tests__/**',
				'**/*.d.ts',
				'src/main/preload.ts', // Electron preload script
			],
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
		},
	},
});
