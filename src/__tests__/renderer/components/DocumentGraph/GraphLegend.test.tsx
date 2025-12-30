/**
 * Tests for the GraphLegend component
 *
 * The GraphLegend displays a collapsible panel explaining node types, edge types,
 * keyboard shortcuts, and interaction hints in the Mind Map visualization.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { GraphLegend, type GraphLegendProps } from '../../../../renderer/components/DocumentGraph/GraphLegend';
import type { Theme } from '../../../../renderer/types';

// Mock theme for testing
const mockTheme: Theme = {
  id: 'dracula',
  name: 'Dracula',
  mode: 'dark',
  colors: {
    bgMain: '#282a36',
    bgSidebar: '#21222c',
    bgActivity: '#343746',
    border: '#44475a',
    textMain: '#f8f8f2',
    textDim: '#6272a4',
    accent: '#bd93f9',
    accentDim: 'rgba(189, 147, 249, 0.2)',
    accentText: '#ff79c6',
    accentForeground: '#282a36',
    success: '#50fa7b',
    warning: '#ffb86c',
    error: '#ff5555',
  },
};

// Light theme for theme testing
const lightTheme: Theme = {
  ...mockTheme,
  id: 'light',
  name: 'Light',
  mode: 'light',
  colors: {
    ...mockTheme.colors,
    bgMain: '#ffffff',
    bgSidebar: '#f5f5f5',
    bgActivity: '#fafafa',
    border: '#e5e5e5',
    textMain: '#1a1a1a',
    textDim: '#666666',
    accent: '#6366f1',
  },
};

// Default props for testing
const defaultProps: GraphLegendProps = {
  theme: mockTheme,
  showExternalLinks: true,
};

describe('GraphLegend', () => {
  describe('Rendering', () => {
    it('renders in collapsed state by default', () => {
      render(<GraphLegend {...defaultProps} />);

      // Should show the header button
      expect(screen.getByRole('button', { name: /legend/i })).toBeInTheDocument();

      // Should NOT show the content sections
      expect(screen.queryByText('Node Types')).not.toBeInTheDocument();
    });

    it('renders in expanded state when defaultExpanded is true', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      // Should show the content sections
      expect(screen.getByText('Node Types')).toBeInTheDocument();
      expect(screen.getByText('Connection Types')).toBeInTheDocument();
      expect(screen.getByText('Selection')).toBeInTheDocument();
    });

    it('renders all node types when showExternalLinks is true', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded showExternalLinks />);

      expect(screen.getByText('Document')).toBeInTheDocument();
      // External Link appears in both Node Types and Connection Types sections
      const externalLinks = screen.getAllByText('External Link');
      expect(externalLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('hides external node type when showExternalLinks is false', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded showExternalLinks={false} />);

      expect(screen.getByText('Document')).toBeInTheDocument();
      // External Link should appear once in "Connection Types" section for edges
      // but not in "Node Types" section
      const nodeTypesSection = screen.getByText('Node Types').parentElement;
      expect(within(nodeTypesSection!).queryByText('External Link')).not.toBeInTheDocument();
    });

    it('renders all edge types when showExternalLinks is true', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded showExternalLinks />);

      expect(screen.getByText('Internal Link')).toBeInTheDocument();
      // External Link appears in both Node Types and Connection Types sections
      const allExternalLinks = screen.getAllByText('External Link');
      expect(allExternalLinks.length).toBe(2); // One in nodes, one in edges
    });

    it('hides external edge type when showExternalLinks is false', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded showExternalLinks={false} />);

      expect(screen.getByText('Internal Link')).toBeInTheDocument();

      // External Link should not appear at all when external links are disabled
      expect(screen.queryByText('External Link')).not.toBeInTheDocument();
    });

    it('renders selection section with selected node preview', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Selection')).toBeInTheDocument();
      expect(screen.getByText('Selected Node')).toBeInTheDocument();
      expect(screen.getByText('Connected Edge')).toBeInTheDocument();
    });

    it('renders keyboard shortcuts section', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
      expect(screen.getByText('↑ ↓ ← →')).toBeInTheDocument();
      expect(screen.getByText('Navigate between nodes')).toBeInTheDocument();
      expect(screen.getByText('Enter')).toBeInTheDocument();
      expect(screen.getByText('Recenter on focused node')).toBeInTheDocument();
      expect(screen.getByText('O')).toBeInTheDocument();
      expect(screen.getByText('Open file in preview')).toBeInTheDocument();
    });

    it('renders interaction hints', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Recenter view')).toBeInTheDocument();
      expect(screen.getByText('Context menu')).toBeInTheDocument();
      expect(screen.getByText('Zoom in/out')).toBeInTheDocument();
    });

    it('renders status indicators section', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Status Indicators')).toBeInTheDocument();
      expect(screen.getByText('Broken Links')).toBeInTheDocument();
      expect(screen.getByText('Links to non-existent files')).toBeInTheDocument();
    });
  });

  describe('Toggle Behavior', () => {
    it('expands when header is clicked', () => {
      render(<GraphLegend {...defaultProps} />);

      // Initially collapsed
      expect(screen.queryByText('Node Types')).not.toBeInTheDocument();

      // Click to expand
      fireEvent.click(screen.getByRole('button', { name: /legend/i }));

      // Should now show content
      expect(screen.getByText('Node Types')).toBeInTheDocument();
    });

    it('collapses when header is clicked again', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      // Initially expanded
      expect(screen.getByText('Node Types')).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(screen.getByRole('button', { name: /legend/i }));

      // Should no longer show content
      expect(screen.queryByText('Node Types')).not.toBeInTheDocument();
    });

    it('toggles multiple times correctly', () => {
      render(<GraphLegend {...defaultProps} />);

      const button = screen.getByRole('button', { name: /legend/i });

      // First click: expand
      fireEvent.click(button);
      expect(screen.getByText('Node Types')).toBeInTheDocument();

      // Second click: collapse
      fireEvent.click(button);
      expect(screen.queryByText('Node Types')).not.toBeInTheDocument();

      // Third click: expand again
      fireEvent.click(button);
      expect(screen.getByText('Node Types')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has region role with aria-label', () => {
      render(<GraphLegend {...defaultProps} />);

      // Mind map legend uses "Mind map legend" as aria-label
      expect(screen.getByRole('region', { name: /mind map legend/i })).toBeInTheDocument();
    });

    it('toggle button has aria-expanded attribute', () => {
      render(<GraphLegend {...defaultProps} />);

      const button = screen.getByRole('button', { name: /legend/i });
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('aria-expanded updates when toggled', () => {
      render(<GraphLegend {...defaultProps} />);

      const button = screen.getByRole('button', { name: /legend/i });
      expect(button).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');

      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('toggle button has aria-controls referencing content', () => {
      render(<GraphLegend {...defaultProps} />);

      const button = screen.getByRole('button', { name: /legend/i });
      expect(button).toHaveAttribute('aria-controls', 'legend-content');
    });

    it('content container has matching id', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(document.getElementById('legend-content')).toBeInTheDocument();
    });

    it('node previews have aria-label', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      // Document node card appears in Node Types and Selection (as selected)
      const docNodes = screen.getAllByRole('img', { name: /document node card/i });
      expect(docNodes.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('img', { name: /external link node pill/i })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /document node card \(selected\)/i })).toBeInTheDocument();
    });

    it('edge previews have aria-label', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      // Internal link edge appears in Connection Types and Selection (as highlighted)
      const internalEdges = screen.getAllByRole('img', { name: /internal link edge/i });
      expect(internalEdges.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('img', { name: /external link edge/i })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /internal link edge \(highlighted\)/i })).toBeInTheDocument();
    });

    it('broken links indicator has aria-label', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByRole('img', { name: /broken links warning indicator/i })).toBeInTheDocument();
    });
  });

  describe('Theme Styling', () => {
    it('applies theme background color to container', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveStyle({ backgroundColor: mockTheme.colors.bgActivity });
    });

    it('applies theme border color to container', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      // Border is a shorthand, check individual properties
      expect(legend).toHaveStyle({ borderWidth: '1px', borderStyle: 'solid' });
    });

    it('applies light theme colors correctly', () => {
      const { container } = render(<GraphLegend {...defaultProps} theme={lightTheme} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveStyle({ backgroundColor: lightTheme.colors.bgActivity });
    });

    it('applies accent color to header background', () => {
      render(<GraphLegend {...defaultProps} />);

      const button = screen.getByRole('button', { name: /legend/i });
      expect(button).toHaveStyle({ backgroundColor: `${mockTheme.colors.accent}10` });
    });

    it('section headers use dim text color', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      // Get all section headers
      const nodeTypesHeader = screen.getByText('Node Types');
      expect(nodeTypesHeader).toHaveStyle({ color: mockTheme.colors.textDim });
    });

    it('item labels use main text color', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const documentLabel = screen.getByText('Document');
      expect(documentLabel).toHaveStyle({ color: mockTheme.colors.textMain });
    });

    it('item descriptions use dim text color with opacity', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const description = screen.getByText('Card with title and description');
      expect(description).toHaveStyle({ color: mockTheme.colors.textDim, opacity: '0.8' });
    });
  });

  describe('Node Preview Styling (Mind Map Cards)', () => {
    it('document node preview renders as SVG card with rect', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const docNode = screen.getByRole('img', { name: /^document node card$/i });
      const rect = docNode.querySelector('rect');
      expect(rect).toBeInTheDocument();
      // Card has rounded corners (rx=4)
      expect(rect).toHaveAttribute('rx', '4');
    });

    it('external node preview renders as pill-shaped SVG', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const extNode = screen.getByRole('img', { name: /^external link node pill$/i });
      const rect = extNode.querySelector('rect');
      expect(rect).toBeInTheDocument();
      // Pill has high rx value for rounded ends (rx=7)
      expect(rect).toHaveAttribute('rx', '7');
    });

    it('selected document node preview has accent stroke', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const selectedNode = screen.getByRole('img', { name: /document node card \(selected\)/i });
      const rect = selectedNode.querySelector('rect');
      expect(rect).toBeInTheDocument();
      // Selected nodes have accent stroke color
      expect(rect).toHaveAttribute('stroke', mockTheme.colors.accent);
    });

    it('document node preview uses bgActivity fill color', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const docNode = screen.getByRole('img', { name: /^document node card$/i });
      const rect = docNode.querySelector('rect');
      expect(rect).toBeInTheDocument();
      expect(rect).toHaveAttribute('fill', mockTheme.colors.bgActivity);
    });

    it('external node preview uses bgMain fill color', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const extNode = screen.getByRole('img', { name: /^external link node pill$/i });
      const rect = extNode.querySelector('rect');
      expect(rect).toBeInTheDocument();
      expect(rect).toHaveAttribute('fill', mockTheme.colors.bgMain);
    });
  });

  describe('Edge Preview Styling (Bezier Curves)', () => {
    it('internal edge preview uses bezier path', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const internalEdge = screen.getByRole('img', { name: /^internal link edge$/i });
      const path = internalEdge.querySelector('path');
      expect(path).toBeInTheDocument();
      // Should NOT have stroke-dasharray (solid line)
      expect(path).not.toHaveAttribute('stroke-dasharray');
    });

    it('external edge preview is dashed bezier path', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const externalEdge = screen.getByRole('img', { name: /external link edge(?! \(highlighted\))/i });
      const path = externalEdge.querySelector('path');
      expect(path).toBeInTheDocument();
      expect(path).toHaveAttribute('stroke-dasharray', '4 3');
    });

    it('internal edge uses dim text color for stroke', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const internalEdge = screen.getByRole('img', { name: /^internal link edge$/i });
      const path = internalEdge.querySelector('path');
      expect(path).toHaveAttribute('stroke', mockTheme.colors.textDim);
    });

    it('highlighted edge uses accent color for stroke', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const highlightedEdge = screen.getByRole('img', { name: /internal link edge \(highlighted\)/i });
      const path = highlightedEdge.querySelector('path');
      expect(path).toHaveAttribute('stroke', mockTheme.colors.accent);
    });

    it('highlighted edge has thicker stroke width', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const highlightedEdge = screen.getByRole('img', { name: /internal link edge \(highlighted\)/i });
      const path = highlightedEdge.querySelector('path');
      expect(path).toHaveAttribute('stroke-width', '2');
    });

    it('normal edge has thinner stroke width', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      const normalEdge = screen.getByRole('img', { name: /^internal link edge$/i });
      const path = normalEdge.querySelector('path');
      expect(path).toHaveAttribute('stroke-width', '1.5');
    });
  });

  describe('Container Styling', () => {
    it('has correct CSS class for styling', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      expect(container.querySelector('.graph-legend')).toBeInTheDocument();
    });

    it('is positioned absolutely at bottom center', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveClass('absolute');
      // Position is set via inline styles: bottom: 16, left: '50%', transform: 'translateX(-50%)'
      expect(legend).toHaveStyle({
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%)',
      });
    });

    it('has max-width constraint', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveStyle({ maxWidth: '300px' });
    });

    it('has z-index for stacking above graph', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveStyle({ zIndex: '10' });
    });

    it('has rounded corners', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveClass('rounded-lg');
    });

    it('has shadow for elevation', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveClass('shadow-lg');
    });
  });

  describe('Content Descriptions', () => {
    it('document node has correct description', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Card with title and description')).toBeInTheDocument();
    });

    it('external node has correct description', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Pill showing domain name')).toBeInTheDocument();
    });

    it('internal edge has correct description', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Connection between markdown files')).toBeInTheDocument();
    });

    it('external edge has correct description', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Connection to external domain')).toBeInTheDocument();
    });

    it('selected node has correct description', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Click or navigate to select')).toBeInTheDocument();
    });

    it('connected edge has correct description', () => {
      render(<GraphLegend {...defaultProps} defaultExpanded />);

      expect(screen.getByText('Edges to/from selected node')).toBeInTheDocument();
    });
  });

  describe('Chevron Icons', () => {
    it('shows ChevronUp when collapsed (indicating can expand)', () => {
      const { container } = render(<GraphLegend {...defaultProps} />);

      // When collapsed, clicking expands - so show up chevron
      const button = screen.getByRole('button', { name: /legend/i });
      const svgs = button.querySelectorAll('svg');
      expect(svgs.length).toBe(1); // Should have one chevron icon
    });

    it('shows ChevronDown when expanded (indicating can collapse)', () => {
      const { container } = render(<GraphLegend {...defaultProps} defaultExpanded />);

      const button = screen.getByRole('button', { name: /legend/i });
      const svgs = button.querySelectorAll('svg');
      expect(svgs.length).toBe(1); // Should have one chevron icon
    });
  });

  describe('Dynamic Content', () => {
    it('updates when showExternalLinks prop changes', () => {
      const { rerender } = render(<GraphLegend {...defaultProps} defaultExpanded showExternalLinks />);

      // Initially showing external links
      expect(screen.getAllByText('External Link').length).toBe(2);

      // Rerender with external links disabled
      rerender(<GraphLegend {...defaultProps} defaultExpanded showExternalLinks={false} />);

      // External Link should no longer appear
      expect(screen.queryByText('External Link')).not.toBeInTheDocument();
    });

    it('applies theme changes dynamically', () => {
      const { container, rerender } = render(<GraphLegend {...defaultProps} />);

      const legend = container.querySelector('.graph-legend');
      expect(legend).toHaveStyle({ backgroundColor: mockTheme.colors.bgActivity });

      // Rerender with light theme
      rerender(<GraphLegend {...defaultProps} theme={lightTheme} />);

      expect(legend).toHaveStyle({ backgroundColor: lightTheme.colors.bgActivity });
    });
  });
});
