/**
 * AuditResultModal - Modal to display audit results with details
 *
 * Features:
 * - Displays audit period in header
 * - Contains AuditReportPanel for detailed view
 * - Mark as Reviewed action for discrepancies
 */

import React from 'react';
import { X } from 'lucide-react';
import type { Theme } from '../types';
import { AuditReportPanel } from './UsageDashboard/AuditReportPanel';
import type { ExtendedAuditResult } from './Settings/AuditHistoryTable';

export interface AuditResultModalProps {
	isOpen: boolean;
	onClose: () => void;
	result: ExtendedAuditResult | null;
	onMarkReviewed?: (selectedIds: string[]) => Promise<void>;
	theme: Theme;
}

export function AuditResultModal({
	isOpen,
	onClose,
	result,
	onMarkReviewed,
	theme,
}: AuditResultModalProps): React.ReactElement | null {
	if (!isOpen || !result) return null;

	return (
		<div
			className="fixed inset-0 flex items-center justify-center z-50"
			style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
			onClick={(e) => e.target === e.currentTarget && onClose()}
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
					<div>
						<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
							Audit Results
						</h2>
						<p className="text-sm" style={{ color: theme.colors.textDim }}>
							{result.period.start} to {result.period.end}
						</p>
					</div>
					<button
						onClick={onClose}
						className="p-1 rounded hover:bg-opacity-10 transition-colors"
						style={{ color: theme.colors.textDim }}
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 140px)' }}>
					<AuditReportPanel result={result} onMarkReviewed={onMarkReviewed} theme={theme} />
				</div>

				{/* Footer */}
				<div
					className="flex justify-between items-center gap-2 p-4 border-t"
					style={{ borderColor: theme.colors.border }}
				>
					<div className="text-sm" style={{ color: theme.colors.textDim }}>
						Total savings:{' '}
						<span style={{ color: '#22c55e' }}>${result.costs.savings.toFixed(2)}</span>
					</div>
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
