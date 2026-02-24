import { describe, it, expect } from 'vitest';
import {
	resolvePinVariables,
	hasPinVariables,
	getPartialPinVariable,
} from '../../../renderer/utils/pinVariableResolver';
import type { PinnedItem } from '../../../renderer/types';

const testPins: PinnedItem[] = [
	{
		logId: '1',
		tabId: 't',
		text: 'Fix the auth bug in login.ts',
		source: 'user',
		messageTimestamp: 100,
		pinnedAt: 100,
	},
	{
		logId: '2',
		tabId: 't',
		text: 'The error is a null pointer in session.validate()',
		source: 'ai',
		messageTimestamp: 200,
		pinnedAt: 200,
	},
	{
		logId: '3',
		tabId: 't',
		text: 'Deploy config for production environment',
		source: 'user',
		messageTimestamp: 300,
		pinnedAt: 300,
	},
];

describe('resolvePinVariables', () => {
	it('resolves {{PIN:1}} to the first pin text', () => {
		const result = resolvePinVariables('See {{PIN:1}}', testPins);
		expect(result.resolvedText).toBe('See Fix the auth bug in login.ts');
		expect(result.hadVariables).toBe(true);
		expect(result.unresolvedVars).toHaveLength(0);
	});

	it('resolves {{PIN:3}} to the third pin text', () => {
		const result = resolvePinVariables('Deploy: {{PIN:3}}', testPins);
		expect(result.resolvedText).toBe('Deploy: Deploy config for production environment');
	});

	it('resolves {{PIN:"auth"}} to the most recent pin matching "auth"', () => {
		const result = resolvePinVariables('Refer to {{PIN:"auth"}}', testPins);
		expect(result.resolvedText).toBe('Refer to Fix the auth bug in login.ts');
	});

	it('resolves {{PIN:"null pointer"}} by content search', () => {
		const result = resolvePinVariables('Error: {{PIN:"null pointer"}}', testPins);
		expect(result.resolvedText).toBe('Error: The error is a null pointer in session.validate()');
	});

	it('leaves unresolved variables when index is out of range', () => {
		const result = resolvePinVariables('See {{PIN:99}}', testPins);
		expect(result.resolvedText).toBe('See {{PIN:99}}');
		expect(result.unresolvedVars).toEqual(['{{PIN:99}}']);
	});

	it('leaves unresolved variables when search has no match', () => {
		const result = resolvePinVariables('See {{PIN:"nonexistent"}}', testPins);
		expect(result.resolvedText).toBe('See {{PIN:"nonexistent"}}');
		expect(result.unresolvedVars).toEqual(['{{PIN:"nonexistent"}}']);
	});

	it('resolves multiple variables in one string', () => {
		const result = resolvePinVariables('{{PIN:1}} and {{PIN:2}}', testPins);
		expect(result.resolvedText).toBe(
			'Fix the auth bug in login.ts and The error is a null pointer in session.validate()'
		);
	});

	it('returns hadVariables=false when no variables present', () => {
		const result = resolvePinVariables('No variables here', testPins);
		expect(result.hadVariables).toBe(false);
		expect(result.resolvedText).toBe('No variables here');
	});
});

describe('hasPinVariables', () => {
	it('returns true for text with {{PIN:...}}', () => {
		expect(hasPinVariables('See {{PIN:1}}')).toBe(true);
	});

	it('returns false for text without pin variables', () => {
		expect(hasPinVariables('No variables')).toBe(false);
	});

	it('returns true for partial pin variable', () => {
		expect(hasPinVariables('See {{PIN:')).toBe(true);
	});
});

describe('getPartialPinVariable', () => {
	it('returns partial when cursor is inside {{ }}', () => {
		const result = getPartialPinVariable('Hello {{PIN:', 12);
		expect(result).toEqual({ start: 6, partial: 'PIN:' });
	});

	it('returns null when cursor is not inside {{ }}', () => {
		const result = getPartialPinVariable('Hello world', 5);
		expect(result).toBeNull();
	});

	it('returns null after closing }}', () => {
		const result = getPartialPinVariable('Hello {{PIN:1}} world', 17);
		expect(result).toBeNull();
	});

	it('returns partial with search text', () => {
		const result = getPartialPinVariable('See {{PIN:"auth', 15);
		expect(result).toEqual({ start: 4, partial: 'PIN:"auth' });
	});
});
