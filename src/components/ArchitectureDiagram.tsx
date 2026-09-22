import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  BaseEdge,
  getSmoothStepPath,
  type EdgeProps,
  Handle,
  Position,
  MarkerType,
  type NodeProps,
  type Node,
  type Edge,
  useReactFlow,
  useViewport,
  ReactFlowProvider,
} from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import {
  Box,
  ChevronLeft,
  ChevronRight,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  UserRound,
} from 'lucide-react';
import type { Architecture } from '../../shared/schema';
import { iconFileFor } from '../../shared/icons';
import '@xyflow/react/dist/style.css';

// Keep an angled connector's caption beside its source segment, clear of
// descriptions underneath an earlier node in the same input column.
function StudyEdge(props: EdgeProps) {
  const [path, centerX, centerY] = getSmoothStepPath(props);
  const horizontalPorts =
    props.sourcePosition === Position.Left || props.sourcePosition === Position.Right;
  const offsetCaption = horizontalPorts && Math.abs(props.sourceY - props.targetY) > 90;
  return (
    <BaseEdge
      id={props.id}
      path={path}
      markerEnd={props.markerEnd}
      style={props.style}
      label={props.label}
      labelX={offsetCaption ? (props.sourceX + props.targetX) / 2 : centerX}
      labelY={offsetCaption ? props.sourceY - 16 : centerY}
      labelStyle={props.labelStyle}
      labelBgStyle={props.labelBgStyle}
      labelBgPadding={props.labelBgPadding}
      labelBgBorderRadius={props.labelBgBorderRadius}
    />
  );
}
const edgeTypes = { study: StudyEdge };

