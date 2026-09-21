import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DBUS_BUS_NAME = 'com.odoo.TimeCheck';
const DBUS_OBJECT_PATH = '/com/odoo/TimeCheck';
const DBUS_INTERFACE_NAME = 'com.odoo.TimeCheck';

export default class TimeCheckAttendanceExtension extends Extension {
    enable() {
        if (this._enabled) {
            console.log('[TimeCheck Extension] Already enabled, skipping');
            return;
        }

        console.log('[TimeCheck Extension] Enabling attendance interceptor extension');
        try {
            this._systemActions = SystemActions.getDefault();
            if (!this._systemActions) {
                console.log('[TimeCheck Extension] Could not get SystemActions default instance');
                return;
            }

            const proto = Object.getPrototypeOf(this._systemActions);
            this._proto = proto;
            this._bypassDepth = 0;

            // Save complete property descriptors so disable() can restore
            // the exact state that existed before the extension was enabled.
            this._origProtoDescriptors = proto ? {
                activateLogout: Object.getOwnPropertyDescriptor(proto, 'activateLogout'),
                activatePowerOff: Object.getOwnPropertyDescriptor(proto, 'activatePowerOff'),
                activateRestart: Object.getOwnPropertyDescriptor(proto, 'activateRestart'),
                activateAction: Object.getOwnPropertyDescriptor(proto, 'activateAction'),
            } : {};

            this._origOwnDescriptors = {
                activateLogout: Object.getOwnPropertyDescriptor(this._systemActions, 'activateLogout'),
                activatePowerOff: Object.getOwnPropertyDescriptor(this._systemActions, 'activatePowerOff'),
                activateRestart: Object.getOwnPropertyDescriptor(this._systemActions, 'activateRestart'),
                activateAction: Object.getOwnPropertyDescriptor(this._systemActions, 'activateAction'),
            };

            const getOriginal = (name) => {
                const own = this._origOwnDescriptors[name];
                if (own && typeof own.value === 'function')
                    return own.value;

                const protoDescriptor = this._origProtoDescriptors[name];
                return protoDescriptor && typeof protoDescriptor.value === 'function'
                    ? protoDescriptor.value
                    : null;
            };

            const effectiveLogout = getOriginal('activateLogout');
            const effectivePowerOff = getOriginal('activatePowerOff');
            const effectiveRestart = getOriginal('activateRestart');
            const effectiveAction = getOriginal('activateAction');

            const self = this;

            const wrappedLogout = function() {
                console.log('[TimeCheck Extension] Intercepted activateLogout');
                self._handleAction('logout', () => {
                    if (effectiveLogout) effectiveLogout.call(this);
                });
            };

            const wrappedPowerOff = function() {
                console.log('[TimeCheck Extension] Intercepted activatePowerOff');
                self._handleAction('shutdown', () => {
                    if (effectivePowerOff) effectivePowerOff.call(this);
                });
            };

            const wrappedRestart = function() {
                console.log('[TimeCheck Extension] Intercepted activateRestart');
                self._handleAction('reboot', () => {
                    if (effectiveRestart) effectiveRestart.call(this);
                });
            };

            const wrappedAction = function(id) {
                console.log(`[TimeCheck Extension] Intercepted activateAction(${id})`);
                if (id === 'logout') {
                    self._handleAction('logout', () => {
                        if (effectiveLogout) effectiveLogout.call(this);
                        else if (effectiveAction) effectiveAction.call(this, id);
                    });
                } else if (id === 'power-off') {
                    self._handleAction('shutdown', () => {
                        if (effectivePowerOff) effectivePowerOff.call(this);
                        else if (effectiveAction) effectiveAction.call(this, id);
                    });
                } else if (id === 'restart') {
                    self._handleAction('reboot', () => {
                        if (effectiveRestart) effectiveRestart.call(this);
                        else if (effectiveAction) effectiveAction.call(this, id);
                    });
                } else {
                    // Preserve all unrelated actions untouched
                    if (effectiveAction) effectiveAction.call(this, id);
                }
            };

            this._systemActions.activateLogout = wrappedLogout;
            this._systemActions.activatePowerOff = wrappedPowerOff;
            this._systemActions.activateRestart = wrappedRestart;
            this._systemActions.activateAction = wrappedAction;

            if (proto) {
                proto.activateLogout = wrappedLogout;
                proto.activatePowerOff = wrappedPowerOff;
                proto.activateRestart = wrappedRestart;
                proto.activateAction = wrappedAction;
            }

            this._enabled = true;
            console.log('[TimeCheck Extension] SystemActions successfully hooked');
        } catch (err) {
            console.warn(`[TimeCheck Extension] Error enabling extension: ${err}. Rolling back.`);
            this.disable();
        }
    }

