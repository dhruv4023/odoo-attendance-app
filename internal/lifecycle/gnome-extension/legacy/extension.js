const { Gio, GLib } = imports.gi;
const SystemActions = imports.misc.systemActions;

const DBUS_BUS_NAME = 'com.example.OdooAttendanceApp';
const DBUS_OBJECT_PATH = '/com/example/OdooAttendanceApp';
const DBUS_INTERFACE_NAME = 'com.example.OdooAttendanceApp';

let _systemActions = null;
let _proto = null;
let _enabled = false;
let _bypassDepth = 0;
let _bypassUntil = 0;

// Saved property descriptors for exact restoration on disable()
let _origProtoDescriptors = null;
let _origOwnDescriptors = null;

// _safeProceed increments _bypassDepth and sets _bypassUntil so that any re-entrant
// or immediate follow-up intercept call triggered by proceedFn (e.g. GNOME session manager
// broadcasting logout back to the shell) is immediately forwarded without another prompt.
function _safeProceed(proceedFn) {
    _bypassDepth++;
    _bypassUntil = Date.now() + 10000; // 10s cooldown window
    try {
        if (typeof proceedFn === 'function') {
            proceedFn();
        }
    } finally {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            _bypassDepth = Math.max(0, _bypassDepth - 1);
            return GLib.SOURCE_REMOVE;
        });
    }
}

function _handleAction(action, proceedFn) {
    if (_bypassDepth > 0 || Date.now() < _bypassUntil) {
        log(`[Odoo Attendance App Extension] Bypassing ${action} (already proceeding)`);
        if (typeof proceedFn === 'function') proceedFn();
        return;
    }

    try {
        log(`[Odoo Attendance App Extension] Intercepted ${action}; checking attendance via D-Bus...`);
        Gio.DBus.session.call(
            DBUS_BUS_NAME,
            DBUS_OBJECT_PATH,
            DBUS_INTERFACE_NAME,
            'RequestAction',
            new GLib.Variant('(s)', [action]),
            new GLib.VariantType('(s)'),
            Gio.DBusCallFlags.NONE,
            120000,
            null,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    const [decision] = reply.recursiveUnpack();
                    log(`[Odoo Attendance App Extension] Decision for ${action}: ${decision}`);

                    if (decision === 'proceed') {
                        _safeProceed(proceedFn);
                    } else {
                        log(`[Odoo Attendance App Extension] Action ${action} cancelled by user checkout.`);
                    }
                } catch (err) {
                    // Fail-open: If Odoo Attendance App is not running or D-Bus fails, always allow normal GNOME action
                    log(`[Odoo Attendance App Extension] D-Bus call finished with error: ${err.message}. Failing open.`);
                    _safeProceed(proceedFn);
                }
            }
        );
    } catch (e) {
        // Fail-open: If D-Bus call initiation fails, allow normal GNOME action
        log(`[Odoo Attendance App Extension] Failed to call D-Bus service: ${e.message}. Failing open.`);
        _safeProceed(proceedFn);
    }
}

function init() {
    log('[Odoo Attendance App Extension] Initializing attendance interceptor extension (GNOME 42-44)');
}

