/**
 * DocumentGraphView - Main container component for the markdown document graph visualization.
 *
 * Features:
 * - React Flow canvas with custom node types (DocumentNode, ExternalLinkNode)
 * - Controls panel: layout toggle (force/hierarchical), external links toggle, zoom, fit view
 * - Minimap with theme-aware colors
 * - Background pattern (dots) with theme colors
 * - Loading and empty states
 * - Theme-aware styling throughout
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Node,
  Edge,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { X, LayoutGrid, Network, ExternalLink, RefreshCw, Maximize2 } from 'lucide-react';
import type { Theme } from '../../types';
import { useLayerStack } from '../../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../../constants/modalPriorities';
import { DocumentNode } from './DocumentNode';
import { ExternalLinkNode } from './ExternalLinkNode';
import { buildGraphData, GraphNodeData } from './graphDataBuilder';

/**
 * Props for the DocumentGraphView component
 */
export interface DocumentGraphViewProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** Current theme */
  theme: Theme;
  /** Root directory path to scan for markdown files */
  rootPath: string;
  /** Optional callback when a document node is double-clicked */
  onDocumentOpen?: (filePath: string) => void;
  /** Optional callback when an external link node is double-clicked */
  onExternalLinkOpen?: (url: string) => void;
}

/**
 * Layout type for the graph
 */
type LayoutType = 'force' | 'hierarchical';

/**
 * Register custom node types for React Flow
 */
const nodeTypes = {
  documentNode: DocumentNode,
  externalLinkNode: ExternalLinkNode,
};

/**
 * Inner component that uses React Flow hooks (must be inside ReactFlowProvider)
 */
