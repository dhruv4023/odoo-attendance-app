import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { Sun, CheckCircle2, ArrowRight } from 'lucide-react';

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

  const handleContinue = useCallback(async () => {
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
        handleContinue();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleCheckIn();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleCheckIn, handleContinue]);

  if (!isOpen) return null;

  return (
    <div className="flex-1 flex items-center justify-center p-4 z-20">
      <div className="w-full max-w-sm rounded-2xl bg-slate-900/90 border border-slate-700/80 p-5 shadow-2xl flex flex-col items-center text-center animate-slide-up">
        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-3 shadow-inner">
          <Sun className="w-6 h-6 animate-pulse-subtle" />
        </div>

        <h2 className="text-lg font-bold tracking-tight text-white mb-1.5">
          Check In Reminder
        </h2>
        <p className="text-xs text-slate-400 leading-relaxed mb-5">
          No attendance log was recorded recently. Would you like to check in now?
        </p>

        <div className="flex gap-3 w-full">
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl font-semibold text-xs bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white shadow-lg shadow-emerald-950/40 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {loading ? 'Checking in…' : 'Check In'}
          </button>
          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl font-semibold text-xs bg-slate-800 hover:bg-slate-700 active:scale-95 disabled:opacity-50 text-slate-200 border border-slate-700 transition-all cursor-pointer"
          >
            <span>Skip</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