function enable() {
    if (_enabled) {
        log('[Odoo Attendance App Extension] Already enabled, skipping');
        return;
    }

    log('[Odoo Attendance App Extension] Enabling attendance interceptor extension');
    try {
        _systemActions = SystemActions.getDefault();
        if (!_systemActions) {
            log('[Odoo Attendance App Extension] Could not get SystemActions default instance');
            return;
        }

        const proto = Object.getPrototypeOf(_systemActions);
        _proto = proto;
        _bypassDepth = 0;

        // Save complete property descriptors so disable() can restore
        // the exact state that existed before the extension was enabled.
        _origProtoDescriptors = proto ? {
            activateLogout: Object.getOwnPropertyDescriptor(proto, 'activateLogout'),
            activatePowerOff: Object.getOwnPropertyDescriptor(proto, 'activatePowerOff'),
            activateRestart: Object.getOwnPropertyDescriptor(proto, 'activateRestart'),
            activateAction: Object.getOwnPropertyDescriptor(proto, 'activateAction'),
        } : {};

        _origOwnDescriptors = {
            activateLogout: Object.getOwnPropertyDescriptor(_systemActions, 'activateLogout'),
            activatePowerOff: Object.getOwnPropertyDescriptor(_systemActions, 'activatePowerOff'),
            activateRestart: Object.getOwnPropertyDescriptor(_systemActions, 'activateRestart'),
            activateAction: Object.getOwnPropertyDescriptor(_systemActions, 'activateAction'),
        };

        const getOriginal = (name) => {
            const own = _origOwnDescriptors[name];
            if (own && typeof own.value === 'function')
                return own.value;

            const protoDescriptor = _origProtoDescriptors[name];
            return protoDescriptor && typeof protoDescriptor.value === 'function'
                ? protoDescriptor.value
                : null;
        };

        const effectiveLogout = getOriginal('activateLogout');
        const effectivePowerOff = getOriginal('activatePowerOff');
        const effectiveRestart = getOriginal('activateRestart');
        const effectiveAction = getOriginal('activateAction');

        const wrappedLogout = function () {
            log('[Odoo Attendance App Extension] Intercepted activateLogout');
            _handleAction('logout', () => {
                if (effectiveLogout) effectiveLogout.call(this);
            });
        };

        const wrappedPowerOff = function () {
            log('[Odoo Attendance App Extension] Intercepted activatePowerOff');
            _handleAction('shutdown', () => {
                if (effectivePowerOff) effectivePowerOff.call(this);
            });
        };

        const wrappedRestart = function () {
            log('[Odoo Attendance App Extension] Intercepted activateRestart');
            _handleAction('reboot', () => {
                if (effectiveRestart) effectiveRestart.call(this);
            });
        };

        const wrappedAction = function (id) {
            log(`[Odoo Attendance App Extension] Intercepted activateAction(${id})`);
            if (id === 'logout') {
                _handleAction('logout', () => {
                    if (effectiveLogout) effectiveLogout.call(this);
                    else if (effectiveAction) effectiveAction.call(this, id);
                });
            } else if (id === 'power-off') {
                _handleAction('shutdown', () => {
                    if (effectivePowerOff) effectivePowerOff.call(this);
                    else if (effectiveAction) effectiveAction.call(this, id);
                });
            } else if (id === 'restart') {
                _handleAction('reboot', () => {
                    if (effectiveRestart) effectiveRestart.call(this);
                    else if (effectiveAction) effectiveAction.call(this, id);
                });
            } else {
                // Preserve all unrelated actions untouched
                if (effectiveAction) effectiveAction.call(this, id);
            }
        };

        _systemActions.activateLogout = wrappedLogout;
        _systemActions.activatePowerOff = wrappedPowerOff;
        _systemActions.activateRestart = wrappedRestart;
        _systemActions.activateAction = wrappedAction;

        if (proto) {
            proto.activateLogout = wrappedLogout;
            proto.activatePowerOff = wrappedPowerOff;
            proto.activateRestart = wrappedRestart;
            proto.activateAction = wrappedAction;
        }

        _enabled = true;
        log('[Odoo Attendance App Extension] SystemActions successfully hooked');
    } catch (err) {
        log(`[Odoo Attendance App Extension] Error enabling extension: ${err}. Rolling back.`);
        disable();
    }
}

function disable() {
    log('[Odoo Attendance App Extension] Disabling attendance interceptor extension');
    _bypassDepth = 0;

    if (_proto && _origProtoDescriptors) {
        for (const name of [
            'activateLogout',
            'activatePowerOff',
            'activateRestart',
            'activateAction',
        ]) {
            const descriptor = _origProtoDescriptors[name];
            if (descriptor)
                Object.defineProperty(_proto, name, descriptor);
            else
                delete _proto[name];
        }
    }

    if (_systemActions && _origOwnDescriptors) {
        for (const name of [
            'activateLogout',
            'activatePowerOff',
            'activateRestart',
            'activateAction',
        ]) {
            const descriptor = _origOwnDescriptors[name];
            if (descriptor)
                Object.defineProperty(_systemActions, name, descriptor);
            else
                delete _systemActions[name];
        }
    }

    _origProtoDescriptors = null;
    _origOwnDescriptors = null;

    _proto = null;
    _systemActions = null;
    _enabled = false;
}
