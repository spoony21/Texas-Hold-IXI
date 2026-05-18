// Minimal pub/sub — decouples GameProtocol from UI (Dependency Inversion Principle).
// GameProtocol emits events; UI modules subscribe without GameProtocol knowing they exist.

const GameEvents = {
    _listeners: {},

    on(event, fn) {
        (this._listeners[event] ||= []).push(fn);
    },

    emit(event, ...args) {
        (this._listeners[event] || []).forEach(fn => fn(...args));
    }
};
