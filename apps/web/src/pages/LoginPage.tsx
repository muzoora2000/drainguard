import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Droplets, Eye, EyeOff, Radio, ShieldCheck, Waves } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, FormError } from '../components/ui';

export function LoginPage() {
  const { isAuthenticated, login, signingIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== '/login' ? from : '/'} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await login(email.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.status === 401
            ? 'The email or password is incorrect.'
            : failure.message
          : 'Sign-in could not be completed.',
      );
    }
  };

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.08fr_0.92fr]">
      <section className="relative hidden overflow-hidden bg-ink px-10 py-12 text-white lg:flex lg:flex-col xl:px-16">
        <div className="absolute -right-28 -top-24 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="absolute -bottom-32 left-12 h-80 w-80 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-500 shadow-lg shadow-brand-900/40">
            <Droplets className="h-6 w-6" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">DrainGuard</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Drainage operations</p>
          </div>
        </div>

        <div className="relative my-auto max-w-xl py-16">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-200">
            <Radio className="h-3.5 w-3.5" />
            Earlier detection. Targeted maintenance.
          </p>
          <h1 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">
            See drainage problems before they become service failures.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-400">
            Monitor litter build-up, rising water and level differences across the network. Turn verified
            signals into clear maintenance work for the right team.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              { icon: Waves, title: 'Live levels', text: 'Litter fill, upstream and downstream water' },
              { icon: ShieldCheck, title: 'Rule clarity', text: 'Possible blockages, not false certainty' },
              { icon: ArrowRight, title: 'Actionable work', text: 'Alerts linked to tasks and records' },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <item.icon className="h-5 w-5 text-brand-300" />
                <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-slate-600">
          DrainGuard supports earlier detection and more effective maintenance. It does not claim to prevent floods.
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 text-white">
              <Droplets className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold tracking-tight text-slate-900">DrainGuard</p>
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Drainage operations</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in to operations</h2>
          <p className="mt-2 text-sm text-slate-500">
            Use your DrainGuard account to view live drainage status and maintenance work.
          </p>

          <form className="mt-8 space-y-4" onSubmit={submit}>
            {error ? (
              <FormError>
                <span className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </span>
              </FormError>
            ) : null}

            <div>
              <label htmlFor="email" className="field-label">
                Email address
              </label>
              <input
                id="email"
                type="email"
                className="field-input"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@organisation.com"
                autoComplete="email"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="password" className="field-label">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  className="field-input pr-11"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-1 top-1 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" size="lg" className="w-full" loading={signingIn}>
              Sign in
              {!signingIn ? <ArrowRight className="h-4 w-4" /> : null}
            </Button>
          </form>

          <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-500">
            <p className="font-medium text-slate-700">Demo environment</p>
            <p className="mt-1">
              Use the seeded administrator, supervisor or technician account supplied with the deployment.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
