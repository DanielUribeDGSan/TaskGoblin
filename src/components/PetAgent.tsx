import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface VisualEffect {
    id: number;
    x: number;
    y: number;
    type: 'stain' | 'letter';
    content?: string;
}

const PetAgent = ({ isSidebarVisible }: { isSidebarVisible: boolean }) => {
    const [pos, setPos] = useState({ x: 500, y: 500 });
    const [target, setTarget] = useState({ x: 500, y: 500 });
    const [behavior, setBehavior] = useState<'walking' | 'pouncing' | 'sitting' | 'staining' | 'stalking' | 'hiding'>('walking');
    const [effects, setEffects] = useState<VisualEffect[]>([]);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
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

    // Dynamic click-through logic & Mouse Tracking
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            setMousePos({ x: e.clientX, y: e.clientY });

            // Sidebar is typically on the left, up to 440px
            const inSidebar = e.clientX < 440;
            setIsNearSidebar(inSidebar);

            if (inSidebar && isIgnoringCursor.current) {
                isIgnoringCursor.current = false;
                invoke("set_ignore_cursor_events", { ignore: false });
            } else if (!inSidebar && !isIgnoringCursor.current) {
                isIgnoringCursor.current = true;
                invoke("set_ignore_cursor_events", { ignore: true });
            }

            // Randomly start stalking if mouse is moving
            if (Math.random() < 0.005 && behavior === 'walking') {
                setBehavior('stalking');
            }
        };
        globalThis.addEventListener('mousemove', handleMouseMove);
        return () => globalThis.removeEventListener('mousemove', handleMouseMove);
    }, [behavior]);

    // Autonomous Movement & Behavior Logic
    useEffect(() => {
        const moveInterval = setInterval(() => {
            const shouldBeHidden = isFocused || isNearSidebar;
            if (shouldBeHidden) return;
            if (behavior === 'sitting' || behavior === 'staining') return;

            setPos(prev => {
                let currentTarget = target;
                if (behavior === 'stalking' || behavior === 'hiding') {
                    currentTarget = mousePos;
                }

                const dx = currentTarget.x - prev.x;
                const dy = currentTarget.y - prev.y;
                const dist = Math.hypot(dx, dy);

                if (dist < 40 && behavior === 'stalking') {
                    setBehavior('hiding');
                    setTimeout(() => setBehavior('walking'), 3000);
                    return prev;
                }

                if (dist < 15 && behavior !== 'hiding' && behavior !== 'stalking') {
                    // Reached target, decide next move
                    const rand = Math.random();
                    if (rand < 0.1) {
                        setBehavior('staining');
                        const newStain: VisualEffect = { id: Date.now(), x: prev.x, y: prev.y, type: 'stain' };
                        setEffects(curr => [...curr, newStain]);
                        setTimeout(() => setBehavior('walking'), 2000);
                        setTimeout(() => setEffects(curr => curr.filter(e => e.id !== newStain.id)), 10000);
                    } else if (rand < 0.2) {
                        setBehavior('pouncing');
                        const letters = "TASKGOBLIN";
                        const letter = letters[Math.floor(Math.random() * letters.length)];
                        const newLetter: VisualEffect = { id: Date.now(), x: prev.x, y: prev.y, type: 'letter', content: letter };
                        setEffects(curr => [...curr, newLetter]);
                        setTimeout(() => setBehavior('walking'), 1500);
                        setTimeout(() => setEffects(curr => curr.filter(e => e.id !== newLetter.id)), 1500);
                    } else if (rand < 0.3) {
                        setBehavior('sitting');
                        setTimeout(() => setBehavior('walking'), 3000);
                    } else {
                        setTarget({
                            x: Math.random() * (globalThis.innerWidth - 100) + 50,
                            y: Math.random() * (globalThis.innerHeight - 100) + 50
                        });
                        setBehavior('walking');
                    }
                    return prev;
                }

                const speed = (behavior === 'pouncing' || behavior === 'stalking') ? 6 : 2;
                return {
                    x: prev.x + (dx / dist) * speed,
                    y: prev.y + (dy / dist) * speed
                };
            });
        }, 30);

        return () => clearInterval(moveInterval);
    }, [target, behavior, isFocused, isNearSidebar, mousePos]);

    const isHidden = isSidebarVisible || isFocused || isNearSidebar;
    if (isHidden) return null;

    return (
        <div className="pet-overlay">
            {effects.map(fx => (
                <div
                    key={fx.id}
                    className={fx.type === 'stain' ? 'cat-stain' : 'stolen-letter'}
                    style={{ left: fx.x, top: fx.y }}
                >
                    {fx.content}
                </div>
            ))}

            {behavior === 'hiding' && (
                <div className="cat-paw-overlay" style={{ left: mousePos.x - 20, top: mousePos.y - 20 }} />
            )}

            <div
                className={`pet-3d-container ${behavior}`}
                style={{
                    left: pos.x,
                    top: pos.y,
                    transform: `translate(-50%, -100%) scaleX(${target.x > pos.x ? 1 : -1})`
                }}
            >
                <div className="cat-3d">
                    <div className="cat-tail"></div>
                    <div className="cat-body"></div>
                    <div className="cat-head">
                        <div className="cat-ears-l"></div>
                        <div className="cat-ears-r"></div>
                        <div className="cat-eyes"></div>
                    </div>
                    <div className="cat-legs">
                        <div className="cat-leg"></div>
                        <div className="cat-leg"></div>
                    </div>
                </div>
                {behavior === 'staining' && <div className="crunch-msg">Oops! 💦</div>}
                {behavior === 'pouncing' && <div className="crunch-msg">MINE! 🐾</div>}
                {behavior === 'sitting' && <div className="crunch-msg">PRRR... 😺</div>}
                {behavior === 'stalking' && <div className="crunch-msg">ACECHANDO... 👁️</div>}
                {behavior === 'hiding' && <div className="crunch-msg">¡TE TENGO! 🐾</div>}
            </div>
        </div>
    );
};

export default PetAgent;
