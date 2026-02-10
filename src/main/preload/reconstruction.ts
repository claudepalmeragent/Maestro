/**
 * Preload API for historical data reconstruction operations
 *
 * Provides the window.maestro.reconstruction namespace for:
 * - Running historical data reconstruction
 * - Previewing reconstruction (dry run)
 * - Subscribing to reconstruction updates
 */

import { ipcRenderer } from 'electron';

/**
 * SSH configuration for fetching remote JSONL data
 */
export interface SshConfig {
	host: string;
	user: string;
	identityFile?: string;
}

/**
 * Options for the reconstruction process
 */
export interface ReconstructionOptions {
	/** Include local agent data (default: true) */
	includeLocalAgents?: boolean;
	/** Include SSH remote agent data (default: false) */
	includeSshRemotes?: boolean;
	/** SSH remote configurations for fetching remote data */
	sshConfigs?: SshConfig[];
	/** Optional date range filter */
	dateRange?: {
		start?: string;
		end?: string;
	};
}

/**
 * Result of a reconstruction operation
 */
export interface ReconstructionResult {
	/** Total number of queries found in JSONL files */
	queriesFound: number;
	/** Number of new records inserted */
	queriesInserted: number;
	/** Number of existing records updated with missing values */
	queriesUpdated: number;
	/** Number of records skipped (already complete) */
	queriesSkipped: number;
	/** Date range covered by the processed data */
	dateRangeCovered: { start: string; end: string } | null;
	/** Errors encountered during processing */
	errors: Array<{ file: string; error: string }>;
	/** Total duration in milliseconds */
	duration: number;
}

/**
 * Creates the Reconstruction API object for preload exposure
 */
export function createReconstructionApi() {
	return {
		/**
		 * Start historical data reconstruction.
		 * This will modify the database by inserting/updating records.
		 *
		 * @param options - Reconstruction options
		 * @returns The reconstruction result with statistics
		 */
		start: (options?: ReconstructionOptions): Promise<ReconstructionResult> =>
			ipcRenderer.invoke('reconstruction:start', options || {}),

		/**
		 * Preview reconstruction (dry run).
		 * This will NOT modify the database - just reports what would be done.
		 *
		 * @param options - Reconstruction options
		 * @returns The reconstruction preview result
		 */
		preview: (options?: ReconstructionOptions): Promise<ReconstructionResult> =>
			ipcRenderer.invoke('reconstruction:preview', options || {}),

		/**
		 * Subscribe to reconstruction updates.
		 * Called when reconstruction completes.
		 *
		 * @param callback - Function to call when reconstruction updates occur
		 * @returns Unsubscribe function
		 */
		onReconstructionUpdate: (callback: () => void) => {
			const handler = () => callback();
			ipcRenderer.on('reconstruction:updated', handler);
			return () => ipcRenderer.removeListener('reconstruction:updated', handler);
		},
	};
}

export type ReconstructionApi = ReturnType<typeof createReconstructionApi>;
