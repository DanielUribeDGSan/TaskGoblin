import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';

interface Point {
    x: number;
    y: number;
}

interface PaintElement {
    id: string;
    type: 'pencil' | 'pen' | 'marker' | 'brush' | 'eraser' | 'rect' | 'circle' | 'text';
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    points?: Point[];
    text?: string;
    color: string;
    thickness: number;
    opacity: number;
    fontSize?: number;
    fontFamily?: string;
    textAlign?: 'left' | 'center' | 'right';
}

type ToolType = 'pencil' | 'pen' | 'marker' | 'brush' | 'eraser' | 'text' | 'rect' | 'circle' | 'move';

const PaintPropertiesPanel = memo(function PaintPropertiesPanel({
    color,
    setColor,
    thickness,
    setThickness,
    opacity,
    setOpacity,
    tool,
    onClearAll,
    onReverseOrder,
}: {
    color: string;
    setColor: (c: string) => void;
    thickness: number;
    setThickness: (n: number) => void;
    opacity: number;
    setOpacity: (n: number) => void;
    tool: ToolType;
    onClearAll: () => void;
    onReverseOrder: () => void;
}) {
    return (
        <div className="paint-properties-anchor">
            <div className="paint-properties">
                <div className="prop-section">
                    <label>Trazo</label>
                    <div className="color-grid">
                        {['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000'].map(c => (
                            <div
                                key={c}
                                className={`color-swatch ${color === c ? 'active' : ''}`}
                                style={{ backgroundColor: c }}
                                onClick={() => setColor(c)}
                            />
                        ))}
                    </div>
                </div>
                {tool === 'text' && (
                    <div className="prop-section">
                        <label>Tamaño de Fuente</label>
                        <div className="size-btns">
                            {[16, 24, 32, 48].map(size => (
                                <button
                                    key={size}
                                    className={`size-btn ${thickness === size / 5 ? 'active' : ''}`}
                                    onClick={() => setThickness(size / 5)}
                                >
                                    {size === 16 ? 'S' : size === 24 ? 'M' : size === 32 ? 'L' : 'XL'}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                <div className="prop-section">
                    <label>Grosor / Tamaño: {thickness}</label>
                    <input type="range" min="1" max="50" value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
                </div>
                <div className="prop-section">
                    <label>Opacidad: {Math.round(opacity * 100)}%</label>
                    <input type="range" min="0.1" max="1" step="0.1" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
                </div>
                <div className="prop-section actions">
                    <label>Capas / Acciones</label>
                    <div className="action-btns">
                        <button type="button" onClick={onReverseOrder} title="Invertir Orden">🔄</button>
                        <button type="button" className="danger" onClick={onClearAll} title="Borrar Todo">🗑️</button>
                    </div>
                </div>
            </div>
        </div>
    );
});

const PaintBoard = ({ onToggleSidebar, onClose }: { onToggleSidebar: (show: boolean) => void, onClose: () => void }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const canvasPreviewRef = useRef<HTMLCanvasElement>(null);
    const elementsRef = useRef<PaintElement[]>([]);
    const [elements, setElements] = useState<PaintElement[]>([]);
    elementsRef.current = elements;
    const [tool, setTool] = useState<'pencil' | 'pen' | 'marker' | 'brush' | 'eraser' | 'text' | 'rect' | 'circle' | 'move'>('pencil');
    const [color, setColor] = useState('#ff0000');
    const [thickness, setThickness] = useState(3);
    const [opacity, setOpacity] = useState(1);

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [selectionBox, setSelectionBox] = useState<{ start: Point; current: Point } | null>(null);
    const [previewElement, setPreviewElement] = useState<PaintElement | null>(null);
    const [activeTextId, setActiveTextId] = useState<string | null>(null);
    const [startPos, setStartPos] = useState<Point | null>(null);

    // Initial window setup (Mount/Unmount only)
    useEffect(() => {
        const setup = async () => {
            await invoke('toggle_paint_mode', { active: true });
            onToggleSidebar(false);
        };
        setup();

        return () => {
            invoke('toggle_paint_mode', { active: false });
            onToggleSidebar(true);
        };
    }, [onToggleSidebar]);

    // Independent Keyboard Listeners
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0 && !activeTextId) {
                setElements(prev => prev.filter(el => !selectedIds.includes(el.id)));
                setSelectedIds([]);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, activeTextId]);

    const handleMouseDown = (e: React.MouseEvent) => {
        // Prevent drawing when clicking on UI panels
        if (e.target !== canvasPreviewRef.current) return;

        const rect = canvasPreviewRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (tool === 'move') {
            // Find clicked element (reverse order for top-most)
            const clicked = [...elements].reverse().find(el => {
                const width = el.width || 100;
                const height = el.height || el.fontSize || 30;

                if (el.type === 'rect' || el.type === 'circle' || el.type === 'text') {
                    return x >= (el.x || 0) && x <= (el.x || 0) + width &&
                        y >= (el.y || 0) - (el.type === 'text' ? height : 0) && y <= (el.y || 0) + (el.type === 'text' ? 0 : height);
                }
                if (el.points) {
                    const xs = el.points.map(p => p.x);
                    const ys = el.points.map(p => p.y);
                    const minX = Math.min(...xs);
                    const maxX = Math.max(...xs);
                    const minY = Math.min(...ys);
                    const maxY = Math.max(...ys);
                    return x >= minX && x <= maxX && y >= minY && y <= maxY;
                }
                return false;
            });

            if (clicked) {
                if (e.shiftKey) {
                    setSelectedIds(prev => prev.includes(clicked.id) ? prev.filter(id => id !== clicked.id) : [...prev, clicked.id]);
                } else if (!selectedIds.includes(clicked.id)) {
                    setSelectedIds([clicked.id]);
                }
                setStartPos({ x, y });
            } else {
                setSelectedIds([]);
                setSelectionBox({ start: { x, y }, current: { x, y } });
            }
            return;
        }

        setStartPos({ x, y });

        if (tool === 'text') {
            const newTextId = Date.now().toString();
            const newText: PaintElement = {
                id: newTextId,
                type: 'text',
                x,
                y,
                text: '',
                color,
                thickness: 0,
                opacity,
                fontSize: thickness * 5, // Font size related to thickness
            };
            setElements(prev => [...prev, newText]);
            setActiveTextId(newTextId);
            return;
        }

        setPreviewElement({
            id: 'preview',
            type: tool as any,
            x,
            y,
            width: 0,
            height: 0,
            points: [{ x, y }],
            color,
            thickness,
            opacity
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const rect = canvasPreviewRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (tool === 'move' && startPos) {
            if (selectedIds.length > 0) {
                const dx = x - startPos.x;
                const dy = y - startPos.y;
                setElements(prev => prev.map(el => {
                    if (selectedIds.includes(el.id)) {
                        if (el.type === 'rect' || el.type === 'circle' || el.type === 'text') {
                            return { ...el, x: (el.x || 0) + dx, y: (el.y || 0) + dy };
                        } else if (el.points) {
                            return { ...el, points: el.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                        }
                    }
                    return el;
                }));
                setStartPos({ x, y });
            } else if (selectionBox) {
                setSelectionBox(prev => prev ? { ...prev, current: { x, y } } : null);
            }
            return;
        }

        if (!startPos || !previewElement) return;

        if (tool === 'rect' || tool === 'circle') {
            setPreviewElement(prev => prev ? {
                ...prev,
                width: x - startPos.x,
                height: y - startPos.y
            } : null);
        } else if (['pencil', 'pen', 'marker', 'brush', 'eraser'].includes(tool)) {
            setPreviewElement(prev => prev ? {
                ...prev,
                points: [...(prev.points || []), { x, y }]
            } : null);
        }
    };

    const handleMouseUp = () => {
        if (tool === 'move' && selectionBox) {
            const minX = Math.min(selectionBox.start.x, selectionBox.current.x);
            const maxX = Math.max(selectionBox.start.x, selectionBox.current.x);
            const minY = Math.min(selectionBox.start.y, selectionBox.current.y);
            const maxY = Math.max(selectionBox.start.y, selectionBox.current.y);

            const newlySelected = elements.filter(el => {
                let ex = el.x || 0;
                let ey = el.y || 0;
                if (el.points) {
                    ex = Math.min(...el.points.map(p => p.x));
                    ey = Math.min(...el.points.map(p => p.y));
                }
                return ex >= minX && ex <= maxX && ey >= minY && ey <= maxY;
            }).map(el => el.id);

            setSelectedIds(newlySelected);
            setSelectionBox(null);
        }

        if (previewElement) {
            setElements(prev => [...prev, { ...previewElement, id: Date.now().toString() }]);
        }
        setPreviewElement(null);
        setStartPos(null);
    };

    const handleTextChange = (id: string, text: string) => {
        setElements(prev => prev.map(el => el.id === id ? { ...el, text } : el));
    };

    const closeTextEdit = () => {
        setActiveTextId(null);
    };

    const clearAll = useCallback(() => {
        requestAnimationFrame(() => {
            setElements([]);
            setSelectedIds([]);
            setPreviewElement(null);
            setActiveTextId(null);
        });
    }, []);

    const reverseOrder = useCallback(() => {
        setElements(prev => [...prev].reverse());
    }, []);

    const closePaint = async () => {
        onClose();
    };

    // Draw Main Elements (Only when elements change)
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        elements.forEach(el => drawElement(ctx, el));
    }, [elements, selectedIds]);

    // Draw Previews (Active Tool / Marquee)
    useEffect(() => {
        const canvas = canvasPreviewRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animationFrameId: number;
        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            if (previewElement) {
                drawElement(ctx, previewElement);
            }

            if (tool === 'move' && selectionBox) {
                ctx.setLineDash([5, 5]);
                ctx.strokeStyle = 'rgba(0, 122, 255, 0.5)';
                ctx.strokeRect(
                    selectionBox.start.x,
                    selectionBox.start.y,
                    selectionBox.current.x - selectionBox.start.x,
                    selectionBox.current.y - selectionBox.start.y
                );
                ctx.setLineDash([]);
            }
            animationFrameId = requestAnimationFrame(render);
        };
        render();
        return () => cancelAnimationFrame(animationFrameId);
    }, [previewElement, selectionBox, tool]);

    // Resize handler: only on mount and real window resize, so clearing canvas doesn't trigger reflow and squash the properties panel
    useEffect(() => {
        const handleResize = () => {
            [canvasRef.current, canvasPreviewRef.current].forEach(canvas => {
                if (canvas) {
                    canvas.width = window.innerWidth;
                    canvas.height = window.innerHeight;
                }
            });
            const ctx = canvasRef.current?.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
                elementsRef.current.forEach(el => drawElement(ctx, el));
            }
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const drawElement = (ctx: CanvasRenderingContext2D, el: PaintElement) => {
        ctx.beginPath();
        ctx.strokeStyle = el.color;
        ctx.fillStyle = el.color;
        ctx.lineWidth = el.thickness;
        ctx.globalAlpha = el.opacity;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        if (el.type === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
            ctx.globalCompositeOperation = 'source-over';
        }

        if (['pencil', 'pen', 'marker', 'brush', 'eraser'].includes(el.type)) {
            if (!el.points || el.points.length < 2) return;

            if (el.type === 'brush') {
                ctx.shadowBlur = el.thickness;
                ctx.shadowColor = el.color;
            } else if (el.type === 'marker') {
                ctx.globalAlpha = el.opacity * 0.5;
            }

            ctx.moveTo(el.points[0].x, el.points[0].y);
            el.points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.stroke();

            // Reset effects
            ctx.shadowBlur = 0;
            ctx.globalAlpha = el.opacity;
        } else if (el.type === 'rect') {
            ctx.strokeRect(el.x || 0, el.y || 0, el.width || 0, el.height || 0);
        } else if (el.type === 'circle') {
            const rx = Math.abs(el.width || 0) / 2;
            const ry = Math.abs(el.height || 0) / 2;
            const cx = (el.x || 0) + (el.width || 0) / 2;
            const cy = (el.y || 0) + (el.height || 0) / 2;
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
        } else if (el.type === 'text') {
            ctx.font = `${el.fontSize}px sans-serif`;
            ctx.textBaseline = 'top';
            ctx.fillText(el.text || '', el.x || 0, el.y || 0);
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;

        // Selection highlight
        if (selectedIds.includes(el.id)) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#007AFF';
            ctx.lineWidth = 1;
            if (el.type === 'rect' || el.type === 'circle' || el.type === 'text') {
                const width = el.width || 100;
                const height = el.height || el.fontSize || 30;
                ctx.strokeRect((el.x || 0) - 5, (el.y || 0) - (el.type === 'text' ? height : 0) - 5, width + 10, height + 10);
            } else if (el.points) {
                const xs = el.points.map(p => p.x);
                const ys = el.points.map(p => p.y);
                const minX = Math.min(...xs);
                const maxX = Math.max(...xs);
                const minY = Math.min(...ys);
                const maxY = Math.max(...ys);
                ctx.strokeRect(minX - 5, minY - 5, (maxX - minX) + 10, (maxY - minY) + 10);
            }
            ctx.setLineDash([]);
        }
    };

    const paintUI = (
        <div className="paint-portal-root">
            <div className={`paint-container tool-${tool}`} data-paint-root>
                {/* Dynamic Island Toolbar */}
                <div className="paint-toolbar-wrapper">
                    <div className="paint-toolbar">
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'pencil' ? 'active' : ''}`} onClick={() => setTool('pencil')} onKeyDown={(e) => e.key === 'Enter' && setTool('pencil')} title="Lápiz">✏️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')} onKeyDown={(e) => e.key === 'Enter' && setTool('pen')} title="Lapicero">✒️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'marker' ? 'active' : ''}`} onClick={() => setTool('marker')} onKeyDown={(e) => e.key === 'Enter' && setTool('marker')} title="Plumón">🖊️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')} onKeyDown={(e) => e.key === 'Enter' && setTool('brush')} title="Brocha">🖌️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} onKeyDown={(e) => e.key === 'Enter' && setTool('eraser')} title="Borrador">🧽</div>
                        <div className="toolbar-divider"></div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'text' ? 'active' : ''}`} onClick={() => setTool('text')} onKeyDown={(e) => e.key === 'Enter' && setTool('text')} title="Texto">A</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => setTool('rect')} onKeyDown={(e) => e.key === 'Enter' && setTool('rect')} title="Rectángulo">□</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'circle' ? 'active' : ''}`} onClick={() => setTool('circle')} onKeyDown={(e) => e.key === 'Enter' && setTool('circle')} title="Círculo">○</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'move' ? 'active' : ''}`} onClick={() => setTool('move')} onKeyDown={(e) => e.key === 'Enter' && setTool('move')} title="Mover">🖐️</div>
                        <div className="toolbar-divider"></div>
                        <div role="button" tabIndex={0} className="tool-btn danger" onClick={clearAll} onKeyDown={(e) => e.key === 'Enter' && clearAll()} title="Borrar Todo">🗑️</div>
                        <div role="button" tabIndex={0} className="tool-btn" onClick={closePaint} onKeyDown={(e) => e.key === 'Enter' && closePaint()} title="Cerrar">✕</div>
                    </div>
                </div>

                {/* Panel rendered in separate portal below so its DOM is never touched when canvas clears */}
                <canvas ref={canvasRef} className="paint-canvas main-canvas" />
                <canvas
                    ref={canvasPreviewRef}
                    width={window.innerWidth}
                    height={window.innerHeight}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    className="paint-canvas preview-canvas"
                />
            </div>

            {/* Text input outside paint-container so removing it on clear doesn't reflow the island */}
            {activeTextId && (() => {
                const activeEl = elements.find(el => el.id === activeTextId);
                if (!activeEl) return null;
                return (
                    <textarea
                        className="canvas-text-input"
                        autoFocus
                        value={activeEl.text || ''}
                        onChange={(e) => handleTextChange(activeTextId, e.target.value)}
                        onBlur={closeTextEdit}
                        onFocus={(e) => e.target.select()}
                        style={{
                            position: 'fixed',
                            left: (activeEl.x || 0) + 'px',
                            top: (activeEl.y || 0) + 'px',
                            color: activeEl.color,
                            fontSize: (activeEl.fontSize || 20) + 'px',
                        }}
                    />
                );
            })()}
        </div>
    );

    const panelPortal = createPortal(
        <PaintPropertiesPanel
            color={color}
            setColor={setColor}
            thickness={thickness}
            setThickness={setThickness}
            opacity={opacity}
            setOpacity={setOpacity}
            tool={tool}
            onClearAll={clearAll}
            onReverseOrder={reverseOrder}
        />,
        document.body
    );

    return (
        <>
            {createPortal(paintUI, document.body)}
            {panelPortal}
        </>
    );
};

export default PaintBoard;
