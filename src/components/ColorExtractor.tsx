import React, { useState, useRef, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import { readFile } from '@tauri-apps/plugin-fs';

interface ColorData {
    hex: string;
    rgb: string;
    hsl: string;
}

const ColorExtractor: React.FC = () => {
    const [image, setImage] = useState<string | null>(null);
    const [selectedColor, setSelectedColor] = useState<ColorData | null>(null);
    const [hoverColor, setHoverColor] = useState<string>('transparent');
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [isHovering, setIsHovering] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const magnifierCanvasRef = useRef<HTMLCanvasElement>(null);

    const handleImageUpload = async () => {
        try {
            await invoke("set_dialog_open", { open: true });
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Image',
                    extensions: ['png', 'jpg', 'jpeg', 'webp']
                }]
            });
            await invoke("set_dialog_open", { open: false });

            if (selected && typeof selected === 'string') {
                // Read file as bytes and convert to data URL for maximum compatibility
                const uint8Array = await readFile(selected);
                const blob = new Blob([uint8Array]);
                const reader = new FileReader();
                reader.onload = (e) => {
                    const dataUrl = e.target?.result as string;
                    setImage(dataUrl);
                    setSelectedColor(null);
                };
                reader.readAsDataURL(blob);
            }
        } catch (err) {
            console.error("Error selecting image:", err);
            await invoke("set_dialog_open", { open: false });
        }
    };

    useEffect(() => {
        if (!image || !canvasRef.current || !containerRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const img = new Image();
        img.crossOrigin = "anonymous"; // Avoid tainting canvas

        const renderImage = () => {
            if (!containerRef.current) return;
            const containerWidth = containerRef.current.getBoundingClientRect().width;

            // Log for debugging visibility
            console.log("Rendering image. Container width:", containerWidth, "Image size:", img.width, "x", img.height);

            const maxWidth = Math.max(containerWidth - 40, 260); // Padding safety
            const maxHeight = 320;

            let width = img.width;
            let height = img.height;

            if (width === 0 || height === 0) {
                console.warn("Image has 0 dimensions");
                return;
            }

            const ratio = Math.min(maxWidth / width, maxHeight / height);
            width = width * ratio;
            height = height * ratio;

            canvas.width = width;
            canvas.height = height;

            ctx?.clearRect(0, 0, width, height);
            ctx?.drawImage(img, 0, 0, width, height);

            console.log("Canvas updated:", width, "x", height);
        };

        img.onload = renderImage;
        img.onerror = (e) => {
            console.error("Failed to load image into DOM:", e);
        };
        img.src = image;

        // Re-render on container resize (e.g. sidebar toggle)
        const resizeObserver = new ResizeObserver(() => {
            if (img.complete) renderImage();
        });
        resizeObserver.observe(containerRef.current);

        return () => resizeObserver.disconnect();
    }, [image]);

    const rgbToHex = (r: number, g: number, b: number) => {
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
    };

    const rgbToHsl = (r: number, g: number, b: number) => {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0, s, l = (max + min) / 2;

        if (max === min) {
            h = s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }
        return `${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`;
    };

    const getColorAtPos = (x: number, y: number) => {
        if (!canvasRef.current) return null;
        const ctx = canvasRef.current.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        const data = ctx.getImageData(x, y, 1, 1).data;
        return {
            r: data[0],
            g: data[1],
            b: data[2],
            hex: rgbToHex(data[0], data[1], data[2]),
            rgb: `rgb(${data[0]}, ${data[1]}, ${data[2]})`,
            hsl: rgbToHsl(data[0], data[1], data[2])
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);

        if (x >= 0 && x < canvasRef.current.width && y >= 0 && y < canvasRef.current.height) {
            const color = getColorAtPos(x, y);
            if (color) {
                setHoverColor(color.hex);
                setMousePos({ x: e.clientX, y: e.clientY });
                setIsHovering(true);
                updateMagnifier(x, y);
            }
        } else {
            setIsHovering(false);
        }
    };

    const updateMagnifier = (x: number, y: number) => {
        if (!canvasRef.current || !magnifierCanvasRef.current) return;
        const mCtx = magnifierCanvasRef.current.getContext('2d');
        if (!mCtx) return;

        const size = 100;
        const zoom = 5;
        mCtx.imageSmoothingEnabled = false;
        mCtx.clearRect(0, 0, size, size);

        // Draw zoomed area
        mCtx.drawImage(
            canvasRef.current,
            x - (size / zoom) / 2,
            y - (size / zoom) / 2,
            size / zoom,
            size / zoom,
            0,
            0,
            size,
            size
        );

        // Draw crosshair
        mCtx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        mCtx.lineWidth = 1;
        mCtx.beginPath();
        mCtx.moveTo(size / 2, 0); mCtx.lineTo(size / 2, size);
        mCtx.moveTo(0, size / 2); mCtx.lineTo(size, size / 2);
        mCtx.stroke();

        // Draw central pixel border
        mCtx.strokeRect(size / 2 - zoom / 2, size / 2 - zoom / 2, zoom, zoom);
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (!canvasRef.current) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.floor(e.clientX - rect.left);
        const y = Math.floor(e.clientY - rect.top);
        const color = getColorAtPos(x, y);
        if (color) {
            setSelectedColor({
                hex: color.hex,
                rgb: color.rgb,
                hsl: color.hsl
            });
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        // You could trigger a toast here if passed via props
    };

    return (
        <div className="color-extractor-container" ref={containerRef}>
            <div className="color-extractor-header">
                <h2 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)' }}>Color Extractor</h2>
                <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Upload an image to pick colors with pixel precision.</p>
            </div>

            {!image ? (
                <div className="upload-placeholder">
                    <button className="upload-btn" onClick={handleImageUpload}>
                        Choose an Image
                    </button>
                </div>
            ) : (
                <div className="extractor-workspace">
                    <div className="canvas-wrapper">
                        <canvas
                            ref={canvasRef}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={() => setIsHovering(false)}
                            onClick={handleCanvasClick}
                            style={{ cursor: 'crosshair', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
                        />

                        {isHovering && (
                            <div
                                className="magnifier-glass"
                                style={{
                                    left: mousePos.x + 20,
                                    top: mousePos.y - 120,
                                    borderColor: hoverColor
                                }}
                            >
                                <canvas ref={magnifierCanvasRef} width={100} height={100} />
                                <div className="magnifier-color-code" style={{ backgroundColor: hoverColor }}>
                                    {hoverColor}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="color-details-panel">
                        <div className="current-selections">
                            <div className="color-swatch-main" style={{ backgroundColor: selectedColor?.hex || hoverColor }}></div>
                            <div className="color-swatch-prev" style={{ backgroundColor: hoverColor }}></div>
                        </div>

                        <div className="format-list">
                            <div className="format-item">
                                <div className="format-label">HEX</div>
                                <div className="format-value">{selectedColor?.hex || hoverColor}</div>
                                <button onClick={() => copyToClipboard(selectedColor?.hex || hoverColor)} title="Copy HEX">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                </button>
                            </div>
                            <div className="format-item">
                                <div className="format-label">RGB</div>
                                <div className="format-value">{selectedColor?.rgb || 'Pick a color'}</div>
                                <button onClick={() => selectedColor && copyToClipboard(selectedColor.rgb)} disabled={!selectedColor}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                </button>
                            </div>
                            <div className="format-item">
                                <div className="format-label">HSL</div>
                                <div className="format-value">{selectedColor?.hsl || '---'}</div>
                                <button onClick={() => selectedColor && copyToClipboard(selectedColor.hsl)} disabled={!selectedColor}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                </button>
                            </div>
                        </div>

                        <button className="change-img-btn" onClick={handleImageUpload}>
                            Use another image
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ColorExtractor;
