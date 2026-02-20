import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// SVG Icons can be added here if needed, but we'll use emojis/images for simplicity as per mockup
const LightModeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
);

const DarkModeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
);

const MouseIcon = () => (
  <img src="/icon/move.gif" alt="Move Mouse" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
);

const MsgIcon = () => (
  <img src="/icon/chat.gif" alt="Move Mouse" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
);

function App() {
  const [activeTab, setActiveTab] = useState("Main");
  const [isMouseMoving, setIsMouseMoving] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  // WhatsApp scheduling state
  const [waPhone, setWaPhone] = useState("");
  const [waMsg, setWaMsg] = useState("");
  const [waTime, setWaTime] = useState("");

  // Sync dark mode class
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    // Check initial mouse state from rust
    invoke("is_mouse_moving").then((state) => {
      setIsMouseMoving(state as boolean);
    }).catch(console.error);

    // Disable right click / default context menu for an app-like feel
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  const handleToggleMouse = async () => {
    try {
      const newState: boolean = await invoke("toggle_mouse");
      setIsMouseMoving(newState);
    } catch (err) {
      console.error(err);
    }
  };

  const handleScheduleWa = async () => {
    try {
      if (!waPhone || !waMsg || !waTime) {
        alert("Please fill in all fields.");
        return;
      }

      const now = new Date();
      const [hours, minutes] = waTime.split(':').map(Number);
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);

      let delayMs = target.getTime() - now.getTime();
      if (delayMs < 0) {
        // If the time already passed today, schedule it for tomorrow
        target.setDate(target.getDate() + 1);
        delayMs = target.getTime() - now.getTime();
      }

      const delaySecs = Math.floor(delayMs / 1000);

      await invoke("schedule_whatsapp", { phone: waPhone, message: waMsg, delaySecs });

      alert(`WhatsApp message scheduled to be sent in ${delaySecs} seconds!`);
      setWaPhone("");
      setWaMsg("");
      setWaTime("");
      setActiveTab("Main");
    } catch (err) {
      console.error(err);
      alert("Error scheduling message: " + err);
    }
  };

  return (
    <div className="app-wrapper">
      <div className="top-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src="/icon/TaskGoblin.png" alt="TaskGoblin" className="app-logo" />
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }}>TaskGoblin</h1>
        </div>
        <button className="theme-toggle-btn" onClick={() => setIsDarkMode(!isDarkMode)}>
          {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
        </button>
      </div>

      <div style={{ padding: '0 16px', marginTop: '4px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '10px 14px', gap: '8px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" placeholder="Search" style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, outline: 'none', width: '100%', fontSize: '14px', color: 'var(--text-primary)', boxShadow: 'none' }} readOnly className="no-focus-input" />
        </div>
      </div>

      <div className="content-area">
        {activeTab === "Main" && (
          <>
            <div className="section-label">MAIN</div>

            <div className={`list-item ${isMouseMoving ? "active" : ""}`} onClick={handleToggleMouse}>
              <div className="icon"><MouseIcon /></div>
              <span>Move Mouse</span>
              <div className={`toggle-switch ${isMouseMoving ? "active" : ""}`}>
                <div className="toggle-knob"></div>
              </div>
            </div>

            <div className="list-item" onClick={() => setActiveTab("WhatsApp")}>
              <div className="icon"><MsgIcon /></div>
              <span>WhatsApp Msg</span>
            </div>

            {/* Added a filler visual structure just to make it look like the long mockup */}
            <div className="section-label" style={{ marginTop: '20px' }}>OTHERS</div>
            <div className="list-item">
              <div className="icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              </div>
              <span>Notifications</span>
            </div>
            <div className="list-item">
              <div className="icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </div>
              <span>Settings</span>
            </div>
          </>
        )}

        {activeTab === "WhatsApp" && (
          <div className="wa-form-container">
            <div className="list-item" onClick={() => setActiveTab("Main")} style={{ marginBottom: '16px', background: 'var(--border-color)', fontWeight: 600 }}>
              <span style={{ fontSize: '18px', marginRight: '8px' }}>←</span> Back
            </div>

            <label className="wa-form-label">Phone Number</label>
            <input
              type="text"
              value={waPhone}
              onChange={e => setWaPhone(e.target.value)}
              placeholder="+1234567890"
            />

            <label className="wa-form-label" style={{ marginTop: '8px' }}>Message</label>
            <textarea
              value={waMsg}
              onChange={e => setWaMsg(e.target.value)}
              placeholder="Type your message here..."
              style={{ minHeight: '80px', resize: 'vertical' }}
            />

            <label className="wa-form-label" style={{ marginTop: '8px' }}>Time (HH:MM)</label>
            <input
              type="time"
              value={waTime}
              onChange={e => setWaTime(e.target.value)}
            />

            <button className="wa-submit-btn" onClick={handleScheduleWa}>
              Schedule
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
