import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { AlertTriangle, LogOut, ArrowRight, Clock, X } from 'lucide-react';

interface ShutdownOverlayProps {
  isOpen: boolean;
  action: string;
  onClose: () => void;
}

export const ShutdownOverlay: React.FC<ShutdownOverlayProps> = ({ isOpen, action, onClose }) => {
  const [loading, setLoading] = useState(false);

  // Closing with 'X' or 'Escape' cancels the logout/shutdown (stays logged in / machine stays alive)
  const handleCancel = useCallback(async () => {
    setLoading(true);
    try {
      await AppService.ShutdownCancel();
    } catch (e) {
      console.error('ShutdownCancel error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [onClose]);

  // Snooze reminder (aborts logout/shutdown so user can continue working, and schedules re-reminder)
  const handleSnooze = useCallback(async () => {
    setLoading(true);
    try {
      await AppService.SnoozeCheckOut();
    } catch (e) {
      console.error('SnoozeCheckOut error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [onClose]);

  // ONLY if Skip button is explicitly selected, continue to system logout/poweroff flow
  const handleSkip = useCallback(async () => {
    setLoading(true);
    try {
      await AppService.ShutdownSkip();
    } catch (e) {
      console.error('ShutdownSkip error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCancel]);

  if (!isOpen) return null;

  const isReminder = action === 'reminder';
  const actionLabel = action === 'logout' ? 'logging out' : action === 'reboot' ? 'restarting' : 'powering off';

  const handleCheckOut = async () => {
    setLoading(true);
    try {
      await AppService.ShutdownCheckOut();
    } catch (e) {
      console.error('ShutdownCheckOut error:', e);
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4 z-20">
      <div className="relative w-full max-w-sm rounded-2xl bg-slate-900/90 border border-slate-700/80 p-5 shadow-2xl flex flex-col items-center text-center animate-slide-up">
        {/* Close Button ('X' cancels dialog) */}
        <button
          type="button"
          onClick={handleCancel}
          disabled={loading}
          aria-label="Close reminder"
          className="absolute top-3.5 right-3.5 p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
          <AlertTriangle className="w-6 h-6 animate-pulse-subtle" />
        </div>

        <h2 className="text-lg font-bold tracking-tight text-white mb-1.5">
          Check Out Reminder
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-5">
          {isReminder
            ? "Your scheduled work shift has ended. Would you like to check out now?"
            : `No attendance log was recorded recently before ${actionLabel}. Would you like to check out now?`}
        </p>

        <div className="flex gap-2 w-full">
          <button
            type="button"
            onClick={handleCheckOut}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl font-semibold text-xs bg-rose-600 hover:bg-rose-500 active:scale-95 disabled:opacity-50 text-white shadow-lg shadow-rose-950/40 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span>{loading ? 'Checking out…' : 'Check Out'}</span>
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
