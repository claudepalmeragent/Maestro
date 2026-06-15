/**
 * Preload API for Feedback operations
 *
 * Fork-only `createFeedbackApi()` exposes the like/dislike RLM feedback
 * recording surface (window.maestro.feedback.record / getAll).
 *
 * Upstream's `createGhFeedbackApi()` exposes the GitHub-issue feedback
 * submission surface (auth check, submit, compose-prompt, search-issues,
 * subscribe-issue).
 */

import { ipcRenderer } from 'electron';

/**
 * Type for the fork-only like/dislike feedback API.
 */
export type FeedbackApi = ReturnType<typeof createFeedbackApi>;

/**
 * Feedback auth check response
 */
export interface FeedbackAuthResponse {
	authenticated: boolean;
	message?: string;
}

/**
 * Feedback submission response
 */
export interface FeedbackSubmitResponse {
	success: boolean;
	error?: string;
	issueUrl?: string;
}

export interface FeedbackAttachmentPayload {
	name: string;
	dataUrl: string;
}

export type FeedbackCategory =
	| 'bug_report'
	| 'feature_request'
	| 'improvement'
	| 'general_feedback';

export interface FeedbackSubmissionPayload {
	sessionId: string;
	category: FeedbackCategory;
	summary: string;
	expectedBehavior: string;
	details: string;
	reproductionSteps?: string;
	additionalContext?: string;
	agentProvider?: string;
	sshRemoteEnabled?: boolean;
	attachments?: FeedbackAttachmentPayload[];
}

export interface FeedbackConversationSubmitPayload {
	category: FeedbackCategory;
	summary: string;
	expectedBehavior: string;
	actualBehavior: string;
	reproductionSteps?: string;
	additionalContext?: string;
	agentProvider?: string;
	sshRemoteEnabled?: boolean;
	attachments?: FeedbackAttachmentPayload[];
	includeDebugPackage?: boolean;
}

/**
 * GitHub feedback API surface (upstream-introduced).
 */
export interface GhFeedbackApi {
	/**
	 * Check whether gh CLI is available and authenticated
	 */
	checkGhAuth: () => Promise<FeedbackAuthResponse>;
	/**
	 * Submit structured user feedback and create a GitHub issue
	 */
	submit: (payload: FeedbackSubmissionPayload) => Promise<FeedbackSubmitResponse>;
	composePrompt: (
		feedbackText: string,
		attachments?: FeedbackAttachmentPayload[]
	) => Promise<{ prompt: string }>;
	/**
	 * Get the conversation system prompt for the feedback chat interface
	 */
	getConversationPrompt: () => Promise<{ prompt: string; environment: string }>;
	/**
	 * Submit feedback from the conversational interface
	 */
	submitConversation: (
		payload: FeedbackConversationSubmitPayload
	) => Promise<FeedbackSubmitResponse>;
	/**
	 * Search existing GitHub issues for potential duplicates
	 */
	searchIssues: (query: string) => Promise<{
		issues: Array<{
			number: number;
			title: string;
			url: string;
			state: string;
			labels: string[];
			createdAt: string;
			author: string;
			commentCount: number;
		}>;
	}>;
	/**
	 * Subscribe to an existing issue (+1 reaction) and optionally comment
	 */
	subscribeIssue: (issueNumber: number, comment?: string) => Promise<FeedbackSubmitResponse>;
}

/**
 * Creates the fork-only like/dislike feedback API object for preload exposure.
 */
export function createFeedbackApi() {
	return {
		/**
		 * Record feedback for an AI response
		 */
		record: (entry: {
			rating: 'liked' | 'disliked';
			sessionId: string;
			sessionName?: string;
			tabId?: string;
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

/**
 * Creates the upstream GitHub-issue feedback API object for preload exposure.
 */
export function createGhFeedbackApi(): GhFeedbackApi {
	return {
		checkGhAuth: (): Promise<FeedbackAuthResponse> => ipcRenderer.invoke('feedback:check-gh-auth'),

		submit: (payload: FeedbackSubmissionPayload): Promise<FeedbackSubmitResponse> =>
			ipcRenderer.invoke('feedback:submit', {
				...payload,
				attachments: payload.attachments ?? [],
			}),

		composePrompt: (
			feedbackText: string,
			attachments: FeedbackAttachmentPayload[] = []
		): Promise<{ prompt: string }> =>
			ipcRenderer.invoke('feedback:compose-prompt', { feedbackText, attachments }),

		getConversationPrompt: (): Promise<{ prompt: string; environment: string }> =>
			ipcRenderer.invoke('feedback:get-conversation-prompt'),

		submitConversation: (
			payload: FeedbackConversationSubmitPayload
		): Promise<FeedbackSubmitResponse> =>
			ipcRenderer.invoke('feedback:submit-conversation', payload),

		searchIssues: (query: string) => ipcRenderer.invoke('feedback:search-issues', { query }),

		subscribeIssue: (issueNumber: number, comment?: string): Promise<FeedbackSubmitResponse> =>
			ipcRenderer.invoke('feedback:subscribe-issue', { issueNumber, comment }),
	};
}
