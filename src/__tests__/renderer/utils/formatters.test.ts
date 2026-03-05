import { describe, it, expect } from 'vitest';
import { sanitizePreviewText } from '../../../renderer/utils/formatters';

describe('sanitizePreviewText', () => {
	it('should replace literal \\n escape sequences with spaces', () => {
		expect(sanitizePreviewText('Hello\\nWorld')).toBe('Hello World');
	});

	it('should replace literal \\r escape sequences with spaces', () => {
		expect(sanitizePreviewText('Hello\\rWorld')).toBe('Hello World');
	});

	it('should replace literal \\t escape sequences with spaces', () => {
		expect(sanitizePreviewText('Hello\\tWorld')).toBe('Hello World');
	});

	it('should replace real newline characters with spaces', () => {
		expect(sanitizePreviewText('Hello\nWorld')).toBe('Hello World');
	});

	it('should replace real carriage return characters with spaces', () => {
		expect(sanitizePreviewText('Hello\rWorld')).toBe('Hello World');
	});

	it('should replace real tab characters with spaces', () => {
		expect(sanitizePreviewText('Hello\tWorld')).toBe('Hello World');
	});

	it('should collapse multiple spaces into single space', () => {
		expect(sanitizePreviewText('Hello   World')).toBe('Hello World');
	});

	it('should handle mixed escape sequences and real characters', () => {
		expect(sanitizePreviewText('Line1\\nLine2\nLine3\\r\\nLine4')).toBe('Line1 Line2 Line3 Line4');
	});

	it('should trim leading and trailing whitespace', () => {
		expect(sanitizePreviewText('  Hello World  ')).toBe('Hello World');
	});

	it('should handle empty string', () => {
		expect(sanitizePreviewText('')).toBe('');
	});

	it('should handle string with only escape sequences', () => {
		expect(sanitizePreviewText('\\n\\r\\t')).toBe('');
	});

	it('should preserve normal text without modifications', () => {
		expect(sanitizePreviewText('Hello, can you help me with React?')).toBe(
			'Hello, can you help me with React?'
		);
	});

	it('should handle realistic remote shell output with literal escapes', () => {
		const remoteText = 'I can help you with that.\\n\\nHere is my approach:\\n1. First step';
		expect(sanitizePreviewText(remoteText)).toBe(
			'I can help you with that. Here is my approach: 1. First step'
		);
	});

	it('should handle realistic local JSON.parse output with real newlines', () => {
		const localText = 'I can help you with that.\n\nHere is my approach:\n1. First step';
		expect(sanitizePreviewText(localText)).toBe(
			'I can help you with that. Here is my approach: 1. First step'
		);
	});
});
