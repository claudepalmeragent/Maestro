/**
 * Preload API for Feedback operations
 *
 * Provides the window.maestro.feedback namespace for:
 * - Recording user feedback (like/dislike) on AI responses
 * - Retrieving all recorded feedback
 */

import { ipcRenderer } from 'electron';

/**
 * Type for the feedback API
 */
export type FeedbackApi = ReturnType<typeof createFeedbackApi>;

/**
 * Creates the feedback API object for preload exposure
 */
export function createFeedbackApi() {
	return {
		/**
		 * Record feedback for an AI response
		 */
		record: (entry: {
			rating: 'liked' | 'disliked';
			sessionId: string;
			agentType: string;
			userQuery: string;
			aiResponse: string;
			timestamp: number;
			reason?: string;
		}): Promise<boolean> => ipcRenderer.invoke('feedback:record', entry),

		/**
		 * Get all recorded feedback
		 */
		getAll: (): Promise<string> => ipcRenderer.invoke('feedback:getAll'),
	};
}
