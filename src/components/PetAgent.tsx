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
    const [behavior, setBehavior] = useState<'walking' | 'pouncing' | 'sitting' | 'vomiting' | 'stalking' | 'stealing'>('walking');
    const [effects, setEffects] = useState<VisualEffect[]>([]);
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const [isFocused, setIsFocused] = useState(document.hasFocus());
    const [isNearSidebar, setIsNearSidebar] = useState(false);
    const [hasMouse, setHasMouse] = useState(false);
    const isIgnoringCursor = useRef(true);
    const requestRef = useRef<number>();
    const lastUpdate = useRef<number>(performance.now());

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

            // If we have stolen the mouse, we NEVER ignore cursor so we can keep cursor: none
            if (hasMouse) {
                if (isIgnoringCursor.current) {
                    isIgnoringCursor.current = false;
                    invoke("set_ignore_cursor_events", { ignore: false });
                }
                return;
            }

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
    }, [behavior, hasMouse]);

    // Autonomous Movement & Behavior Logic (Smooth 60fps)
    const animate = (time: number) => {
        const deltaTime = time - lastUpdate.current;
        lastUpdate.current = time;

        const shouldPause = isFocused || isNearSidebar;
        if (shouldPause && !hasMouse) {
            requestRef.current = requestAnimationFrame(animate);
            return;
        }

        if (behavior === 'sitting' || behavior === 'vomiting') {
            requestRef.current = requestAnimationFrame(animate);
            return;
        }

        setPos(prev => {
            let currentTarget = target;
            if (behavior === 'stalking') {
                currentTarget = mousePos;
            } else if (hasMouse && behavior === 'stealing') {
                // Run away to a corner!
                currentTarget = target;
            }

            const dx = currentTarget.x - prev.x;
            const dy = currentTarget.y - prev.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 40 && behavior === 'stalking') {
                // GOTCHA! Steal mouse?
                const shouldSteal = Math.random() < 0.3;
                if (shouldSteal) {
                    setBehavior('stealing');
                    setHasMouse(true);
                    setTarget({
                        x: Math.random() < 0.5 ? -100 : globalThis.innerWidth + 100,
                        y: Math.random() * globalThis.innerHeight
                    });
                    setTimeout(() => {
                        setHasMouse(false);
                        setBehavior('walking');
                        // Restore ignore-cursor logic in next mouse move
                    }, 5000);
                } else {
                    setBehavior('walking');
                    setTarget({
                        x: Math.random() * (globalThis.innerWidth - 100) + 50,
                        y: Math.random() * (globalThis.innerHeight - 100) + 50
                    });
                }
                return prev;
            }

            if (dist < 15 && behavior !== 'stealing' && behavior !== 'stalking') {
                // Reached target, decide next move
                const rand = Math.random();
                if (rand < 0.05) { // Hairball!
                    setBehavior('vomiting');
                    const newHairball: VisualEffect = {
                        id: Date.now(),
                        x: prev.x - 100,
                        y: prev.y - 100,
                        type: 'stain'
                    };
                    setEffects(curr => [...curr, newHairball]);
                    setTimeout(() => setBehavior('walking'), 3000);
                    setTimeout(() => setEffects(curr => curr.filter(e => e.id !== newHairball.id)), 8000);
                } else if (rand < 0.15) {
                    setBehavior('pouncing');
                    const letters = "TASKGOBLIN";
                    const letter = letters[Math.floor(Math.random() * letters.length)];
                    const newLetter: VisualEffect = { id: Date.now(), x: prev.x, y: prev.y, type: 'letter', content: letter };
                    setEffects(curr => [...curr, newLetter]);
                    setTimeout(() => setBehavior('walking'), 1500);
                    setTimeout(() => setEffects(curr => curr.filter(e => e.id !== newLetter.id)), 1500);
                } else if (rand < 0.25) {
                    setBehavior('sitting');
                    setTimeout(() => setBehavior('walking'), 4000);
                } else {
                    setTarget({
                        x: Math.random() * (globalThis.innerWidth - 100) + 50,
                        y: Math.random() * (globalThis.innerHeight - 100) + 50
                    });
                    setBehavior('walking');
                }
                return prev;
            }

            // Calculate movement
            let speed = (behavior === 'pouncing' || behavior === 'stalking' || behavior === 'stealing') ? 0.3 : 0.1;
            // Frame-rate independent move
            const moveAmount = speed * deltaTime;

            if (dist > 0) {
                return {
                    x: prev.x + (dx / dist) * moveAmount,
                    y: prev.y + (dy / dist) * moveAmount
                };
            }
            return prev;
        });

        requestRef.current = requestAnimationFrame(animate);
    };

    useEffect(() => {
        requestRef.current = requestAnimationFrame(animate);
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [target, behavior, isFocused, isNearSidebar, mousePos, hasMouse]);

    const isHidden = (isSidebarVisible || isFocused || isNearSidebar) && !hasMouse;
    if (isHidden) return null;

    return (
        <div className={`pet-overlay ${hasMouse ? 'stealing-mouse' : ''}`}>
            {effects.map(fx => (
                <div
                    key={fx.id}
                    className={fx.type === 'stain' ? 'pet-hairball' : 'stolen-letter'}
                    style={{ left: fx.x, top: fx.y }}
                >
                    {fx.content}
                </div>
            ))}

            <div
                className={`pet-3d-container ${behavior} ${hasMouse ? 'carrying' : ''}`}
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
                        {hasMouse && (
                            <div className="stolen-mouse-icon">🖱️</div>
                        )}
                    </div>
                    <div className="cat-legs">
                        <div className="cat-leg"></div>
                        <div className="cat-leg"></div>
                    </div>
                </div>
                {behavior === 'vomiting' && <div className="crunch-msg">*GULP* bleh! 🤮</div>}
                {behavior === 'pouncing' && <div className="crunch-msg">MINE! 🐾</div>}
                {behavior === 'sitting' && <div className="crunch-msg">Zzz... 😴</div>}
                {behavior === 'stalking' && <div className="crunch-msg">STALKING... 👁️</div>}
                {behavior === 'stealing' && <div className="crunch-msg">COFFEE TIME! ☕️</div>}
            </div>
        </div>
    );
};

export default PetAgent;
