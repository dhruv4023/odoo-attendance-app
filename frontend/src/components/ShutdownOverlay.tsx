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
    <div className="flex-1 flex items-center justify-center p-4 z-20 select-none">
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900/95 border border-slate-700/80 p-6 shadow-2xl flex flex-col items-center text-center animate-slide-up">
        {/* Close Button ('X' cancels logout, stays logged in) */}
        <button
          type="button"
          onClick={handleCancel}
          disabled={loading}
          aria-label="Cancel and stay logged in"
          className="absolute top-3.5 right-3.5 p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Warning Icon Badge */}
        <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4 shadow-inner">
          <AlertTriangle className="w-7 h-7 animate-pulse-subtle" />
        </div>

        <h2 className="text-xl font-bold tracking-tight text-white mb-2">
          Did you check out in Odoo?
        </h2>
        <p className="text-xs text-slate-300 leading-relaxed mb-6 max-w-sm">
          You are {actionLabel}. No recent check-out was recorded. Would you like to check out now before leaving?
        </p>

        <div className="flex flex-col gap-2.5 w-full">
          {/* Primary Action: Check Out */}
          <button
            type="button"
            onClick={handleCheckOut}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 active:scale-98 disabled:opacity-50 text-white shadow-lg shadow-rose-950/50 transition-all cursor-pointer border border-rose-400/20"
          >
            <LogOut className="w-4 h-4 shrink-0 text-rose-200" />
            <span>{loading ? 'Opening Odoo…' : 'Check Out in Odoo'}</span>
            <ExternalLink className="w-3.5 h-3.5 opacity-70 ml-0.5" />
          </button>

          {/* Secondary Actions Row */}
          <div className="flex gap-2 w-full">
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              className="flex-1 inline-flex items-center justify-center py-2.5 px-3 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 active:scale-98 disabled:opacity-50 text-slate-200 border border-slate-700 transition-all cursor-pointer"
            >
              <span>Stay Logged In</span>
            </button>

            <button
              type="button"
              onClick={handleSkip}
              disabled={loading}
              className="inline-flex items-center justify-center gap-1 py-2.5 px-3 rounded-xl font-medium text-xs bg-slate-900 hover:bg-slate-800 active:scale-98 disabled:opacity-50 text-slate-400 hover:text-slate-300 border border-slate-800 transition-all cursor-pointer"
            >
              <span>Skip & Log Out</span>
              <ArrowRight className="w-3 h-3 shrink-0" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-4">
          <ShieldAlert className="w-3 h-3 text-slate-500" />
          <span>If you check out but don't log out right away, you'll be prompted again if inactive.</span>
        </div>
      </div>
    </div>
  );
};
