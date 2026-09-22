import React, { useState, useEffect, useCallback } from 'react';
import { Events } from '@wailsio/runtime';
import * as AppService from '../bindings/time-check/appservice.js';
import { DailyStatus } from './types.js';
import { MainView } from './views/MainView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { ShutdownOverlay } from './components/ShutdownOverlay.tsx';

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const windowType = urlParams.get('window') || (window.location.hash ? window.location.hash.replace('#', '') : 'main');

  const [view, setView] = useState<'main' | 'settings'>('main');
  const [status, setStatus] = useState<DailyStatus | null>(null);
  const [shutdownAction, setShutdownAction] = useState<string>('shutdown');

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
    if (windowType !== 'checkout') {
      fetchStatus();
    }

    // Wails v3 Event Listeners
    Events.On('status-changed', (ev: any) => {
      const data = ev?.data ?? ev;
      if (data) {
        setStatus(data);
      }
    });

    Events.On('open-settings', () => {
      setView('settings');
    });

    // Check-out / Shutdown Prompt Action Event Listeners
    Events.On('checkout-requested', (ev: any) => {
      const data = ev?.data ?? ev;
      const action = typeof data === 'object' && data?.action ? data.action : typeof data === 'string' ? data : 'shutdown';
      setShutdownAction(action);
    });

    Events.On('shutdown-requested', (ev: any) => {
      const data = ev?.data ?? ev;
      const action = typeof data === 'object' && data?.action ? data.action : typeof data === 'string' ? data : 'shutdown';
      setShutdownAction(action);
    });
  }, [fetchStatus, windowType]);

  // Window 2: Dedicated Check-Out / Logout Dialog Window
  if (windowType === 'checkout') {
    return (
      <ShutdownOverlay
        isOpen={true}
        action={shutdownAction}
        onClose={() => AppService.HideCheckOutWindow()}
      />
    );
  }

  // Window 1: Main Application Window
  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none overflow-hidden relative">
      {/* Background ambient lighting */}
      <div className="absolute -top-24 -left-24 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <main className="flex-1 overflow-hidden z-10">
        {view === 'main' ? (
          <MainView
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

