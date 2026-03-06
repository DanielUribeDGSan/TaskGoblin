import React, { useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core";
import { PDFDocument, PageSizes } from 'pdf-lib';
import { writeFile } from "@tauri-apps/plugin-fs";

const ImageConverter: React.FC<{ showToast: (msg: string) => void, t: (key: string) => string, language: string }> = ({ showToast, t, language }) => {
    const [inputPaths, setInputPaths] = useState<string[]>([]);
    const [format, setFormat] = useState('png');
    const [width, setWidth] = useState<string>('');
    const [height, setHeight] = useState<string>('');
    const [quality, setQuality] = useState<number>(80);
    const [optimize, setOptimize] = useState(true);
    const [isProcessing, setIsProcessing] = useState(false);

    // PDF specific options
    const [pdfOrientation, setPdfOrientation] = useState<'portrait' | 'landscape'>('portrait');
    const [pdfPageSize, setPdfPageSize] = useState<string>('A4');
    const [pdfMargin, setPdfMargin] = useState<'none' | 'small' | 'large'>('none');
    const [pdfMerge, setPdfMerge] = useState(true);

    const handleSelectImage = async () => {
        try {
            await invoke("set_dialog_open", { open: true });
            const selected = await open({
                multiple: true,
                filters: [{
                    name: 'Image',
                    extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tiff', 'avif', 'heic', 'heif']
                }]
            });
            await invoke("set_dialog_open", { open: false });

            if (selected && Array.isArray(selected)) {
                setInputPaths(selected);
            } else if (selected && typeof selected === 'string') {
                setInputPaths([selected]);
            }
        } catch (err) {
            console.error("Error selecting image:", err);
            await invoke("set_dialog_open", { open: false });
        }
    };

    const handleConvertToPdf = async () => {
        if (inputPaths.length === 0) return;

        try {
            setIsProcessing(true);

            await invoke("set_dialog_open", { open: true });
            const savePath = await save({
                defaultPath: pdfMerge ? 'document.pdf' : undefined,
                filters: [{ name: 'PDF', extensions: ['pdf'] }]
            });
            await invoke("set_dialog_open", { open: false });

            if (!savePath) {
                setIsProcessing(false);
                return;
            }

            if (pdfMerge) {
                const pdfDoc = await PDFDocument.create();
                const pageSize = (PageSizes as any)[pdfPageSize] || PageSizes.A4;
                const marginValue = pdfMargin === 'none' ? 0 : pdfMargin === 'small' ? 20 : 40;

                for (const path of inputPaths) {
                    const imgBytes = await invoke("read_pdf_file", { path });
                    const uint8Bytes = new Uint8Array(imgBytes as number[]);

                    try {
                        let img;
                        if (path.toLowerCase().endsWith('.png')) {
                            img = await pdfDoc.embedPng(uint8Bytes);
                        } else {
                            img = await pdfDoc.embedJpg(uint8Bytes);
                        }

                        const page = pdfDoc.addPage(pdfOrientation === 'landscape' ? [pageSize[1], pageSize[0]] : pageSize);
                        const { width: pWidth, height: pHeight } = page.getSize();

                        const availableWidth = pWidth - (marginValue * 2);
                        const availableHeight = pHeight - (marginValue * 2);

                        const imgDims = img.scale(1);
                        const ratio = Math.min(availableWidth / imgDims.width, availableHeight / imgDims.height);
                        const finalWidth = imgDims.width * ratio;
                        const finalHeight = imgDims.height * ratio;

                        page.drawImage(img, {
                            x: marginValue + (availableWidth - finalWidth) / 2,
                            y: marginValue + (availableHeight - finalHeight) / 2,
                            width: finalWidth,
                            height: finalHeight,
                        });
                    } catch (e) {
                        console.error(`Error embedding image ${path}:`, e);
                    }
                }

                const pdfBytes = await pdfDoc.save();
                await writeFile(savePath, pdfBytes);
            } else {
                // Individual PDFs (simplified: saving only the first one or looping would require more dialogs)
                showToast(t('image.toast_merge_only'));
            }

            showToast(t('image.toast_success'));
            setIsProcessing(false);
        } catch (err) {
            console.error("Error converting to PDF:", err);
            showToast(t('common.error') + ": " + err);
            setIsProcessing(false);
            await invoke("set_dialog_open", { open: false });
        }
    };

    const handleConvert = async () => {
        if (inputPaths.length === 0) return;
        if (format === 'pdf') {
            return handleConvertToPdf();
        }

        try {
            setIsProcessing(true);
            const inputPath = inputPaths[0]; // For standard conversion, use first file
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

            showToast(t('image.toast_success'));
            setIsProcessing(false);
        } catch (err) {
            console.error("Error converting image:", err);
            showToast(t('common.error') + ": " + err);
            setIsProcessing(false);
            await invoke("set_dialog_open", { open: false });
        }
    };

    return (
        <div className="wa-form-container">
            <div style={{ marginTop: '0px' }}>
                <div className="wa-input-group">
                    <label className="wa-input-label" htmlFor="input-origin">{t('image.label_source')}</label>
                    <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                id="input-origin"
                                type="text"
                                className="wa-input"
                                placeholder={t('image.placeholder_source')}
                                value={inputPaths.length > 0 ? `${inputPaths.length} ${language === 'es' ? 'archivos seleccionados' : 'files selected'}` : ''}
                                readOnly
                                style={{ flex: 1, textOverflow: 'ellipsis' }}
                            />
                            <button className="wa-submit-btn" style={{ width: 'auto', padding: '0 16px', margin: 0 }} onClick={handleSelectImage}>
                                {t('common.select')}
                            </button>
                        </div>
                        {inputPaths.length > 0 && (
                            <div className="file-list-summary" style={{
                                fontSize: '12px',
                                color: 'var(--text-secondary)',
                                padding: '8px',
                                background: 'rgba(255,255,255,0.02)',
                                borderRadius: '8px',
                                maxHeight: '100px',
                                overflowY: 'auto'
                            }}>
                                {inputPaths.map((p, idx) => (
                                    <div key={idx} style={{ padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                        • {p.split('/').pop()}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="wa-input-group" style={{ marginTop: '16px' }}>
                    <label className="wa-input-label" htmlFor="output-format">{t('image.label_format')}</label>
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
                        <option value="pdf">PDF</option>
                    </select>
                </div>

                {format !== 'pdf' ? (
                    <>
                        <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                            <div className="wa-input-group" style={{ flex: 1 }}>
                                <label className="wa-input-label" htmlFor="input-width">{t('image.label_width')}</label>
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
                                <label className="wa-input-label" htmlFor="input-height">{t('image.label_height')}</label>
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
                                    <label className="wa-input-label" htmlFor="quality-range">{t('image.label_quality')}</label>
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
                                <span style={{ fontSize: '14px', fontWeight: '600' }}>{t('image.smart_opt')}</span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('image.smart_opt_desc')}</span>
                            </div>
                            <div className={`toggle-switch ${optimize ? "active" : ""}`}>
                                <div className="toggle-knob"></div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        <div className="pdf-options-section">
                            <label className="wa-input-label">{t('image.pdf_orientation')}</label>
                            <div className="segmented-control">
                                <button
                                    className={pdfOrientation === 'portrait' ? 'active' : ''}
                                    onClick={() => setPdfOrientation('portrait')}
                                >
                                    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="1" y="1" width="12" height="16" rx="1" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                    {t('image.pdf_vertical')}
                                </button>
                                <button
                                    className={pdfOrientation === 'landscape' ? 'active' : ''}
                                    onClick={() => setPdfOrientation('landscape')}
                                >
                                    <svg width="18" height="14" viewBox="0 0 18 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="1" y="1" width="16" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                    {t('image.pdf_horizontal')}
                                </button>
                            </div>
                        </div>

                        <div className="pdf-options-section">
                            <label className="wa-input-label">{t('image.pdf_page_size')}</label>
                            <select
                                className="wa-input"
                                value={pdfPageSize}
                                onChange={(e) => setPdfPageSize(e.target.value)}
                                style={{ appearance: 'none', background: 'var(--bg-secondary)', cursor: 'pointer' }}
                            >
                                <option value="A4">A4 (297x210 mm)</option>
                                <option value="Letter">Carta (8.5x11 in)</option>
                                <option value="Legal">Oficio (8.5x14 in)</option>
                            </select>
                        </div>

                        <div className="pdf-options-section">
                            <label className="wa-input-label">{t('image.pdf_margin')}</label>
                            <div className="segmented-control">
                                <button
                                    className={pdfMargin === 'none' ? 'active' : ''}
                                    onClick={() => setPdfMargin('none')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                                        <path d="M2 2L14 14" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                                    </svg>
                                    {t('image.pdf_margin_none')}
                                </button>
                                <button
                                    className={pdfMargin === 'small' ? 'active' : ''}
                                    onClick={() => setPdfMargin('small')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                                        <rect x="5" y="5" width="6" height="6" fill="currentColor" opacity="0.3" />
                                    </svg>
                                    {t('image.pdf_margin_small')}
                                </button>
                                <button
                                    className={pdfMargin === 'large' ? 'active' : ''}
                                    onClick={() => setPdfMargin('large')}
                                >
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="2" />
                                        <rect x="4" y="4" width="8" height="8" fill="currentColor" opacity="0.3" />
                                    </svg>
                                    {t('image.pdf_margin_large')}
                                </button>
                            </div>
                        </div>

                        <div className="list-item" style={{ marginTop: '0', padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer' }} onClick={() => setPdfMerge(!pdfMerge)}>
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                <span style={{ fontSize: '14px', fontWeight: '600' }}>{t('image.pdf_merge')}</span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{t('image.pdf_merge_desc')}</span>
                            </div>
                            <div className={`toggle-switch ${pdfMerge ? "active" : ""}`}>
                                <div className="toggle-knob"></div>
                            </div>
                        </div>
                    </div>
                )}

                <button
                    className={`wa-submit-btn ${inputPaths.length === 0 || isProcessing ? 'disabled' : ''}`}
                    style={{ marginTop: '24px', position: 'relative' }}
                    onClick={handleConvert}
                    disabled={inputPaths.length === 0 || isProcessing}
                >
                    {isProcessing ? t('common.processing') : (format === 'pdf' ? t('image.btn_convert_pdf') : t('image.btn_convert'))}
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
                            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: '700', color: 'var(--text-primary)' }}>{t('image.loading_title')}</h3>
                            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-secondary)' }}>
                                {t('image.loading_desc')}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImageConverter;
