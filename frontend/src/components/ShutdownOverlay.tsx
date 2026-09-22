import React, { useState, useEffect, useCallback } from 'react';
import * as AppService from '../../bindings/odoo-attendance-app/appservice.js';
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
    <div className="relative w-screen h-screen bg-[#1c1722] text-[#f8f7f9] flex flex-col justify-between select-none overflow-hidden font-sans">
      {/* Dynamic Ambient Background Glows */}
      <div className="absolute top-1/4 left-1/4 w-[36rem] h-[36rem] bg-[#6b3e66]/25 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[36rem] h-[36rem] bg-[#7b4775]/20 rounded-full blur-[120px] pointer-events-none" />

      {/* Top Bar */}
      <header className="w-full px-8 py-6 flex items-center justify-between z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-[#6b3e66]/30 border border-[#6b3e66]/50 flex items-center justify-center text-white shadow-sm">
            <LogOut className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">
            Odoo Attendance App
          </span>
        </div>

        {/* Close / Stay Logged In Button */}
        <button
          type="button"
          onClick={handleCancel}
          disabled={loading}
          aria-label="Cancel and stay logged in"
          className="p-2 rounded-xl text-[#a69eb0] hover:text-white hover:bg-[#342b3e] transition-colors cursor-pointer border border-[#3d3248] hover:border-[#524361]"
          title="Cancel and stay logged in"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Center Dialog Card */}
      <main className="flex-1 flex items-center justify-center p-6 z-10">
        <div className="relative w-full max-w-md rounded-3xl bg-[#251f2e] border border-[#6b3e66]/50 p-8 shadow-2xl flex flex-col items-center text-center">
          {/* Warning Icon Badge */}
          <div className="w-14 h-14 rounded-2xl bg-[#6b3e66]/30 border border-[#6b3e66]/50 flex items-center justify-center text-white mb-4 shadow-inner">
            <AlertTriangle className="w-7 h-7" />
          </div>

          <h2 className="text-xl font-bold tracking-tight text-white mb-2">
            Did you check out in Odoo?
          </h2>
          <p className="text-xs text-[#cfc9d6] leading-relaxed mb-6 max-w-sm">
            You are {actionLabel}. No recent check-out was recorded.
          </p>

          <div className="flex flex-col gap-3 w-full">
            {/* Primary Action: Check Out */}
            <button
              type="button"
              onClick={handleCheckOut}
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 py-3.5 px-4 rounded-2xl font-bold text-sm bg-[#6b3e66] hover:bg-[#7b4775] active:bg-[#8b5185] active:scale-98 disabled:opacity-50 text-white shadow-xl shadow-[rgba(129,91,125,0.4)] transition-all cursor-pointer border border-[#6b3e66] hover:border-[#7b4775] active:border-[#8b5185]"
            >
              <LogOut className="w-4 h-4 shrink-0 text-white" />
              <span>{loading ? 'Opening Odoo…' : 'Check Out in Odoo'}</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80 ml-0.5" />
            </button>

            {/* Secondary Actions Row */}
            <div className="flex gap-2.5 w-full">
              <button
                type="button"
                onClick={handleCancel}
                disabled={loading}
                className="flex-1 inline-flex items-center justify-center py-2.5 px-3 rounded-xl font-semibold text-xs bg-[#342b3e] hover:bg-[#3f344c] active:scale-98 disabled:opacity-50 text-[#f8f7f9] border border-[#4a3c57] transition-all cursor-pointer"
              >
                <span>Stay Logged In</span>
              </button>

              <button
                type="button"
                onClick={handleSkip}
                disabled={loading}
                className="inline-flex items-center justify-center gap-1 py-2.5 px-4 rounded-xl font-medium text-xs bg-[#1c1722] hover:bg-[#2e2638] active:scale-98 disabled:opacity-50 text-[#cfc9d6] hover:text-white border border-[#3d3248] transition-all cursor-pointer"
              >
                <span>Skip & Log Out</span>
                <ArrowRight className="w-3 h-3 shrink-0" />
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Footer */}
      <footer className="w-full px-8 py-4 flex items-center justify-between text-[11px] text-[#7e748c] font-mono z-10">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-[#8b5185]" />
          <span>Session protection active · Logout & power-off are monitored</span>
        </div>
        <span>Escape to stay logged in</span>
      </footer>
    </div>
  );
};
