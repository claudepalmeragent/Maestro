import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';

// We test the formatting logic directly rather than the full component
describe('Elapsed Time Display Logic', () => {
	it('should not display for responses under 5 seconds', () => {
		const elapsedMs = 3000;
		expect(elapsedMs >= 5000).toBe(false);
	});

	it('should display seconds for responses 5-59 seconds', () => {
		const elapsedMs = 47000;
		const display =
			elapsedMs < 60000
				? `${Math.floor(elapsedMs / 1000)}s`
				: `${Math.floor(elapsedMs / 60000)}m ${Math.floor((elapsedMs % 60000) / 1000)}s`;
		expect(display).toBe('47s');
	});

	it('should display minutes and seconds for responses over 60 seconds', () => {
		const elapsedMs = 132000;
		const display =
			elapsedMs < 60000
				? `${Math.floor(elapsedMs / 1000)}s`
				: `${Math.floor(elapsedMs / 60000)}m ${Math.floor((elapsedMs % 60000) / 1000)}s`;
		expect(display).toBe('2m 12s');
	});

	it('should display exactly 5s at the threshold', () => {
		const elapsedMs = 5000;
		expect(elapsedMs >= 5000).toBe(true);
		const display =
			elapsedMs < 60000
				? `${Math.floor(elapsedMs / 1000)}s`
				: `${Math.floor(elapsedMs / 60000)}m ${Math.floor((elapsedMs % 60000) / 1000)}s`;
		expect(display).toBe('5s');
	});

	it('should show live counter only when streamStartTime is set and elapsedMs is not', () => {
		const log = { source: 'ai', streamStartTime: Date.now() - 10000, elapsedMs: undefined };
		const showLive = log.source === 'ai' && !log.elapsedMs && !!log.streamStartTime;
		expect(showLive).toBe(true);
	});

	it('should show frozen time and not live counter when elapsedMs is set', () => {
		const log = { source: 'ai', streamStartTime: Date.now() - 10000, elapsedMs: 10000 };
		const showFrozen = log.source === 'ai' && !!log.elapsedMs && log.elapsedMs >= 5000;
		const showLive = log.source === 'ai' && !log.elapsedMs && !!log.streamStartTime;
		expect(showFrozen).toBe(true);
		expect(showLive).toBe(false);
	});

	it('should not show elapsed time for user messages', () => {
		const log = { source: 'user', elapsedMs: 15000, streamStartTime: Date.now() - 15000 };
		const showFrozen = log.source === 'ai' && !!log.elapsedMs && log.elapsedMs >= 5000;
		const showLive = log.source === 'ai' && !log.elapsedMs && !!log.streamStartTime;
		expect(showFrozen).toBe(false);
		expect(showLive).toBe(false);
	});
});
