import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

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
type ResizeHandle = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se' | null;

const PaintPropertiesPanel = memo(function PaintPropertiesPanel({
    color,
    setColor,
    thickness,
    setThickness,
    opacity,
    setOpacity,
    tool,
    onHide,
    t,
    textInput,
    setTextInput,
    onAddText,
}: {
    color: string;
    setColor: (c: string) => void;
    thickness: number;
    setThickness: (n: number) => void;
    opacity: number;
    setOpacity: (n: number) => void;
    tool: ToolType;
    onHide: () => void;
    t: (key: string) => string;
    textInput: string;
    setTextInput: (s: string) => void;
    onAddText: () => void;
}) {
    return (
        <div className="paint-properties-anchor">
            <div className="paint-properties">
                <button type="button" className="close-panel-btn" onClick={onHide} title={t('paint.hide_panel')}>✕</button>
                <div className="prop-section">
                    <label htmlFor="color-picker">{t('paint.trazo')}</label>
                    <div id="color-picker" className="color-grid">
                        {['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffffff', '#000000'].map(c => (
                            <div
                                key={c}
                                role="button"
                                tabIndex={0}
                                className={`color-swatch ${color === c ? 'active' : ''}`}
                                style={{ backgroundColor: c }}
                                onClick={() => setColor(c)}
                                onKeyDown={(e) => e.key === 'Enter' && setColor(c)}
                            />
                        ))}
                    </div>
                </div>
                {tool === 'text' && (
                    <>
                        <div className="prop-section">
                            <label htmlFor="text-input">{t('paint.text')}</label>
                            <div className="sidebar-text-input-wrapper">
                                <textarea
                                    id="text-input"
                                    className="sidebar-text-area"
                                    value={textInput}
                                    onChange={(e) => setTextInput(e.target.value)}
                                    placeholder={t('paint.placeholder_text')}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            onAddText();
                                        }
                                    }}
                                />
                                <button type="button" className="add-text-btn" onClick={onAddText}>
                                    {t('paint.add_text')}
                                </button>
                            </div>
                        </div>
                        <div className="prop-section">
                            <label htmlFor="size-btns">{t('paint.font_size')}</label>
                            <div id="size-btns" className="size-btns">
                                {[16, 24, 32, 48].map(size => (
                                    <button
                                        key={size}
                                        type="button"
                                        className={`size-btn ${thickness === size / 5 ? 'active' : ''}`}
                                        onClick={() => setThickness(size / 5)}
                                    >
                                        {size === 16 ? 'S' : size === 24 ? 'M' : size === 32 ? 'L' : 'XL'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                )}
                <div className="prop-section">
                    <label htmlFor="thickness-range">{t('paint.thickness')}: {thickness}</label>
                    <input id="thickness-range" type="range" min="1" max="50" value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
                </div>
                <div className="prop-section">
                    <label htmlFor="opacity-range">{t('paint.opacity')}: {Math.round(opacity * 100)}%</label>
                    <input id="opacity-range" type="range" min="0.1" max="1" step="0.1" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
                </div>
            </div>
        </div>
    );
});

const PaintBoard = ({ onClose, t }: { onClose: () => void, t: (key: string) => string }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const canvasPreviewRef = useRef<HTMLCanvasElement>(null);
    const elementsRef = useRef<PaintElement[]>([]);
    const [elements, setElements] = useState<PaintElement[]>([]);
    elementsRef.current = elements;
    const [tool, setTool] = useState<ToolType>('pencil');
    const [color, setColor] = useState('#ff0000');
    const [thickness, setThickness] = useState(3);
    const [opacity, setOpacity] = useState(1);
    const [lastTool, setLastTool] = useState<ToolType>('pencil');

    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [selectionBox, setSelectionBox] = useState<{ start: Point; current: Point } | null>(null);
    const [previewElement, setPreviewElement] = useState<PaintElement | null>(null);
    const [startPos, setStartPos] = useState<Point | null>(null);
    const [resizeHandle, setResizeHandle] = useState<ResizeHandle>(null);
    const [isPanelVisible, setIsPanelVisible] = useState(true);
    const [textInput, setTextInput] = useState('');
    const lastMousePos = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

    const getResizeHandle = (x: number, y: number, el: PaintElement): ResizeHandle => {
        if (el.type !== 'rect' && el.type !== 'circle' && el.type !== 'text') return null;
        const width = el.width || 0;
        const height = el.height || el.fontSize || 30;
        const ex = el.x || 0;
        const ey = el.y || 0;
        const pad = 10;

        const left = Math.min(ex, ex + width);
        const right = Math.max(ex, ex + width);
        const top = Math.min(ey, ey + height);
        const bottom = Math.max(ey, ey + height);

        if (Math.abs(x - left) < pad && Math.abs(y - top) < pad) return 'nw';
        if (Math.abs(x - right) < pad && Math.abs(y - top) < pad) return 'ne';
        if (Math.abs(x - left) < pad && Math.abs(y - bottom) < pad) return 'sw';
        if (Math.abs(x - right) < pad && Math.abs(y - bottom) < pad) return 'se';
        if (Math.abs(x - (left + right) / 2) < pad && Math.abs(y - top) < pad) return 'n';
        if (Math.abs(x - (left + right) / 2) < pad && Math.abs(y - bottom) < pad) return 's';
        if (Math.abs(x - left) < pad && Math.abs(y - (top + bottom) / 2) < pad) return 'w';
        if (Math.abs(x - right) < pad && Math.abs(y - (top + bottom) / 2) < pad) return 'e';
        return null;
    };

    // Independent Keyboard Listeners
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
                setElements(prev => prev.filter(el => !selectedIds.includes(el.id)));
                setSelectedIds([]);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds]);

    // Reset inline cursor when tool changes so CSS can take over
    useEffect(() => {
        if (tool !== lastTool) {
            if (canvasPreviewRef.current) {
                canvasPreviewRef.current.style.cursor = '';
            }
            setLastTool(tool);
        }
    }, [tool, lastTool]);

    const measureText = (text: string, fontSize: number): number => {
        const canvas = canvasRef.current || document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return text.length * (fontSize * 0.6); // Fallback
        ctx.font = `${fontSize}px sans-serif`;
        return ctx.measureText(text).width;
    };

    const addTextToCanvas = (x: number, y: number, text?: string) => {
        const finalText = text || window.prompt(t('paint.placeholder_text'));
        if (finalText) {
            const fontSize = thickness * 5;
            const width = measureText(finalText, fontSize);
            const newText: PaintElement = {
                id: Date.now().toString(),
                type: 'text',
                x,
                y,
                text: finalText,
                color,
                thickness: 0,
                opacity,
                fontSize,
                width,
                height: fontSize,
            };
            setElements(prev => [...prev, newText]);
            if (text) setTextInput(''); // Clear sidebar input
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.target !== canvasPreviewRef.current) return;
        const rect = canvasPreviewRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (tool === 'move') {
            if (selectedIds.length === 1) {
                const el = elements.find(e => e.id === selectedIds[0]);
                if (el) {
                    const handle = getResizeHandle(x, y, el);
                    if (handle) {
                        setResizeHandle(handle);
                        setStartPos({ x, y });
                        return;
                    }
                }
            }

            const clicked = [...elements].reverse().find(el => {
                if (el.type === 'rect' || el.type === 'circle' || el.type === 'text') {
                    const width = el.width || 0;
                    const height = el.type === 'text' ? (el.fontSize || 20) : (el.height || 0);
                    const ex = el.x || 0;
                    const ey = el.y || 0;
                    const left = Math.min(ex, ex + width);
                    const right = Math.max(ex, ex + width);
                    const top = Math.min(ey, ey + height);
                    const bottom = Math.max(ey, ey + height);
                    return x >= left && x <= right && y >= top && y <= bottom;
                }
                if (el.points) {
                    const xs = el.points.map(p => p.x);
                    const ys = el.points.map(p => p.y);
                    const minX = Math.min(...xs) - 10;
                    const maxX = Math.max(...xs) + 10;
                    const minY = Math.min(...ys) - 10;
                    const maxY = Math.max(...ys) + 10;
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
                const handle = getResizeHandle(x, y, clicked);
                if (handle) setResizeHandle(handle);
                setStartPos({ x, y });
            } else {
                setSelectedIds([]);
                setSelectionBox({ start: { x, y }, current: { x, y } });
            }
            return;
        }

        setStartPos({ x, y });
        if (tool === 'text') {
            addTextToCanvas(x, y);
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

        if (tool === 'move') {
            const canvas = canvasPreviewRef.current;
            if (canvas && !startPos) {
                let newCursor = 'default';
                if (selectedIds.length === 1) {
                    const el = elements.find(e => e.id === selectedIds[0]);
                    if (el) {
                        const h = getResizeHandle(x, y, el);
                        if (h) {
                            if (h === 'nw' || h === 'se') newCursor = 'nwse-resize';
                            else if (h === 'ne' || h === 'sw') newCursor = 'nesw-resize';
                            else if (h === 'n' || h === 's') newCursor = 'ns-resize';
                            else if (h === 'w' || h === 'e') newCursor = 'ew-resize';
                        }
                    }
                }
                canvas.style.cursor = newCursor;
            }

            if (startPos) {
                const dx = x - startPos.x;
                const dy = y - startPos.y;

                if (resizeHandle && selectedIds.length === 1) {
                    setElements(prev => prev.map(el => {
                        if (el.id === selectedIds[0]) {
                            let { x: ex = 0, y: ey = 0, width: ew = 100, height: eh = 30 } = el;
                            if (el.type === 'text') eh = el.fontSize || 20;
                            if (resizeHandle.includes('e')) ew += dx;
                            if (resizeHandle.includes('s')) eh += dy;
                            if (resizeHandle.includes('w')) { ex += dx; ew -= dx; }
                            if (resizeHandle.includes('n')) { ey += dy; eh -= dy; }
                            if (el.type === 'text') {
                                const newFontSize = Math.max(10, eh);
                                const newWidth = measureText(el.text || '', newFontSize);
                                return { ...el, x: ex, y: ey, fontSize: newFontSize, width: newWidth, height: newFontSize };
                            }
                            return { ...el, x: ex, y: ey, width: Math.max(5, ew), height: Math.max(5, eh) };
                        }
                        return el;
                    }));
                    setStartPos({ x, y });
                } else if (selectedIds.length > 0) {
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
            }
            return;
        }

        lastMousePos.current = { x, y };
        if (!startPos || !previewElement) return;

        if (tool === 'rect' || tool === 'circle') {
            setPreviewElement(prev => prev ? { ...prev, width: x - startPos.x, height: y - startPos.y } : null);
        } else if (['pencil', 'pen', 'marker', 'brush', 'eraser'].includes(tool)) {
            setPreviewElement(prev => prev ? { ...prev, points: [...(prev.points || []), { x, y }] } : null);
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
        setResizeHandle(null);
    };

    const clearAll = useCallback(() => {
        requestAnimationFrame(() => {
            setElements([]);
            setSelectedIds([]);
            setPreviewElement(null);
        });
    }, []);



    const closePaint = async () => {
        onClose();
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        elements.forEach(el => drawElement(ctx, el));
    }, [elements, selectedIds]);

    useEffect(() => {
        const canvas = canvasPreviewRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        let animationFrameId: number;
        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (previewElement) drawElement(ctx, previewElement);
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
            ctx.lineWidth = el.thickness * 4;
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

        if (selectedIds.includes(el.id)) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#007AFF';
            ctx.lineWidth = 1;
            const isSingle = selectedIds.length === 1;

            if (el.type === 'rect' || el.type === 'circle' || el.type === 'text') {
                const width = el.width || 0;
                const height = el.type === 'text' ? (el.fontSize || 20) : (el.height || 0);
                const ex = el.x || 0;
                const ey = el.y || 0;
                const left = Math.min(ex, ex + width);
                const right = Math.max(ex, ex + width);
                const top = Math.min(ey, ey + height);
                const bottom = Math.max(ey, ey + height);

                ctx.strokeRect(left - 5, top - 5, (right - left) + 10, (bottom - top) + 10);
                ctx.setLineDash([]);

                if (isSingle) {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = '#007AFF';
                    ctx.lineWidth = 2;
                    const hs = 8;
                    const points = [
                        [left - 5, top - 5], [(left + right) / 2, top - 5], [right + 5, top - 5],
                        [left - 5, (top + bottom) / 2], [right + 5, (top + bottom) / 2],
                        [left - 5, bottom + 5], [(left + right) / 2, bottom + 5], [right + 5, bottom + 5]
                    ];
                    points.forEach(([hx, hy]) => {
                        ctx.beginPath();
                        ctx.arc(hx, hy, hs / 2, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();
                    });
                }
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
                <div className="paint-toolbar-wrapper">
                    <div className="paint-toolbar">
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'pencil' ? 'active' : ''}`} onClick={() => setTool('pencil')} onKeyDown={(e) => e.key === 'Enter' && setTool('pencil')} title={t('paint.pencil')}>✏️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')} onKeyDown={(e) => e.key === 'Enter' && setTool('pen')} title={t('paint.pen')}>✒️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'marker' ? 'active' : ''}`} onClick={() => setTool('marker')} onKeyDown={(e) => e.key === 'Enter' && setTool('marker')} title={t('paint.marker')}>🖊️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'brush' ? 'active' : ''}`} onClick={() => setTool('brush')} onKeyDown={(e) => e.key === 'Enter' && setTool('brush')} title={t('paint.brush')}>🖌️</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} onKeyDown={(e) => e.key === 'Enter' && setTool('eraser')} title={t('paint.eraser')}>🧽</div>
                        <div className="toolbar-divider"></div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'text' ? 'active' : ''}`} onClick={() => setTool('text')} onKeyDown={(e) => e.key === 'Enter' && setTool('text')} title={t('paint.text')}>A</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'rect' ? 'active' : ''}`} onClick={() => setTool('rect')} onKeyDown={(e) => e.key === 'Enter' && setTool('rect')} title={t('paint.rect')}>□</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'circle' ? 'active' : ''}`} onClick={() => setTool('circle')} onKeyDown={(e) => e.key === 'Enter' && setTool('circle')} title={t('paint.circle')}>○</div>
                        <div role="button" tabIndex={0} className={`tool-btn ${tool === 'move' ? 'active' : ''}`} onClick={() => setTool('move')} onKeyDown={(e) => e.key === 'Enter' && setTool('move')} title={t('paint.move')}>🖐️</div>
                        <div className="toolbar-divider"></div>
                        <div role="button" tabIndex={0} className="tool-btn danger" onClick={clearAll} onKeyDown={(e) => e.key === 'Enter' && clearAll()} title={t('paint.clear_all')}>🗑️</div>
                        <div role="button" tabIndex={0} className="tool-btn" onClick={closePaint} onKeyDown={(e) => e.key === 'Enter' && closePaint()} title={t('paint.close')}>✕</div>
                    </div>
                </div>

                {!isPanelVisible && (
                    <button className="show-panel-btn" onClick={() => setIsPanelVisible(true)} title={t('paint.show_panel')}>🎨</button>
                )}

                <canvas ref={canvasRef} className="paint-canvas main-canvas" />
                <canvas
                    ref={canvasPreviewRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    className="paint-canvas preview-canvas"
                />
            </div>
        </div>
    );

    return (
        <>
            {createPortal(paintUI, document.body)}
            {isPanelVisible && createPortal(
                <PaintPropertiesPanel
                    color={color}
                    setColor={setColor}
                    thickness={thickness}
                    setThickness={setThickness}
                    opacity={opacity}
                    setOpacity={setOpacity}
                    tool={tool}
                    onHide={() => setIsPanelVisible(false)}
                    t={t}
                    textInput={textInput}
                    setTextInput={setTextInput}
                    onAddText={() => addTextToCanvas(lastMousePos.current.x, lastMousePos.current.y, textInput)}
                />,
                document.body
            )}
        </>
    );
};

export default PaintBoard;
