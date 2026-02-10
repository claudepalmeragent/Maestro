/**
 * AuditResultModal - Modal to display audit results with correction options
 *
 * Features:
 * - Displays audit period in header
 * - Contains AuditReportPanel for detailed view
 * - Allows auto-correction of discrepancies
 *
 * Usage:
 * ```tsx
 * <AuditResultModal
 *   isOpen={isOpen}
 *   onClose={handleClose}
 *   result={auditResult}
 *   onAutoCorrect={handleAutoCorrect}
 *   theme={theme}
 * />
 * ```
 */

import React from 'react';
import { X } from 'lucide-react';
import type { Theme } from '../types';
import { AuditReportPanel, type AuditReportResult } from './UsageDashboard/AuditReportPanel';

export interface AuditResultModalProps {
	isOpen: boolean;
	onClose: () => void;
	result: AuditReportResult | null;
	onAutoCorrect: (selectedIds: string[]) => Promise<void>;
	theme: Theme;
}

export function AuditResultModal({
	isOpen,
	onClose,
	result,
	onAutoCorrect,
	theme,
}: AuditResultModalProps): React.ReactElement | null {
	if (!isOpen || !result) return null;

	return (
		<div
			className="fixed inset-0 flex items-center justify-center z-50"
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
		>
			<div
				className="rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden"
				style={{ backgroundColor: theme.colors.bgSidebar }}
			>
				{/* Header */}
				<div
					className="flex items-center justify-between p-4 border-b"
					style={{ borderColor: theme.colors.border }}
				>
					<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
						Audit Results: {result.period.start} to {result.period.end}
					</h2>
					<button
						onClick={onClose}
						className="p-1 rounded hover:bg-opacity-10 transition-colors"
						style={{ color: theme.colors.textDim }}
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 120px)' }}>
					<AuditReportPanel result={result} onAutoCorrect={onAutoCorrect} theme={theme} />
				</div>

				{/* Footer */}
				<div
					className="flex justify-end gap-2 p-4 border-t"
					style={{ borderColor: theme.colors.border }}
				>
					<button
						onClick={onClose}
						className="px-4 py-2 rounded border transition-colors hover:bg-opacity-10"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
						}}
					>
						Close
					</button>
				</div>
			</div>
		</div>
	);
}
