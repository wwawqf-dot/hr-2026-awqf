import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { ApiError, setOnAuthExpired } from '../api/client';
import { api } from '../api/client';
import { downloadBackupFile } from '../utils/backupFile';

const AuthContext = createContext(null);

// Enrich a Supabase auth user with its app role/username from `profiles`.
async function loadProfile(authUser) {
    const { data } = await supabase
        .from('profiles')
        .select('username, role')
        .eq('id', authUser.id)
        .single();
    return {
        id: authUser.id,
        email: authUser.email,
        username: data?.username || authUser.email,
        role: data?.role || 'viewer',
    };
}

function mapAuthError(message) {
    if (/invalid login credentials/i.test(message)) return 'بيانات الدخول غير صحيحة';
    if (/email not confirmed/i.test(message)) return 'لم يتم تأكيد البريد الإلكتروني لهذا الحساب';
    if (/rate limit/i.test(message)) return 'محاولات كثيرة، يرجى الانتظار قليلاً ثم إعادة المحاولة';
    return message || 'تعذر تسجيل الدخول';
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;

        async function hydrate(session) {
            if (!active) return;
            if (session?.user) {
                const profile = await loadProfile(session.user);
                if (active) setUser(profile);
            } else if (active) {
                setUser(null);
            }
            if (active) setLoading(false);
        }

        supabase.auth.getSession().then(({ data }) => hydrate(data.session));

        // Defer work off the callback thread — supabase-js warns against
        // awaiting other supabase calls directly inside this handler.
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
            setTimeout(() => hydrate(session), 0);
        });

        return () => {
            active = false;
            sub.subscription.unsubscribe();
        };
    }, []);

    // Register the session-expiry callback so safeSupabase in client.js
    // can trigger a forced logout when the server returns 401 / JWT error.
    useEffect(() => {
        setOnAuthExpired(() => {
            supabase.auth.signOut().catch(() => {});
            setUser(null);
        });
    }, []);

    const login = useCallback(async (ident, password) => {
        // Resolve a name (or email) to the auth email first, so users can
        // sign in with their username only — the server generates internal
        // emails (wqf-...@internal.local) that are never shown.
        let email = String(ident).trim();
        if (!email) throw new ApiError('يرجى إدخال اسم المستخدم أو البريد الإلكتروني', 400);
        if (!email.includes('@')) {
            // A distinct "username not found" message let anyone probe which
            // accounts exist before ever trying a password. The RPC now
            // returns an unusable address for unknown names, so sign-in
            // fails with the same generic message either way.
            const resolved = await api.resolveLogin(email);
            email = resolved || `unknown-${encodeURIComponent(email)}@invalid.local`;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error) throw new ApiError(mapAuthError(error.message), 400);

        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('username, role')
            .eq('id', data.user.id)
            .single();

        if (profileErr || !profile) {
            await supabase.auth.signOut();
            throw new ApiError('لم يتم العثور على صلاحية للمستخدم', 403);
        }

        const enriched = {
            id: data.user.id,
            email: data.user.email,
            username: profile.username || data.user.email,
            role: profile.role,
        };
        setUser(enriched);
        setLoading(false);

        // Automatic backup on sign-in. Deliberately NOT awaited: the export
        // walks every employee, year row and deduction, and making the
        // admin stare at a spinner for it would turn a safety net into an
        // annoyance they ask to have removed.
        //
        // Guarded on the role because export_all() is admin-only server
        // side. Firing it for a متابع or a مُدخل بيانات would not produce a
        // file — it would produce a permission error on every single login.
        //
        // A failure here must never block the session: the user is already
        // signed in and the app is usable. It is reported to the console
        // rather than swallowed, because a backup nobody knows has stopped
        // running is the worst of both worlds.
        if (enriched.role === 'admin') {
            downloadBackupFile({ auto: true }).catch((err) => {
                console.error('[backup] تعذّر تصدير النسخة التلقائية عند الدخول:', err?.message || err);
            });
        }
        return enriched;
    }, []);

    const logout = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
    }, []);

    const isAdmin = user?.role === 'admin';
    const isSuperAdmin = user?.email === 'wqf-837dec4f6914@internal.local';

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, isAdmin, isSuperAdmin }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
