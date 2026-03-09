import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const supabase = createClient(supabaseUrl, supabaseKey);

export const getDeviceId = () => {
    let deviceId = localStorage.getItem("app-device-id");
    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem("app-device-id", deviceId);
    }
    return deviceId;
};

export type LicenseStatus = "valid" | "invalid" | "mismatch" | "error";

export const checkLicenseStatus = async (email: string, licenseKey: string): Promise<{ status: LicenseStatus; id?: string; boundDeviceId?: string }> => {
    try {
        const deviceId = getDeviceId();
        const { data, error } = await supabase
            .from("licenses")
            .select("*")
            .eq("email", email)
            .eq("license_key", licenseKey)
            .single();

        if (error || !data) {
            return { status: "invalid" };
        }

        if (data.device_id && data.device_id !== deviceId) {
            return { status: "mismatch", id: data.id, boundDeviceId: data.device_id };
        }

        if (!data.device_id) {
            return { status: "valid", id: data.id }; // Needs binding
        }

        return { status: "valid", id: data.id };
    } catch (err) {
        console.error("License check error:", err);
        return { status: "error" };
    }
};

export const bindLicense = async (licenseId: string) => {
    const deviceId = getDeviceId();
    const { error } = await supabase
        .from("licenses")
        .update({ device_id: deviceId })
        .eq("id", licenseId);

    if (error) throw error;
};
