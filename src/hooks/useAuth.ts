import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Session, User } from '@supabase/supabase-js';

interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: 'command' | 'field' | null;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    session: null,
    user: null,
    loading: true,
    role: null,
  });
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchRole = useCallback(async (userId: string): Promise<'command' | 'field' | null> => {
    try {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId);
      if (data && data.length > 0) {
        const roles = data.map((r: any) => r.role);
        if (roles.includes('command')) return 'command';
        if (roles.includes('field')) return 'field';
      }
      return 'field'; // default role
    } catch {
      return 'field';
    }
  }, []);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const role = session?.user ? await fetchRole(session.user.id) : null;
        setAuthState({
          session,
          user: session?.user ?? null,
          loading: false,
          role,
        });
      }
    );

    // THEN check existing session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const role = session?.user ? await fetchRole(session.user.id) : null;
      setAuthState({
        session,
        user: session?.user ?? null,
        loading: false,
        role,
      });
    });

    // Session refresh every 30 minutes
    refreshInterval.current = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await supabase.auth.refreshSession();
      }
    }, 30 * 60 * 1000);

    return () => {
      subscription.unsubscribe();
      if (refreshInterval.current) clearInterval(refreshInterval.current);
    };
  }, [fetchRole]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    localStorage.removeItem('herald_session');
    await supabase.auth.signOut();
  }, []);

  return {
    ...authState,
    signIn,
    signOut,
  };
}
