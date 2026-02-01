import React, { useState, useRef, useEffect } from 'react';
import type { Theme } from '../../types';
import type { ProjectFolder } from '../../../shared/types';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { Modal, ModalFooter, EmojiPickerField, FormInput } from '../ui';
import { ColorPicker } from '../common/ColorPicker';

export interface ProjectFolderModalProps {
	/** Theme for styling */
	theme: Theme;
	/** Callback to close the modal */
	onClose: () => void;
	/** Callback when folder is saved (create or update) */
	onSave: (folder: Omit<ProjectFolder, 'id' | 'createdAt' | 'updatedAt'>) => void;
	/** Existing folder data if editing (undefined for create mode) */
	existingFolder?: ProjectFolder;
}

/**
 * ProjectFolderModal - Modal for creating or editing project folders.
 *
 * Features:
 * - Emoji picker for folder icon
 * - Name input
 * - Color picker for highlight color
 * - Create/Update modes based on existingFolder prop
 */
export function ProjectFolderModal({
	theme,
	onClose,
	onSave,
	existingFolder,
}: ProjectFolderModalProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const isEditMode = !!existingFolder;

	// Form state
	const [name, setName] = useState(existingFolder?.name || '');
	const [emoji, setEmoji] = useState(existingFolder?.emoji || '');
	const [highlightColor, setHighlightColor] = useState<string | undefined>(
		existingFolder?.highlightColor
	);

	// Focus input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	const handleSubmit = () => {
		if (!name.trim()) return;

		onSave({
			name: name.trim().toUpperCase(),
			emoji: emoji || undefined,
			highlightColor,
			collapsed: existingFolder?.collapsed ?? false,
			order: existingFolder?.order ?? 0,
		});
		onClose();
	};

	const isValid = name.trim().length > 0;

	return (
		<Modal
			theme={theme}
			title={isEditMode ? 'Edit Project Folder' : 'Create Project Folder'}
			priority={MODAL_PRIORITIES.CREATE_GROUP} // Use same priority as CREATE_GROUP
			onClose={onClose}
			initialFocusRef={inputRef}
			width={450}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleSubmit}
					confirmLabel={isEditMode ? 'Save' : 'Create'}
					confirmDisabled={!isValid}
				/>
			}
		>
			<div className="space-y-6">
				{/* Name and Emoji Row */}
				<div className="flex gap-4 items-end">
					{/* Emoji Selector */}
					<EmojiPickerField
						theme={theme}
						value={emoji || '📁'}
						onChange={setEmoji}
						restoreFocusRef={inputRef}
					/>

					{/* Folder Name Input */}
					<div className="flex-1">
						<FormInput
							ref={inputRef}
							theme={theme}
							label="Folder Name"
							value={name}
							onChange={setName}
							onSubmit={isValid ? handleSubmit : undefined}
							placeholder="Enter folder name..."
							heightClass="h-[52px]"
							autoFocus
						/>
					</div>
				</div>

				{/* Color Picker */}
				<div>
					<label
						className="block text-xs font-medium mb-2 uppercase tracking-wide"
						style={{ color: theme.colors.textDim }}
					>
						Highlight Color
					</label>
					<ColorPicker
						theme={theme}
						selectedColor={highlightColor}
						onColorSelect={setHighlightColor}
						size="md"
					/>
					<p className="text-xs mt-2 opacity-70" style={{ color: theme.colors.textDim }}>
						Color appears as left bar when expanded, background tint when collapsed.
					</p>
				</div>
			</div>
		</Modal>
	);
}

export default ProjectFolderModal;
