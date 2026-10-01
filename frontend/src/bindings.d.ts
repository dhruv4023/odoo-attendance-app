declare module '*/bindings/odoo-attendance-app/appservice.js' {
  export function CheckIn(): Promise<any>;
  export function CheckOut(): Promise<any>;
  export function ForceCheckOut(): Promise<any>;
  export function GetTodayStatus(): Promise<any>;
  export function GetOdooStatus(): Promise<any>;
  export function SyncOdooStatus(): Promise<any>;
  export function TestOdooConnection(odooURL: string, apiKey: string): Promise<any>;
  export function GetSettings(): Promise<any>;
  export function SaveSettings(settings: any): Promise<any>;
  export function GetNextReminder(): Promise<any>;
  export function GetAppInfo(): Promise<any>;
  export function GetAutostartEnabled(): Promise<any>;
  export function LoginCheckIn(): Promise<any>;
  export function LoginContinue(): Promise<any>;
  export function SnoozeCheckIn(): Promise<any>;
  export function SnoozeCheckOut(): Promise<any>;
  export function AbortAction(): Promise<any>;
  export function ProceedAction(): Promise<any>;
  export function ShutdownCheckOut(): Promise<any>;
  export function ShutdownContinue(): Promise<any>;
  export function ShutdownCancel(): Promise<any>;
  export function ShutdownSkip(): Promise<any>;
  export function HideWindow(): Promise<any>;
  export function ShowWindow(): Promise<any>;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
