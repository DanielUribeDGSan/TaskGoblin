import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Rect { x: number; y: number; w: number; h: number }

function CaptureOverlay() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    const [rect, setRect] = useState<Rect | null>(null);
    const dragging = useRef(false);

    // Draw selection rect on canvas
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Semi-transparent dark overlay
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (rect && rect.w > 0 && rect.h > 0) {
            // Cut out the selection (makes it bright/clear)
            ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
            // White border around selection
            ctx.strokeStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            // Corner dots
            const corners = [
                [rect.x, rect.y],
                [rect.x + rect.w, rect.y],
                [rect.x, rect.y + rect.h],
                [rect.x + rect.w, rect.y + rect.h],
            ];
            ctx.fillStyle = "#fff";
            corners.forEach(([cx, cy]) => {
                ctx.beginPath();
                ctx.arc(cx, cy, 4, 0, Math.PI * 2);
                ctx.fill();
            });
            // Size label
            ctx.fillStyle = "rgba(0,0,0,0.7)";
            ctx.fillRect(rect.x, rect.y - 22, 90, 20);
            ctx.fillStyle = "#fff";
            ctx.font = "12px sans-serif";
            ctx.fillText(`${Math.round(rect.w)} × ${Math.round(rect.h)}`, rect.x + 5, rect.y - 7);
        }
    }, [rect]);

    // Resize canvas to window
    useEffect(() => {
        const resize = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        resize();
        window.addEventListener("resize", resize);
        return () => window.removeEventListener("resize", resize);
    }, []);

    const onMouseDown = (e: React.MouseEvent) => {
        startRef.current = { x: e.clientX, y: e.clientY };
        dragging.current = true;
        setRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (!dragging.current || !startRef.current) return;
        const x = Math.min(e.clientX, startRef.current.x);
        const y = Math.min(e.clientY, startRef.current.y);
        const w = Math.abs(e.clientX - startRef.current.x);
        const h = Math.abs(e.clientY - startRef.current.y);
        setRect({ x, y, w, h });
    };

    const onMouseUp = async (e: React.MouseEvent) => {
        dragging.current = false;
        if (!startRef.current) return;
        const x = Math.min(e.clientX, startRef.current.x);
        const y = Math.min(e.clientY, startRef.current.y);
        const w = Math.abs(e.clientX - startRef.current.x);
        const h = Math.abs(e.clientY - startRef.current.y);

        if (w > 5 && h > 5) {
            // Get device pixel ratio for hi-DPI screens
            const dpr = window.devicePixelRatio || 1;
            await invoke("finalize_capture", {
                x: Math.round(x * dpr),
                y: Math.round(y * dpr),
                w: Math.round(w * dpr),
                h: Math.round(h * dpr),
            });
        } else {
            // Tiny selection = cancel
            await getCurrentWindow().close();
        }
    };

    const onKeyDown = async (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            await invoke("cancel_capture");
        }
    };

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: "fixed",
                inset: 0,
                width: "100vw",
                height: "100vh",
                cursor: "crosshair",
                display: "block",
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onKeyDown={onKeyDown}
            tabIndex={0}
        />
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <CaptureOverlay />
    </React.StrictMode>
);
