/**
 * Reconstruction IPC Handlers
 *
 * These handlers provide access to the historical reconstruction service for
 * reconstructing query-level historical data from Claude Code's JSONL files.
 *
 * Features:
 * - Run historical data reconstruction (preview or actual)
 * - Scan local JSONL files
 * - Optionally scan SSH remote agents
 * - Date range filtering
 */

import { ipcMain, BrowserWindow } from 'electron';
import { logger } from '../../utils/logger';
import { withIpcErrorLogging, CreateHandlerOptions } from '../../utils/ipcHandler';
import {
	reconstructHistoricalData,
	ReconstructionOptions,
	ReconstructionResult,
} from '../../services/historical-reconstruction-service';

const LOG_CONTEXT = '[Reconstruction]';

// Helper to create handler options with consistent context
const handlerOpts = (operation: string): Pick<CreateHandlerOptions, 'context' | 'operation'> => ({
	context: LOG_CONTEXT,
	operation,
});

/**
 * Dependencies for reconstruction handlers
 */
export interface ReconstructionHandlerDependencies {
	getMainWindow: () => BrowserWindow | null;
}

/**
 * Broadcast reconstruction update to renderer
 */
function broadcastReconstructionUpdate(getMainWindow: () => BrowserWindow | null): void {
	const mainWindow = getMainWindow();
	if (mainWindow && !mainWindow.isDestroyed()) {
		mainWindow.webContents.send('reconstruction:updated');
	}
}

/**
 * Register all Reconstruction-related IPC handlers.
 *
 * These handlers provide reconstruction operations:
 * - Start reconstruction (with actual database modifications)
 * - Preview reconstruction (dry run, no modifications)
 */
export function registerReconstructionHandlers(deps: ReconstructionHandlerDependencies): void {
	const { getMainWindow } = deps;

	// Start reconstruction (actual database modifications)
	ipcMain.handle(
		'reconstruction:start',
		withIpcErrorLogging(
			handlerOpts('start'),
			async (options: ReconstructionOptions): Promise<ReconstructionResult> => {
				logger.info('Starting historical reconstruction', LOG_CONTEXT, { options });
				const result = await reconstructHistoricalData({ ...options, dryRun: false });
				broadcastReconstructionUpdate(getMainWindow);
				return result;
			}
		)
	);

	// Preview reconstruction (dry run, no modifications)
	ipcMain.handle(
		'reconstruction:preview',
		withIpcErrorLogging(
			handlerOpts('preview'),
			async (options: ReconstructionOptions): Promise<ReconstructionResult> => {
				logger.info('Running reconstruction preview (dry run)', LOG_CONTEXT, { options });
				const result = await reconstructHistoricalData({ ...options, dryRun: true });
				return result;
			}
		)
	);

	logger.info('Reconstruction IPC handlers registered', LOG_CONTEXT);
}
