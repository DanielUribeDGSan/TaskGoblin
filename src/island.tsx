import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { translations, type Language } from "./i18n/translations";

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
    justifyContent: 'space-between',
    minWidth: '150px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
    position: 'relative' as const
};

const Island = () => {
    const [timeLeftStr, setTimeLeftStr] = useState("...");
    const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const isOcrMode = params.get("mode") === "ocr";

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
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#28c840" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                            <path d="M21 12a9 9 0 11-6.22-8.56" />
                        </svg>
                        <span style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                            color: '#28c840',
                            letterSpacing: '0.3px'
                        }} data-tauri-drag-region>
                            {getOcrLabel()}
                        </span>
                    </div>
                </div>
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
                        title="Cancel Shutdown"
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
