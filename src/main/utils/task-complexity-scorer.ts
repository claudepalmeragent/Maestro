/**
 * task-complexity-scorer.ts
 *
 * Scores task complexity as SMALL / MEDIUM / LARGE based on
 * structured metadata (Auto Run docs) or heuristic analysis
 * (interactive prompts).
 *
 * Used by capacity-checker.ts to estimate token consumption
 * before starting a task.
 *
 * @see Investigation plan Section 23.2.3
 */

export type TaskComplexity = 'SMALL' | 'MEDIUM' | 'LARGE';

export interface TaskDescriptor {
	// Auto Run fields (from doc parsing)
	numTasks?: number;
	numFilesTouched?: number;
	numPlannedInsertions?: number;
	totalLinesToInsert?: number;
	numNewFiles?: number;
	numAutoRunDocs?: number;

	// Interactive fields (from prompt analysis)
	promptLength?: number;
	referencedFileCount?: number;
	promptComplexityHint?: 'simple' | 'moderate' | 'complex';
}

/**
 * Score a task's complexity based on available metadata.
 */
export function scoreTaskComplexity(task: TaskDescriptor): TaskComplexity {
	let score = 0;

	// Auto Run scoring (structured, reliable)
	if (task.numTasks) score += task.numTasks * 3;
	if (task.numFilesTouched) score += task.numFilesTouched * 2;
	if (task.numPlannedInsertions) score += task.numPlannedInsertions * 1;
	if (task.totalLinesToInsert) score += task.totalLinesToInsert / 50;
	if (task.numNewFiles) score += task.numNewFiles * 5;

	// Interactive scoring (heuristic, less precise)
	if (task.promptLength) {
		score += task.promptLength > 500 ? 5 : task.promptLength > 200 ? 2 : 0;
	}
	if (task.referencedFileCount) score += task.referencedFileCount * 2;
	if (task.promptComplexityHint === 'complex') score += 10;
	else if (task.promptComplexityHint === 'moderate') score += 5;

	// Batch multiplier for Auto Run
	if (task.numAutoRunDocs && task.numAutoRunDocs > 1) {
		score *= 1 + (task.numAutoRunDocs - 1) * 0.3;
	}

	if (score < 15) return 'SMALL';
	if (score <= 40) return 'MEDIUM';
	return 'LARGE';
}

/**
 * Map complexity bucket to estimated % of 5-hr window.
 */
export function complexityToEstimatedPct(complexity: TaskComplexity): number {
	switch (complexity) {
		case 'SMALL':
			return 12;
		case 'MEDIUM':
			return 20;
		case 'LARGE':
			return 30;
	}
}

/**
 * Analyze a user prompt for complexity hints.
 */
export function analyzePromptComplexity(prompt: string): 'simple' | 'moderate' | 'complex' {
	const lower = prompt.toLowerCase();

	// Simple patterns
	const simplePatterns = [
		'fix typo',
		'rename',
		'add comment',
		'update import',
		'change name',
		'fix spelling',
		'remove unused',
	];
	if (prompt.length < 100 || simplePatterns.some((p) => lower.includes(p))) {
		return 'simple';
	}

	// Complex patterns
	const complexPatterns = [
		'refactor',
		'implement',
		'add feature',
		'rewrite',
		'migrate',
		'integrate',
		'redesign',
		'create new',
		'build',
	];

	// Count file references (patterns like /path/to/file or file.ext)
	const fileRefCount = (prompt.match(/\b[\w/-]+\.\w{1,5}\b/g) || []).length;

	if (complexPatterns.some((p) => lower.includes(p)) || fileRefCount >= 3) {
		return 'complex';
	}

	return 'moderate';
}

/**
 * Extract a TaskDescriptor from an Auto Run document's content.
 */
export function extractAutoRunDescriptor(docContent: string): TaskDescriptor {
	// Count tasks: lines matching "- [ ] **Task N:"
	const taskMatches = docContent.match(/^- \[ \] \*\*Task \d+/gm);
	const numTasks = taskMatches ? taskMatches.length : 0;

	// Count files to create
	const createMatches = docContent.match(/^- `[^`]+`/gm);
	const numNewFiles = createMatches ? createMatches.length : 0;

	// Count files mentioned in "Files to Modify"
	const modifySection = docContent.match(/## Files to Modify[\s\S]*?(?=## |$)/);
	const modifyMatches = modifySection ? (modifySection[0].match(/^- `/gm) || []).length : 0;

	// Estimate lines to insert from code blocks
	const codeBlocks = docContent.match(/```[\s\S]*?```/g) || [];
	const totalLinesToInsert = codeBlocks.reduce((sum, block) => {
		return sum + block.split('\n').length - 2; // subtract opening/closing ```
	}, 0);

	return {
		numTasks,
		numFilesTouched: numNewFiles + modifyMatches,
		numNewFiles,
		totalLinesToInsert,
		numPlannedInsertions: numTasks,
	};
}
