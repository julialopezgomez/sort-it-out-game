import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client.
 *
 * The anon key is compiled into the public bundle, and that is fine — it is a public
 * client key by design. What protects the data is on the server side: anon has no direct
 * SELECT, INSERT, UPDATE or DELETE on any game table (see 0020_security.sql), and every
 * mutation goes through a SECURITY DEFINER RPC that checks room, identity, phase and role.
 *
 * A service-role key must never appear anywhere in this directory.
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

export const isSupabaseConfigured = url !== '' && anonKey !== '';

/** Shown on the diagnostic screen so the owner can jump straight to the dashboard. */
export const supabaseDashboardUrl = (() => {
  const explicit = import.meta.env.VITE_SUPABASE_DASHBOARD_URL?.trim();
  if (explicit) return explicit;
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)/i.exec(url);
  return match
    ? `https://supabase.com/dashboard/project/${match[1]}`
    : 'https://supabase.com/dashboard';
})();

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error('NOT_CONFIGURED');
  }
  client ??= createClient(url, anonKey, {
    auth: {
      // No accounts: nothing to persist, nothing to refresh, no session in storage.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
    global: {
      headers: { 'x-application-name': 'sort-it-out' },
    },
  });
  return client;
}

/** For tests. */
export function resetSupabaseClient(): void {
  client = null;
}
