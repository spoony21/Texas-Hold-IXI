// GameProtocol — session orchestrator (Single Responsibility: wires modules together).
// Public API: init, startGame, addBot, sendAction, sendChat, leaveGame, handleMessage.
// Internal helpers: _broadcast, _send, _restartLobbyHeartbeat.

const GameProtocol = {
    // Initialise the session. Note: remoteAddresses from onInit are intentionally
    // IGNORED — the Spixi platform may list contacts who haven't opened the app yet.
    // Peers are discovered purely through broadcast JOIN heartbeats, so only
    // actually-online players ever appear in the lobby.
    init(sessionId, myAddress) {
        GameState.sessionId = sessionId;
        GameState.myAddress = myAddress;
        GameState.joinedAt  = Date.now();

        GameState.players[myAddress] = {
            name: GameState.shortAddr(myAddress),
            stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
            seatIndex: 0, connected: true, isBot: false,
            joinedAt: GameState.joinedAt,
            lastSeenAt: Date.now()
        };

        GameState.isHost      = false;
        GameState.hostAddress = null;

        this._startLobbyBroadcast();
        this._startPeerCleanup();
        HostElection.elect();  // Solo case: I become host immediately
    },

    startGame() {
        if (!GameState.isHost) return;
        if (GameState.phase !== PHASE.LOBBY) return;
        if (Object.keys(GameState.players).length < 2) return;
        GameState.dealerIndex = 0;
        GameFlow.startRound();
    },

    addBot() {
        if (!GameState.isHost) return;
        if (Object.keys(GameState.players).length >= MAX_PLAYERS) return;
        const botNum  = Object.keys(GameState.players).filter(a => a.startsWith('bot:')).length + 1;
        const botAddr = `bot:${botNum}`;
        this._broadcast({ type: MSG.BOT_ADD, address: botAddr, name: `Bot ${botNum}` });
    },

    sendAction(action, amount = 0) {
        const msg = { type: MSG.PLAYER_ACTION, address: GameState.myAddress, action, amount };
        if (GameState.isHost) GameFlow.handlePlayerAction(GameState.myAddress, action, amount);
        this._broadcast(msg);
    },

    sendChat(text) {
        // _send (no local echo) — caller already adds the message to the UI as "You"
        this._send({ type: MSG.CHAT, address: GameState.myAddress, text });
    },

    leaveGame() {
        if (GameState.phase !== PHASE.LOBBY) {
            this._send({
                type: MSG.LEAVE,
                address: GameState.myAddress,
                name: GameState.players[GameState.myAddress]?.name,
                stack: GameState.players[GameState.myAddress]?.stack || 0
            });
        }
        SpixiAppSdk.back();
    },

    handleMessage(senderAddr, data) {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        // Update liveness on every inbound message (Starwind pattern).
        const peer = GameState.players[senderAddr];
        if (peer) peer.lastSeenAt = Date.now();
        const handler = MessageHandlers[msg.type];
        if (handler) handler.call(MessageHandlers, senderAddr, msg);
    },

    // ── Internal helpers ──────────────────────────────────────────────────────

    _broadcast(msg) {
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
        this.handleMessage(GameState.myAddress, JSON.stringify(msg));
    },

    _send(msg) {
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    },

    // Announce my presence to the session every 2s while in the lobby.
    // Mirrors Starwind Arena's lobbyJoin pattern. Peers are identified by the
    // SDK-authenticated senderAddress on the receiving side — never by msg.address —
    // so phantom JOINs spoofing other identities can't slip in.
    _startLobbyBroadcast() {
        clearInterval(GameState._lobbyInterval);
        const sendJoin = () => this._send({
            type: MSG.JOIN,
            joinedAt: GameState.joinedAt,
            name: GameState.players[GameState.myAddress]?.name
        });
        sendJoin();
        GameState._lobbyInterval = setInterval(() => {
            if (GameState.phase === PHASE.LOBBY) { sendJoin(); }
            else { clearInterval(GameState._lobbyInterval); GameState._lobbyInterval = null; }
        }, 2000);
    },

    // Remove peers that stop broadcasting. Without this, a stale JOIN from a
    // disconnected/phantom peer (e.g. left over from a previous Spixi session)
    // would stick in the lobby forever and could wrongly win host election.
    _startPeerCleanup() {
        clearInterval(GameState._cleanupInterval);
        GameState._cleanupInterval = setInterval(() => {
            if (GameState.phase !== PHASE.LOBBY) return;
            const now = Date.now();
            let changed = false;
            for (const [addr, p] of Object.entries(GameState.players)) {
                if (addr === GameState.myAddress || p.isBot) continue;
                if (p.lastSeenAt && now - p.lastSeenAt > 6000) {
                    delete GameState.players[addr];
                    changed = true;
                }
            }
            if (changed) {
                HostElection.elect();
                GameEvents.emit('lobbyUpdated');
            }
        }, 2000);
    }
};
