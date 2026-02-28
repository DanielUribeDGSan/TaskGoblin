import { useState, useRef, useEffect } from "react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";

// Configure worker - Use unpkg for more reliability in production
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;

interface OverlayText {
    id: string;
    x: number;
    y: number;
    text: string;
    fontSize: number;
    color: string;
    width: number;
    height: number;
}

interface OverlaySignature {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    dataUrl: string; // Base64 PNG
}

interface PdfEditorProps {
    onClose: () => void;
    showToast: (msg: string) => void;
    t: (key: string) => string;
}

export default function PdfEditor({ onClose, showToast, t }: PdfEditorProps) {
    const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [numPages, setNumPages] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState<number>(1);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const [texts, setTexts] = useState<OverlayText[]>([]);
    const [signatures, setSignatures] = useState<OverlaySignature[]>([]);

    const [isDrawingSignature, setIsDrawingSignature] = useState(false);
    const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    const [scale, setScale] = useState<number>(1.2);
    const [selectedId, setSelectedId] = useState<string | null>(null);

    // Load PDF when component mounts
    useEffect(() => {
        console.log("PdfEditor: Mounted, calling pickPdfFile");
        pickPdfFile();
    }, []);

    const pickPdfFile = async () => {
        try {
            console.log("PdfEditor: Opening file picker...");
            await invoke("set_dialog_open", { open: true });
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'PDF',
                    extensions: ['pdf']
                }]
            });
            await invoke("set_dialog_open", { open: false });
            console.log("PdfEditor: File picker closed, selected:", selected);

            if (selected && typeof selected === 'string') {
                console.log("PdfEditor: Reading PDF file from path:", selected);
                const data: number[] = await invoke("read_pdf_file", { path: selected });
                console.log("PdfEditor: PDF file read, bytes length:", data.length);
                const uint8Array = new Uint8Array(data);
                // Important: Clone the data to avoid buffer detachment if pdf.js takes stewardship
                setPdfData(new Uint8Array(uint8Array));

                console.log("PdfEditor: Loading document into pdf.js...");
                const loadingTask = pdfjsLib.getDocument({ data: uint8Array });
                const doc = await loadingTask.promise;
                console.log("PdfEditor: Document loaded successfully, pages:", doc.numPages);
                setPdfDoc(doc);
                setNumPages(doc.numPages);
                setCurrentPage(1);
            } else {
                console.log("PdfEditor: No file selected or cancelled");
                onClose(); // Cancelled
            }
        } catch (err) {
            console.error("PdfEditor: Failed to pick PDF", err);
            invoke("set_dialog_open", { open: false }).catch(() => { });
            // Fallback close
            onClose();
        }
    };

    useEffect(() => {
        if (pdfDoc && canvasRef.current) {
            renderPage(currentPage);
        }
    }, [pdfDoc, currentPage, scale]);

    const renderPage = async (pageNumber: number) => {
        if (!pdfDoc || !canvasRef.current) return;

        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport: viewport,
        };

        await page.render(renderContext).promise;
    };



    const addText = () => {
        const newText: OverlayText = {
            id: Date.now().toString(),
            x: 100,
            y: 100,
            text: "",
            fontSize: 24,
            color: "#000000",
            width: 50, // Smaller initial width, will grow
            height: 28
        };
        setTexts([...texts, newText]);
        setSelectedId(newText.id);
    };

    const updateText = (id: string, newText: Partial<OverlayText>) => {
        setTexts(texts.map(t => t.id === id ? { ...t, ...newText } : t));
    };

    const removeText = (id: string) => {
        setTexts(texts.filter(t => t.id !== id));
        if (selectedId === id) setSelectedId(null);
    };

    // ----- Signature Pad -----
    const startDrawing = (_e: React.MouseEvent | React.TouchEvent) => {
        setIsDrawing(true);
        const ctx = signatureCanvasRef.current?.getContext("2d");
        if (ctx) {
            ctx.beginPath();
        }
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const canvas = signatureCanvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const rect = canvas.getBoundingClientRect();
        let x, y;

        if ('touches' in e) {
            x = e.touches[0].clientX - rect.left;
            y = e.touches[0].clientY - rect.top;
        } else {
            x = e.nativeEvent.offsetX;
            y = e.nativeEvent.offsetY;
        }

        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = "#000000";
        ctx.lineTo(x, y);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
    };

    const saveSignature = () => {
        const canvas = signatureCanvasRef.current;
        if (canvas) {
            const dataUrl = canvas.toDataURL("image/png");
            const newSig: OverlaySignature = {
                id: Date.now().toString(),
                x: 100, // Default drop center-ish
                y: 100,
                width: 150,
                height: 80,
                dataUrl
            };
            setSignatures([...signatures, newSig]);
            setIsDrawingSignature(false);
        }
    };

    // ----- Export PDF -----
    const handleSavePdf = async () => {
        if (!pdfData || !pdfDoc) return;

        try {
            await invoke("set_dialog_open", { open: true });
            const savePath = await save({
                filters: [{
                    name: 'PDF',
                    extensions: ['pdf']
                }]
            });
            await invoke("set_dialog_open", { open: false });

            if (!savePath) return; // User cancelled

            // Using .slice() ensures we have a unique copy of the buffer 
            // even if the original was somehow modified or detached.
            const pdfDocMod = await PDFDocument.load(pdfData.slice());
            // Assuming we are only editing the FIRST page for this MVP simplicity, 
            // or we need to map overlays to specific pages. Let's map to currentPage.
            const page = pdfDocMod.getPages()[currentPage - 1];

            const { width: pdfWidth, height: pdfHeight } = page.getSize();

            // We need the inverse scale to map from UI coordinates back to PDF coordinates
            // PDF-lib origin (0,0) is bottom-left. HTML Canvas is top-left.
            const renderedPage = await pdfDoc.getPage(currentPage);
            const viewport = renderedPage.getViewport({ scale: 1.0 }); // Original Unscaled Document size

            const scaleX = pdfWidth / viewport.width;
            const scaleY = pdfHeight / viewport.height;

            const font = await pdfDocMod.embedFont(StandardFonts.Helvetica);

            for (const t of texts) {
                if (!t.text.trim()) continue; // Skip empty text to avoid crashes

                const pdfX = t.x * scaleX;
                // PDF-lib origin is bottom-left. HTML is top-left.
                // Since we now have 0 padding and line-height 1, t.y is the top of the text.
                // We add the fontSize to move to the baseline for pdf-lib.
                const pdfY = pdfHeight - (t.y * scaleY) - (t.fontSize * scaleY);

                page.drawText(t.text, {
                    x: pdfX,
                    y: pdfY,
                    size: t.fontSize * scaleX,
                    font: font,
                    color: hexToRgb(t.color),
                    lineHeight: t.fontSize * scaleX * 1.2,
                    maxWidth: Math.max(1, t.width * scaleX)
                });
            }

            // Draw Signatures
            for (const s of signatures) {
                const imgBytes = await fetch(s.dataUrl).then(res => res.arrayBuffer());
                const pdfImage = await pdfDocMod.embedPng(imgBytes);

                const pdfX = s.x * scaleX;
                const pdfY = pdfHeight - (s.y * scaleY) - (s.height * scaleY);

                page.drawImage(pdfImage, {
                    x: pdfX,
                    y: pdfY,
                    width: s.width * scaleX,
                    height: s.height * scaleY
                });
            }

            const pdfBytes = await pdfDocMod.save();

            // Send back to Tauri to Save to Disk - Pass the path explicitly
            try {
                await writeFile(savePath, pdfBytes);
                showToast(t("pdf_tools.toast_saved"));
                onClose(); // Close the editor after successful save
            } catch (err: any) {
                console.error("Save error:", err);
                showToast(`${t("common.error")}: ${err.message || err}`);
            }
            // Removed onClose() to keep the editor open as requested

        } catch (err: any) {
            console.error("Error saving PDF: ", err);
            invoke("set_dialog_open", { open: false }).catch(() => { });
            showToast(`${t("common.error")}: ${err.message || err || "Error desconocido"}`);
        }
    };

    const hexToRgb = (hex: string) => {
        // remove hash
        hex = hex.replace(/^#/, '');
        const bigint = parseInt(hex, 16);
        const r = (bigint >> 16) & 255;
        const g = (bigint >> 8) & 255;
        const b = bigint & 255;
        return rgb(r / 255, g / 255, b / 255);
    }

    if (!pdfData) {
        return (
            <div className="pdf-editor-overlay">
                <div className="pdf-editor-loading">{t("pdf_tools.loading")}</div>
            </div>
        )
    }

    return (
        <div className="pdf-editor-overlay" onClick={() => setSelectedId(null)}>
            <div
                data-tauri-drag-region
                onMouseDown={() => invoke('start_window_drag')}
                style={{
                    height: '32px',
                    background: '#e0e0e0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    color: '#555',
                    borderBottom: '1px solid #ccc',
                    cursor: 'grab',
                    flexShrink: 0,
                    fontWeight: 500,
                    letterSpacing: '0.5px'
                }}
            >
                {t("pdf_tools.drag_handle")}
            </div>
            <div className="pdf-toolbar" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="pdf-tool-btn">⬅ {t("common.back")}</button>

                <div className="pdf-toolbar-center">
                    <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}>◀</button>
                    <span>{currentPage} / {numPages}</span>
                    <button onClick={() => setCurrentPage(Math.min(numPages, currentPage + 1))}>▶</button>

                    <span style={{ margin: '0 16px' }}>|</span>

                    <button onClick={() => setScale(Math.max(0.5, scale - 0.2))}>-</button>
                    <span>{Math.round(scale * 100)}%</span>
                    <button onClick={() => setScale(scale + 0.2)}>+</button>

                    <span style={{ margin: '0 16px' }}>|</span>
                    <button onClick={() => setIsDrawingSignature(true)}>{t("pdf_tools.sign")}</button>
                    <button onClick={addText} style={{ marginLeft: '8px' }}>{t("pdf_tools.add_text")}</button>
                </div>

                <div className="pdf-toolbar-right" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    {selectedId && (
                        <div className="color-presets" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {['#000000', '#ff0000', '#0000ff', '#008000', '#ffa500'].map(c => (
                                <button
                                    key={c}
                                    onClick={() => updateText(selectedId, { color: c })}
                                    style={{ background: c, width: 24, height: 24, borderRadius: '50%', border: '2px solid white', cursor: 'pointer', boxShadow: '0 0 4px rgba(0,0,0,0.2)' }}
                                />
                            ))}
                            <input type="color" value={texts.find(t => t.id === selectedId)?.color || "#000000"} onChange={e => updateText(selectedId, { color: e.target.value })} style={{ width: 30, height: 30, padding: 0, border: 'none', background: 'transparent' }} />
                        </div>
                    )}
                    <button onClick={handleSavePdf} className="pdf-tool-btn save">{t("pdf_tools.save_pdf")}</button>
                </div>
            </div>

            <div className="pdf-canvas-container">
                <div className="pdf-canvas-wrapper" style={{ position: 'relative' }}>
                    <canvas ref={canvasRef} style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />

                    {/* Overlay Texts */}
                    {texts.map(tItem => (
                        <div key={tItem.id} style={{
                            position: 'absolute',
                            left: tItem.x * scale,
                            top: tItem.y * scale,
                            border: selectedId === tItem.id ? '2px solid #007bff' : '1px dashed #ccc',
                            backgroundColor: 'transparent',
                            cursor: 'move',
                            boxSizing: 'border-box'
                        }}
                            onClick={(e) => { e.stopPropagation(); setSelectedId(tItem.id); }}
                            onMouseDown={(e) => {
                                if ((e.target as HTMLElement).tagName.toLowerCase() === 'textarea' && document.activeElement === e.target) return;
                                if ((e.target as HTMLElement).classList.contains('resize-handle')) return;

                                const startX = e.clientX - (tItem.x * scale);
                                const startY = e.clientY - (tItem.y * scale);

                                const onMouseMove = (moveEvent: MouseEvent) => {
                                    setTexts(prev => prev.map(textItem =>
                                        textItem.id === tItem.id ? {
                                            ...textItem,
                                            x: (moveEvent.clientX - startX) / scale,
                                            y: (moveEvent.clientY - startY) / scale
                                        } : textItem
                                    ));
                                };

                                const onMouseUp = () => {
                                    document.removeEventListener('mousemove', onMouseMove);
                                    document.removeEventListener('mouseup', onMouseUp);
                                };

                                document.addEventListener('mousemove', onMouseMove);
                                document.addEventListener('mouseup', onMouseUp);
                            }}
                        >
                            {selectedId === tItem.id && (
                                <button onClick={(e) => { e.stopPropagation(); removeText(tItem.id); }} style={{ position: 'absolute', top: -12, right: -12, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', fontSize: 12, zIndex: 20 }}>x</button>
                            )}
                            <textarea
                                autoFocus
                                value={tItem.text}
                                onChange={e => {
                                    const target = e.target as HTMLTextAreaElement;

                                    // Auto-resize width based on content
                                    const tempSpan = document.createElement('span');
                                    tempSpan.style.font = `${tItem.fontSize * scale}px sans-serif`;
                                    tempSpan.style.visibility = 'hidden';
                                    tempSpan.style.position = 'absolute';
                                    tempSpan.style.whiteSpace = 'pre';
                                    tempSpan.innerText = target.value || ' ';
                                    document.body.appendChild(tempSpan);
                                    const newWidth = (tempSpan.getBoundingClientRect().width + 10) / scale;
                                    document.body.removeChild(tempSpan);

                                    // Auto-resize height
                                    target.style.height = '1px';
                                    const newHeight = target.scrollHeight;
                                    target.style.height = `${newHeight}px`;

                                    updateText(tItem.id, {
                                        text: target.value,
                                        width: newWidth,
                                        height: newHeight / scale
                                    });
                                }}
                                placeholder={t("pdf_tools.write_placeholder")}
                                style={{
                                    fontSize: `${tItem.fontSize * scale}px`,
                                    color: tItem.color,
                                    border: 'none',
                                    outline: 'none',
                                    width: `${tItem.width * scale}px`,
                                    height: `${tItem.height * scale}px`,
                                    background: 'transparent',
                                    resize: 'none',
                                    cursor: 'text',
                                    padding: '0',
                                    margin: 0,
                                    overflow: 'hidden',
                                    lineHeight: '1.2'
                                }}
                            />
                            {/* Resize Handle - Paint Style */}
                            <div
                                className="resize-handle"
                                style={{
                                    position: 'absolute',
                                    bottom: -5,
                                    right: -5,
                                    width: 10,
                                    height: 10,
                                    background: '#007bff',
                                    cursor: 'nwse-resize',
                                    zIndex: 30,
                                    borderRadius: '2px'
                                }}
                                onMouseDown={(e) => {
                                    e.stopPropagation();
                                    const startX = e.clientX;
                                    const startWidth = tItem.width;
                                    const startHeight = tItem.height;
                                    const startFontSize = tItem.fontSize;

                                    const onMouseMove = (moveEvent: MouseEvent) => {
                                        const delta = (moveEvent.clientX - startX) / scale;
                                        const newWidth = Math.max(50, startWidth + delta);
                                        const ratio = newWidth / startWidth;
                                        const newHeight = startHeight * ratio;
                                        const newFontSize = startFontSize * ratio;

                                        setTexts(prev => prev.map(textItem =>
                                            textItem.id === tItem.id ? {
                                                ...textItem,
                                                width: newWidth,
                                                height: newHeight,
                                                fontSize: newFontSize
                                            } : textItem
                                        ));
                                    };

                                    const onMouseUp = () => {
                                        document.removeEventListener('mousemove', onMouseMove);
                                        document.removeEventListener('mouseup', onMouseUp);
                                    };

                                    document.addEventListener('mousemove', onMouseMove);
                                    document.addEventListener('mouseup', onMouseUp);
                                }}
                            />
                        </div>
                    ))}

                    {/* Overlay Signatures */}
                    {signatures.map(s => (
                        <div key={s.id} style={{
                            position: 'absolute',
                            left: s.x * scale,
                            top: s.y * scale,
                            cursor: 'move',
                            border: selectedId === s.id ? '2px solid #007bff' : '1px dashed transparent',
                            boxSizing: 'border-box'
                        }}
                            onClick={(e) => { e.stopPropagation(); setSelectedId(s.id); }}
                            onMouseDown={(e) => {
                                if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
                                const startX = e.clientX - (s.x * scale);
                                const startY = e.clientY - (s.y * scale);

                                const onMouseMove = (moveEvent: MouseEvent) => {
                                    setSignatures(prev => prev.map(sig =>
                                        sig.id === s.id ? {
                                            ...sig,
                                            x: (moveEvent.clientX - startX) / scale,
                                            y: (moveEvent.clientY - startY) / scale
                                        } : sig
                                    ));
                                };

                                const onMouseUp = () => {
                                    document.removeEventListener('mousemove', onMouseMove);
                                    document.removeEventListener('mouseup', onMouseUp);
                                };

                                document.addEventListener('mousemove', onMouseMove);
                                document.addEventListener('mouseup', onMouseUp);
                            }}
                        >
                            {selectedId === s.id && (
                                <>
                                    <button onClick={(e) => { e.stopPropagation(); setSignatures(prev => prev.filter(sig => sig.id !== s.id)); }} style={{ position: 'absolute', top: -12, right: -12, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 10, zIndex: 20 }}>x</button>
                                    {/* Resize Handle for Signatures */}
                                    <div
                                        className="resize-handle"
                                        style={{
                                            position: 'absolute',
                                            bottom: -5,
                                            right: -5,
                                            width: 10,
                                            height: 10,
                                            background: '#007bff',
                                            cursor: 'nwse-resize',
                                            zIndex: 30,
                                            borderRadius: '2px'
                                        }}
                                        onMouseDown={(e) => {
                                            e.stopPropagation();
                                            const startX = e.clientX;
                                            const startWidth = s.width;
                                            const startHeight = s.height;

                                            const onMouseMove = (moveEvent: MouseEvent) => {
                                                const delta = (moveEvent.clientX - startX) / scale;
                                                const newWidth = Math.max(30, startWidth + delta);
                                                // Maintain aspect ratio for signatures
                                                const ratio = newWidth / startWidth;
                                                const newHeight = startHeight * ratio;

                                                setSignatures(prev => prev.map(sig =>
                                                    sig.id === s.id ? {
                                                        ...sig,
                                                        width: newWidth,
                                                        height: newHeight
                                                    } : sig
                                                ));
                                            };

                                            const onMouseUp = () => {
                                                document.removeEventListener('mousemove', onMouseMove);
                                                document.removeEventListener('mouseup', onMouseUp);
                                            };

                                            document.addEventListener('mousemove', onMouseMove);
                                            document.addEventListener('mouseup', onMouseUp);
                                        }}
                                    />
                                </>
                            )}
                            <img src={s.dataUrl} width={s.width * scale} height={s.height * scale} alt="Signature" style={{ pointerEvents: 'none', display: 'block' }} />
                        </div>
                    ))}
                </div>
            </div>

            {isDrawingSignature && (
                <div className="signature-modal-overlay">
                    <div className="signature-modal">
                        <h3>{t("pdf_tools.draw_signature")}</h3>
                        <canvas
                            ref={signatureCanvasRef}
                            width={400}
                            height={200}
                            style={{ border: '1px solid #ccc', background: '#fff', cursor: 'crosshair' }}
                            onMouseDown={startDrawing}
                            onMouseMove={draw}
                            onMouseUp={stopDrawing}
                            onMouseOut={stopDrawing}
                            onTouchStart={startDrawing}
                            onTouchMove={draw}
                            onTouchEnd={stopDrawing}
                        />
                        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button onClick={() => setIsDrawingSignature(false)}>{t("common.cancel")}</button>
                            <button onClick={saveSignature} style={{ background: 'var(--accent-color)', color: 'white' }}>{t("pdf_tools.insert_signature")}</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
         .pdf-editor-overlay {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: #f0f0f0;
            z-index: 100000;
            display: flex;
            flex-direction: column;
            pointer-events: auto !important;
         }
         .pdf-editor-overlay * {
            pointer-events: auto;
         }
         .pdf-editor-loading {
            margin: auto;
            font-size: 20px;
            color: #333;
         }
         .pdf-toolbar {
            height: 60px;
            background: #fff;
            border-bottom: 1px solid #ddd;
            display: flex;
            align-items: center;
            padding: 0 24px;
            justify-content: space-between;
         }
         .pdf-tool-btn {
            padding: 8px 16px;
            border-radius: 6px;
            border: 1px solid #ddd;
            background: #f9f9f9;
            cursor: pointer;
         }
         .pdf-tool-btn.save {
            background: #007bff;
            color: white;
            border: none;
         }
         .pdf-toolbar-center {
            display: flex;
            align-items: center;
            gap: 12px;
         }
         .pdf-toolbar-center button {
            padding: 4px 8px;
            cursor: pointer;
            border: 1px solid #ccc;
            background: #fff;
            border-radius: 4px;
         }
         .pdf-canvas-container {
            flex: 1;
            overflow: auto;
            display: flex;
            justify-content: center;
            padding: 40px;
         }
         .signature-modal-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 100001;
         }
         .signature-modal {
            background: #fff;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
         }
         .signature-modal h3 {
             margin-top: 0;
             color: #333;
         }
      `}</style>
        </div>
    );
}
