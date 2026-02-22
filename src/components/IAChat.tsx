import { useState, useRef, useEffect } from "react";

// Icons
const SparkleIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" /></svg>
);

const ImageIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
);

const MicIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
);

const SendIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
);

const KeyIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" /><path d="m21 2-9.6 9.6" /><circle cx="7.5" cy="15.5" r="5.5" /></svg>
);

const BackIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="m15 18-6-6 6-6" /></svg>
);

interface IAChatProps {
    setActiveTab: (tab: string) => void;
}

const aiModels = [
    { id: "openai", name: "ChatGPT (Free)", provider: "Pollinations", isFree: true },
    { id: "claude", name: "Claude (Free)", provider: "Pollinations", isFree: true },
    { id: "gpt-4o", name: "ChatGPT 4o", provider: "OpenAI", isFree: false },
    { id: "gpt-3.5-turbo", name: "ChatGPT 3.5", provider: "OpenAI", isFree: false },
    { id: "llama-3.1-8b-instant", name: "Groq Llama 3.1 8B", provider: "Groq", isFree: false },
    { id: "deepseek-chat", name: "DeepSeek v3", provider: "DeepSeek", isFree: false },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "Google", isFree: false }
];

export default function IAChat({ setActiveTab }: IAChatProps) {
    const [message, setMessage] = useState("");
    const [selectedModel, setSelectedModel] = useState(aiModels[0]);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [showKeyMenu, setShowKeyMenu] = useState(false);

    // API Keys state
    const [apiKeys, setApiKeys] = useState<{ [key: string]: string }>({
        OpenAI: "",
        Groq: "",
        DeepSeek: "",
        Google: ""
    });

    const [chatHistory, setChatHistory] = useState<{ role: string, content: string }[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Load keys from localStorage on mount
    useEffect(() => {
        const savedKeys = localStorage.getItem("mouseCrazy_apiKeys");
        if (savedKeys) {
            setApiKeys(JSON.parse(savedKeys));
        }
    }, []);

    // Save keys whenever they change
    useEffect(() => {
        localStorage.setItem("mouseCrazy_apiKeys", JSON.stringify(apiKeys));
    }, [apiKeys]);

    // Auto-scroll chat
    useEffect(() => {
        // Use a small timeout to ensure the DOM has updated before scrolling
        setTimeout(() => {
            chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }, 50);
    }, [chatHistory]);

    const handleKeyChange = (provider: string, val: string) => {
        setApiKeys(prev => ({ ...prev, [provider]: val }));
    };

    const streamResponse = async (userMsg: string) => {
        setIsStreaming(true);
        let url = "";
        let headers: any = { "Content-Type": "application/json" };
        let requestBody: any = {
            model: selectedModel.id,
            messages: [...chatHistory, { role: "user", content: userMsg }],
            stream: true
        };

        // Determine endpoint & auth based on provider
        let method = "POST";
        if (selectedModel.isFree) {
            // Pollinations allows GET requests anonymously without auth limits
            url = `https://text.pollinations.ai/${encodeURIComponent(userMsg)}?model=${selectedModel.id}`;
            method = "GET";
            // For GET requests, headers and body are not typically sent in the same way
            headers = undefined;
            requestBody = undefined;
        } else {
            const key = apiKeys[selectedModel.provider];
            if (!key) {
                setChatHistory(prev => [...prev, { role: "assistant", content: `Error: No API key found for ${selectedModel.provider}.Please set it in the settings menu(🔑 icon).` }]);
                setIsStreaming(false);
                return;
            }
            headers["Authorization"] = `Bearer ${key}`;
            if (selectedModel.provider === "OpenAI") url = "https://api.openai.com/v1/chat/completions";
            else if (selectedModel.provider === "Groq") url = "https://api.groq.com/openai/v1/chat/completions";
            else if (selectedModel.provider === "DeepSeek") url = "https://api.deepseek.com/chat/completions";
            else if (selectedModel.provider === "Google") {
                // Setup for Gemini's direct API (Rest equivalent) or point to a proxy.
                // Using standard OpenAI compatible format for simplicity, assuming users can use tools like Gemini-OpenAI-Proxy.
                url = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
            }
        }

        try {
            const res = await fetch(url, {
                method: method,
                headers: selectedModel.isFree ? undefined : headers,
                body: selectedModel.isFree ? undefined : JSON.stringify(requestBody)
            });

            if (!res.ok) {
                // User friendly error handling based on status codes
                if (res.status === 401) throw new Error("Llave de API incorrecta o no autorizada (401). Verifica que la hayas copiado bien.");
                if (res.status === 402) throw new Error("Tu cuenta no tiene saldo suficiente para usar este modelo de paga (402). Por favor, recarga créditos en la plataforma oficial.");
                if (res.status === 404) throw new Error("El modelo seleccionado no está disponible o ha sido descontinuado por el proveedor (404).");
                if (res.status === 429) throw new Error("Has excedido el límite de peticiones gratuitas o de pago de esta API (429). Espera un momento y vuelve a intentarlo.");

                throw new Error(`Ocurrió un error inesperado al conectar con ${selectedModel.provider}. Código de error: ${res.status}`);
            }

            // For GET text responses (like Pollinations), it might not stream JSON chunks, just pure text
            if (selectedModel.isFree) {
                const text = await res.text();
                setChatHistory(prev => [...prev, { role: "assistant", content: text }]);
                setIsStreaming(false);
                return;
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder("utf-8");

            // Add empty assistant message to stream into
            setChatHistory(prev => [...prev, { role: "assistant", content: "" }]);

            if (reader) {
                let done = false;
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) {
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n');
                        for (const line of lines) {
                            if (line.trim().startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                                try {
                                    // Make sure we correctly strip just "data: "
                                    const jsonStr = line.trim().substring(6);
                                    if (!jsonStr) continue;

                                    const parsed = JSON.parse(jsonStr);
                                    const textInfo = parsed.choices?.[0]?.delta?.content || "";

                                    if (textInfo) {
                                        setChatHistory(prev => {
                                            const newHistory = [...prev];
                                            newHistory[newHistory.length - 1].content += textInfo;
                                            return newHistory;
                                        });
                                    }
                                } catch (e) {
                                    // Ignore parse errors for incomplete chunks
                                }
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error("Chat error:", error);
            // Default friendly error message fallback
            let message = error.message;
            if (!message.includes("(")) {
                message = "Ocurrió un problema de conexión. Por favor, revisa tus llaves (API Keys) o inténtalo más tarde.";
            }
            setChatHistory(prev => [...prev, { role: "assistant", content: `❌ Error: ${message}` }]);
        } finally {
            setIsStreaming(false);
        }
    };

    const handleSend = () => {
        if (!message.trim() || isStreaming) return;
        const newMsg = message;
        setMessage("");

        // Reset textarea height
        if (textareaRef.current) {
            textareaRef.current.style.height = '24px';
        }

        setChatHistory(prev => [...prev, { role: "user", content: newMsg }]);
        streamResponse(newMsg);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setMessage(e.target.value);
        if (textareaRef.current) {
            textareaRef.current.style.height = '24px'; // Reset to calculate exact scrollHeight
            const scrollHeight = textareaRef.current.scrollHeight;
            textareaRef.current.style.height = Math.min(scrollHeight, 150) + 'px'; // Max height 150px
        }
    };

    const handleImageSearch = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        alert(`Selected ${file.name} for image search. (Full reverse search backend pending)`);
    };

    return (
        <div className="ia-chat-container">
            {/* Header */}
            <div className="ia-chat-header" data-tauri-drag-region>
                <button className="icon-btn-ghost" onClick={() => setActiveTab("Main")}>
                    <BackIcon />
                </button>
                <div className="ia-chat-title" data-tauri-drag-region>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Model</div>
                    <div style={{ fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} onClick={() => setShowModelMenu(!showModelMenu)}>
                        {selectedModel.name}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </div>
                </div>
                <button className="icon-btn-ghost" onClick={() => setShowKeyMenu(!showKeyMenu)}>
                    <KeyIcon />
                </button>
            </div>

            {/* Model Selection Dropdown */}
            {showModelMenu && (
                <div className="ia-model-menu">
                    <div className="ia-model-menu-header">Select Model</div>
                    <div className="ia-model-list">
                        {aiModels.map(model => (
                            <div
                                key={model.id}
                                className={`ia-model-item ${selectedModel.id === model.id ? 'active' : ''}`}
                                onClick={() => { setSelectedModel(model); setShowModelMenu(false); setChatHistory([]); }}
                            >
                                <div style={{ fontWeight: 500, color: model.isFree ? '#69f0ae' : 'var(--text-primary)' }}>{model.name}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{model.provider}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* API Key Modal */}
            {showKeyMenu && (
                <div className="ia-key-menu">
                    <div className="ia-model-menu-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        API Configurations
                        <button onClick={() => setShowKeyMenu(false)} style={{ background: 'none', border: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>X</button>
                    </div>
                    <p style={{ fontSize: '12px', color: 'var(--text-secondary)', padding: '12px 12px 4px' }}>Free models don't require keys. For others, enter them here (saved locally).</p>
                    <div style={{ padding: '8px 12px 12px', display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto' }}>
                        <input type="password" placeholder="OpenAI API Key" className="ia-api-input" value={apiKeys.OpenAI || ''} onChange={(e) => handleKeyChange("OpenAI", e.target.value)} />
                        <input type="password" placeholder="Groq API Key" className="ia-api-input" value={apiKeys.Groq || ''} onChange={(e) => handleKeyChange("Groq", e.target.value)} />
                        <input type="password" placeholder="DeepSeek API Key" className="ia-api-input" value={apiKeys.DeepSeek || ''} onChange={(e) => handleKeyChange("DeepSeek", e.target.value)} />
                        <input type="password" placeholder="Google Gemini API Key" className="ia-api-input" value={apiKeys.Google || ''} onChange={(e) => handleKeyChange("Google", e.target.value)} />
                    </div>
                </div>
            )}

            {/* Chat History Area */}
            <div className="ia-chat-history">
                {chatHistory.length === 0 ? (
                    <div className="ia-empty-state">
                        <h1 style={{ fontSize: '28px', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-primary)', lineHeight: '1.2' }}>What Do You Want<br />To Create</h1>
                        <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Select a free model or set your API key and ask anything...</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {chatHistory.map((chat, idx) => (
                            <div key={idx} style={{
                                alignSelf: chat.role === "user" ? "flex-end" : "flex-start",
                                background: chat.role === "user" ? "var(--bg-secondary)" : "transparent",
                                border: chat.role === "user" ? "1px solid var(--border-color)" : "none",
                                padding: "12px 16px",
                                borderRadius: "16px",
                                maxWidth: "90%",
                                fontSize: "14px",
                                color: "var(--text-primary)",
                                lineHeight: 1.5,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word"
                            }}>
                                {chat.content}
                            </div>
                        ))}
                    </div>
                )}
                <div ref={chatEndRef} />
            </div>

            {/* Input Area */}
            <div className="ia-chat-input-wrapper">
                <div className="ia-input-container">
                    <button className="ia-icon-btn" title="Models" onClick={() => setShowModelMenu(!showModelMenu)}>
                        <SparkleIcon />
                    </button>

                    <button className="ia-icon-btn" title="Search via Image" onClick={handleImageSearch}>
                        <ImageIcon />
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" style={{ display: 'none' }} />

                    <button className="ia-icon-btn" title="Voice Input">
                        <MicIcon />
                    </button>

                    <textarea
                        ref={textareaRef}
                        className="ia-text-input"
                        placeholder={isStreaming ? "Thinking..." : "Ask me anything..."}
                        value={message}
                        onChange={handleInput}
                        onKeyDown={handleKeyDown}
                        disabled={isStreaming}
                        rows={1}
                        style={{
                            resize: 'none',
                            overflowY: 'auto',
                            minHeight: '24px',
                            maxHeight: '150px',
                            lineHeight: '1.5',
                            padding: '4px'
                        }}
                    />

                    <button className="ia-send-btn" onClick={handleSend} disabled={!message.trim() || isStreaming}>
                        {isStreaming ? (
                            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--bg-primary)', animation: 'pulse 1s infinite' }} />
                        ) : (
                            <SendIcon />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
