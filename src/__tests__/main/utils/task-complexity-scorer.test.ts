import { describe, it, expect } from 'vitest';
import {
	scoreTaskComplexity,
	complexityToEstimatedPct,
	analyzePromptComplexity,
	extractAutoRunDescriptor,
	type TaskDescriptor,
} from '../../../main/utils/task-complexity-scorer';

describe('scoreTaskComplexity', () => {
	it('returns SMALL for empty/minimal task descriptor', () => {
		expect(scoreTaskComplexity({})).toBe('SMALL');
	});

	it('returns SMALL for low-scoring tasks', () => {
		const task: TaskDescriptor = { numTasks: 1, numFilesTouched: 1 };
		// score = 1*3 + 1*2 = 5
		expect(scoreTaskComplexity(task)).toBe('SMALL');
	});

	it('returns MEDIUM for moderate tasks', () => {
		const task: TaskDescriptor = { numTasks: 5, numFilesTouched: 3 };
		// score = 5*3 + 3*2 = 21
		expect(scoreTaskComplexity(task)).toBe('MEDIUM');
	});

	it('returns LARGE for complex tasks', () => {
		const task: TaskDescriptor = {
			numTasks: 10,
			numFilesTouched: 8,
			numNewFiles: 3,
		};
		// score = 10*3 + 8*2 + 3*5 = 30 + 16 + 15 = 61
		expect(scoreTaskComplexity(task)).toBe('LARGE');
	});

	it('accounts for promptLength scoring', () => {
		expect(scoreTaskComplexity({ promptLength: 50 })).toBe('SMALL'); // 0 points
		expect(scoreTaskComplexity({ promptLength: 300 })).toBe('SMALL'); // 2 points
		expect(scoreTaskComplexity({ promptLength: 600 })).toBe('SMALL'); // 5 points
	});

	it('accounts for promptComplexityHint', () => {
		expect(scoreTaskComplexity({ promptComplexityHint: 'complex' })).toBe('SMALL'); // 10 points (< 15)
		expect(
			scoreTaskComplexity({
				promptComplexityHint: 'complex',
				referencedFileCount: 3,
			})
		).toBe('MEDIUM'); // 10 + 6 = 16
	});

	it('applies batch multiplier for multiple Auto Run docs', () => {
		const base: TaskDescriptor = { numTasks: 5, numFilesTouched: 3 };
		// base score = 21 → MEDIUM
		expect(scoreTaskComplexity(base)).toBe('MEDIUM');

		const batched: TaskDescriptor = { ...base, numAutoRunDocs: 3 };
		// score = 21 * (1 + 2*0.3) = 21 * 1.6 = 33.6 → MEDIUM still
		expect(scoreTaskComplexity(batched)).toBe('MEDIUM');

		const largeBatch: TaskDescriptor = {
			numTasks: 8,
			numFilesTouched: 5,
			numAutoRunDocs: 4,
		};
		// base = 8*3 + 5*2 = 34, * (1 + 3*0.3) = 34 * 1.9 = 64.6 → LARGE
		expect(scoreTaskComplexity(largeBatch)).toBe('LARGE');
	});

	it('correctly classifies boundary scores', () => {
		// Score exactly 15 → MEDIUM
		const medium: TaskDescriptor = { numTasks: 5 }; // 5*3 = 15
		expect(scoreTaskComplexity(medium)).toBe('MEDIUM');

		// Score exactly 40 → MEDIUM
		const mediumHigh: TaskDescriptor = { numTasks: 8, numFilesTouched: 8 };
		// 8*3 + 8*2 = 40
		expect(scoreTaskComplexity(mediumHigh)).toBe('MEDIUM');

		// Score 41 → LARGE
		const large: TaskDescriptor = { numTasks: 8, numFilesTouched: 8, promptLength: 300 };
		// 8*3 + 8*2 + 2 = 42
		expect(scoreTaskComplexity(large)).toBe('LARGE');
	});
});

describe('complexityToEstimatedPct', () => {
	it('returns correct percentages for each bucket', () => {
		expect(complexityToEstimatedPct('SMALL')).toBe(12);
		expect(complexityToEstimatedPct('MEDIUM')).toBe(20);
		expect(complexityToEstimatedPct('LARGE')).toBe(30);
	});
});

describe('analyzePromptComplexity', () => {
	it('returns simple for short prompts', () => {
		expect(analyzePromptComplexity('fix it')).toBe('simple');
	});

	it('returns simple for prompts with simple patterns', () => {
		expect(
			analyzePromptComplexity('Please fix typo in the README file and update the documentation')
		).toBe('simple');
		expect(analyzePromptComplexity('Rename the function to something more descriptive')).toBe(
			'simple'
		);
	});

	it('returns complex for prompts with complex patterns', () => {
		const prompt =
			'Refactor the authentication module to use JWT tokens instead of sessions. This needs to be updated across all middleware files.';
		expect(analyzePromptComplexity(prompt)).toBe('complex');
	});

	it('returns complex for prompts with many file references', () => {
		const prompt =
			'Update the code in src/auth.ts, src/middleware.ts, src/routes.ts, and tests/auth.test.ts to handle the new API format';
		expect(analyzePromptComplexity(prompt)).toBe('complex');
	});

	it('returns moderate for medium-length prompts without strong signals', () => {
		const prompt =
			'Update the error handling in this component so that when the API returns a 404, we show a friendly message to the user instead of a blank screen';
		expect(analyzePromptComplexity(prompt)).toBe('moderate');
	});
});

describe('extractAutoRunDescriptor', () => {
	it('extracts task count from Auto Run doc', () => {
		const doc = `# Tasks
- [ ] **Task 1: Do something**
- [ ] **Task 2: Do another thing**
- [ ] **Task 3: Final thing**
`;
		const result = extractAutoRunDescriptor(doc);
		expect(result.numTasks).toBe(3);
		expect(result.numPlannedInsertions).toBe(3);
	});

	it('extracts new files from backtick patterns across entire doc', () => {
		const doc = `## Files to Create
- \`/app/src/file1.ts\` — Description
- \`/app/src/file2.ts\` — Description

## Files to Modify
- \`/app/src/existing.ts\` — Modify
`;
		const result = extractAutoRunDescriptor(doc);
		// The regex matches all "- `..." lines across the entire doc
		expect(result.numNewFiles).toBe(3);
	});

	it('counts files in Files to Modify section', () => {
		const doc = `## Files to Create
- \`/app/src/new.ts\`

## Files to Modify
- \`/app/src/old1.ts\` — Change A
- \`/app/src/old2.ts\` — Change B

## Tasks
- [ ] **Task 1: Do it**
`;
		const result = extractAutoRunDescriptor(doc);
		// numNewFiles = 3 (all backtick lines: 1 create + 2 modify)
		// modifyMatches = 2 (lines in Files to Modify section)
		// numFilesTouched = numNewFiles + modifyMatches = 3 + 2 = 5
		expect(result.numFilesTouched).toBe(5);
	});

	it('estimates lines from code blocks', () => {
		const doc = `
\`\`\`typescript
const a = 1;
const b = 2;
const c = 3;
\`\`\`
`;
		const result = extractAutoRunDescriptor(doc);
		// Code block has 5 lines total, minus 2 for ``` delimiters = 3
		expect(result.totalLinesToInsert).toBe(3);
	});

	it('handles empty document', () => {
		const result = extractAutoRunDescriptor('');
		expect(result.numTasks).toBe(0);
		expect(result.numNewFiles).toBe(0);
		expect(result.numFilesTouched).toBe(0);
		expect(result.totalLinesToInsert).toBe(0);
	});
});
