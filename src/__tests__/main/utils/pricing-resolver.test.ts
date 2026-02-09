/**
 * Tests for pricing-resolver utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the store getters module
vi.mock('../../../main/stores/getters', () => ({
	getAgentConfigsStore: vi.fn(),
	getProjectFoldersStore: vi.fn(),
	getSessionsStore: vi.fn(),
}));

import {
	getAgentPricingConfig,
	getProjectFolderPricingConfig,
	getAgentProjectFolderId,
	resolveBillingMode,
	resolveModelForPricing,
	resolvePricingConfig,
} from '../../../main/utils/pricing-resolver';

import {
	getAgentConfigsStore,
	getProjectFoldersStore,
	getSessionsStore,
} from '../../../main/stores/getters';

const mockedGetAgentConfigsStore = vi.mocked(getAgentConfigsStore);
const mockedGetProjectFoldersStore = vi.mocked(getProjectFoldersStore);
const mockedGetSessionsStore = vi.mocked(getSessionsStore);

describe('pricing-resolver', () => {
	// Mock store instances
	const mockAgentConfigsStore = { get: vi.fn(), set: vi.fn() };
	const mockProjectFoldersStore = { get: vi.fn(), set: vi.fn() };
	const mockSessionsStore = { get: vi.fn(), set: vi.fn() };

	beforeEach(() => {
		vi.clearAllMocks();
		mockedGetAgentConfigsStore.mockReturnValue(mockAgentConfigsStore as any);
		mockedGetProjectFoldersStore.mockReturnValue(mockProjectFoldersStore as any);
		mockedGetSessionsStore.mockReturnValue(mockSessionsStore as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('getAgentPricingConfig', () => {
		it('should return stored config when valid', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'max',
						pricingModel: 'claude-opus-4-5-20251101',
					},
				},
			});

			const result = getAgentPricingConfig('agent-1');

			expect(result.billingMode).toBe('max');
			expect(result.pricingModel).toBe('claude-opus-4-5-20251101');
		});

		it('should return defaults when agent has no config', () => {
			mockAgentConfigsStore.get.mockReturnValue({});

			const result = getAgentPricingConfig('agent-1');

			expect(result.billingMode).toBe('auto');
			expect(result.pricingModel).toBe('auto');
		});

		it('should return defaults when agent config has no pricingConfig', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': { someOtherConfig: 'value' },
			});

			const result = getAgentPricingConfig('agent-1');

			expect(result.billingMode).toBe('auto');
			expect(result.pricingModel).toBe('auto');
		});

		it('should return defaults when pricingConfig is incomplete', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'max',
						// Missing pricingModel
					},
				},
			});

			const result = getAgentPricingConfig('agent-1');

			expect(result.billingMode).toBe('auto');
			expect(result.pricingModel).toBe('auto');
		});
	});

	describe('getProjectFolderPricingConfig', () => {
		it('should return folder pricing config when present', () => {
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'max' },
				},
			]);

			const result = getProjectFolderPricingConfig('folder-1');

			expect(result).toEqual({ billingMode: 'max' });
		});

		it('should return null when folder has no pricing config', () => {
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
				},
			]);

			const result = getProjectFolderPricingConfig('folder-1');

			expect(result).toBeNull();
		});

		it('should return null when folder not found', () => {
			mockProjectFoldersStore.get.mockReturnValue([]);

			const result = getProjectFolderPricingConfig('non-existent');

			expect(result).toBeNull();
		});
	});

	describe('getAgentProjectFolderId', () => {
		it('should return first folder ID when session has folders', () => {
			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Test Agent',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: ['folder-1', 'folder-2'],
				},
			]);

			const result = getAgentProjectFolderId('agent-1');

			expect(result).toBe('folder-1');
		});

		it('should return null when session has empty folders array', () => {
			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Test Agent',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: [],
				},
			]);

			const result = getAgentProjectFolderId('agent-1');

			expect(result).toBeNull();
		});

		it('should return null when session not found', () => {
			mockSessionsStore.get.mockReturnValue([]);

			const result = getAgentProjectFolderId('non-existent');

			expect(result).toBeNull();
		});

		it('should return null when session has no projectFolderIds property', () => {
			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Test Agent',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
				},
			]);

			const result = getAgentProjectFolderId('agent-1');

			expect(result).toBeNull();
		});
	});

	describe('resolveBillingMode', () => {
		it('should return agent-level setting when not auto', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'max',
						pricingModel: 'auto',
					},
				},
			});

			const result = resolveBillingMode('agent-1');

			expect(result).toBe('max');
		});

		it('should fall back to project folder when agent is auto', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
					},
				},
			});
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'max' },
				},
			]);

			const result = resolveBillingMode('agent-1', 'folder-1');

			expect(result).toBe('max');
		});

		it('should fall back to detected auth when no folder config', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
						detectedBillingMode: 'max',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			const result = resolveBillingMode('agent-1');

			expect(result).toBe('max');
		});

		it('should default to api when nothing configured', () => {
			mockAgentConfigsStore.get.mockReturnValue({});
			mockSessionsStore.get.mockReturnValue([]);

			const result = resolveBillingMode('agent-1');

			expect(result).toBe('api');
		});

		it('should look up project folder from session when not provided', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Test Agent',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: ['folder-1'],
				},
			]);
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'max' },
				},
			]);

			const result = resolveBillingMode('agent-1');

			expect(result).toBe('max');
		});

		it('should use api billing mode as agent setting', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'api',
						pricingModel: 'auto',
					},
				},
			});

			const result = resolveBillingMode('agent-1');

			expect(result).toBe('api');
		});
	});

	describe('resolveModelForPricing', () => {
		it('should return agent-level model when not auto', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'claude-opus-4-5-20251101',
					},
				},
			});

			const result = resolveModelForPricing('agent-1');

			expect(result).toBe('claude-opus-4-5-20251101');
		});

		it('should fall back to detected model when set to auto', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
						detectedModel: 'claude-sonnet-4-20250514',
					},
				},
			});

			const result = resolveModelForPricing('agent-1');

			expect(result).toBe('claude-sonnet-4-20250514');
		});

		it('should return default model when nothing configured', () => {
			mockAgentConfigsStore.get.mockReturnValue({});

			const result = resolveModelForPricing('agent-1');

			// Default is claude-sonnet-4-20250514 (from DEFAULT_MODEL_ID)
			expect(result).toBe('claude-sonnet-4-20250514');
		});
	});

	describe('resolvePricingConfig', () => {
		it('should return agent source when agent has explicit setting', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'max',
						pricingModel: 'claude-opus-4-5-20251101',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			const result = resolvePricingConfig('agent-1');

			expect(result).toEqual({
				billingMode: 'max',
				modelId: 'claude-opus-4-5-20251101',
				billingModeSource: 'agent',
				modelSource: 'agent',
			});
		});

		it('should return folder source when agent is auto and folder has config', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Test Agent',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: ['folder-1'],
				},
			]);
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'max' },
				},
			]);

			const result = resolvePricingConfig('agent-1');

			expect(result.billingMode).toBe('max');
			expect(result.billingModeSource).toBe('folder');
		});

		it('should return detected source when agent is auto and has detection', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
						detectedBillingMode: 'max',
						detectedModel: 'claude-opus-4-5-20251101',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([]);

			const result = resolvePricingConfig('agent-1');

			expect(result).toEqual({
				billingMode: 'max',
				modelId: 'claude-opus-4-5-20251101',
				billingModeSource: 'detected',
				modelSource: 'detected',
			});
		});

		it('should return default source when nothing configured', () => {
			mockAgentConfigsStore.get.mockReturnValue({});
			mockSessionsStore.get.mockReturnValue([]);

			const result = resolvePricingConfig('agent-1');

			expect(result).toEqual({
				billingMode: 'api',
				modelId: 'claude-sonnet-4-20250514',
				billingModeSource: 'default',
				modelSource: 'default',
			});
		});

		it('should use provided project folder ID', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
					},
				},
			});
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-override',
					name: 'Override Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'api' },
				},
			]);

			const result = resolvePricingConfig('agent-1', 'folder-override');

			expect(result.billingMode).toBe('api');
			expect(result.billingModeSource).toBe('folder');
		});

		it('should fall back to detected when folder has no pricing config', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'auto',
						detectedBillingMode: 'max',
					},
				},
			});
			mockSessionsStore.get.mockReturnValue([
				{
					id: 'agent-1',
					name: 'Test Agent',
					toolType: 'claude',
					cwd: '/test',
					projectRoot: '/test',
					projectFolderIds: ['folder-1'],
				},
			]);
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					// No pricingConfig
				},
			]);

			const result = resolvePricingConfig('agent-1');

			expect(result.billingMode).toBe('max');
			expect(result.billingModeSource).toBe('detected');
		});

		it('should handle mixed sources (agent model, folder billing)', () => {
			mockAgentConfigsStore.get.mockReturnValue({
				'agent-1': {
					pricingConfig: {
						billingMode: 'auto',
						pricingModel: 'claude-opus-4-5-20251101',
					},
				},
			});
			mockProjectFoldersStore.get.mockReturnValue([
				{
					id: 'folder-1',
					name: 'Test Folder',
					collapsed: false,
					order: 0,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					pricingConfig: { billingMode: 'max' },
				},
			]);

			const result = resolvePricingConfig('agent-1', 'folder-1');

			expect(result).toEqual({
				billingMode: 'max',
				modelId: 'claude-opus-4-5-20251101',
				billingModeSource: 'folder',
				modelSource: 'agent',
			});
		});
	});

	describe('error handling', () => {
		it('should return defaults when agent configs store throws', () => {
			mockAgentConfigsStore.get.mockImplementation(() => {
				throw new Error('Store corrupted');
			});

			const result = getAgentPricingConfig('agent-1');

			expect(result.billingMode).toBe('auto');
			expect(result.pricingModel).toBe('auto');
		});

		it('should return null when project folders store throws', () => {
			mockProjectFoldersStore.get.mockImplementation(() => {
				throw new Error('Store corrupted');
			});

			const result = getProjectFolderPricingConfig('folder-1');

			expect(result).toBeNull();
		});

		it('should return null when sessions store throws', () => {
			mockSessionsStore.get.mockImplementation(() => {
				throw new Error('Store corrupted');
			});

			const result = getAgentProjectFolderId('agent-1');

			expect(result).toBeNull();
		});

		it('should return null when project folders data is not an array', () => {
			mockProjectFoldersStore.get.mockReturnValue('not an array' as any);

			const result = getProjectFolderPricingConfig('folder-1');

			expect(result).toBeNull();
		});

		it('should return null when sessions data is not an array', () => {
			mockSessionsStore.get.mockReturnValue('not an array' as any);

			const result = getAgentProjectFolderId('agent-1');

			expect(result).toBeNull();
		});

		it('should return api billing mode when store throws in resolveBillingMode', () => {
			mockAgentConfigsStore.get.mockImplementation(() => {
				throw new Error('Store corrupted');
			});

			const result = resolveBillingMode('agent-1');

			expect(result).toBe('api');
		});
	});
});
