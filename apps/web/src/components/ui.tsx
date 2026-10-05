import clsx from 'clsx';
import { AlertTriangle, ChevronLeft, CloudOff, Info, Loader2, X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, useNavigate } from 'react-router';
import { useOnline, useOutboxCount } from '../lib/queries';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white active:bg-brand-800 disabled:bg-brand-700/50',
  success: 'bg-emerald-600 text-white active:bg-emerald-700 disabled:opacity-50',
  secondary: 'surface border border-app text-[color:var(--text)] active:surface-2 disabled:opacity-50',
  danger: 'bg-red-600 text-white active:bg-red-700 disabled:opacity-50',
  ghost: 'text-brand-700 dark:text-brand-500 active:bg-brand-50/50 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' | 'xl'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors select-none',
        size === 'sm' && 'h-9 px-3 text-sm',
        size === 'md' && 'h-11 px-4 text-[15px]',
        size === 'lg' && 'h-14 px-5 text-base',
        size === 'xl' && 'h-16 px-6 text-lg tracking-wide',
        VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={clsx('surface rounded-2xl border border-app p-4 shadow-sm', className)}>{children}</div>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-sm text-red-600">{error}</span> : hint ? <span className="text-muted mt-1 block text-xs">{hint}</span> : null}
    </label>
  );
}

const inputCls =
  'surface w-full rounded-xl border border-app px-3 h-12 text-base outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600/20';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputCls, props.className)} />;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between gap-4 py-2 text-left">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="text-muted block text-sm">{hint}</span>}
      </span>
      <span className={clsx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600')}>
        <span className={clsx('absolute top-0.5 size-6 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'info' || tone === 'success' ? Info : AlertTriangle;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm',
        tone === 'info' && 'bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
        tone === 'success' && 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
        tone === 'warn' && 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
        tone === 'error' && 'bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-200',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="text-muted flex items-center justify-center gap-2 py-10">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  );
}

export function Chip({ tone = 'gray', children }: { tone?: 'gray' | 'brand' | 'green' | 'red' | 'amber' | 'blue'; children: ReactNode }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
        tone === 'gray' && 'surface-2 text-muted',
        tone === 'brand' && 'bg-brand-100 text-brand-800 dark:bg-brand-800 dark:text-brand-100',
        tone === 'green' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200',
        tone === 'red' && 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
        tone === 'amber' && 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
        tone === 'blue' && 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200',
      )}
    >
      {children}
    </span>
  );
}

/** Bottom sheet / modal. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="surface safe-bottom max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl p-4 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="surface-2 rounded-full p-2">
            <X className="size-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConnectionBar() {
  const online = useOnline();
  const pending = useOutboxCount();
  if (online && pending === 0) return null;
  return (
    <div className={clsx('flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-medium', online ? 'bg-sky-600 text-white' : 'bg-gray-800 text-white')}>
      {!online && <CloudOff className="size-3.5" />}
      {!online ? 'Sem internet — a rota continua disponível.' : null}
      {pending > 0 && ` ${pending} registro(s) aguardando sincronização.`}
    </div>
  );
}

export function Page({
  title,
  back,
  actions,
  children,
  footer,
  bleed,
}: {
  title: string;
  back?: string | true;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  bleed?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <header className="safe-top surface sticky top-0 z-30 border-b border-app">
        <ConnectionBar />
        <div className="flex h-14 items-center gap-2 px-2">
          {back ? (
            typeof back === 'string' ? (
              <Link to={back} aria-label="Voltar" className="rounded-full p-2">
                <ChevronLeft className="size-6" />
              </Link>
            ) : (
              <button onClick={() => navigate(-1)} aria-label="Voltar" className="rounded-full p-2">
                <ChevronLeft className="size-6" />
              </button>
            )
          ) : (
            <span className="w-2" />
          )}
          <h1 className="flex-1 truncate text-lg font-bold">{title}</h1>
          {actions}
        </div>
      </header>
      <main className={clsx('flex-1', !bleed && 'space-y-4 p-4')}>{children}</main>
      {footer && <footer className="safe-bottom surface sticky bottom-0 z-30 border-t border-app px-4 pt-3">{footer}</footer>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-muted">{icon}</div>
      <p className="font-semibold">{title}</p>
      {children && <div className="text-muted max-w-sm text-sm">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="surface-2 rounded-xl p-3">
      <div className="text-muted text-xs">{label}</div>
      <div className="text-xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-muted text-xs">{sub}</div>}
    </div>
  );
}
