import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { Sun, CheckCircle2, ArrowRight, Clock, X } from 'lucide-react';

interface LoginOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginOverlay: React.FC<LoginOverlayProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);

  const handleCheckIn = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await AppService.LoginCheckIn();
    } catch (e) {
      console.error('LoginCheckIn error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [loading, onClose]);

  const handleSnooze = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await AppService.SnoozeCheckIn();
    } catch (e) {
      console.error('SnoozeCheckIn error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [loading, onClose]);

  const handleSkip = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      await AppService.LoginContinue();
    } catch (e) {
      console.error('LoginContinue error:', e);
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
        handleSkip();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleCheckIn();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCheckIn, handleSkip]);

  if (!isOpen) return null;

  return (
    <div className="flex-1 flex items-center justify-center p-4 z-20">
      <div className="relative w-full max-w-sm rounded-2xl bg-slate-900/90 border border-slate-700/80 p-5 shadow-2xl flex flex-col items-center text-center animate-slide-up">
        {/* Close Button ('X' skips) */}
        <button
          type="button"
          onClick={handleSkip}
          disabled={loading}
          aria-label="Close reminder"
          className="absolute top-3.5 right-3.5 p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
          <Sun className="w-6 h-6 animate-pulse-subtle" />
        </div>

        <h2 className="text-lg font-bold tracking-tight text-white mb-1.5">
          Check In Reminder
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-5">
          No attendance log was recorded recently. Would you like to check in now?
        </p>

        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>{loading ? 'Checking in…' : 'Check In'}</span>
          </button>
          <button
            type="button"
            onClick={handleSnooze}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl font-semibold text-xs bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 disabled:opacity-50 text-amber-300 border border-amber-500/30 transition-all cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Snooze</span>
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1 py-2 px-2.5 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-50 text-slate-300 border border-slate-700 transition-all cursor-pointer"
          >
            <span>Skip</span>
            <ArrowRight className="w-3 h-3 shrink-0" />
          </button>
        </div>
      </div>
    </div>
  );
};
