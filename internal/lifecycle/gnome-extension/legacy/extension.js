const { Gio, GLib } = imports.gi;
const SystemActions = imports.misc.systemActions;

const DBUS_BUS_NAME = 'com.odoo.TimeCheck';
const DBUS_OBJECT_PATH = '/com/odoo/TimeCheck';
const DBUS_INTERFACE_NAME = 'com.odoo.TimeCheck';

let _systemActions = null;
let _proto = null;
let _isBypassing = false;
let _origActivateLogout = null;
let _origActivatePowerOff = null;
let _origActivateRestart = null;
let _origActivateAction = null;

function _handleAction(action, proceedFn) {
    if (_isBypassing) {
        proceedFn();
        return;
    }

    try {
        log(`[TimeCheck Extension] Calling D-Bus RequestAction for ${action}...`);
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
                    log(`[TimeCheck Extension] Decision for ${action}: ${decision}`);

                    if (decision === 'proceed') {
                        _isBypassing = true;
                        try {
                            proceedFn();
                        } finally {
                            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                _isBypassing = false;
                                return GLib.SOURCE_REMOVE;
                            });
                        }
                    } else {
                        log(`[TimeCheck Extension] Action ${action} cancelled by user checkout.`);
                    }
                } catch (err) {
                    log(`[TimeCheck Extension] D-Bus finish error: ${err.message}. Proceeding with default action.`);
                    _isBypassing = true;
                    try {
                        proceedFn();
                    } finally {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            _isBypassing = false;
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                }
            }
        );
    } catch (e) {
        log(`[TimeCheck Extension] D-Bus call to helper failed: ${e.message}. Proceeding with default action.`);
        _isBypassing = true;
        try {
            proceedFn();
        } finally {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                _isBypassing = false;
                return GLib.SOURCE_REMOVE;
            });
        }
    }
}

function init() {
    log('[TimeCheck Extension] Initializing attendance interceptor extension for GNOME 42-44');
}

function enable() {
    log('[TimeCheck Extension] Enabling attendance interceptor extension for GNOME 42-44');
    _systemActions = SystemActions.getDefault();
    const proto = Object.getPrototypeOf(_systemActions);
    _proto = proto;
    _isBypassing = false;

    _origActivateLogout = proto.activateLogout || _systemActions.activateLogout;
    _origActivatePowerOff = proto.activatePowerOff || _systemActions.activatePowerOff;
    _origActivateRestart = proto.activateRestart || _systemActions.activateRestart;
    _origActivateAction = proto.activateAction || _systemActions.activateAction;

    const wrappedLogout = function() {
        log('[TimeCheck Extension] Intercepted activateLogout');
        _handleAction('logout', () => _origActivateLogout.call(this));
    };

    const wrappedPowerOff = function() {
        log('[TimeCheck Extension] Intercepted activatePowerOff');
        _handleAction('shutdown', () => _origActivatePowerOff.call(this));
    };

    const wrappedRestart = function() {
        log('[TimeCheck Extension] Intercepted activateRestart');
        _handleAction('reboot', () => _origActivateRestart.call(this));
    };

    const wrappedAction = function(id) {
        log(`[TimeCheck Extension] Intercepted activateAction(${id})`);
        if (id === 'logout') {
            _handleAction('logout', () => _origActivateLogout.call(this));
        } else if (id === 'power-off') {
            _handleAction('shutdown', () => _origActivatePowerOff.call(this));
        } else if (id === 'restart') {
            _handleAction('reboot', () => _origActivateRestart.call(this));
        } else {
            _origActivateAction.call(this, id);
        }
    };

    _systemActions.activateLogout = wrappedLogout;
    _systemActions.activatePowerOff = wrappedPowerOff;
    _systemActions.activateRestart = wrappedRestart;
    _systemActions.activateAction = wrappedAction;

    proto.activateLogout = wrappedLogout;
    proto.activatePowerOff = wrappedPowerOff;
    proto.activateRestart = wrappedRestart;
    proto.activateAction = wrappedAction;

    log('[TimeCheck Extension] SystemActions successfully hooked');
}

function disable() {
    log('[TimeCheck Extension] Disabling attendance interceptor extension');
    if (_proto) {
        if (_origActivateLogout) _proto.activateLogout = _origActivateLogout;
        if (_origActivatePowerOff) _proto.activatePowerOff = _origActivatePowerOff;
        if (_origActivateRestart) _proto.activateRestart = _origActivateRestart;
        if (_origActivateAction) _proto.activateAction = _origActivateAction;
    }
    if (_systemActions) {
        delete _systemActions.activateLogout;
        delete _systemActions.activatePowerOff;
        delete _systemActions.activateRestart;
        delete _systemActions.activateAction;
    }
    _origActivateLogout = null;
    _origActivatePowerOff = null;
    _origActivateRestart = null;
    _origActivateAction = null;
    _proto = null;
    _systemActions = null;
}
