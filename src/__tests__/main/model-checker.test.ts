/**
 * Tests for Model Checker
 */

import { describe, it, expect } from 'vitest';
import { parseModelsFromPricingPage } from '../../main/model-checker';

describe('model-checker', () => {
	describe('parseModelsFromPricingPage', () => {
		it('should parse model names from a pricing table', () => {
			const html = `
| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
|-------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Opus 4.6 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Sonnet 4.6 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |
| Claude Haiku 4.5 | $1 / MTok | $1.25 / MTok | $2 / MTok | $0.10 / MTok | $5 / MTok |
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(3);
			expect(models[0].name).toBe('Claude Opus 4.6');
			expect(models[1].name).toBe('Claude Sonnet 4.6');
			expect(models[2].name).toBe('Claude Haiku 4.5');
		});

		it('should parse input and output pricing', () => {
			const html = `
| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
|-------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Opus 4.6 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |
| Claude Sonnet 4.6 | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models[0].inputPricePerMillion).toBe(5);
			expect(models[0].outputPricePerMillion).toBe(25);
			expect(models[1].inputPricePerMillion).toBe(3);
			expect(models[1].outputPricePerMillion).toBe(15);
		});

		it('should handle deprecated model annotations', () => {
			const html = `
| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
|-------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Sonnet 3.7 (deprecated) | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |
| Claude Opus 3 (deprecated) | $15 / MTok | $18.75 / MTok | $30 / MTok | $1.50 / MTok | $75 / MTok |
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(2);
			expect(models[0].name).toBe('Claude Sonnet 3.7');
			expect(models[1].name).toBe('Claude Opus 3');
		});

		it('should deduplicate models appearing in multiple tables', () => {
			const html = `
| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
|-------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Opus 4.6 | $5 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $25 / MTok |

Some text between tables.

| Model | Batch input | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Batch output |
|-------|-------------|-----------------|-----------------|----------------------|--------------|
| Claude Opus 4.6 | $2.50 / MTok | $6.25 / MTok | $10 / MTok | $0.50 / MTok | $12.50 / MTok |
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(1);
			expect(models[0].name).toBe('Claude Opus 4.6');
		});

		// HTML <td> format tests (actual pricing page format)
		it('should parse models from HTML <td> tags', () => {
			const html = `
<table>
<tr><td class="p-2">Claude Opus 4.6</td><td class="p-2">$5 / MTok</td><td class="p-2">$6.25 / MTok</td><td class="p-2">$10 / MTok</td><td class="p-2">$0.50 / MTok</td><td class="p-2">$25 / MTok</td></tr>
<tr><td class="p-2">Claude Sonnet 4.6</td><td class="p-2">$3 / MTok</td><td class="p-2">$3.75 / MTok</td><td class="p-2">$6 / MTok</td><td class="p-2">$0.30 / MTok</td><td class="p-2">$15 / MTok</td></tr>
</table>
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(2);
			expect(models[0].name).toBe('Claude Opus 4.6');
			expect(models[0].inputPricePerMillion).toBe(5);
			expect(models[0].outputPricePerMillion).toBe(25);
			expect(models[1].name).toBe('Claude Sonnet 4.6');
			expect(models[1].inputPricePerMillion).toBe(3);
			expect(models[1].outputPricePerMillion).toBe(15);
		});

		it('should handle deprecated models with <a> tags in HTML format', () => {
			const html = `
<table>
<tr><td class="p-2">Claude Sonnet 3.7 (<a href="/docs">deprecated</a>)</td><td class="p-2">$3 / MTok</td><td class="p-2">$3.75 / MTok</td><td class="p-2">$6 / MTok</td><td class="p-2">$0.30 / MTok</td><td class="p-2">$15 / MTok</td></tr>
</table>
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(1);
			expect(models[0].name).toBe('Claude Sonnet 3.7');
			expect(models[0].inputPricePerMillion).toBe(3);
			expect(models[0].outputPricePerMillion).toBe(15);
		});

		it('should deduplicate HTML models appearing in multiple tables', () => {
			const html = `
<table>
<tr><td class="p-2">Claude Opus 4.6</td><td class="p-2">$5 / MTok</td><td class="p-2">$6.25 / MTok</td><td class="p-2">$10 / MTok</td><td class="p-2">$0.50 / MTok</td><td class="p-2">$25 / MTok</td></tr>
</table>
<p>Some text</p>
<table>
<tr><td class="p-2">Claude Opus 4.6</td><td class="p-2">$2.50 / MTok</td><td class="p-2">$6.25 / MTok</td><td class="p-2">$10 / MTok</td><td class="p-2">$0.50 / MTok</td><td class="p-2">$12.50 / MTok</td></tr>
</table>
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(1);
			expect(models[0].name).toBe('Claude Opus 4.6');
		});

		it('should return empty array for non-table content', () => {
			const html = '<html><body>No tables here</body></html>';
			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(0);
		});

		it('should handle a hypothetical new model', () => {
			const html = `
| Model | Base Input Tokens | 5m Cache Writes | 1h Cache Writes | Cache Hits & Refreshes | Output Tokens |
|-------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Sonnet 5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.40 / MTok | $20 / MTok |
			`;

			const models = parseModelsFromPricingPage(html);
			expect(models.length).toBe(1);
			expect(models[0].name).toBe('Claude Sonnet 5');
			expect(models[0].inputPricePerMillion).toBe(4);
			expect(models[0].outputPricePerMillion).toBe(20);
		});
	});
});
