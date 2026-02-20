import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Patch {
    id: number;
    x: number;
    y: number;
}

const PetAgent = ({ isSidebarVisible }: { isSidebarVisible: boolean }) => {
    const [pos, setPos] = useState({ x: 500, y: 500 });
    const [target, setTarget] = useState({ x: 500, y: 500 });
    const [isEating, setIsEating] = useState(false);
    const [patches, setPatches] = useState<Patch[]>([]);
    const [isFocused, setIsFocused] = useState(document.hasFocus());
    const [isNearSidebar, setIsNearSidebar] = useState(false);
    const isIgnoringCursor = useRef(true);

    // Focus tracking
    useEffect(() => {
        const handleFocus = () => setIsFocused(true);
        const handleBlur = () => setIsFocused(false);
        globalThis.addEventListener('focus', handleFocus);
        globalThis.addEventListener('blur', handleBlur);
        return () => {
            globalThis.removeEventListener('focus', handleFocus);
            globalThis.removeEventListener('blur', handleBlur);
        };
    }, []);

    // Dynamic click-through logic: if mouse is in sidebar area, let it through
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            const inSidebar = e.clientX < 440;
            setIsNearSidebar(inSidebar);

            if (inSidebar && isIgnoringCursor.current) {
                isIgnoringCursor.current = false;
                invoke("set_ignore_cursor_events", { ignore: false });
            } else if (!inSidebar && !isIgnoringCursor.current) {
                isIgnoringCursor.current = true;
                invoke("set_ignore_cursor_events", { ignore: true });
            }
        };
        globalThis.addEventListener('mousemove', handleMouseMove);
        return () => globalThis.removeEventListener('mousemove', handleMouseMove);
    }, []);

    // Autonomous Movement Logic
    useEffect(() => {
        const moveInterval = setInterval(() => {
            const shouldBeHidden = isFocused || isNearSidebar;
            if (isEating || shouldBeHidden) return;

            setPos(prev => {
                const dx = target.x - prev.x;
                const dy = target.y - prev.y;
                const dist = Math.hypot(dx, dy);

                if (dist < 10) {
                    // Reached target, pick new one or eat
                    if (Math.random() < 0.3) {
                        setIsEating(true);
                        setPatches(p => [...p, { id: Date.now(), x: prev.x, y: prev.y }]);
                        setTimeout(() => setIsEating(false), 800);
                    } else {
                        setTarget({
                            x: Math.random() * (globalThis.innerWidth - 100) + 50,
                            y: Math.random() * (globalThis.innerHeight - 100) + 50
                        });
                    }
                    return prev;
                }

                return {
                    x: prev.x + (dx / dist) * 2,
                    y: prev.y + (dy / dist) * 2
                };
            });
        }, 20);

        return () => clearInterval(moveInterval);
    }, [target, isEating, isFocused, isNearSidebar]);

    // The pet is "shy": it hides when the sidebar is visible, or when you are focused on the app.
    const isHidden = isSidebarVisible || isFocused || isNearSidebar;
    if (isHidden) return null;

    return (
        <div className="pet-overlay">
            {patches.map(p => (
                <div key={p.id} className="eaten-patch" style={{ left: p.x, top: p.y }} />
            ))}

            <div
                className={`pet-3d-container ${isEating ? 'eating' : ''}`}
                style={{
                    left: pos.x,
                    top: pos.y,
                    transform: `translate(-50%, -100%) scaleX(${target.x > pos.x ? 1 : -1})`
                }}
            >
                {/* 3D-ish Puppy using CSS layers */}
                <div className="puppy-3d">
                    <div className="puppy-tail"></div>
                    <div className="puppy-body">
                        <div className="puppy-spots"></div>
                    </div>
                    <div className="puppy-head">
                        <div className="puppy-ears-l"></div>
                        <div className="puppy-ears-r"></div>
                        <div className="puppy-eyes"></div>
                        <div className="puppy-nose"></div>
                    </div>
                    <div className="puppy-legs">
                        <div className="leg leg-1"></div>
                        <div className="leg leg-2"></div>
                        <div className="leg leg-3"></div> {/* Special 3rd leg for depth/requested style */}
                    </div>
                </div>
                {isEating && <div className="crunch-msg">CHOMP!</div>}
            </div>
        </div>
    );
};

export default PetAgent;
