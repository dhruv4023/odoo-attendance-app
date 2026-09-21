import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/time-check/appservice.js';
import { Sun, CheckCircle2, ArrowRight, ExternalLink, ShieldCheck } from 'lucide-react';

interface LoginOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginOverlay: React.FC<LoginOverlayProps> = ({ isOpen, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
      setCurrentDate(
        now.toLocaleDateString(undefined, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-slate-950/95 backdrop-blur-xl select-none">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-sky-500/15 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-lg rounded-3xl bg-slate-900/90 border border-slate-700/80 p-8 shadow-2xl flex flex-col items-center text-center animate-slide-up">
        {/* Top Icon Badge */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-5 shadow-lg shadow-emerald-950/50">
          <Sun className="w-8 h-8 animate-pulse-subtle" />
        </div>

        {/* Live Clock & Date */}
        <div className="mb-2">
          <div className="text-3xl font-extrabold tracking-tight text-white font-mono">
            {currentTime || '--:--:--'}
          </div>
          <div className="text-xs font-medium text-emerald-400/90 tracking-wide uppercase mt-1">
            {currentDate}
          </div>
        </div>

        {/* Headline */}
        <h1 className="text-2xl font-bold text-slate-100 mt-4 mb-2">
          Welcome! Time to Check In
        </h1>
        <p className="text-sm text-slate-400 max-w-sm leading-relaxed mb-8">
          Start your work session by recording your attendance. Clicking Check In will open your Odoo attendance dashboard.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-98 disabled:opacity-50 text-white shadow-xl shadow-emerald-950/60 transition-all cursor-pointer border border-emerald-400/20"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-200" />
            <span>{loading ? 'Checking in…' : 'Check In to Odoo'}</span>
            <ExternalLink className="w-4 h-4 opacity-70 ml-0.5" />
          </button>

          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl font-semibold text-sm bg-slate-800/90 hover:bg-slate-700/90 active:scale-98 disabled:opacity-50 text-slate-300 border border-slate-700 transition-all cursor-pointer"
          >
            <span>Continue to Desktop</span>
            <ArrowRight className="w-4 h-4 shrink-0 text-slate-400" />
          </button>
        </div>

        {/* Bottom Security Note */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-6">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
          <span>Attendance check-out will be requested automatically on logout / shutdown</span>
        </div>
      </div>
    </div>
  );
};