    disable() {
        console.log('[TimeCheck Extension] Disabling attendance interceptor extension');
        this._bypassDepth = 0;

        if (this._proto && this._origProtoDescriptors) {
            for (const name of [
                'activateLogout',
                'activatePowerOff',
                'activateRestart',
                'activateAction',
            ]) {
                const descriptor = this._origProtoDescriptors[name];
                if (descriptor)
                    Object.defineProperty(this._proto, name, descriptor);
                else
                    delete this._proto[name];
            }
        }

        if (this._systemActions && this._origOwnDescriptors) {
            for (const name of [
                'activateLogout',
                'activatePowerOff',
                'activateRestart',
                'activateAction',
            ]) {
                const descriptor = this._origOwnDescriptors[name];
                if (descriptor)
                    Object.defineProperty(this._systemActions, name, descriptor);
                else
                    delete this._systemActions[name];
            }
        }

        this._origProtoDescriptors = null;
        this._origOwnDescriptors = null;

        this._proto = null;
        this._systemActions = null;
        this._enabled = false;
    }

    // _safeProceed increments _bypassDepth so that any re-entrant intercept
    // _safeProceed increments _bypassDepth and sets _bypassUntil so that any re-entrant
    // or immediate follow-up intercept call triggered by proceedFn (e.g. GNOME session manager
    // broadcasting logout back to the shell) is immediately forwarded without another prompt.
    _safeProceed(proceedFn) {
        this._bypassDepth++;
        this._bypassUntil = Date.now() + 10000; // 10s cooldown window
        try {
            if (typeof proceedFn === 'function') {
                proceedFn();
            }
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._bypassDepth = Math.max(0, this._bypassDepth - 1);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    async _handleAction(action, proceedFn) {
        if (this._bypassDepth > 0 || Date.now() < (this._bypassUntil || 0)) {
            console.log(`[TimeCheck Extension] Bypassing ${action} (already proceeding)`);
            if (typeof proceedFn === 'function') proceedFn();
            return;
        }

        try {
            console.log(`[TimeCheck Extension] Intercepted ${action}; checking attendance via D-Bus...`);
            const reply = await Gio.DBus.session.call(
                DBUS_BUS_NAME,
                DBUS_OBJECT_PATH,
                DBUS_INTERFACE_NAME,
                'RequestAction',
                new GLib.Variant('(s)', [action]),
                new GLib.VariantType('(s)'),
                Gio.DBusCallFlags.NONE,
                120000,
                null
            );

            const [decision] = reply.recursiveUnpack();
            console.log(`[TimeCheck Extension] Decision for ${action}: ${decision}`);

            if (decision === 'proceed') {
                this._safeProceed(proceedFn);
            } else {
                console.log(`[TimeCheck Extension] Action ${action} cancelled by user checkout.`);
            }
        } catch (e) {
            // Fail-open: If TimeCheck is not running or D-Bus fails, always allow normal GNOME action
            console.warn(`[TimeCheck Extension] D-Bus call failed: ${e.message}. Failing open with default action.`);
            this._safeProceed(proceedFn);
        }
    }
}
