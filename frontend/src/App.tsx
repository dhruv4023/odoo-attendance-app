import React, { useState, useEffect, useCallback } from 'react';
import { Events } from '@wailsio/runtime';
import * as AppService from '../bindings/time-check/appservice.js';
import { DailyStatus } from './types.js';
import { MainView } from './views/MainView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { LoginOverlay } from './components/LoginOverlay.tsx';
import { ShutdownOverlay } from './components/ShutdownOverlay.tsx';

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const windowType = urlParams.get('window') || window.location.hash.replace('#', '') || 'settings';

  const [view, setView] = useState<'main' | 'settings'>(windowType === 'settings' ? 'settings' : 'main');
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [shutdownAction, setShutdownAction] = useState('shutdown');

  const fetchStatus = useCallback(async () => {
    try {
      const st: DailyStatus = await AppService.GetTodayStatus();
      if (st) {
        setStatus(st);
      }
    } catch (e) {
      console.warn('GetTodayStatus error:', e);
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    // Wails v3 Event Listeners
    Events.On('status-changed', (ev: any) => {
      const data = ev?.data ?? ev;
      if (data) {
        setStatus(data);
      }
    });

    Events.On('schedule-changed', () => {
      fetchStatus();
    });

    // Check-out Action Event Listeners
    Events.On('checkout-requested', (ev: any) => {
      const data = ev?.data ?? ev;
      const action = typeof data === 'object' && data?.action ? data.action : 'shutdown';
      setShutdownAction(action);
    });

    Events.On('shutdown-requested', (ev: any) => {
      const data = ev?.data ?? ev;
      const action = typeof data === 'object' && data?.action ? data.action : 'shutdown';
      setShutdownAction(action);
    });
  }, [fetchStatus]);

  // Window 1: Dedicated Check-In Window
  if (windowType === 'checkin') {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none overflow-hidden relative">
        <div className="absolute -top-20 -left-20 w-60 h-60 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <LoginOverlay
          isOpen={true}
          onClose={() => AppService.HideCheckInWindow()}
        />
      </div>
    );
  }

  // Window 2: Dedicated Check-Out Window
  if (windowType === 'checkout') {
    return (
      <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none overflow-hidden relative">
        <div className="absolute -top-20 -left-20 w-60 h-60 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -right-20 w-60 h-60 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <ShutdownOverlay
          isOpen={true}
          action={shutdownAction}
          onClose={() => AppService.HideCheckOutWindow()}
        />
      </div>
    );
  }

  // Window 3: Settings & Dashboard Window
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none overflow-hidden relative">
      {/* Background ambient lighting */}
      <div className="absolute -top-24 -left-24 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <main className="flex-1 overflow-hidden z-10">
        {view === 'main' ? (
          <MainView
            onNavigateSettings={() => setView('settings')}
            status={status}
            onRefresh={fetchStatus}
          />
        ) : (
          <SettingsView onBack={() => setView('main')} />
        )}
      </main>
    </div>
  );
};
