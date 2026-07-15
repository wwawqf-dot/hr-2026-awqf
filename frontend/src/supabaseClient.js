import { createClient } from '@supabase/supabase-js';

// The frontend uses ONLY the public "anon" JWT key (starts with `eyJ...`).
// It is safe to ship in a public bundle: Row Level Security + the
// SECURITY DEFINER RPCs in supabase/schema.sql are what actually protect
// the data. NEVER put the service_role key or an `sbp_` token here.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
    // Fail loudly in dev; in prod this surfaces as a clear console error
    // instead of a confusing "network" failure on every request.
    // eslint-disable-next-line no-console
    console.error(
        'إعدادات Supabase مفقودة: تأكد من ضبط VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY في ملف .env'
    );
}

export const supabase = createClient(url, anonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});
