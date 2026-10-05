import type { MeDto } from '@derepart/shared';
import { MapPin } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Banner, Button, Field, Input } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { cacheMe } from '../lib/offline';
import { keys, queryClient } from '../lib/queries';
import { authErrorMessage, supabase } from '../lib/supabase';

type Mode = 'login' | 'register' | 'forgot';

export function AuthPage({ mode: initialMode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => setMode(initialMode), [initialMode]);

  // Returning from the e-mail confirmation link: supabase-js already created the session.
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) void enterApp();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Loads the profile (the API creates it on the first access) and opens the app. */
  async function enterApp() {
    const me = await api<MeDto>('/me');
    await cacheMe(me);
    queryClient.setQueryData(keys.me, me);
    navigate('/', { replace: true });
  }

  async function submitSupabase() {
    const auth = supabase!.auth;
    if (mode === 'forgot') {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/redefinir-senha` });
      if (error) throw error;
      setInfo('Se existir uma conta com este e-mail, enviamos um link para criar uma nova senha.');
      return;
    }
    if (mode === 'register') {
      const { data, error } = await auth.signUp({
        email,
        password,
        options: { data: { name }, emailRedirectTo: `${location.origin}/entrar` },
      });
      if (error) throw error;
      // Supabase hides existing e-mails: an existing account comes back without identities.
      if (data.user && data.user.identities?.length === 0) throw Object.assign(new Error('exists'), { code: 'user_already_exists' });
      if (!data.session) {
        setInfo(`Enviamos um link de confirmação para ${email}. Abra-o e depois entre com sua senha.`);
        setMode('login');
        return;
      }
      await enterApp();
      return;
    }
    const { error } = await auth.signInWithPassword({ email, password });
    if (error) throw error;
    await enterApp();
  }

  async function submitLocal() {
    const me = await api<MeDto>(mode === 'login' ? '/auth/login' : '/auth/register', {
      method: 'POST',
      body: mode === 'login' ? { email, password } : { name, email, password },
    });
    await cacheMe(me);
    queryClient.setQueryData(keys.me, me);
    navigate('/', { replace: true });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    setFields({});
    try {
      if (supabase) await submitSupabase();
      else await submitLocal();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(errorMessage(err));
        if (err.details?.fields) setFields(err.details.fields as Record<string, string>);
      } else {
        setError(authErrorMessage(err as Error));
      }
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Recuperar senha';

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-brand-700 grid size-16 place-items-center rounded-2xl text-white">
          <MapPin className="size-9" />
        </div>
        <h1 className="text-2xl font-bold">Derepart</h1>
        <p className="text-muted text-sm">Escaneie as etiquetas, otimize a rota e entregue mais rápido.</p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        {mode === 'register' && (
          <Field label="Nome" error={fields.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Field>
        )}
        <Field label="E-mail" error={fields.email}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        {mode !== 'forgot' && (
          <Field label="Senha" error={fields.password} hint={mode === 'register' ? 'Mínimo de 8 caracteres' : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />
          </Field>
        )}
        {info && <Banner tone="success">{info}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {mode === 'forgot' ? 'Enviar link' : title}
        </Button>
        {supabase && mode === 'login' && (
          <button type="button" onClick={() => setMode('forgot')} className="text-muted w-full text-center text-sm underline">
            Esqueci minha senha
          </button>
        )}
      </form>
      <p className="text-center text-sm">
        {mode === 'register' ? (
          <>
            Já tem conta?{' '}
            <Link className="text-brand-700 font-semibold" to="/entrar" onClick={() => setMode('login')}>
              Entrar
            </Link>
          </>
        ) : mode === 'forgot' ? (
          <button type="button" className="text-brand-700 font-semibold" onClick={() => setMode('login')}>
            Voltar para entrar
          </button>
        ) : (
          <>
            Não tem conta?{' '}
            <Link className="text-brand-700 font-semibold" to="/criar-conta">
              Criar conta
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

/** Opened from the "reset password" e-mail (Supabase Auth): sets a new password. */
export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase!.auth.updateUser({ password });
    setBusy(false);
    if (error) setError(authErrorMessage(error));
    else navigate('/', { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-bold">Nova senha</h1>
      {!supabase || !ready ? (
        <Banner tone="warn">Abra esta página pelo link enviado ao seu e-mail. Se o link expirou, peça outro em “Esqueci minha senha”.</Banner>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <Field label="Nova senha" hint="Mínimo de 8 caracteres">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
          </Field>
          {error && <Banner tone="error">{error}</Banner>}
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Salvar nova senha
          </Button>
        </form>
      )}
      <Link to="/entrar" className="text-brand-700 text-center text-sm font-semibold">
        Voltar para entrar
      </Link>
    </div>
  );
}
