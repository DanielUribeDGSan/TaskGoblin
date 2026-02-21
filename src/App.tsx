import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { register, unregister, isRegistered } from '@tauri-apps/plugin-global-shortcut';
import { listen } from "@tauri-apps/api/event";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import PetAgent from './components/PetAgent';
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

const PetIcon = () => (
  <img src="/icon/fox.gif" alt="Pet" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
);

const MsgIcon = () => (
  <img src="/icon/chat.gif" alt="Move Mouse" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
);

const CloseIcon = () => (
  <img src="/icon/close.gif" alt="Move Mouse" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
);

const ScreenshotIcon = () => (
  <img src="/icon/copy.gif" alt="Screenshot" style={{ width: '22px', height: '22px', objectFit: 'contain' }} />
);

interface Contact {
  name: string;
  phone: string;
}

const ContactPicker = ({ contacts, onSelect, currentPhone, onRefresh }: { contacts: Contact[], onSelect: (c: Contact) => void, currentPhone: string, onRefresh: () => void }) => {
  const [searchTerm, setSearchTerm] = useState("");

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.phone.includes(searchTerm)
  ).sort((a, b) => a.name.localeCompare(b.name));

  const groups = filtered.reduce((acc, contact) => {
    const firstLetter = contact.name.charAt(0).toUpperCase();
    if (!acc[firstLetter]) acc[firstLetter] = [];
    acc[firstLetter].push(contact);
    return acc;
  }, {} as Record<string, Contact[]>);

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <div className="contact-picker-wrapper">
      <input
        type="text"
        className="contact-search-input"
        placeholder="Filter contacts..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />

      {Object.keys(groups).sort().map(letter => (
        <div key={letter}>
          <div className="contact-group-header">{letter}</div>
          {groups[letter].map((contact, idx) => (
            <div
              key={`${contact.name}-${idx}`}
              className={`contact-item ${contact.phone === currentPhone ? 'selected' : ''}`}
              onClick={() => onSelect(contact)}
            >
              <div className="contact-avatar">{getInitials(contact.name)}</div>
              <div className="contact-info">
                <span className="contact-name">{contact.name}</span>
                <span className="contact-phone">{contact.phone}</span>
              </div>
              {contact.phone === currentPhone && (
                <div className="contact-check">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      {filtered.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '16px' }}>
            {contacts.length === 0
              ? "No contacts found or permissions missing."
              : "No matches found for your search."}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', justifyContent: 'center' }}>
            <button
              onClick={onRefresh}
              className="wa-submit-btn"
              style={{ width: 'auto', padding: '8px 16px', background: 'rgba(255,255,255,0.05)', fontSize: '12px' }}
            >
              🔄 Retry Sync
            </button>
            {contacts.length === 0 && (
              <button
                onClick={() => invoke("open_contact_settings")}
                className="wa-submit-btn"
                style={{ width: 'auto', padding: '8px 16px', fontSize: '12px' }}
              >
                🔐 Grant Permissions
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function App() {
  const [activeTab, setActiveTab] = useState("Main");
  const [isMouseMoving, setIsMouseMoving] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);

  // WhatsApp scheduling state
  const [waPhone, setWaPhone] = useState("");
  const [countryCode, setCountryCode] = useState("+52"); // Default México
  const [waMsg, setWaMsg] = useState("");
  const [waDateTime, setWaDateTime] = useState<Date | null>(new Date());
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: "", visible: false });
  const [isPetMode, setIsPetMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isAutostartEnabled, setIsAutostartEnabled] = useState(false);

  const checkAccessibility = async () => {
    try {
      const isEnabled = await invoke("check_accessibility");
      return isEnabled;
    } catch (err) {
      return false;
    }
  };

  const requestAccessibility = async () => {
    try {
      await invoke("request_accessibility");
    } catch (err) {
      showToast("Error requesting permissions: " + err);
    }
  };

  const handleToggleMouse = async () => {
    const isEnabled = await checkAccessibility();
    if (!isEnabled) {
      showToast("⚠️ Accessibility required for mouse mover");
      await requestAccessibility();
      // Also open settings as fallback
      setTimeout(() => invoke("open_accessibility_settings"), 2000);
      return;
    }
    try {
      const newState: boolean = await invoke("toggle_mouse");
      setIsMouseMoving(newState);
    } catch (err) {
      console.error(err);
    }
  };

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

    // Check autostart state
    isEnabled().then(setIsAutostartEnabled).catch(console.error);

    // Disable right click / default context menu for an app-like feel
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    globalThis.addEventListener("contextmenu", handleContextMenu);

    // Fetch contacts
    const fetchContacts = async () => {
      setIsLoadingContacts(true);
      setContactError(null);
      try {
        const data = await invoke("get_contacts");
        setContacts(data as Contact[]);
      } catch (err) {
        console.error(err);
        setContactError(err as string);
      } finally {
        setIsLoadingContacts(false);
      }
    };

    fetchContacts();
    checkAccessibility(); // Check for mouse movement permissions on start

    // Keydown debugger for finding the right shortcut keys
    const handleKeyDown = (e: KeyboardEvent) => {
      console.log(`Key pressed: ${e.key} | Code: ${e.code} | Shift: ${e.shiftKey} | Meta(Cmd): ${e.metaKey} | Ctrl: ${e.ctrlKey} | Alt: ${e.altKey}`);
    };
    window.addEventListener("keydown", handleKeyDown);

    // Register global shortcut
    console.log("Registering shortcut");

    const setupShortcut = async () => {
      try {
        const registered = await isRegistered('Control+Alt+2');
        if (registered) {
          console.log("Shortcut already registered, unregistering first");
          await unregister('Control+Alt+2');
        }
        await register('Control+Alt+2', (event) => {
          if (event.state === 'Pressed') {
            handleExtractText();
          }
        });
        console.log('Shortcut Registered Successfully');
      } catch (err) {
        console.error("Failed to register shortcut:", err);
      }
    };

    setupShortcut();

    // Reset sidebar state if window is focused (e.g. from tray)
    const unlistenPromise = getCurrentWebviewWindow().listen('tauri://focus', () => {
      console.log("Window focused, opening sidebar state");
      setIsSidebarOpen(true);
    });

    // Listen for backend-triggered toasts (captures)
    const unlistenToast = listen<{ message: string; title: string }>("show-toast", (event) => {
      setIsSidebarOpen(true); // Open sidebar automatically for the alert
      showToast(event.payload.message);

      // Auto-close after 3.5 seconds
      setTimeout(() => {
        setIsSidebarOpen(false);
        setTimeout(async () => {
          try { await invoke('hide_window'); } catch (e) { }
        }, 600); // Match CSS animation duration
      }, 3500);
    });

    return () => {
      globalThis.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
      unregister('Control+Alt+2').catch(console.error);
      unlistenPromise.then(unlisten => unlisten());
      unlistenToast.then(u => u());
    };
  }, []);

  const togglePetMode = async () => {
    const newMode = !isPetMode;
    try {
      await invoke("toggle_pet_mode", { active: newMode });
      setIsPetMode(newMode);
      if (newMode) {
        setIsSidebarOpen(false); // Auto-hide on start
      } else {
        setIsSidebarOpen(true); // Restore on stop
        // Force window to be interactive again
        await invoke("set_ignore_cursor_events", { ignore: false });
      }
      showToast(newMode ? "¡Mascota Gato activada! �" : "El gato se fue a dormir... 🏠");
    } catch (err) {
      showToast("Error toggling cat mode: " + err);
    }
  };

  const handleToggleAutostart = async () => {
    try {
      if (isAutostartEnabled) {
        await disable();
        setIsAutostartEnabled(false);
        showToast("Start on Login disabled");
      } else {
        await enable();
        setIsAutostartEnabled(true);
        showToast("Start on Login enabled");
      }
    } catch (err) {
      console.error(err);
      showToast("Error toggling autostart: " + err);
    }
  };

  const handleCloseApps = async () => {
    try {
      showToast("Closing applications... 🧹");
      await invoke("close_all_apps");
      showToast("All apps closed! ✨");
    } catch (err) {
      console.error(err);
      showToast("Error closing apps: " + err);
    }
  };

  const handleExtractText = async () => {
    try {
      // Logic for copying and notification is now unified in the Rust backend
      // for both UI clicks, global shortcuts, and triple-tap.
      await invoke("process_screenshot_ocr");
    } catch (err) {
      console.error(err);
      // Backend already shows a notification, but we can log it here
    }
  };

  const showToast = (message: string) => {
    setToast({ message, visible: true });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 4000);
  };

  const sanitizePhone = (phone: string, code: string) => {
    // Remove all non-numeric characters except +
    const cleaned = phone.replace(/[^\d+]/g, "");

    // If it starts with +, return as is
    if (cleaned.startsWith("+")) return cleaned;

    // If it has 10 digits and no +, prepend chosen code
    if (cleaned.length === 10) return code + cleaned;

    // If it's already has the prefix but no +
    if (cleaned.startsWith(code.replace("+", "")) && cleaned.length > 10) {
      return "+" + cleaned;
    }

    return cleaned;
  };

  const handleScheduleWa = async () => {
    try {
      if (!waPhone || !waMsg || !waDateTime) {
        alert("Please fill in all fields.");
        return;
      }

      const finalPhone = sanitizePhone(waPhone, countryCode);
      if (!finalPhone.startsWith("+")) {
        alert("Please ensure the number has a country code (e.g., +52)");
        return;
      }

      const now = new Date();
      const target = waDateTime;

      const delayMs = target.getTime() - now.getTime();
      if (delayMs < 0) {
        alert("The selected date and time has already passed. Please choose a future time.");
        return;
      }

      const delaySecs = Math.floor(delayMs / 1000);

      await invoke("schedule_whatsapp", {
        phone: finalPhone,
        message: waMsg,
        delaySecs: delaySecs
      }).then(() => {
        showToast(`Message scheduled for ${waDateTime.toLocaleString()} 🚀`);
        setWaPhone("");
        setWaMsg("");
        setWaDateTime(new Date());
        setActiveTab("Main");
      }).catch(err => {
        console.error(err);
        showToast("Error scheduling: " + err);
      });
    } catch (err) {
      console.error(err);
      showToast("Error scheduling message: " + err);
    }
  };

  return (
    <div className={`app-wrapper ${isPetMode ? 'pet-mode-active' : ''} ${!isSidebarOpen ? 'sidebar-closed' : ''}`}>
      {isPetMode && !isSidebarOpen && (
        <button
          className="floating-restore-btn"
          onClick={() => {
            console.log("Restore button clicked");
            togglePetMode();
          }}
          title="Desactivar Gato y Abrir App"
          style={{ zIndex: 10000, pointerEvents: 'auto' }}
        >
          <img src="/icon/TaskGoblin.png" alt="TaskGoblin" style={{ width: '28px', height: '28px', borderRadius: '6px' }} />
        </button>
      )}

      <div className="sidebar-content">
        <div className="sidebar-header" data-tauri-drag-region>
          <div
            className="logo-section"
            onClick={() => setActiveTab("Main")}
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}
            data-tauri-drag-region
          >
            <img src="/icon/TaskGoblin.png" alt="TaskGoblin" className="app-logo" data-tauri-drag-region />
            <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)' }} data-tauri-drag-region>TaskGoblin</h1>
            <span style={{ fontSize: '10px', color: 'var(--text-secondary)', marginBottom: '-9px', marginLeft: '-4px' }} data-tauri-drag-region>Mascota Gato 2.0</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="theme-toggle-btn"
              onClick={() => {
                setIsSidebarOpen(false);
                setTimeout(async () => {
                  try {
                    await invoke('hide_window');
                  } catch (e) {
                    console.error("Failed to hide window", e);
                  }
                }, 600); // Wait for the new 0.6s CSS animation to play
              }}
              title="Close Sidebar"
            >
              <span style={{ fontSize: '18px' }}>×</span>
            </button>
            <button className="theme-toggle-btn" onClick={() => setIsDarkMode(!isDarkMode)}>
              {isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
            </button>
          </div>
        </div>

        <div style={{ padding: '0 16px', marginTop: '4px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '10px 14px', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input type="text" placeholder="Search" style={{ border: 'none', background: 'transparent', padding: 0, margin: 0, outline: 'none', width: '100%', fontSize: '14px', color: 'var(--text-primary)', boxShadow: 'none' }} readOnly className="no-focus-input" />
          </div>
        </div>

        <div className="content-area">
          {activeTab === "Pet" && (
            <div className="wa-form-container">
              <div className="wa-back-btn" onClick={() => setActiveTab("Main")}>
                <span style={{ fontSize: '16px', marginRight: '6px' }}>←</span> Volver
              </div>
              <h2 style={{ fontSize: '18px', marginBottom: '8px' }}>Puppy Mode 🐶</h2>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                Activate a gluttonous puppy that travels the screen eating fragments.
              </p>

              <button
                className={`wa-submit-btn ${isPetMode ? 'active' : ''}`}
                onClick={togglePetMode}
                style={{ padding: '12px', background: isPetMode ? '#8c7ae6' : 'rgba(255,255,255,0.05)' }}
              >
                {isPetMode ? "🛑 Deactivate Puppy" : "🚀 Activate Puppy"}
              </button>
            </div>
          )}

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

              <div className={`list-item ${isPetMode ? 'active' : ''}`} onClick={togglePetMode}>
                <div className="icon"><PetIcon /></div>
                <span>Mascota (Gato Realista)</span>
                <div className={`toggle-switch ${isPetMode ? 'active' : ''}`}>
                  <div className="toggle-knob" />
                </div>
              </div>

              <div className="list-item" onClick={() => setActiveTab("WhatsApp")}>
                <div className="icon"><MsgIcon /></div>
                <span>WhatsApp Msg</span>
              </div>


              <div className="list-item" onClick={handleExtractText} title="Shortcut: Control+Alt+2">
                <div className="icon">
                  <div className="icon"><ScreenshotIcon /></div>
                </div>
                <span>Screenshot to Text</span>
              </div>

              <div className="list-item" onClick={handleCloseApps}>
                <div className="icon"><CloseIcon /></div>
                <span>Close All Apps</span>
              </div>


              {/* Added a filler visual structure just to make it look like the long mockup */}
              <div className="section-label" style={{ marginTop: '20px' }}>OTHERS</div>



              <div className="list-item">
                <div className="icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                </div>
                <span>Notifications</span>
              </div>
              <div className="list-item" onClick={() => setActiveTab("Settings")}>
                <div className="icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                </div>
                <span>Settings</span>
              </div>
            </>
          )}

          {activeTab === "Settings" && (
            <div className="wa-form-container">
              <div className="wa-back-btn" onClick={() => setActiveTab("Main")}>
                <span style={{ fontSize: '16px', marginRight: '6px' }}>←</span> Volver
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                App configuration and behavior.
              </p>

              <div className={`list-item ${isAutostartEnabled ? "active" : ""}`} onClick={handleToggleAutostart}>
                <div className="icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
                </div>
                <span>Start on Login</span>
                <div className={`toggle-switch ${isAutostartEnabled ? "active" : ""}`}>
                  <div className="toggle-knob"></div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "WhatsApp" && (
            <div className="wa-form-container">
              <div className="wa-back-btn" onClick={() => setActiveTab("Main")}>
                <span style={{ fontSize: '16px', marginRight: '6px' }}>←</span> Volver
              </div>

              <ContactPicker
                contacts={contacts}
                onSelect={(c) => {
                  const cleaned = c.phone.replace(/[^\d+]/g, "");
                  setWaPhone(cleaned);
                }}
                currentPhone={waPhone}
                onRefresh={async () => {
                  setIsLoadingContacts(true);
                  setContactError(null);
                  try {
                    const data = await invoke("get_contacts");
                    setContacts(data as Contact[]);
                  } catch (err) {
                    console.error(err);
                    setContactError(err as string);
                  } finally {
                    setIsLoadingContacts(false);
                  }
                }}
              />
              {isLoadingContacts && (
                <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px', color: 'var(--accent-color)' }}>
                  ⌛ Fetching your contacts...
                </div>
              )}

              <label className="wa-form-label" style={{ marginTop: '18px' }}>Contact / Phone Number</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="country-select"
                >
                  <option value="+52">🇲🇽 +52</option>
                  <option value="+1">🇺🇸 +1</option>
                  <option value="+34">🇪🇸 +34</option>
                  <option value="+54">🇦🇷 +54</option>
                  <option value="+57">🇨🇴 +57</option>
                  <option value="+56">🇨🇱 +56</option>
                  <option value="+51">🇵🇪 +51</option>
                  <option value="+44">🇬🇧 +44</option>
                </select>
                <input
                  type="text"
                  value={waPhone}
                  onChange={e => setWaPhone(e.target.value)}
                  placeholder="443 123 4567"
                  style={{ flex: 1 }}
                />
              </div>





              {contactError && (
                <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px', color: '#ff5555' }}>
                  ❌ Error: {contactError}
                </div>
              )}

              <label className="wa-form-label" style={{ marginTop: '8px' }}>Message</label>
              <textarea
                value={waMsg}
                onChange={e => setWaMsg(e.target.value)}
                placeholder="Type your message here..."
                style={{ minHeight: '80px', resize: 'vertical' }}
              />


              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                  <label className="wa-form-label">Date</label>
                  <DatePicker
                    selected={waDateTime}
                    onChange={(date: Date | null) => setWaDateTime(date)}
                    dateFormat="MM/dd/yyyy"
                    className="custom-datepicker"
                    minDate={new Date()}
                    maxDate={new Date(new Date().getFullYear(), 11, 31)}
                    placeholderText="Select Date"
                    portalId="root"
                  />
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                  <label className="wa-form-label">Time</label>
                  <DatePicker
                    selected={waDateTime}
                    onChange={(date: Date | null) => setWaDateTime(date)}
                    showTimeSelect
                    showTimeSelectOnly
                    timeIntervals={15}
                    timeCaption="Time"
                    dateFormat="h:mm aa"
                    className="custom-datepicker"
                    placeholderText="Select Time"
                    portalId="root"
                  />
                </div>
              </div>

              <button className="wa-submit-btn" onClick={handleScheduleWa} style={{ marginTop: '16px' }}>
                Schedule
              </button>
            </div>
          )}
        </div>
      </div> {/* End of sidebar-content */}

      {toast.visible && (
        <div className={`toast-notification ${toast.visible ? 'visible' : ''}`}>
          <span style={{ marginRight: '8px' }}>✨</span>
          {toast.message}
        </div>
      )}

      {isPetMode && <PetAgent isSidebarVisible={isSidebarOpen} />}
    </div>
  );
}

export default App;
