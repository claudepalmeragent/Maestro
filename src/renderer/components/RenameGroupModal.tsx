import React, { useRef, useState } from 'react';
import type { Theme, Group } from '../types';
import type { TransportMode } from '../../shared/types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter, EmojiPickerField, FormInput } from './ui';
import { useSettingsStore } from '../stores/settingsStore';

interface RenameGroupModalProps {
	theme: Theme;
	groupId: string;
	groupName: string;
	setGroupName: (name: string) => void;
	groupEmoji: string;
	setGroupEmoji: (emoji: string) => void;
	onClose: () => void;
	groups: Group[];
	setGroups: React.Dispatch<React.SetStateAction<Group[]>>;
}

export function RenameGroupModal(props: RenameGroupModalProps) {
	const {
		theme,
		groupId,
		groupName,
		setGroupName,
		groupEmoji,
		setGroupEmoji,
		onClose,
		groups,
		setGroups,
	} = props;

	const inputRef = useRef<HTMLInputElement>(null);
	const appTransportMode = useSettingsStore((s) => s.claudeCodeDefaultTransportMode);

	const currentGroup = groups.find((g) => g.id === groupId);
	const [transportMode, setTransportMode] = useState<TransportMode | undefined>(
		currentGroup?.transportMode
	);

	const handleRename = () => {
		if (groupName.trim() && groupId) {
			setGroups((prev) =>
				prev.map((g) =>
					g.id === groupId
						? { ...g, name: groupName.trim().toUpperCase(), emoji: groupEmoji, transportMode }
						: g
				)
			);
			onClose();
		}
	};

	return (
		<Modal
			theme={theme}
			title="Rename Group"
			priority={MODAL_PRIORITIES.RENAME_GROUP}
			onClose={onClose}
			initialFocusRef={inputRef}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleRename}
					confirmLabel="Rename"
					confirmDisabled={!groupName.trim()}
				/>
			}
		>
			<div className="space-y-4">
				<div className="flex gap-4 items-end">
					{/* Emoji Selector - Left Side */}
					<EmojiPickerField
						theme={theme}
						value={groupEmoji}
						onChange={setGroupEmoji}
						restoreFocusRef={inputRef}
					/>

					{/* Group Name Input - Right Side */}
					<div className="flex-1">
						<FormInput
							ref={inputRef}
							theme={theme}
							label="Group Name"
							value={groupName}
							onChange={setGroupName}
							onSubmit={handleRename}
							placeholder="Enter group name..."
							heightClass="h-[52px]"
							autoFocus
						/>
					</div>
				</div>

				{/* Transport Mode */}
				<div>
					<label className="block text-xs font-medium mb-1" style={{ color: theme.colors.textDim }}>
						Claude Code Transport Mode
					</label>
					<p className="text-xs mb-2" style={{ color: theme.colors.textDim }}>
						Inherited from app:{' '}
						<span style={{ color: theme.colors.textMain }}>
							{appTransportMode === 'interactive-pty'
								? 'Interactive PTY (Claude Max)'
								: 'Legacy (claude --print)'}
						</span>
					</p>
					<select
						value={transportMode ?? ''}
						onChange={(e) =>
							setTransportMode(
								e.target.value === '' ? undefined : (e.target.value as TransportMode)
							)
						}
						className="text-xs px-2 py-1.5 rounded border w-full"
						style={{
							backgroundColor: theme.colors.bgMain,
							color: theme.colors.textMain,
							borderColor: theme.colors.border,
						}}
					>
						<option value="">
							Inherit from app (
							{appTransportMode === 'interactive-pty' ? 'Interactive PTY' : 'Legacy'})
						</option>
						<option value="legacy-print">Legacy (claude --print)</option>
						<option value="interactive-pty">Interactive PTY (Claude Max)</option>
					</select>
					<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
						Any level set to Interactive PTY wins for all agents below it (strict ratchet — narrower
						scopes cannot demote a broader opt-in).
					</p>
				</div>
			</div>
		</Modal>
	);
}
