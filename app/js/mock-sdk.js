// Browser testing mock for Spixi SDK
// Activates automatically when running outside the Spixi app
// Starts you alone as host — use "Add Bot" to add AI opponents

(function() {
    const isSpixi = /Spixi|ixian/i.test(navigator.userAgent);
    if (isSpixi) return;

    console.log('[MockSDK] Browser mode active');

    const MY_ADDRESS = 'ixian1MMMM0000000000000000000000000000000000';

    // Patch spixiAction to route internally instead of navigating
    SpixiAppSdk.spixiAction = function(actionData, useRequestId = true) {
        let reqId = null;
        let promise;
        if (useRequestId) {
            reqId = ++SpixiAppSdk._requestId;
            actionData.id = reqId;
            promise = new Promise((resolve, reject) => {
                SpixiAppSdk._pendingRequests[reqId] = { resolve, reject };
            });
        }
        setTimeout(() => MockBus.handle(actionData, reqId), 10);
        return promise;
    };

    const MockBus = {
        handle(action, reqId) {
            if (action.c === 'ds') {
                // Network send — no real peers in mock mode
                // game-protocol._broadcast already calls handleMessage locally
                // Private messages to bot addresses are ignored (host handles bots directly)
            } else if (action.c === 'getStorage') {
                const val = localStorage.getItem(`spixi_${action.t}_${action.k}`);
                SpixiAppSdk.ar({ id: reqId, r: val ? btoa(val) : 'null' });
            } else if (action.c === 'setStorage') {
                localStorage.setItem(`spixi_${action.t}_${action.k}`, atob(action.v));
                SpixiAppSdk.ar({ id: reqId, r: 'ok' });
            }
        }
    };

    // Fire init after short delay — no remote addresses so you become host automatically
    setTimeout(() => {
        SpixiAppSdk.onInit('mock-session-001', MY_ADDRESS);
    }, 300);

    console.log('[MockSDK] You are:', MY_ADDRESS);
})();
