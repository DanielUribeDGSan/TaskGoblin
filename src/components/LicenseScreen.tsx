import React, { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

// Make sure these are properly configured in your .env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

interface LicenseScreenProps {
    onValidated: () => void;
    t: (key: string) => string;
}

const generateDeviceId = () => {
    let deviceId = localStorage.getItem("app-device-id");
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem("app-device-id", deviceId);
    }
    return deviceId;
};

export default function LicenseScreen({ onValidated, t }: LicenseScreenProps) {
    const [email, setEmail] = useState("");
    const [licenseKey, setLicenseKey] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [unbindPrompt, setUnbindPrompt] = useState<{ id: string } | null>(null);

    useEffect(() => {
        // Basic config check
        if (!supabaseUrl || !supabaseKey) {
            console.warn("Supabase configuration is missing!");
        }
    }, []);

    const handleValidate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const deviceId = generateDeviceId();

            // Query the license from Supabase
            const { data, error: fetchError } = await supabase
                .from("licenses")
                .select("*")
                .eq("email", email)
                .eq("license_key", licenseKey)
                .single();

            if (fetchError || !data) {
                throw new Error("License not found or invalid email.");
            }

            // Check device binding
            if (data.device_id && data.device_id !== deviceId) {
                // License is bound to another device
                setUnbindPrompt({ id: data.id });
                setLoading(false);
                return;
            }

            if (!data.device_id) {
                // Bind to current device
                const { error: updateError } = await supabase
                    .from("licenses")
                    .update({ device_id: deviceId })
                    .eq("id", data.id);

                if (updateError) {
                    throw new Error("Error binding license to this device.");
                }
            }

            // Validated successfully
            localStorage.setItem("app-license-valid", "true");
            onValidated();

        } catch (err: any) {
            console.error(err);
            setError(err.message || "An error occurred during validation.");
        } finally {
            setLoading(false);
        }
    };

    const handleUnbind = async () => {
        if (!unbindPrompt) return;
        setLoading(true);
        setError("");
        try {
            const deviceId = generateDeviceId();
            const { error: updateError } = await supabase
                .from("licenses")
                .update({ device_id: deviceId })
                .eq("id", unbindPrompt.id);

            if (updateError) {
                throw new Error("Error transferring license to this device.");
            }

            localStorage.setItem("app-license-valid", "true");
            onValidated();
        } catch (err: any) {
            setError(err.message || "Failed to unbind from previous device.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <div className="info-alert-card" style={{ marginBottom: '16px' }}>
                <div className="info-alert-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                </div>
                <div className="info-alert-content">
                    <h4>{t('license.form_title')}</h4>
                    <p>{t('license.form_desc')}</p>
                </div>
            </div>

            {error && (
                <div style={{ textAlign: 'center', padding: '10px', fontSize: '12px', color: '#ff5555', marginBottom: '16px', background: 'rgba(255,85,85,0.1)', borderRadius: '8px' }}>
                    {error}
                </div>
            )}

            {!unbindPrompt ? (
                <>
                    <label className="wa-form-label" style={{ marginTop: '8px' }}>{t('license.label_email')}</label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('license.placeholder_email')}
                        className="wa-input"
                        style={{ width: '100%' }}
                    />

                    <label className="wa-form-label" style={{ marginTop: '16px' }}>{t('license.label_key')}</label>
                    <input
                        type="text"
                        required
                        value={licenseKey}
                        onChange={(e) => setLicenseKey(e.target.value)}
                        placeholder={t('license.placeholder_key')}
                        className="wa-input"
                        style={{ width: '100%' }}
                    />

                    <button
                        className="wa-submit-btn"
                        onClick={handleValidate}
                        disabled={loading || !email || !licenseKey}
                        style={{ marginTop: '24px', opacity: (loading || !email || !licenseKey) ? 0.5 : 1 }}
                    >
                        {loading ? t('license.btn_validating') : t('license.btn_activate')}
                    </button>

                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                        <a href="https://task-goblin.com" target="_blank" rel="noreferrer" style={{ fontSize: '12px', color: 'var(--accent-color)', textDecoration: 'underline' }}>
                            {t('license.buy_link')}
                        </a>
                    </div>
                </>
            ) : (
                <div style={{ marginTop: '16px', textAlign: 'center' }}>
                    <p style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '20px' }}>
                        {t('license.in_use_msg')}
                    </p>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                            className="wa-submit-btn"
                            onClick={() => setUnbindPrompt(null)}
                            style={{ flex: 1, background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                        >
                            {t('common.cancel')}
                        </button>
                        <button
                            className="wa-submit-btn"
                            onClick={handleUnbind}
                            disabled={loading}
                            style={{ flex: 2, marginTop: '0px', opacity: loading ? 0.5 : 1 }}
                        >
                            {loading ? t('license.btn_transferring') : t('license.btn_transfer')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
