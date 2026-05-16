import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import type { TransportMode } from '../../shared/types';

function getSettingsFilePath(): string {
	// electron-store default: app.getPath('userData')/config.json
	// macOS: ~/Library/Application Support/maestro/config.json
	// Windows: %APPDATA%/maestro/config.json
	// Linux: ~/.config/maestro/config.json
	// On CI boxes where Maestro isn't installed, the file won't exist and
	// the reader returns undefined, which falls through to 'legacy-print'.
	switch (process.platform) {
		case 'darwin':
			return path.join(os.homedir(), 'Library', 'Application Support', 'maestro', 'config.json');
		case 'win32':
			return path.join(process.env.APPDATA ?? '', 'maestro', 'config.json');
		default:
			return path.join(os.homedir(), '.config', 'maestro', 'config.json');
	}
}

/**
 * Read the claudeCodeDefaultTransportMode from the on-disk Maestro settings file
 * (the same JSON file the Electron app writes via electron-store).
 *
 * Returns undefined when:
 *   - The settings file doesn't exist (e.g., CI box with no Maestro install).
 *   - The file is unreadable or unparseable.
 *   - The setting is absent or set to an unrecognized value.
 *
 * In all undefined cases, the caller falls through to 'legacy-print', ensuring
 * byte-identical behavior with pre-ARD-7 CLI invocations.
 */
export function readClaudeCodeDefaultTransportModeFromSettings(): TransportMode | undefined {
	try {
		const raw = fs.readFileSync(getSettingsFilePath(), 'utf-8');
		const settings = JSON.parse(raw);
		const v = settings?.claudeCodeDefaultTransportMode;
		return v === 'interactive-pty' || v === 'legacy-print' ? v : undefined;
	} catch {
		return undefined;
	}
}
