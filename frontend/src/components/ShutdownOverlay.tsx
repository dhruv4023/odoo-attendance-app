import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { AlertTriangle, LogOut, ArrowRight, X, ShieldAlert, ExternalLink } from 'lucide-react';

interface ShutdownOverlayProps {
  isOpen: boolean;
  action: string;
  onClose: () => void;
}

export const ShutdownOverlay: React.FC<ShutdownOverlayProps> = ({ isOpen, action, onClose }) => {
  const [loading, setLoading] = useState(false);

  // Closing with 'X' or 'Escape' cancels the logout/shutdown (stays logged in / machine stays alive)
  const handleCancel = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await AppService.ShutdownCancel();
    } catch (e) {
      console.error('ShutdownCancel error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [loading, onClose]);

  // If Skip button is selected, proceed with system logout/poweroff flow
  const handleSkip = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await AppService.ShutdownSkip();
    } catch (e) {
      console.error('ShutdownSkip error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [loading, onClose]);

  const handleCheckOut = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await AppService.ShutdownCheckOut();
    } catch (e) {
      console.error('ShutdownCheckOut error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [loading, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleCheckOut();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel, handleCheckOut]);

  if (!isOpen) return null;

  const actionLabel = action === 'logout' ? 'logging out' : action === 'reboot' ? 'restarting' : 'powering off';

  return (
    <div className="relative w-screen h-screen bg-[#0f172a] text-slate-100 flex flex-col justify-between select-none overflow-hidden font-sans">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-[36rem] h-[36rem] bg-rose-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[36rem] h-[36rem] bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Bar */}
      <header className="w-full px-8 py-6 flex items-center justify-between z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-sm">
            <LogOut className="w-5 h-5 text-rose-400" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">
            TimeCheck
          </span>
        </div>

        {/* Close / Stay Logged In Button */}
        <button
          type="button"
          onClick={handleCancel}
          disabled={loading}
          aria-label="Cancel and stay logged in"
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer border border-slate-800 hover:border-slate-700"
          title="Cancel and stay logged in"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Center Dialog Card */}
      <main className="flex-1 flex items-center justify-center p-6 z-10">
        <div className="relative w-full max-w-md rounded-3xl bg-slate-900 border border-rose-500/40 p-8 shadow-2xl flex flex-col items-center text-center">
          {/* Warning Icon Badge */}
          <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-inner">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold tracking-tight text-white mb-2">
            Did you check out in Odoo?
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed mb-6 max-w-sm">
            You are {actionLabel}. No recent check-out was recorded.
          </p>

          <div className="flex flex-col gap-3 w-full">
            {/* Primary Action: Check Out */}
            <button
              type="button"
              onClick={handleCheckOut}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 active:scale-98 disabled:opacity-50 text-white shadow-xl shadow-rose-950/60 transition-all cursor-pointer border border-rose-400/30"
            >
              <LogOut className="w-4 h-4 shrink-0 text-rose-200" />
              <span>{loading ? 'Opening Odoo…' : 'Check Out in Odoo'}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-70 ml-0.5" />
            </button>

            {/* Secondary Actions Row */}
            <div className="flex gap-2.5 w-full">
              <button
                type="button"
                onClick={handleCancel}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-98 disabled:opacity-50 text-slate-200 border border-slate-700 transition-all cursor-pointer"
              >
                <span>Stay Logged In</span>
              </button>

              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="inline-flex items-center justify-center gap-1 py-2.5 px-4 rounded-xl font-medium text-xs bg-slate-900 hover:bg-slate-800 active:scale-98 disabled:opacity-50 text-slate-400 hover:text-slate-300 border border-slate-800 transition-all cursor-pointer"
              >
                <span>Skip & Log Out</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Footer */}
      <footer className="w-full px-8 py-4 flex items-center justify-between text-[11px] text-slate-600 font-mono z-10">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
          <span>Session protection active · Logout & power-off are monitored</span>
        </div>
        <span>Escape to stay logged in</span>
      </footer>
    </div>
  );
};
