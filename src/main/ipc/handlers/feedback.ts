/**
 * Feedback IPC Handlers
 *
 * Handles recording user feedback (like/dislike) on AI responses.
 * Feedback is stored in separate Markdown files for liked vs disliked responses.
 * Full content is preserved (no truncation) for future RLM processing.
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';

const LOG_CONTEXT = '[Feedback]';
const FEEDBACK_DIR = 'feedback';
const LIKED_FILE = 'ResponsesLikedByTheUser.md';
const DISLIKED_FILE = 'ResponsesDislikedByTheUser.md';

const handlerOpts = (operation: string): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
});

async function ensureFeedbackDir(): Promise<string> {
	const feedbackDir = path.join(app.getPath('userData'), FEEDBACK_DIR);
	await fs.mkdir(feedbackDir, { recursive: true });
	return feedbackDir;
}

async function getFeedbackFilePath(rating: 'liked' | 'disliked'): Promise<string> {
	const feedbackDir = await ensureFeedbackDir();
	const filename = rating === 'liked' ? LIKED_FILE : DISLIKED_FILE;
	return path.join(feedbackDir, filename);
}

function getFileHeader(rating: 'liked' | 'disliked'): string {
	if (rating === 'liked') {
		return '# Liked AI Responses\n\nThis file tracks AI responses that the user has positively rated.\nThese represent high-quality responses that should inform future behavior.\n\n---\n\n';
	}
	return '# Disliked AI Responses\n\nThis file tracks AI responses that the user has negatively rated.\nThese represent responses that should be avoided or improved upon.\n\n---\n\n';
}

/**
 * Register all Feedback-related IPC handlers.
 */
export function registerFeedbackHandlers(): void {
	ipcMain.handle(
		'feedback:record',
		withIpcErrorLogging(
			handlerOpts('record'),
			async (entry: {
				rating: 'liked' | 'disliked';
				sessionId: string;
				sessionName?: string;
				tabId?: string;
				agentType: string;
				userQuery: string;
				aiResponse: string;
				timestamp: number;
				reason?: string;
			}) => {
				const filepath = await getFeedbackFilePath(entry.rating);

				// Read existing file or create with appropriate header
				let content = '';
				try {
					content = await fs.readFile(filepath, 'utf-8');
				} catch {
					content = getFileHeader(entry.rating);
				}

				const ratingEmoji = entry.rating === 'liked' ? '👍' : '👎';

				// Full content — no truncation
				const newEntry = `## Entry: ${new Date(entry.timestamp).toLocaleString()}
**Rating**: ${ratingEmoji} ${entry.rating.toUpperCase()}
**Agent**: ${entry.agentType}
**Session**: ${entry.sessionName ? `${entry.sessionName} (${entry.sessionId})` : entry.sessionId}${entry.tabId ? ` | Tab: ${entry.tabId}` : ''}

### User Query
${entry.userQuery}

### AI Response
${entry.aiResponse}
${entry.reason ? `\n### Reason\n${entry.reason}` : ''}

---

`;
				content += newEntry;
				await fs.writeFile(filepath, content, 'utf-8');
				return true;
			}
		)
	);

	ipcMain.handle(
		'feedback:getAll',
		withIpcErrorLogging(handlerOpts('getAll'), async () => {
			const feedbackDir = await ensureFeedbackDir();
			// Return content from both files, concatenated
			let content = '';
			try {
				content += await fs.readFile(path.join(feedbackDir, LIKED_FILE), 'utf-8');
			} catch {
				// File doesn't exist yet — skip
			}
			try {
				content += '\n\n' + (await fs.readFile(path.join(feedbackDir, DISLIKED_FILE), 'utf-8'));
			} catch {
				// File doesn't exist yet — skip
			}
			return content.trim();
		})
	);
}
