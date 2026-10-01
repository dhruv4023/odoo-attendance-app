import React, { useState, useEffect, useCallback } from 'react';
import { Events } from '@wailsio/runtime';
import * as AppService from '../bindings/odoo-attendance-app/appservice.js';
import { DailyStatus } from './types.js';
import { MainView } from './views/MainView.tsx';
import { ShutdownOverlay } from './components/ShutdownOverlay.tsx';

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const windowType = urlParams.get('window') || (window.location.hash ? window.location.hash.replace('#', '') : 'main');

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
    <div className="flex flex-col h-full bg-[#1c1722] text-[#f8f7f9] select-none overflow-hidden relative">


      {/* Main Container */}
      <main className="flex-1 overflow-hidden z-10">
        <MainView
          status={status}
          onRefresh={fetchStatus}
        />
      </main>
    </div>
  );
};

