import type { MeDto } from '@derepart/shared';
import { MapPin } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Banner, Button, Field, Input } from '../components/ui';
import { api, ApiError, errorMessage } from '../lib/api';
import { cacheMe } from '../lib/offline';
import { keys, queryClient } from '../lib/queries';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const me = await api<MeDto>(mode === 'login' ? '/auth/login' : '/auth/register', {
        method: 'POST',
        body: mode === 'login' ? { email, password } : { name, email, password },
      });
      await cacheMe(me);
      queryClient.setQueryData(keys.me, me);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.details?.fields) setFields(err.details.fields as Record<string, string>);
    } finally {
      setBusy(false);
    }
  }

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
        {error && <Banner tone="error">{error}</Banner>}
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          {mode === 'login' ? 'Entrar' : 'Criar conta'}
        </Button>
      </form>
      <p className="text-center text-sm">
        {mode === 'login' ? (
          <>
            Não tem conta?{' '}
            <Link className="text-brand-700 font-semibold" to="/criar-conta">
              Criar conta
            </Link>
          </>
        ) : (
          <>
            Já tem conta?{' '}
            <Link className="text-brand-700 font-semibold" to="/entrar">
              Entrar
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
