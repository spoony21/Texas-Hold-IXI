// GameProtocol — session orchestrator (Single Responsibility: wires modules together).
// Public API: init, startGame, addBot, sendAction, sendChat, leaveGame, handleMessage.
// Internal helpers: _broadcast, _send, _restartLobbyHeartbeat.

const GameProtocol = {
    init(sessionId, myAddress, remoteAddresses) {
        GameState.sessionId    = sessionId;
        GameState.myAddress    = myAddress;
        GameState.joinedAt     = Date.now();
        GameState.allAddresses = [myAddress, ...remoteAddresses];

        GameState.players[myAddress] = {
            name: GameState.shortAddr(myAddress),
            stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
            seatIndex: 0, connected: true, isBot: false,
            joinedAt: GameState.joinedAt
        };

        GameState.isHost      = true;
        GameState.hostAddress = myAddress;
        // Do NOT start the heartbeat here — wait for the player to explicitly join
        // so we never appear in another player's lobby before they've confirmed.
    },

    // Called when the player clicks "Join Table". Starts the JOIN heartbeat
    // and makes this client visible to everyone else in the session.
    joinLobby() {
        if (GameState.hasJoinedLobby) return;
        GameState.hasJoinedLobby = true;
        this._restartLobbyHeartbeat();
        GameEvents.emit('lobbyJoined');
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

    _restartLobbyHeartbeat() {
        clearInterval(GameState._lobbyInterval);
        const sendJoin = () => this._send({
            type: MSG.JOIN,
            address: GameState.myAddress,
            name: GameState.players[GameState.myAddress]?.name,
            joinedAt: GameState.joinedAt
        });
        sendJoin();
        GameState._lobbyInterval = setInterval(() => {
            if (GameState.phase === PHASE.LOBBY) { sendJoin(); }
            else { clearInterval(GameState._lobbyInterval); GameState._lobbyInterval = null; }
        }, 3000);
    }
};
