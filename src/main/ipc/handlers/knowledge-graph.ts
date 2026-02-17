import { ipcMain, app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

const KNOWLEDGE_GRAPH_DIR = 'knowledge_graph';

async function ensureKnowledgeGraphDir(): Promise<string> {
	const dataDir = app.getPath('userData');
	const kgDir = path.join(dataDir, KNOWLEDGE_GRAPH_DIR);
	await fs.mkdir(kgDir, { recursive: true });
	return kgDir;
}

function sanitizeFilename(name: string): string {
	return name.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
}

function formatTimestamp(ts: number): string {
	const d = new Date(ts);
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

export function registerKnowledgeGraphHandlers(): void {
	ipcMain.handle(
		'knowledgeGraph:save',
		async (
			_event,
			entry: {
				sessionName: string;
				sessionId: string;
				agentType: string;
				projectPath: string;
				projectName: string;
				summary: string;
				detailedLearnings: string;
				totalQueries?: number;
				totalCost?: number;
				contextUsage?: number;
				timestamp: number;
			}
		) => {
			const kgDir = await ensureKnowledgeGraphDir();
			const filename = `${sanitizeFilename(entry.sessionName)}_${formatTimestamp(entry.timestamp)}.md`;
			const filepath = path.join(kgDir, filename);

			const content = `# Knowledge Gained: ${entry.sessionName}

**Date**: ${new Date(entry.timestamp).toLocaleString()}
**Agent**: ${entry.agentType}
**Project**: ${entry.projectPath}

## Summary
${entry.summary || 'No summary available.'}

## Detailed Learnings
${entry.detailedLearnings || 'No detailed learnings recorded.'}

## Session Statistics
- Total Queries: ${entry.totalQueries ?? 'N/A'}
- Total Cost: ${entry.totalCost != null ? `$${entry.totalCost.toFixed(4)}` : 'N/A'}
- Context Usage: ${entry.contextUsage != null ? `${entry.contextUsage.toFixed(1)}%` : 'N/A'}
`;

			await fs.writeFile(filepath, content, 'utf-8');
			return filepath;
		}
	);

	ipcMain.handle('knowledgeGraph:list', async () => {
		const kgDir = await ensureKnowledgeGraphDir();
		const files = await fs.readdir(kgDir);
		return files
			.filter((f) => f.endsWith('.md'))
			.sort()
			.reverse();
	});

	ipcMain.handle('knowledgeGraph:read', async (_event, filename: string) => {
		const kgDir = await ensureKnowledgeGraphDir();
		const filepath = path.join(kgDir, filename);
		return fs.readFile(filepath, 'utf-8');
	});

	ipcMain.handle('knowledgeGraph:delete', async (_event, filename: string) => {
		const kgDir = await ensureKnowledgeGraphDir();
		const filepath = path.join(kgDir, filename);
		await fs.unlink(filepath);
		return true;
	});
}
