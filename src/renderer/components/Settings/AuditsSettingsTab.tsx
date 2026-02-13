/**
 * AuditsSettingsTab - Settings tab for configuring usage audits
 *
 * This component provides a UI for:
 * - Configuring scheduled audits (daily, weekly, monthly)
 * - Running manual audits for a date range
 * - Viewing audit history with detail modal
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { Theme } from '../../types';
import { AuditHistoryTable, type ExtendedAuditResult } from './AuditHistoryTable';
import { AuditResultModal } from '../AuditResultModal';
import { ReconstructionPanel } from '../UsageDashboard/ReconstructionPanel';

/**
 * Audit configuration settings for scheduled audits.
 */
interface AuditConfig {
	dailyEnabled: boolean;
	dailyTime: string;
	weeklyEnabled: boolean;
	weeklyDay: number;
	monthlyEnabled: boolean;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface AuditsSettingsTabProps {
	theme: Theme;
}

export function AuditsSettingsTab({ theme }: AuditsSettingsTabProps): React.ReactElement {
	const [config, setConfig] = useState<AuditConfig>({
		dailyEnabled: false,
		dailyTime: '00:00',
		weeklyEnabled: false,
		weeklyDay: 0,
		monthlyEnabled: false,
	});
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [auditRunning, setAuditRunning] = useState(false);
	const [manualDateRange, setManualDateRange] = useState({
		start: '',
		end: '',
	});
	const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
	const [selectedAudit, setSelectedAudit] = useState<ExtendedAuditResult | null>(null);
	const [modalOpen, setModalOpen] = useState(false);

	useEffect(() => {
		loadConfig();
		initializeDateRange();
	}, []);

	async function loadConfig(): Promise<void> {
		try {
			const cfg = await window.maestro.audit.getConfig();
			setConfig(cfg);
		} catch (error) {
			console.error('Failed to load audit config:', error);
		} finally {
			setLoading(false);
		}
	}

	function initializeDateRange(): void {
		const end = new Date().toISOString().split('T')[0];
		const start = new Date();
		start.setDate(start.getDate() - 7);
		setManualDateRange({
			start: start.toISOString().split('T')[0],
			end,
		});
	}

	async function saveConfig(): Promise<void> {
		setSaving(true);
		try {
			await window.maestro.audit.saveConfig(config);
		} catch (error) {
			console.error('Failed to save audit config:', error);
		} finally {
			setSaving(false);
		}
	}

	async function runManualAudit(): Promise<void> {
		if (!manualDateRange.start || !manualDateRange.end) return;

		setAuditRunning(true);
		try {
			const result = await window.maestro.audit.run(manualDateRange.start, manualDateRange.end);
			console.log('Audit result:', result);
			// Refresh the history table after a successful audit
			setHistoryRefreshKey((prev) => prev + 1);
			// Show the result in modal
			setSelectedAudit(result as ExtendedAuditResult);
			setModalOpen(true);
		} catch (error) {
			console.error('Audit failed:', error);
		} finally {
			setAuditRunning(false);
		}
	}

	const handleSelectAudit = useCallback((audit: ExtendedAuditResult) => {
		setSelectedAudit(audit);
		setModalOpen(true);
	}, []);

	const handleCloseModal = useCallback(() => {
		setModalOpen(false);
	}, []);

	const handleMarkReviewed = useCallback(async (selectedIds: string[]) => {
		try {
			await window.maestro.audit.autoCorrect(selectedIds);
			// Refresh history after marking
			setHistoryRefreshKey((prev) => prev + 1);
		} catch (error) {
			console.error('Failed to mark entries as reviewed:', error);
		}
	}, []);

	if (loading) {
		return (
			<div className="p-4" style={{ color: theme.colors.textDim }}>
				Loading...
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
					Usage Audits
				</h2>
				<p className="text-sm mt-1" style={{ color: theme.colors.textDim }}>
					Compare Maestro's recorded usage against Anthropic's data via ccusage.
				</p>
			</div>

			{/* Scheduled Audits Section */}
			<section className="space-y-4">
				<h3 className="font-medium" style={{ color: theme.colors.textMain }}>
					Scheduled Audits
				</h3>

				{/* Daily */}
				<div className="flex items-center gap-4">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={config.dailyEnabled}
							onChange={(e) => setConfig({ ...config, dailyEnabled: e.target.checked })}
							className="w-4 h-4 rounded"
							style={{ accentColor: theme.colors.accent }}
						/>
						<span style={{ color: theme.colors.textMain }}>Daily audit at</span>
					</label>
					<input
						type="time"
						value={config.dailyTime}
						onChange={(e) => setConfig({ ...config, dailyTime: e.target.value })}
						disabled={!config.dailyEnabled}
						className="px-2 py-1 rounded border bg-transparent outline-none"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							opacity: config.dailyEnabled ? 1 : 0.5,
						}}
					/>
				</div>

				{/* Weekly */}
				<div className="flex items-center gap-4">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={config.weeklyEnabled}
							onChange={(e) => setConfig({ ...config, weeklyEnabled: e.target.checked })}
							className="w-4 h-4 rounded"
							style={{ accentColor: theme.colors.accent }}
						/>
						<span style={{ color: theme.colors.textMain }}>Weekly audit on</span>
					</label>
					<select
						value={config.weeklyDay}
						onChange={(e) => setConfig({ ...config, weeklyDay: Number(e.target.value) })}
						disabled={!config.weeklyEnabled}
						className="px-2 py-1 rounded border bg-transparent outline-none"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							backgroundColor: theme.colors.bgMain,
							opacity: config.weeklyEnabled ? 1 : 0.5,
						}}
					>
						{DAYS_OF_WEEK.map((day, i) => (
							<option key={day} value={i}>
								{day}
							</option>
						))}
					</select>
				</div>

				{/* Monthly */}
				<div className="flex items-center gap-2">
					<label className="flex items-center gap-2 cursor-pointer">
						<input
							type="checkbox"
							checked={config.monthlyEnabled}
							onChange={(e) => setConfig({ ...config, monthlyEnabled: e.target.checked })}
							className="w-4 h-4 rounded"
							style={{ accentColor: theme.colors.accent }}
						/>
						<span style={{ color: theme.colors.textMain }}>Monthly audit (1st of each month)</span>
					</label>
				</div>

				<button
					onClick={saveConfig}
					disabled={saving}
					className="px-4 py-2 rounded font-medium transition-opacity"
					style={{
						backgroundColor: theme.colors.accent,
						color: '#ffffff',
						opacity: saving ? 0.5 : 1,
					}}
				>
					{saving ? 'Saving...' : 'Save Schedule'}
				</button>
			</section>

			{/* Manual Audit Section */}
			<section className="space-y-4 pt-4 border-t" style={{ borderColor: theme.colors.border }}>
				<h3 className="font-medium" style={{ color: theme.colors.textMain }}>
					Manual Audit
				</h3>

				<div className="flex items-end gap-4">
					<label className="flex flex-col gap-1">
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							Start Date
						</span>
						<input
							type="date"
							value={manualDateRange.start}
							onChange={(e) => setManualDateRange({ ...manualDateRange, start: e.target.value })}
							className="px-2 py-1 rounded border bg-transparent outline-none"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
								backgroundColor: theme.colors.bgMain,
							}}
						/>
					</label>

					<label className="flex flex-col gap-1">
						<span className="text-sm" style={{ color: theme.colors.textDim }}>
							End Date
						</span>
						<input
							type="date"
							value={manualDateRange.end}
							onChange={(e) => setManualDateRange({ ...manualDateRange, end: e.target.value })}
							className="px-2 py-1 rounded border bg-transparent outline-none"
							style={{
								borderColor: theme.colors.border,
								color: theme.colors.textMain,
								backgroundColor: theme.colors.bgMain,
							}}
						/>
					</label>

					<button
						onClick={runManualAudit}
						disabled={auditRunning}
						className="px-4 py-2 rounded font-medium transition-opacity"
						style={{
							backgroundColor: '#22c55e',
							color: '#ffffff',
							opacity: auditRunning ? 0.5 : 1,
						}}
					>
						{auditRunning ? 'Running...' : 'Run Audit Now'}
					</button>
				</div>
			</section>

			{/* Audit History Section */}
			<section className="pt-4 border-t" style={{ borderColor: theme.colors.border }}>
				<h3 className="font-medium mb-4" style={{ color: theme.colors.textMain }}>
					Audit History
				</h3>
				<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
					Click on a row to view detailed breakdown.
				</p>
				<AuditHistoryTable
					theme={theme}
					key={historyRefreshKey}
					onSelectAudit={handleSelectAudit}
				/>
			</section>

			{/* Historical Data Reconstruction Section */}
			<section className="pt-4 border-t" style={{ borderColor: theme.colors.border }}>
				<ReconstructionPanel theme={theme} />
			</section>

			{/* Audit Result Modal */}
			<AuditResultModal
				isOpen={modalOpen}
				onClose={handleCloseModal}
				result={selectedAudit}
				onMarkReviewed={handleMarkReviewed}
				theme={theme}
			/>
		</div>
	);
}
