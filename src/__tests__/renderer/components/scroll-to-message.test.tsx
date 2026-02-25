import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Scroll-to-message data attributes', () => {
	it('should verify data-message-timestamp attribute pattern', () => {
		// Verify the querySelector pattern used by handleScrollToMessage
		const container = document.createElement('div');
		container.setAttribute('data-terminal-scroll-container', '');

		const msg1 = document.createElement('div');
		msg1.setAttribute('data-message-timestamp', '1700000000000');
		msg1.textContent = 'First message';

		const msg2 = document.createElement('div');
		msg2.setAttribute('data-message-timestamp', '1700000001000');
		msg2.textContent = 'Second message';

		container.appendChild(msg1);
		container.appendChild(msg2);
		document.body.appendChild(container);

		// Exact match
		const found = container.querySelector('[data-message-timestamp="1700000000000"]');
		expect(found).not.toBeNull();
		expect(found!.textContent).toBe('First message');

		// All messages queryable
		const allMessages = container.querySelectorAll('[data-message-timestamp]');
		expect(allMessages.length).toBe(2);

		// Closest match logic
		const targetTimestamp = 1700000000500;
		let closestElement: Element | null = null;
		let closestDiff = Infinity;

		allMessages.forEach((el) => {
			const ts = Number(el.getAttribute('data-message-timestamp'));
			const diff = Math.abs(ts - targetTimestamp);
			if (diff < closestDiff) {
				closestDiff = diff;
				closestElement = el;
			}
		});

		expect(closestElement).not.toBeNull();
		expect(closestElement!.textContent).toBe('First message');
		expect(closestDiff).toBe(500);

		document.body.removeChild(container);
	});

	it('should reject closest match beyond 5 second threshold', () => {
		const container = document.createElement('div');
		const msg = document.createElement('div');
		msg.setAttribute('data-message-timestamp', '1700000000000');
		container.appendChild(msg);

		const targetTimestamp = 1700000010000; // 10 seconds later
		const allMessages = container.querySelectorAll('[data-message-timestamp]');

		let closestDiff = Infinity;
		allMessages.forEach((el) => {
			const ts = Number(el.getAttribute('data-message-timestamp'));
			const diff = Math.abs(ts - targetTimestamp);
			if (diff < closestDiff) {
				closestDiff = diff;
			}
		});

		// Should be beyond 5s threshold
		expect(closestDiff).toBeGreaterThan(5000);
	});
});
