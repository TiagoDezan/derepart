import { createClient, type AuthError, type SupabaseClient } from '@supabase/supabase-js';
import { messageFor } from '@derepart/shared';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Supabase Auth client (null when the app uses the API's own e-mail/password login).
 * The publishable key is public by design: it only allows what Auth and RLS permit.
 */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;

/** Current access token, refreshed by supabase-js when it is about to expire. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: messageFor('INVALID_CREDENTIALS'),
  email_not_confirmed: 'Confirme seu e-mail pelo link que enviamos antes de entrar.',
  user_already_exists: messageFor('EMAIL_TAKEN'),
  email_exists: messageFor('EMAIL_TAKEN'),
  weak_password: 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.',
  over_email_send_rate_limit: 'Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos.',
  over_request_rate_limit: messageFor('RATE_LIMITED'),
  same_password: 'A nova senha precisa ser diferente da atual.',
  signup_disabled: 'Novos cadastros estão desativados.',
  validation_failed: 'Verifique o e-mail informado.',
};

/** Supabase Auth errors → friendly Portuguese messages (never the technical text). */
export function authErrorMessage(err: AuthError | Error | null | undefined): string {
  if (!err) return messageFor('INTERNAL');
  const code = (err as AuthError).code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  if ((err as AuthError).status === 0 || /fetch|network/i.test(err.message)) return messageFor('OFFLINE');
  return messageFor('INTERNAL');
}
