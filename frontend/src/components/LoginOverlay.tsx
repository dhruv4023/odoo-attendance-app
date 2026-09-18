import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/odoo-attendance-app/appservice.js';
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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-[#141018]/95 backdrop-blur-xl select-none">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/3 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-[#6b3e66]/25 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/3 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-[#7b4775]/20 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-lg rounded-3xl bg-[#251f2e]/95 border border-[#3d3248] p-8 shadow-2xl flex flex-col items-center text-center animate-slide-up">
        {/* Top Icon Badge */}
        <div className="w-16 h-16 rounded-2xl bg-[#6b3e66]/30 border border-[#6b3e66]/50 flex items-center justify-center text-white mb-5 shadow-lg shadow-[rgba(129,91,125,0.3)]">
          <Sun className="w-8 h-8 text-white animate-pulse-subtle" />
        </div>

        {/* Live Clock & Date */}
        <div className="mb-2">
          <div className="text-3xl font-extrabold tracking-tight text-white font-mono">
            {currentTime || '--:--:--'}
          </div>
          <div className="text-xs font-medium text-[#d8b4d1] tracking-wide uppercase mt-1">
            {currentDate}
          </div>
        </div>

        {/* Headline */}
        <h1 className="text-2xl font-bold text-[#f8f7f9] mt-4 mb-2">
          Welcome! Time to Check In
        </h1>
        <p className="text-sm text-[#a69eb0] max-w-sm leading-relaxed mb-8">
          Start your work session by recording your attendance. Clicking Check In will open your Odoo attendance dashboard.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 w-full">
          <button
            type="button"
            onClick={handleCheckIn}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl font-bold text-sm bg-[#6b3e66] hover:bg-[#7b4775] active:bg-[#8b5185] active:scale-98 disabled:opacity-50 text-white shadow-xl shadow-[rgba(129,91,125,0.4)] transition-all cursor-pointer border border-[#6b3e66] hover:border-[#7b4775] active:border-[#8b5185]"
          >
            <CheckCircle2 className="w-5 h-5 shrink-0 text-white" />
            <span>{loading ? 'Checking in…' : 'Check In to Odoo'}</span>
            <ExternalLink className="w-4 h-4 opacity-80 ml-0.5" />
          </button>

          <button
            type="button"
            onClick={handleContinue}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 py-3.5 px-5 rounded-2xl font-semibold text-sm bg-[#342b3e] hover:bg-[#3f344c] active:scale-98 disabled:opacity-50 text-[#f8f7f9] border border-[#4a3c57] transition-all cursor-pointer"
          >
            <span>Continue to Desktop</span>
            <ArrowRight className="w-4 h-4 shrink-0 text-[#cfc9d6]" />
          </button>
        </div>

        {/* Bottom Security Note */}
        <div className="flex items-center gap-1.5 text-[11px] text-[#7e748c] mt-6">
          <ShieldCheck className="w-3.5 h-3.5 text-[#8b5185]" />
          <span>Attendance check-out will be requested automatically on logout / shutdown</span>
        </div>
      </div>
    </div>
  );
};
