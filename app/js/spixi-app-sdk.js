// Copyright (C) 2026 IXI Labs
// Spixi Mini Apps SDK v0.51

const SPX_CMD_NETWORK_DATA = "ds";
const SPX_CMD_GET_STORAGE = "getStorage";
const SPX_CMD_SET_STORAGE = "setStorage";

var SpixiAppSdk = {
    version: 0.51,
    date: "2025-12-15",
    _requestId: 0,
    _pendingRequests: {},

    fireOnLoad: function () { setTimeout(function() { location.href = "ixian:onload:" + SpixiAppSdk.version; }, 0); },
    back: function () { setTimeout(function() { location.href = "ixian:back"; }, 0); },

    sendNetworkData: function (data, recipientAddress = null) {
        var obj = { c: SPX_CMD_NETWORK_DATA, d: data };
        if (recipientAddress) { obj.r = recipientAddress; }
        SpixiAppSdk.spixiAction(obj, false);
    },

    sendNetworkProtocolData: function (protocolId, data, recipientAddress = null) {
        var obj = { c: SPX_CMD_NETWORK_DATA, pid: protocolId, d: data };
        if (recipientAddress) { obj.r = recipientAddress; }
        SpixiAppSdk.spixiAction(obj, false);
    },

    getStorageData: async function (table, key) {
        const resp = await SpixiAppSdk.spixiAction({ c: SPX_CMD_GET_STORAGE, t: table, k: key }, true);
        if (resp != "null") { return atob(resp); }
        return null;
    },

    setStorageData: function (table, key, value) {
        return SpixiAppSdk.spixiAction({ c: SPX_CMD_SET_STORAGE, t: table, k: key, v: btoa(value) }, true);
    },

    spixiAction: function (actionData, useRequestId = true) {
        if (typeof actionData !== 'object') { throw new Error('actionData must be an object'); }
        let reqId = null;
        let promise;
        if (useRequestId) {
            reqId = ++SpixiAppSdk._requestId;
            actionData.id = reqId;
            promise = new Promise(function(resolve, reject) {
                SpixiAppSdk._pendingRequests[reqId] = { resolve, reject };
            });
        }
        let json = JSON.stringify(actionData);
        let b64 = btoa(json);
        setTimeout(function() { location.href = "xa:" + b64; }, 0);
        return promise;
    },

    ar: function (actionResponse) {
        try {
            let resp = (typeof actionResponse === 'string') ? JSON.parse(actionResponse) : actionResponse;
            let reqId = resp.id;
            let pendingRequest = SpixiAppSdk._pendingRequests[reqId];
            if (reqId && pendingRequest) {
                if (resp.e) { pendingRequest.reject(resp.e); }
                else { pendingRequest.resolve(resp.r); }
                delete SpixiAppSdk._pendingRequests[reqId];
            }
        } catch (e) { console.error('SpixiAppSdk.ar error:', e); }
    },

    onInit: function (sessionId, userAddress, ...remoteAddresses) {},
    onNetworkData: function (senderAddress, data) {},
    onNetworkProtocolData: function (senderAddress, protocolId, data) {},
    onRequestAccept: function (data) {},
    onRequestReject: function (data) {},
    onAppEndSession: function (data) {},
};
