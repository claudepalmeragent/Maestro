/**
 * Feedback IPC Handlers
 *
 * Handles recording user feedback (like/dislike) on AI responses.
 * Feedback is stored in a Markdown file for future context and learning.
 */

import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';

const LOG_CONTEXT = '[Feedback]';
const FEEDBACK_DIR = 'feedback';
const LIKED_FILE = 'ResponsesLikedByTheUser.md';

const handlerOpts = (operation: string): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
});

async function ensureFeedbackDir(): Promise<string> {
	const feedbackDir = path.join(app.getPath('userData'), FEEDBACK_DIR);
	await fs.mkdir(feedbackDir, { recursive: true });
	return feedbackDir;
}

async function getLikedFilePath(): Promise<string> {
	const feedbackDir = await ensureFeedbackDir();
	return path.join(feedbackDir, LIKED_FILE);
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
				agentType: string;
				userQuery: string;
				aiResponse: string;
				timestamp: number;
				reason?: string;
			}) => {
				const filepath = await getLikedFilePath();

				// Check if file exists, if not create with header
				let content = '';
				try {
					content = await fs.readFile(filepath, 'utf-8');
				} catch {
					content =
						'# User Response Feedback\n\nThis file tracks AI responses that the user has rated.\n\n---\n\n';
				}

				const ratingEmoji = entry.rating === 'liked' ? '👍' : '👎';
				const responseSummary =
					entry.aiResponse.substring(0, 200) + (entry.aiResponse.length > 200 ? '...' : '');
				const querySummary =
					entry.userQuery.substring(0, 100) + (entry.userQuery.length > 100 ? '...' : '');

				const newEntry = `## Entry: ${new Date(entry.timestamp).toLocaleString()}
**Rating**: ${ratingEmoji} ${entry.rating.toUpperCase()}
**Agent**: ${entry.agentType}
**Session**: ${entry.sessionId}

### User Query
${querySummary}

### AI Response Summary
${responseSummary}
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
			const filepath = await getLikedFilePath();
			try {
				return await fs.readFile(filepath, 'utf-8');
			} catch {
				return '';
			}
		})
	);
}