function DocumentGraphViewInner({
  isOpen,
  onClose,
  theme,
  rootPath,
  onDocumentOpen,
  onExternalLinkOpen,
}: DocumentGraphViewProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layoutType, setLayoutType] = useState<LayoutType>('force');
  const [includeExternalLinks, setIncludeExternalLinks] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const { registerLayer, unregisterLayer } = useLayerStack();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { fitView } = useReactFlow();

  // Register with layer stack for Escape handling
  useEffect(() => {
    if (isOpen) {
      const id = registerLayer({
        type: 'modal',
        priority: MODAL_PRIORITIES.DOCUMENT_GRAPH,
        blocksLowerLayers: true,
        capturesFocus: true,
        focusTrap: 'lenient',
        onEscape: () => onCloseRef.current(),
      });
      return () => unregisterLayer(id);
    }
  }, [isOpen, registerLayer, unregisterLayer]);

  // Focus container on open
  useEffect(() => {
    if (isOpen) {
      containerRef.current?.focus();
    }
  }, [isOpen]);

  /**
   * Apply a simple force-directed-like layout using grid placement
   * For actual force-directed layout, we would use d3-force (Phase: Layout Algorithms task)
   */
  const applySimpleLayout = useCallback(
    (rawNodes: Node<GraphNodeData>[]): Node<GraphNodeData>[] => {
      if (rawNodes.length === 0) return [];

      const documentNodes = rawNodes.filter((n) => n.type === 'documentNode');
      const externalNodes = rawNodes.filter((n) => n.type === 'externalLinkNode');

      const spacing = layoutType === 'hierarchical' ? { x: 350, y: 150 } : { x: 300, y: 200 };
      const cols = Math.ceil(Math.sqrt(documentNodes.length));

      // Position document nodes in a grid
      const positionedDocs = documentNodes.map((node, i) => ({
        ...node,
        position: {
          x: (i % cols) * spacing.x,
          y: Math.floor(i / cols) * spacing.y,
        },
      }));

      // Position external nodes below or to the right
      const externalStartY =
        positionedDocs.length > 0
          ? Math.max(...positionedDocs.map((n) => n.position.y)) + spacing.y + 50
          : 0;

      const positionedExternal = externalNodes.map((node, i) => ({
        ...node,
        position: {
          x: (i % (cols + 2)) * 180,
          y: externalStartY + Math.floor(i / (cols + 2)) * 100,
        },
      }));

      return [...positionedDocs, ...positionedExternal];
    },
    [layoutType]
  );

  /**
   * Inject theme into node data for styling
   */
  const injectThemeIntoNodes = useCallback(
    (rawNodes: Node<GraphNodeData>[]): Node<GraphNodeData & { theme: Theme }>[] => {
      return rawNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          theme,
        },
      }));
    },
    [theme]
  );

  /**
   * Load and build graph data
   */
  const loadGraphData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const graphData = await buildGraphData({
        rootPath,
        includeExternalLinks,
      });

      // Apply layout
      const layoutedNodes = applySimpleLayout(graphData.nodes);

      // Inject theme
      const themedNodes = injectThemeIntoNodes(layoutedNodes);

      setNodes(themedNodes as Node[]);
      setEdges(graphData.edges);

      // Fit view after nodes are set
      setTimeout(() => {
        fitView({ padding: 0.1, duration: 300 });
      }, 50);
    } catch (err) {
      console.error('Failed to build graph data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load document graph');
    } finally {
      setLoading(false);
    }
  }, [rootPath, includeExternalLinks, applySimpleLayout, injectThemeIntoNodes, setNodes, setEdges, fitView]);

  // Load data when modal opens or settings change
  useEffect(() => {
    if (isOpen) {
      loadGraphData();
    }
  }, [isOpen, loadGraphData]);

  // Re-apply theme when it changes
  useEffect(() => {
    if (!loading && nodes.length > 0) {
      const themedNodes = nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          theme,
        },
      }));
      setNodes(themedNodes);
    }
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Handle node double-click for opening documents/links
   */
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node<GraphNodeData>) => {
      if (node.data.nodeType === 'document' && onDocumentOpen) {
        onDocumentOpen(node.data.filePath);
      } else if (node.data.nodeType === 'external' && onExternalLinkOpen) {
        // Open the first URL if multiple
        const urls = node.data.urls;
        if (urls.length > 0) {
          onExternalLinkOpen(urls[0]);
        }
      }
    },
    [onDocumentOpen, onExternalLinkOpen]
  );

  /**
   * Edge styling based on type and selection
   */
  const styledEdges = useMemo(() => {
    return edges.map((edge) => ({
      ...edge,
      style: {
        stroke: edge.type === 'external' ? theme.colors.textDim : theme.colors.textDim,
        strokeWidth: 1.5,
        strokeDasharray: edge.type === 'external' ? '4 4' : undefined,
      },
      animated: edge.type === 'external',
    }));
  }, [edges, theme.colors]);

  /**
   * Handle layout toggle
   */
  const handleLayoutToggle = useCallback(() => {
    setLayoutType((prev) => (prev === 'force' ? 'hierarchical' : 'force'));
  }, []);

  /**
   * Handle external links toggle
   */
  const handleExternalLinksToggle = useCallback(() => {
    setIncludeExternalLinks((prev) => !prev);
  }, []);

  /**
   * Handle fit view button
   */
  const handleFitView = useCallback(() => {
    fitView({ padding: 0.1, duration: 300 });
  }, [fitView]);

  if (!isOpen) return null;

  const documentCount = nodes.filter((n) => n.type === 'documentNode').length;
  const externalCount = nodes.filter((n) => n.type === 'externalLinkNode').length;

  return (
    <div
      className="fixed inset-0 modal-overlay flex items-center justify-center z-[9999] animate-in fade-in duration-100"
      onClick={onClose}
    >
      <div
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Document Graph"
        className="rounded-xl shadow-2xl border overflow-hidden flex flex-col outline-none"
        style={{
          backgroundColor: theme.colors.bgActivity,
          borderColor: theme.colors.border,
          width: '85vw',
          maxWidth: '1600px',
          height: '85vh',
          maxHeight: '950px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0"
          style={{ borderColor: theme.colors.border }}
        >
          <div className="flex items-center gap-3">
            <Network className="w-5 h-5" style={{ color: theme.colors.accent }} />
            <h2 className="text-lg font-semibold" style={{ color: theme.colors.textMain }}>
              Document Graph
            </h2>
            <span
              className="text-xs px-2 py-0.5 rounded"
              style={{
                backgroundColor: `${theme.colors.accent}20`,
                color: theme.colors.textDim,
              }}
            >
              {rootPath}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Layout Toggle */}
            <button
              onClick={handleLayoutToggle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors"
              style={{
                backgroundColor: `${theme.colors.accent}15`,
                color: theme.colors.textMain,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}25`)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}15`)}
              title={`Switch to ${layoutType === 'force' ? 'hierarchical' : 'force-directed'} layout`}
            >
              {layoutType === 'force' ? <LayoutGrid className="w-4 h-4" /> : <Network className="w-4 h-4" />}
              {layoutType === 'force' ? 'Hierarchical' : 'Force'}
            </button>

            {/* External Links Toggle */}
            <button
              onClick={handleExternalLinksToggle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors"
              style={{
                backgroundColor: includeExternalLinks ? `${theme.colors.accent}25` : `${theme.colors.accent}10`,
                color: includeExternalLinks ? theme.colors.accent : theme.colors.textDim,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}30`)}
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = includeExternalLinks
                  ? `${theme.colors.accent}25`
                  : `${theme.colors.accent}10`)
              }
              title={includeExternalLinks ? 'Hide external links' : 'Show external links'}
            >
              <ExternalLink className="w-4 h-4" />
              External
            </button>

            {/* Refresh Button */}
            <button
              onClick={() => loadGraphData()}
              className="p-1.5 rounded transition-colors"
              style={{ color: theme.colors.textDim }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="Refresh graph"
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>

            {/* Fit View Button */}
            <button
              onClick={handleFitView}
              className="p-1.5 rounded transition-colors"
              style={{ color: theme.colors.textDim }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="Fit view"
            >
              <Maximize2 className="w-4 h-4" />
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded transition-colors"
              style={{ color: theme.colors.textDim }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = `${theme.colors.accent}20`)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Content - React Flow Canvas */}
        <div className="flex-1 relative" style={{ backgroundColor: theme.colors.bgMain }}>
          {loading ? (
            <div
              className="h-full flex items-center justify-center"
              style={{ color: theme.colors.textDim }}
            >
              <RefreshCw className="w-6 h-6 animate-spin mr-2" />
              Scanning documents...
            </div>
          ) : error ? (
            <div
              className="h-full flex flex-col items-center justify-center gap-4"
              style={{ color: theme.colors.textDim }}
            >
              <p>Failed to load document graph</p>
              <p className="text-sm opacity-70">{error}</p>
              <button
                onClick={() => loadGraphData()}
                className="px-4 py-2 rounded text-sm"
                style={{
                  backgroundColor: theme.colors.accent,
                  color: theme.colors.bgMain,
                }}
              >
                Retry
              </button>
            </div>
          ) : nodes.length === 0 ? (
            <div
              className="h-full flex flex-col items-center justify-center gap-2"
              style={{ color: theme.colors.textDim }}
            >
              <Network className="w-12 h-12 opacity-30" />
              <p className="text-lg">No markdown files found</p>
              <p className="text-sm opacity-70">This directory doesn't contain any .md files</p>
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={styledEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDoubleClick={handleNodeDoubleClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.1 }}
              minZoom={0.1}
              maxZoom={2}
              defaultEdgeOptions={{
                type: 'smoothstep',
              }}
              proOptions={{ hideAttribution: true }}
            >
              {/* Background Pattern */}
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color={theme.colors.border}
              />

              {/* Controls */}
              <Controls
                showZoom={true}
                showFitView={true}
                showInteractive={false}
                style={{
                  backgroundColor: theme.colors.bgActivity,
                  borderColor: theme.colors.border,
                  borderRadius: 8,
                }}
              />

              {/* Minimap */}
              <MiniMap
                nodeColor={(node) => {
                  if (node.type === 'documentNode') return theme.colors.accent;
                  if (node.type === 'externalLinkNode') return theme.colors.textDim;
                  return theme.colors.border;
                }}
                nodeStrokeWidth={2}
                pannable
                zoomable
                style={{
                  backgroundColor: theme.colors.bgSidebar,
                  borderColor: theme.colors.border,
                  borderRadius: 8,
                }}
              />
            </ReactFlow>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t flex items-center justify-between text-xs flex-shrink-0"
          style={{
            borderColor: theme.colors.border,
            color: theme.colors.textDim,
          }}
        >
          <span>
            {documentCount > 0
              ? `${documentCount} document${documentCount !== 1 ? 's' : ''}${
                  includeExternalLinks && externalCount > 0 ? `, ${externalCount} external domain${externalCount !== 1 ? 's' : ''}` : ''
                }`
              : 'No documents found'}
          </span>
          <span style={{ opacity: 0.7 }}>Double-click to open • Drag to move • Scroll to zoom • Esc to close</span>
        </div>
      </div>
    </div>
  );
}

/**
 * DocumentGraphView component wrapped with ReactFlowProvider
 */
export function DocumentGraphView(props: DocumentGraphViewProps) {
  if (!props.isOpen) return null;

  return (
    <ReactFlowProvider>
      <DocumentGraphViewInner {...props} />
    </ReactFlowProvider>
  );
}

export default DocumentGraphView;
