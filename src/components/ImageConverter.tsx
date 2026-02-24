import React, { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";

const ImageConverter: React.FC<{ showToast: (msg: string) => void }> = ({ showToast }) => {
    const [inputPath, setInputPath] = useState<string | null>(null);
    const [format, setFormat] = useState('png');
    const [width, setWidth] = useState<string>('');
    const [height, setHeight] = useState<string>('');
    const [quality, setQuality] = useState<number>(80);
    const [optimize, setOptimize] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    const handleSelectImage = async () => {
        try {
            await invoke("set_dialog_open", { open: true });
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Image',
                    extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'avif', 'heic', 'heif']
                }]
            });
            await invoke("set_dialog_open", { open: false });

            if (selected && typeof selected === 'string') {
                setInputPath(selected);
            }
        } catch (err) {
            console.error("Error selecting image:", err);
            await invoke("set_dialog_open", { open: false });
        }
    };

    const handleConvert = async () => {
        if (!inputPath) return;

        try {
            setIsProcessing(true);
            const fileName = inputPath.split('/').pop()?.split('.')[0] || 'converted_image';

            await invoke("set_dialog_open", { open: true });
            const outputPath = await save({
                defaultPath: `${fileName}.${format}`,
                filters: [{
                    name: format.toUpperCase(),
                    extensions: [format]
                }]
            });
            await invoke("set_dialog_open", { open: false });

            if (!outputPath) {
                setIsProcessing(false);
                return;
            }

            await invoke("process_image", {
                inputPath,
                outputPath,
                format,
                width: width ? Number.parseInt(width) : null,
                height: height ? Number.parseInt(height) : null,
                quality: (format === 'jpg' || format === 'jpeg') ? quality : null,
                optimize: optimize
            });

            showToast("Image converted successfully! ✨");
            setIsProcessing(false);
        } catch (err) {
            console.error("Error converting image:", err);
            showToast("Error converting image: " + err);
            setIsProcessing(false);
            await invoke("set_dialog_open", { open: false });
        }
    };

    return (
        <div className="wa-form-container">
            <div className="color-extractor-header">
                <h2 style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' }}>Image Converter 🖼️</h2>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Convert, resize and compress your images.</p>
            </div>

            <div style={{ marginTop: '20px' }}>
                <div className="wa-input-group">
                    <label className="wa-input-label" htmlFor="input-origin">Source Image</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            id="input-origin"
                            type="text"
                            className="wa-input"
                            placeholder="No image selected"
                            value={inputPath || ''}
                            readOnly
                            style={{ flex: 1, textOverflow: 'ellipsis' }}
                        />
                        <button className="wa-submit-btn" style={{ width: 'auto', padding: '0 16px', margin: 0 }} onClick={handleSelectImage}>
                            Select
                        </button>
                    </div>
                </div>

                <div className="wa-input-group" style={{ marginTop: '16px' }}>
                    <label className="wa-input-label" htmlFor="output-format">Output Format</label>
                    <select
                        id="output-format"
                        className="wa-input"
                        value={format}
                        onChange={(e) => setFormat(e.target.value)}
                        style={{ appearance: 'none', background: 'var(--bg-secondary)', cursor: 'pointer' }}
                    >
                        <option value="png">PNG</option>
                        <option value="jpg">JPG</option>
                        <option value="webp">WebP</option>
                        <option value="avif">AVIF</option>
                        <option value="heic">HEIC</option>
                        <option value="bmp">BMP</option>
                        <option value="gif">GIF</option>
                        <option value="tiff">TIFF</option>
                    </select>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                    <div className="wa-input-group" style={{ flex: 1 }}>
                        <label className="wa-input-label" htmlFor="input-width">Width (optional)</label>
                        <input
                            id="input-width"
                            type="number"
                            className="wa-input"
                            placeholder="e.g. 1920"
                            value={width}
                            onChange={(e) => setWidth(e.target.value)}
                        />
                    </div>
                    <div className="wa-input-group" style={{ flex: 1 }}>
                        <label className="wa-input-label" htmlFor="input-height">Height (optional)</label>
                        <input
                            id="input-height"
                            type="number"
                            className="wa-input"
                            placeholder="e.g. 1080"
                            value={height}
                            onChange={(e) => setHeight(e.target.value)}
                        />
                    </div>
                </div>

                {(format === 'jpg' || format === 'jpeg' || format === 'webp') && (
                    <div className="wa-input-group" style={{ marginTop: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <label className="wa-input-label" htmlFor="quality-range">Compression Quality</label>
                            <span style={{ fontSize: '12px', color: 'var(--accent-color)', opacity: optimize ? 0.5 : 1 }}>{quality}%</span>
                        </div>
                        <input
                            id="quality-range"
                            type="range"
                            min="1"
                            max="100"
                            value={quality}
                            onChange={(e) => setQuality(Number.parseInt(e.target.value))}
                            disabled={optimize}
                            style={{ width: '100%', accentColor: 'var(--accent-color)', cursor: optimize ? 'not-allowed' : 'pointer', opacity: optimize ? 0.5 : 1 }}
                        />
                    </div>
                )}

                <div className="list-item" style={{ marginTop: '20px', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }} onClick={() => setOptimize(!optimize)}>
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                        <span style={{ fontSize: '14px', fontWeight: '600' }}>Smart Optimization</span>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Automatically reduce size without visual loss.</span>
                    </div>
                    <div className={`toggle-switch ${optimize ? "active" : ""}`}>
                        <div className="toggle-knob"></div>
                    </div>
                </div>

                <button
                    className={`wa-submit-btn ${!inputPath || isProcessing ? 'disabled' : ''}`}
                    style={{ marginTop: '24px', position: 'relative' }}
                    onClick={handleConvert}
                    disabled={!inputPath || isProcessing}
                >
                    {isProcessing ? "Processing..." : "Convert and Save"}
                </button>
                {isProcessing && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000,
                        color: 'white',
                        padding: '24px',
                        backdropFilter: 'blur(4px)'
                    }}>
                        <div style={{
                            backgroundColor: 'var(--bg-secondary)',
                            padding: '32px',
                            borderRadius: '24px',
                            width: '100%',
                            maxWidth: '320px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                            border: '1px solid var(--border-color)',
                            textAlign: 'center'
                        }}>
                            <div className="loading-spinner"></div>
                            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>Converting Image...</h3>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                                This might take a moment depending on the size and format.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImageConverter;
