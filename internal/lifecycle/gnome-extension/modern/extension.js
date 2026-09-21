import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DBUS_BUS_NAME = 'com.odoo.TimeCheck';
const DBUS_OBJECT_PATH = '/com/odoo/TimeCheck';
const DBUS_INTERFACE_NAME = 'com.odoo.TimeCheck';

export default class TimeCheckAttendanceExtension extends Extension {
    enable() {
        console.log('[TimeCheck Extension] Enabling attendance interceptor extension');
        this._systemActions = SystemActions.getDefault();
        const proto = Object.getPrototypeOf(this._systemActions);
        this._proto = proto;
        this._isBypassing = false;

        this._origActivateLogout = proto.activateLogout || this._systemActions.activateLogout;
        this._origActivatePowerOff = proto.activatePowerOff || this._systemActions.activatePowerOff;
        this._origActivateRestart = proto.activateRestart || this._systemActions.activateRestart;
        this._origActivateAction = proto.activateAction || this._systemActions.activateAction;

        const self = this;

        const wrappedLogout = function() {
            console.log('[TimeCheck Extension] Intercepted activateLogout');
            self._handleAction('logout', () => self._origActivateLogout.call(this));
        };

        const wrappedPowerOff = function() {
            console.log('[TimeCheck Extension] Intercepted activatePowerOff');
            self._handleAction('shutdown', () => self._origActivatePowerOff.call(this));
        };

        const wrappedRestart = function() {
            console.log('[TimeCheck Extension] Intercepted activateRestart');
            self._handleAction('reboot', () => self._origActivateRestart.call(this));
        };

        const wrappedAction = function(id) {
            console.log(`[TimeCheck Extension] Intercepted activateAction(${id})`);
            if (id === 'logout') {
                self._handleAction('logout', () => self._origActivateLogout.call(this));
            } else if (id === 'power-off') {
                self._handleAction('shutdown', () => self._origActivatePowerOff.call(this));
            } else if (id === 'restart') {
                self._handleAction('reboot', () => self._origActivateRestart.call(this));
            } else {
                self._origActivateAction.call(this, id);
            }
        };

        this._systemActions.activateLogout = wrappedLogout;
        this._systemActions.activatePowerOff = wrappedPowerOff;
        this._systemActions.activateRestart = wrappedRestart;
        this._systemActions.activateAction = wrappedAction;

        proto.activateLogout = wrappedLogout;
        proto.activatePowerOff = wrappedPowerOff;
        proto.activateRestart = wrappedRestart;
        proto.activateAction = wrappedAction;

        console.log('[TimeCheck Extension] SystemActions successfully hooked');
    }

    disable() {
        console.log('[TimeCheck Extension] Disabling attendance interceptor extension');
        if (this._proto) {
            if (this._origActivateLogout) this._proto.activateLogout = this._origActivateLogout;
            if (this._origActivatePowerOff) this._proto.activatePowerOff = this._origActivatePowerOff;
            if (this._origActivateRestart) this._proto.activateRestart = this._origActivateRestart;
            if (this._origActivateAction) this._proto.activateAction = this._origActivateAction;
        }
        if (this._systemActions) {
            delete this._systemActions.activateLogout;
            delete this._systemActions.activatePowerOff;
            delete this._systemActions.activateRestart;
            delete this._systemActions.activateAction;
        }
        this._origActivateLogout = null;
        this._origActivatePowerOff = null;
        this._origActivateRestart = null;
        this._origActivateAction = null;
        this._proto = null;
        this._systemActions = null;
    }

    async _handleAction(action, proceedFn) {
        if (this._isBypassing) {
            proceedFn();
            return;
        }

        try {
            console.log(`[TimeCheck Extension] Calling D-Bus RequestAction for ${action}...`);
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
                this._isBypassing = true;
                try {
                    proceedFn();
                } finally {
                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        this._isBypassing = false;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else {
                console.log(`[TimeCheck Extension] Action ${action} cancelled by user checkout.`);
            }
        } catch (e) {
            console.warn(`[TimeCheck Extension] D-Bus call to helper failed: ${e.message}. Proceeding with default action.`);
            this._isBypassing = true;
            try {
                proceedFn();
            } finally {
                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                    this._isBypassing = false;
                    return GLib.SOURCE_REMOVE;
                });
            }
        }
    }
}
