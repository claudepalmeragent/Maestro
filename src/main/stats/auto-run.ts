/**
 * Auto Run CRUD Operations
 *
 * Handles insertion, updating, and retrieval of Auto Run sessions and tasks.
 */

import type Database from 'better-sqlite3';
import type { AutoRunSession, AutoRunTask, StatsTimeRange } from '../../shared/stats-types';
import { generateId, getTimeRangeStart, normalizePath, LOG_CONTEXT } from './utils';
import {
	mapAutoRunSessionRow,
	mapAutoRunTaskRow,
	type AutoRunSessionRow,
	type AutoRunTaskRow,
} from './row-mappers';
import { StatementCache } from './utils';
import { logger } from '../utils/logger';

const stmtCache = new StatementCache();

// ============================================================================
// Auto Run Sessions
// ============================================================================

const INSERT_SESSION_SQL = `
  INSERT INTO auto_run_sessions (id, session_id, agent_type, document_path, start_time, duration, tasks_total, tasks_completed, project_path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Insert a new Auto Run session
 */
export function insertAutoRunSession(
	db: Database.Database,
	session: Omit<AutoRunSession, 'id'>
): string {
	const id = generateId();
	const stmt = stmtCache.get(db, INSERT_SESSION_SQL);

	stmt.run(
		id,
		session.sessionId,
		session.agentType,
		normalizePath(session.documentPath),
		session.startTime,
		session.duration,
		session.tasksTotal ?? null,
		session.tasksCompleted ?? null,
		normalizePath(session.projectPath)
	);

	logger.debug(`Inserted Auto Run session ${id}`, LOG_CONTEXT);
	return id;
}

/**
 * Update an existing Auto Run session (e.g., when it completes)
 */
export function updateAutoRunSession(
	db: Database.Database,
	id: string,
	updates: Partial<AutoRunSession>
): boolean {
	const setClauses: string[] = [];
	const params: (string | number | null)[] = [];

	if (updates.duration !== undefined) {
		setClauses.push('duration = ?');
		params.push(updates.duration);
	}
	if (updates.tasksTotal !== undefined) {
		setClauses.push('tasks_total = ?');
		params.push(updates.tasksTotal ?? null);
	}
	if (updates.tasksCompleted !== undefined) {
		setClauses.push('tasks_completed = ?');
		params.push(updates.tasksCompleted ?? null);
	}
	if (updates.documentPath !== undefined) {
		setClauses.push('document_path = ?');
		params.push(normalizePath(updates.documentPath));
	}

	if (setClauses.length === 0) {
		return false;
	}

	params.push(id);
	const sql = `UPDATE auto_run_sessions SET ${setClauses.join(', ')} WHERE id = ?`;
	const stmt = db.prepare(sql);
	const result = stmt.run(...params);

	logger.debug(`Updated Auto Run session ${id}`, LOG_CONTEXT);
	return result.changes > 0;
}

/**
 * Get Auto Run sessions within a time range
 */
export function getAutoRunSessions(db: Database.Database, range: StatsTimeRange): AutoRunSession[] {
	const startTime = getTimeRangeStart(range);
	const stmt = stmtCache.get(
		db,
		`
      SELECT * FROM auto_run_sessions
      WHERE start_time >= ?
      ORDER BY start_time DESC
    `
	);

	const rows = stmt.all(startTime) as AutoRunSessionRow[];
	return rows.map(mapAutoRunSessionRow);
}

// ============================================================================
// Auto Run Tasks
// ============================================================================

const INSERT_TASK_SQL = `
  INSERT INTO auto_run_tasks (id, auto_run_session_id, session_id, agent_type, task_index, task_content, start_time, duration, success, tasks_completed_count)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

/**
 * Insert a new Auto Run task
 */
export function insertAutoRunTask(db: Database.Database, task: Omit<AutoRunTask, 'id'>): string {
	const id = generateId();
	const stmt = stmtCache.get(db, INSERT_TASK_SQL);

	stmt.run(
		id,
		task.autoRunSessionId,
		task.sessionId,
		task.agentType,
		task.taskIndex,
		task.taskContent ?? null,
		task.startTime,
		task.duration,
		task.success ? 1 : 0,
		task.tasksCompletedCount ?? null
	);

	logger.debug(`Inserted Auto Run task ${id}`, LOG_CONTEXT);
	return id;
}

