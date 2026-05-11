// Browser testing mock for Spixi SDK
// - Solo mode  (1 tab):  add bots via "Add Bot" button
// - Multi-tab mode (2+ tabs): open the same URL in multiple tabs.
//   Each tab gets a unique mock address and messages route via BroadcastChannel.
//   No Spixi app or Ixian blockchain required.

(function() {
    const isSpixi = /Spixi|ixian/i.test(navigator.userAgent);
    if (isSpixi) return;

    // --- Unique address per tab ---
    // Persist in sessionStorage so reloads keep the same address within a tab.
    let MY_ADDRESS = sessionStorage.getItem('mock_address');
    if (!MY_ADDRESS) {
        const rand = Math.random().toString(36).slice(2, 10).toUpperCase();
        MY_ADDRESS = 'ixian1MOCK' + rand + '0000000000000000000000000000';
        sessionStorage.setItem('mock_address', MY_ADDRESS);
    }

    // Shared session ID — all tabs on the same origin join the same session.
    const SESSION_ID = 'mock-session-browser';

    // BroadcastChannel for cross-tab message routing
    const channel = new BroadcastChannel('spixi_mock_' + SESSION_ID);

    console.log('[MockSDK] Browser mode active. Address:', MY_ADDRESS);
    console.log('[MockSDK] Open this page in another tab to test multiplayer.');

    // --- Patch spixiAction ---
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
                // Route outbound network messages to other tabs via BroadcastChannel.
                // If action.r is set this is a private message (only the target tab
                // should deliver it); otherwise it's a broadcast to all peers.
                channel.postMessage({
                    from: MY_ADDRESS,
                    to: action.r || null,  // null = broadcast
                    data: action.d
                });
            } else if (action.c === 'getStorage') {
                const val = localStorage.getItem(`spixi_${action.t}_${action.k}`);
                SpixiAppSdk.ar({ id: reqId, r: val ? btoa(val) : 'null' });
            } else if (action.c === 'setStorage') {
                localStorage.setItem(`spixi_${action.t}_${action.k}`, atob(action.v));
                SpixiAppSdk.ar({ id: reqId, r: 'ok' });
            }
        }
    };

    // Deliver incoming cross-tab messages to this tab's SDK handler
    channel.onmessage = (event) => {
        const { from, to, data } = event.data;
        if (from === MY_ADDRESS) return;           // ignore own echoes
        if (to && to !== MY_ADDRESS) return;       // private message for someone else
        SpixiAppSdk.onNetworkData(from, data);
    };

    // Fire onInit — no remoteAddresses needed; peers discover each other via JOIN heartbeat
    setTimeout(() => {
        SpixiAppSdk.onInit(SESSION_ID, MY_ADDRESS);
    }, 300);
})();
