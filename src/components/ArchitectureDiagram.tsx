import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type NodeProps,
  type Node,
  type Edge,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import { Box, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import type { Architecture } from '../../shared/schema';
import { iconFileFor } from '../../shared/icons';
import '@xyflow/react/dist/style.css';

const elk = new ELK();
type ServiceData = {
  label: string;
  description: string;
  icon?: string;
  active: boolean;
  dimmed: boolean;
  service: string | null;
  onActivate: () => void;
};
type ServiceNode = Node<ServiceData, 'service'>;
function Service({ data }: NodeProps<ServiceNode>) {
  return (
    <div
      className={`service-node ${data.active ? 'is-active' : ''} ${data.dimmed ? 'is-dimmed' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${data.label}。${data.description}`}
      title={data.label}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          data.onActivate();
        }
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div className="service-node-icon">
        {data.icon ? (
          <img
            src={data.icon}
            alt=""
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <Box size={27} />
        )}
      </div>
      <div className="service-node-label">{data.label}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { service: Service };
type Props = {
  graph: Architecture;
  requirementIds: string[];
  highlightedNodeIds: string[];
  highlightedEdgeIds: string[];
  onRequirements: (ids: string[]) => void;
  iconBase?: string;
  iconMap?: Record<string, string>;
};
function DiagramContent({
  graph,
  requirementIds,
  highlightedNodeIds,
  highlightedEdgeIds,
  onRequirements,
  iconBase = '/aws-icons/',
  iconMap,
}: Props) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [layoutError, setLayoutError] = useState(false);
  const [step, setStep] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const flow = useReactFlow();
  useEffect(() => {
    let cancelled = false;
    setStep(-1);
    setPlaying(false);
    setSelectedNode(null);
    setLayoutError(false);
    setPositions({});
    elk
      .layout({
        id: graph.id,
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': 'RIGHT',
          'elk.spacing.nodeNode': '46',
          'elk.layered.spacing.nodeNodeBetweenLayers': '80',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          'elk.padding': '[top=24,left=24,bottom=24,right=24]',
        },
        children: graph.nodes.map((n) => ({ id: n.id, width: 190, height: 150 })),
        edges: graph.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
      })
      .then((layout) => {
        if (!cancelled)
          setPositions(
            Object.fromEntries(
              (layout.children ?? []).map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]),
            ),
          );
      })
      .catch(() => {
        if (!cancelled) {
          setLayoutError(true);
          setPositions(
            Object.fromEntries(
              graph.nodes.map((n, i) => [n.id, { x: (i % 3) * 280, y: Math.floor(i / 3) * 190 }]),
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [graph]);
  useEffect(() => {
    if (!Object.keys(positions).length) return;
    const id = window.setTimeout(
      () => flow.fitView({ padding: 0.17, minZoom: 0.25, maxZoom: 1, duration: 0 }),
      100,
    );
    return () => clearTimeout(id);
  }, [positions, flow]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setStep((current) => {
          if (current >= graph.steps.length - 1) {
            setPlaying(false);
            return current;
          }
          return current + 1;
        }),
      2200,
    );
    return () => clearInterval(timer);
  }, [playing, graph.steps.length]);
  const activeStep = step >= 0 ? graph.steps[step] : null;
  const hasHighlights = !!(
    requirementIds.length ||
    highlightedNodeIds.length ||
    highlightedEdgeIds.length ||
    activeStep
  );
  const nodes: ServiceNode[] = useMemo(
    () =>
      graph.nodes.map((n) => {
        const filename = iconFileFor(n.service);
        const icon =
          (n.service && iconMap?.[n.service]) ||
          (filename && iconMap?.[filename]) ||
          (!iconMap && filename ? `${iconBase}${filename}` : undefined);
        const active =
          n.requirementIds.some((id) => requirementIds.includes(id)) ||
          highlightedNodeIds.includes(n.id) ||
          !!activeStep?.nodeIds.includes(n.id) ||
          selectedNode === n.id;
        return {
          id: n.id,
          type: 'service',
          position: positions[n.id] ?? { x: 0, y: 0 },
          data: {
            label: n.label,
            description: n.description,
            icon: icon || undefined,
            active,
            dimmed: hasHighlights && !active,
            service: n.service,
            onActivate: () => {
              setSelectedNode(n.id);
              onRequirements(n.requirementIds);
            },
          },
          ariaLabel: `${n.label}。${n.description}`,
          focusable: false,
        };
      }),
    [
      graph.nodes,
      positions,
      requirementIds,
      highlightedNodeIds,
      activeStep,
      selectedNode,
      hasHighlights,
      iconMap,
      iconBase,
    ],
  );
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const active =
          e.requirementIds.some((id) => requirementIds.includes(id)) ||
          highlightedEdgeIds.includes(e.id) ||
          !!activeStep?.edgeIds.includes(e.id);
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          label: e.label,
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: active ? '#e87722' : '#8190a2' },
          style: {
            stroke: active ? '#e87722' : '#8190a2',
            strokeWidth: active ? 2.6 : 1.5,
            opacity: hasHighlights && !active ? 0.28 : 1,
            strokeDasharray: e.kind === 'data' ? undefined : '5 4',
          },
          labelStyle: { fontSize: 13, fill: '#425065', fontWeight: 600 },
          labelBgPadding: [7, 5],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
        };
      }),
    [graph.edges, requirementIds, highlightedEdgeIds, activeStep, hasHighlights],
  );
  const detail = graph.nodes.find((n) => n.id === selectedNode);
  return (
    <>
      <div className="diagram-canvas" aria-label="AWSアーキテクチャ図">
        {!Object.keys(positions).length ? (
          <div className="diagram-loading">構成図を配置しています…</div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.15}
            maxZoom={1.8}
            fitView
            fitViewOptions={{ padding: 0.17 }}
            onNodeClick={(_, node) => {
              setSelectedNode(node.id);
              onRequirements(graph.nodes.find((n) => n.id === node.id)?.requirementIds ?? []);
            }}
            onPaneClick={() => setSelectedNode(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#ced7e2" gap={22} size={1.1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        <span className="diagram-hint">ドラッグで移動 · ＋ / − で拡大縮小</span>
      </div>
      {layoutError && (
        <p className="inline-note">自動配置を調整できなかったため、簡易配置で表示しています。</p>
      )}
      <div className="flow-controls">
        <button
          className="icon-button"
          aria-label={playing ? '処理の再生を停止' : '処理の流れを再生'}
          onClick={() => {
            if (playing) setPlaying(false);
            else {
              if (step < 0 || step === graph.steps.length - 1) setStep(0);
              setPlaying(true);
            }
          }}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button
          className="icon-button"
          aria-label="前の処理"
          disabled={step <= 0}
          onClick={() => {
            setPlaying(false);
            setStep((s) => s - 1);
          }}
        >
          <ChevronLeft size={17} />
        </button>
        <div className="flow-step">
          <span className="eyebrow">
            DATA FLOW {step >= 0 ? `${step + 1} / ${graph.steps.length}` : ''}
          </span>
          <strong>{activeStep?.title ?? '処理の流れをたどる'}</strong>
        </div>
        <button
          className="icon-button"
          aria-label="次の処理"
          disabled={step === graph.steps.length - 1}
          onClick={() => {
            setPlaying(false);
            setStep((s) => s + 1);
          }}
        >
          <ChevronRight size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="処理の強調をリセット"
          onClick={() => {
            setStep(-1);
            setPlaying(false);
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      {(activeStep || detail) && (
        <div className="diagram-detail">
          <strong>{detail?.label ?? activeStep?.title}</strong>
          <p>{detail?.description ?? activeStep?.description}</p>
        </div>
      )}
    </>
  );
}
export function ArchitectureDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramContent {...props} />
    </ReactFlowProvider>
  );
}