/**
 * Get all tasks for a specific Auto Run session
 */
export function getAutoRunTasks(db: Database.Database, autoRunSessionId: string): AutoRunTask[] {
	const stmt = stmtCache.get(
		db,
		`
      SELECT * FROM auto_run_tasks
      WHERE auto_run_session_id = ?
      ORDER BY task_index ASC
    `
	);

	const rows = stmt.all(autoRunSessionId) as AutoRunTaskRow[];
	return rows.map(mapAutoRunTaskRow);
}

/**
 * Reconstruct orphaned Auto Run sessions where endAutoRun() was never called.
 *
 * Orphaned sessions have tasks_completed = NULL and/or duration = 0.
 * Reconstruction uses child task rows to estimate:
 * - tasks_completed: COUNT of successful task rows (approximate — each row is an agent call)
 * - duration: MAX(task.start_time + task.duration) - session.start_time
 *
 * If the tasks_completed_count column exists (migration v9+), uses SUM of that instead.
 *
 * Returns the number of sessions reconstructed.
 */
export function reconstructOrphanedSessions(db: Database.Database): number {
	try {
		// Find orphaned sessions (NULL tasks_completed or duration = 0)
		const orphans = db
			.prepare(
				`
			SELECT id, start_time, duration, tasks_completed
			FROM auto_run_sessions
			WHERE tasks_completed IS NULL OR duration = 0
		`
			)
			.all() as Array<{
			id: string;
			start_time: number;
			duration: number;
			tasks_completed: number | null;
		}>;

		if (orphans.length === 0) {
			return 0;
		}

		logger.info(
			`Found ${orphans.length} orphaned Auto Run session(s), attempting reconstruction`,
			LOG_CONTEXT
		);

		// Check if tasks_completed_count column exists (migration v9)
		const columns = (db.pragma('table_info(auto_run_tasks)') ?? []) as Array<{ name: string }>;
		const hasTasksCompletedCount =
			Array.isArray(columns) && columns.some((c) => c.name === 'tasks_completed_count');

		let reconstructed = 0;

		for (const orphan of orphans) {
			// Get task stats for this session
			const taskStats = db
				.prepare(
					`
				SELECT
					COUNT(*) as task_count,
					COUNT(CASE WHEN success = 1 THEN 1 END) as success_count,
					MAX(start_time + duration) as last_task_end
					${hasTasksCompletedCount ? ', SUM(CASE WHEN success = 1 THEN COALESCE(tasks_completed_count, 1) ELSE 0 END) as total_tasks_completed' : ''}
				FROM auto_run_tasks
				WHERE auto_run_session_id = ?
			`
				)
				.get(orphan.id) as {
				task_count: number;
				success_count: number;
				last_task_end: number | null;
				total_tasks_completed?: number;
			};

			if (!taskStats || taskStats.task_count === 0) {
				logger.warn(`Orphaned session ${orphan.id} has no task rows, skipping`, LOG_CONTEXT);
				continue;
			}

			const updates: Partial<{ duration: number; tasksCompleted: number }> = {};

			// Reconstruct tasks_completed if NULL
			if (orphan.tasks_completed === null) {
				updates.tasksCompleted =
					hasTasksCompletedCount && taskStats.total_tasks_completed
						? taskStats.total_tasks_completed
						: taskStats.success_count;
			}

			// Reconstruct duration if 0
			if (orphan.duration === 0 && taskStats.last_task_end) {
				updates.duration = taskStats.last_task_end - orphan.start_time;
			}

			if (Object.keys(updates).length > 0) {
				updateAutoRunSession(db, orphan.id, updates);
				reconstructed++;
				logger.info(`Reconstructed session ${orphan.id}: ${JSON.stringify(updates)}`, LOG_CONTEXT);
			}
		}

		return reconstructed;
	} catch (error) {
		// Non-fatal — reconstruction is best-effort data repair
		logger.warn(`Failed to reconstruct orphaned sessions: ${error}`, LOG_CONTEXT);
		return 0;
	}
}

/**
 * Clear the statement cache (call when database is closed)
 */
export function clearAutoRunCache(): void {
	stmtCache.clear();
}
