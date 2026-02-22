import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const Island = () => {
    const [timeLeftStr, setTimeLeftStr] = useState("...");

    useEffect(() => {
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
    }, []);

    const handleCancel = async () => {
        try {
            await invoke("cancel_shutdown");
            await getCurrentWebviewWindow().close();
        } catch (e) {
            console.error(e);
        }
    };

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
            <div style={{
                backgroundColor: '#000000',
                borderRadius: '999px',
                height: '36px',
                padding: '0 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                minWidth: '150px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.8)', // Deep shadow so it pops on all wallpapers
                position: 'relative'
            }} data-tauri-drag-region>

                {/* Left side: subtle green shutdown icon and Time */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', zIndex: 1 }} data-tauri-drag-region>
                    {/* A small green power icon to match the phone icon from the iOS screenshot */}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#28c840" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" data-tauri-drag-region>
                        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line>
                    </svg>
                    <span style={{
                        fontSize: '15px',
                        fontWeight: 600,
                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                        color: '#28c840', // iOS Green
                        letterSpacing: '0.3px',
                        transform: 'translateY(0.5px)' // slight optical adjustment
                    }} data-tauri-drag-region>
                        {timeLeftStr}
                    </span>
                </div>

                {/* Right side: Cancel action as a secondary quiet button that glows on hover */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '16px' }} data-tauri-drag-region>
                    {/* We can use a small colored waveform icon or just the X */}
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
                            e.currentTarget.style.background = 'rgba(255, 59, 48, 0.9)'; // iOS Red
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
