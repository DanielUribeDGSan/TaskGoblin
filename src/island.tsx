import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { translations, type Language } from "./i18n/translations";
import "./App.css";
function getOcrLabel(): string {
    try {
        const lang = (localStorage.getItem("app-language") as Language) || "es";
        return translations[lang]?.common?.ocr_loading ?? translations.es.common.ocr_loading;
    } catch {
        return "Copiando el texto...";
    }
}

const pillStyle = {
    backgroundColor: '#000000',
    borderRadius: '999px',
    height: '36px',
    padding: '0 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '150px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.6)',
    position: 'relative' as const
};

const Island = () => {
    const [timeLeftStr, setTimeLeftStr] = useState("...");
    const [ocrStatus, setOcrStatus] = useState<'loading' | 'success' | 'no_text' | 'error'>('loading');

    const params = typeof globalThis.window !== "undefined" ? new URLSearchParams(globalThis.window.location.search) : new URLSearchParams();
    const isOcrMode = params.get("mode") === "ocr";

    const getStatusLabel = () => {
        const lang = (localStorage.getItem("app-language") as Language) || "es";
        switch (ocrStatus) {
            case 'success': return translations[lang]?.ocr?.success ?? translations.es.ocr.success;
            case 'no_text': return translations[lang]?.ocr?.no_text ?? translations.es.ocr.no_text;
            case 'error': return translations[lang]?.ocr?.failed ?? translations.es.ocr.failed;
            default: return getOcrLabel();
        }
    };

    useEffect(() => {
        if (!isOcrMode) return;

        console.log("Island: OCR Mode active, checking URL status...");
        const urlStatus = params.get("status") as 'loading' | 'success' | 'no_text' | 'error' | null;

        if (urlStatus && ['loading', 'success', 'no_text', 'error'].includes(urlStatus)) {
            setOcrStatus(urlStatus);

            // If it's a final state (not loading), auto close after 2 seconds
            if (urlStatus !== 'loading') {
                setTimeout(async () => {
                    try {
                        const win = getCurrentWebviewWindow();
                        console.log("Island: Auto-closing window after 2s result display");
                        await win.close();
                    } catch (e) {
                        console.error("Island: Failed to close window:", e);
                    }
                }, 2000);
            }
        }

        // Safety timeout for 'loading' state just in case it bugs out
        const safety = setTimeout(async () => {
            console.log("Island: Frontend safety timeout reached.");
            try {
                const win = getCurrentWebviewWindow();
                await win.close();
            } catch (e) { }
        }, 15000);

        return () => {
            clearTimeout(safety);
        };
    }, [isOcrMode]);

    useEffect(() => {
        if (isOcrMode) return;
        let interval: ReturnType<typeof setInterval>;

        const tick = async () => {
            try {
                const { target_timestamp } = await invoke<{ target_timestamp: number, duration_secs: number }>("get_shutdown_time");
                if (target_timestamp === 0) {
                    await getCurrentWebviewWindow().close();
                    return;
                }

                const now = Math.floor(Date.now() / 1000);
                let diff = target_timestamp - now;

                if (diff <= 0) {
                    setTimeLeftStr("0:00");
                    return;
                }

                const hours = Math.floor(diff / 3600);
                const mins = Math.floor((diff % 3600) / 60);
                const secs = diff % 60;
                const pad = (n: number) => n.toString().padStart(2, '0');

                if (hours > 0) {
                    setTimeLeftStr(`${hours}:${pad(mins)}:${pad(secs)}`);
                } else {
                    setTimeLeftStr(`${mins}:${pad(secs)}`);
                }
            } catch (err) {
                console.error("Failed to get shutdown time:", err);
            }
        };

        tick();
        interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [isOcrMode]);

    const handleCancel = async () => {
        try {
            await invoke("cancel_shutdown");
            await getCurrentWebviewWindow().close();
        } catch (e) {
            console.error(e);
        }
    };

    if (isOcrMode) {
        return (
            <div style={{
                width: '100vw',
                height: '100vh',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                paddingTop: '8px',
                userSelect: 'none',
                overflow: 'hidden'
            }}>
                <div style={pillStyle} data-tauri-drag-region>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', zIndex: 1 }} data-tauri-drag-region>
                        {ocrStatus === 'loading' ? (
                            <svg className="rotating-spinner" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#28c840" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 12a9 9 0 11-6.22-8.56" />
                            </svg>
                        ) : ocrStatus === 'success' ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#28c840" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        )}
                        <span style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            color: ocrStatus === 'error' ? '#ff3b30' : '#28c840',
                            letterSpacing: '0.3px',
                            whiteSpace: 'nowrap'
                        }} data-tauri-drag-region>
                            {getStatusLabel()}
                        </span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '8px',
            userSelect: 'none',
            overflow: 'hidden'
        }}>
            <div style={pillStyle} data-tauri-drag-region>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', zIndex: 1 }} data-tauri-drag-region>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#28c840" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" data-tauri-drag-region>
                        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line>
                    </svg>
                    <span style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                        color: '#28c840',
                        letterSpacing: '0.3px',
                        transform: 'translateY(0.5px)'
                    }} data-tauri-drag-region>
                        {timeLeftStr}
                    </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '16px' }} data-tauri-drag-region>
                    <button
                        onClick={handleCancel}
                        style={{
                            background: 'rgba(255, 255, 255, 0.12)',
                            border: 'none',
                            color: '#ffffff',
                            width: '22px',
                            height: '22px',
                            borderRadius: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            zIndex: 1,
                            outline: 'none',
                            transition: 'all 0.2s ease',
                            marginLeft: '4px'
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 59, 48, 0.9)';
                            e.currentTarget.style.transform = 'scale(1.05)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                            e.currentTarget.style.transform = 'scale(1)';
                        }}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<Island />);
