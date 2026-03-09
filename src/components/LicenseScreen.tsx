import React, { useState } from "react";
import { checkLicenseStatus, bindLicense } from "../utils/license";

const EyeIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

const EyeOffIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
        <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
        <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
        <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
);

interface LicenseScreenProps {
    onValidated: () => void;
    t: (key: string) => string;
}

export default function LicenseScreen({ onValidated, t }: LicenseScreenProps) {
    const [email, setEmail] = useState(() => localStorage.getItem("app-email") || "");
    const [licenseKey, setLicenseKey] = useState(() => localStorage.getItem("app-license-key") || "");
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [unbindPrompt, setUnbindPrompt] = useState<{ id: string } | null>(null);

    const handleValidate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        try {
            const result = await checkLicenseStatus(email, licenseKey);

            if (result.status === "invalid") {
                throw new Error(t('license.error_invalid') || "License not found or invalid email.");
            }

            if (result.status === "mismatch" && result.id) {
                setUnbindPrompt({ id: result.id });
                setLoading(false);
                return;
            }

            if (result.status === "error") {
                throw new Error("Validation error.");
            }

            if (result.id) {
                await bindLicense(result.id);
            }

            // Validated successfully
            localStorage.setItem("app-license-valid", "true");
            localStorage.setItem("app-last-license-check", new Date().toISOString());
            localStorage.setItem("app-email", email);
            localStorage.setItem("app-license-key", licenseKey);
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
            await bindLicense(unbindPrompt.id);

            localStorage.setItem("app-license-valid", "true");
            localStorage.setItem("app-last-license-check", new Date().toISOString());
            localStorage.setItem("app-email", email);
            localStorage.setItem("app-license-key", licenseKey);
            onValidated();
        } catch (err: any) {
            setError(err.message || "Failed to transfer license.");
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

            {unbindPrompt ? (
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
            ) : (
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
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showKey ? "text" : "password"}
                            required
                            value={licenseKey}
                            onChange={(e) => setLicenseKey(e.target.value)}
                            placeholder={t('license.placeholder_key')}
                            className="wa-input"
                            style={{ width: '100%', paddingRight: '40px' }}
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey(!showKey)}
                            title={showKey ? t('license.hide_key') : t('license.show_key')}
                            style={{
                                position: 'absolute',
                                right: '10px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-secondary)',
                                cursor: 'pointer',
                                padding: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            {showKey ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                    </div>

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
            )}
        </div>
    );
}