const elk = new ELK();
const nodeWidth = 190;
const nodeHeight = 178;
const isPerson = (service: string | null, label: string) =>
  !service && /分析担当|利用者|ユーザー|ユーザ|analyst|\buser\b/i.test(label);
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
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  return (
    <div
      className={`service-node ${data.active ? 'is-active' : ''} ${data.dimmed ? 'is-dimmed' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${data.label}。${data.description}`}
      title={data.description || data.label}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          data.onActivate();
        }
      }}
    >
      <Handle id="target-left" type="target" position={Position.Left} />
      <Handle id="target-right" type="target" position={Position.Right} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} />
      <div className="service-node-icon">
        {data.icon && data.icon !== failedIcon ? (
          <img src={data.icon} alt="" onError={() => setFailedIcon(data.icon ?? null)} />
        ) : isPerson(data.service, data.label) ? (
          <UserRound size={66} strokeWidth={1.45} />
        ) : (
          <Box size={54} strokeWidth={1.5} />
        )}
      </div>
      <div className="service-node-label">{data.label}</div>
      {data.description && <div className="service-node-description">{data.description}</div>}
      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-top" type="source" position={Position.Top} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const compact = canvasSize.width > 0 && canvasSize.width < 520;
  const dense = canvasSize.width >= 520 && canvasSize.height > 0 && canvasSize.height < 340;
  const layoutNodeHeight = dense ? 134 : nodeHeight;
  const canvas = useRef<HTMLDivElement>(null);
  const flow = useReactFlow();
  const { zoom } = useViewport();
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const updateSize = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (!width || !height) return;
      setCanvasSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setStep(-1);
    setPlaying(false);
    setSelectedNode(null);
  }, [graph]);
  useEffect(() => {
    let cancelled = false;
    setLayoutError(false);
    setPositions({});
    elk
      .layout({
        id: graph.id,
        layoutOptions: {
          'elk.algorithm': 'layered',
          'elk.direction': compact ? 'DOWN' : 'RIGHT',
          'elk.spacing.nodeNode': compact || dense ? '24' : '44',
          'elk.layered.spacing.nodeNodeBetweenLayers': compact ? '40' : '100',
          'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
          'elk.padding': '[top=24,left=24,bottom=24,right=24]',
        },
        children: graph.nodes.map((n) => ({
          id: n.id,
          width: nodeWidth,
          height: layoutNodeHeight,
        })),
        edges: graph.edges.map((edge) => {
          const source = graph.nodes.find((node) => node.id === edge.from);
          // Place an analyst beside the output of the query engine. This affects
          // layout only: the rendered connector retains its actual direction.
          const personQuery =
            edge.kind === 'control' && source && isPerson(source.service, source.label);
          return {
            id: edge.id,
            sources: [personQuery ? edge.to : edge.from],
            targets: [personQuery ? edge.from : edge.to],
          };
        }),
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
              graph.nodes.map((n, i) => [
                n.id,
                compact
                  ? { x: 0, y: i * 218 }
                  : { x: (i % 3) * 290, y: Math.floor(i / 3) * (layoutNodeHeight + 52) },
              ]),
            ),
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [graph, compact, dense, layoutNodeHeight]);
  useEffect(() => {
    if (!Object.keys(positions).length) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (canvas.current?.clientWidth && canvas.current.clientHeight)
          void flow.fitView({
            padding: 0.08,
            minZoom: 0.18,
            maxZoom: 1,
            duration: 0,
          });
      });
    };
    const id = window.setTimeout(fit, 100);
    const observer = new ResizeObserver(fit);
    if (canvas.current) observer.observe(canvas.current);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
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
      onRequirements,
    ],
  );
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const pointsLeft = (positions[e.from]?.x ?? 0) > (positions[e.to]?.x ?? 0);
        const deltaY = (positions[e.to]?.y ?? 0) - (positions[e.from]?.y ?? 0);
        const vertical = compact && Math.abs(deltaY) > nodeHeight / 2;
        const sourceHandle = vertical
          ? deltaY > 0
            ? 'source-bottom'
            : 'source-top'
          : pointsLeft
            ? 'source-left'
            : 'source-right';
        const targetHandle = vertical
          ? deltaY > 0
            ? 'target-top'
            : 'target-bottom'
          : pointsLeft
            ? 'target-right'
            : 'target-left';
        const active =
          e.requirementIds.some((id) => requirementIds.includes(id)) ||
          highlightedEdgeIds.includes(e.id) ||
          !!activeStep?.edgeIds.includes(e.id);
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          sourceHandle,
          targetHandle,
          label: e.label,
          type: 'study',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#263f5d' },
          style: {
            stroke: '#263f5d',
            strokeWidth: active ? 2.1 : 1.6,
            opacity: hasHighlights && !active ? 0.58 : 1,
            strokeDasharray: e.kind === 'data' ? undefined : '5 4',
          },
          labelStyle: { fontSize: 14, fill: '#203954', fontWeight: 500 },
          labelBgPadding: [9, 6],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: '#fff', fillOpacity: 0.95 },
        };
      }),
    [
      graph.edges,
      positions,
      compact,
      requirementIds,
      highlightedEdgeIds,
      activeStep,
      hasHighlights,
    ],
  );
  const detail = graph.nodes.find((n) => n.id === selectedNode);
  return (
    <div
      className={`architecture-diagram${compact ? ' is-compact' : ''}${dense ? ' is-dense' : ''}`}
    >
      <div ref={canvas} className="diagram-canvas" aria-label="AWSアーキテクチャ図">
        {!Object.keys(positions).length ? (
          <div className="diagram-loading">構成図を配置しています…</div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.15}
            maxZoom={1.8}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1 }}
            onNodeClick={(_, node) => {
              setSelectedNode(node.id);
              onRequirements(graph.nodes.find((n) => n.id === node.id)?.requirementIds ?? []);
            }}
            onPaneClick={() => setSelectedNode(null)}
            proOptions={{ hideAttribution: true }}
          />
        )}
      </div>
      {layoutError && (
        <p className="inline-note">自動配置を調整できなかったため、簡易配置で表示しています。</p>
      )}
      <div className="diagram-toolbar">
        <div className="diagram-zoom" role="group" aria-label="構成図の表示倍率">
          <button
            className="icon-button"
            type="button"
            aria-label="構成図を縮小"
            disabled={zoom <= 0.15}
            onClick={() => void flow.zoomOut()}
          >
            <Minus size={17} />
          </button>
          <button
            className="diagram-zoom-value"
            type="button"
            aria-label="構成図全体を表示"
            title="構成図全体を表示"
            onClick={() => void flow.fitView({ padding: 0.08, minZoom: 0.18, maxZoom: 1 })}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="構成図を拡大"
            disabled={zoom >= 1.8}
            onClick={() => void flow.zoomIn()}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="flow-controls">
          <button
            className="flow-play-button"
            type="button"
            aria-label={playing ? '処理の再生を停止' : '処理の流れを再生'}
            disabled={!graph.steps.length}
            onClick={() => {
              setSelectedNode(null);
              if (playing) setPlaying(false);
              else {
                if (step < 0 || step === graph.steps.length - 1) setStep(0);
                setPlaying(true);
              }
            }}
          >
            {playing ? <Pause size={17} /> : <Play size={17} />}
            <span>{playing ? '再生を停止' : '図の流れを再生'}</span>
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="前の処理"
            disabled={step <= 0}
            onClick={() => {
              setSelectedNode(null);
              setPlaying(false);
              setStep((s) => s - 1);
            }}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="次の処理"
            disabled={step === graph.steps.length - 1}
            onClick={() => {
              setSelectedNode(null);
              setPlaying(false);
              setStep((s) => s + 1);
            }}
          >
            <ChevronRight size={17} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="処理の強調をリセット"
            onClick={() => {
              setStep(-1);
              setPlaying(false);
            }}
          >
            <RotateCcw size={16} />
          </button>
        </div>
        {activeStep && (
          <div className="flow-step" aria-live="polite">
            <span className="eyebrow">
              {step + 1} / {graph.steps.length}
            </span>
            <strong>{activeStep.title}</strong>
          </div>
        )}
      </div>
      {(activeStep || detail) && (
        <div className="diagram-detail">
          <strong>{detail?.label ?? activeStep?.title}</strong>
          <p>{detail?.description ?? activeStep?.description}</p>
        </div>
      )}
    </div>
  );
}
export function ArchitectureDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramContent {...props} />
    </ReactFlowProvider>
  );
}
