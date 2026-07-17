import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { ApiError, setOnAuthExpired } from '../api/client';

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

    const login = useCallback(async (username, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: String(username).trim(),
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
        return enriched;
    }, []);

    const logout = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
    }, []);

    const isAdmin = user?.role === 'admin';

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, isAdmin }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
