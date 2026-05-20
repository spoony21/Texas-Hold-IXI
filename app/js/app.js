// App — thin controller that wires the SDK, subscribes to GameEvents, and exposes
// the HTML onclick interface (Single Responsibility: orchestration only).

const App = {
    myAddress:        null,
    actionCallAmount: 0,

    init() {
        // We intentionally ignore remoteAddresses from onInit — the Spixi platform
        // may list contacts who haven't opened the app yet. Peer discovery is
        // handled via broadcast JOIN heartbeats inside GameProtocol.
        SpixiAppSdk.onInit = (sessionId, myAddress) => {
            this.myAddress = myAddress;
            GameProtocol.init(sessionId, myAddress);
            this._subscribeToEvents();
            this.showScreen('lobby');
            LobbyUI.render();
        };

        SpixiAppSdk.onNetworkData = (senderAddr, data) => {
            GameProtocol.handleMessage(senderAddr, data);
        };

        SpixiAppSdk.fireOnLoad();
    },

    // ── Event subscriptions ───────────────────────────────────────────────────

    _subscribeToEvents() {
        GameEvents.on('playerJoined', (addr) => {
            LobbyUI.render();
            const p     = GameState.players[addr];
            const label = p?.isBot
                ? `${p.name} joined as a bot`
                : `${p?.name || GameState.shortAddr(addr)} joined the table`;
            LobbyUI.addLog(label);
        });

        GameEvents.on('lobbyUpdated', () => LobbyUI.render());

        GameEvents.on('gameStarted', (msg) => {
            this.showScreen('game');
            GameUI.updatePot(0);
            GameUI.renderTable(this.myAddress);
            GameUI.addLog(`New hand — Dealer: ${GameState.shortAddr(msg.dealer)}`);
            GameUI.hideActions();
        });

        GameEvents.on('holeCards', (cards) => {
            const el = document.getElementById('my-cards');
            if (!el) return;
            el.innerHTML = cards.map(c => PokerEngine.cardHTML(c)).join('');
            el.classList.add('card-deal');
        });

        GameEvents.on('communityCards', (cards, phase) => {
            const el = document.getElementById('community-cards');
            if (el) el.innerHTML = cards.map(c => PokerEngine.cardHTML(c)).join('');
            GameUI.addLog(`--- ${phase.toUpperCase()} ---`);
            GameUI.renderTable(this.myAddress);
        });

        GameEvents.on('actionRequest', (addr, callAmount, pot, roundBet) => {
            this.actionCallAmount = callAmount;
            GameUI.updatePot(pot);
            GameUI.renderTable(this.myAddress);

            if (addr === this.myAddress) {
                const myStack = GameState.players[this.myAddress]?.stack || 0;
                GameUI.showActions(callAmount, myStack);
            } else {
                GameUI.hideActions();
            }

            GameUI.renderTable(this.myAddress);
        });

        GameEvents.on('playerAction', (addr, action, amount) => {
            const name = GameState.players[addr]?.name || GameState.shortAddr(addr);
            let msg = `${name}: ${action.toUpperCase()}`;
            if (amount > 0) msg += ` ${amount}`;
            GameUI.addLog(msg);
            GameUI.renderTable(this.myAddress);
        });

        GameEvents.on('stateUpdate', (state) => {
            GameUI.updatePot(state.pot);
            GameUI.renderTable(this.myAddress);
        });

        GameEvents.on('showdown', (players, communityCards) => {
            GameUI.addLog('--- SHOWDOWN ---');
            GameUI.hideActions();
            GameUI.renderTable(this.myAddress);
        });

        GameEvents.on('reveal', (addr, cards) => {
            const name = GameState.players[addr]?.name || GameState.shortAddr(addr);
            GameUI.addLog(`${name} shows: ${cards.map(c => PokerEngine.cardLabel(c)).join(' ')}`);
            GameUI.renderTable(this.myAddress);
        });

        GameEvents.on('result', (winners, pot, hands) => {
            const winNames = winners.map(a => GameState.players[a]?.name || GameState.shortAddr(a));
            const share    = Math.floor(pot / winners.length);
            GameUI.addLog(`🏆 ${winNames.join(' & ')} wins ${share} chips! (${winners.map(w => hands[w]).filter(Boolean).join(', ')})`);
            GameUI.hideActions();
            GameUI.renderTable(this.myAddress);
            GameUI.showResult(winNames.join(' & '), share, winners.map(w => hands[w]).filter(Boolean).join(', '));
        });

        GameEvents.on('newRound', () => {
            GameUI.addLog('New round starting…');
            GameUI.hideResult();
            document.getElementById('my-cards').innerHTML = '<div class="card face-down">🂠</div><div class="card face-down">🂠</div>';
            document.getElementById('community-cards').innerHTML = '';
            GameUI.hideActions();
            GameUI.updatePot(0);
        });

        GameEvents.on('chat', (addr, text) => {
            const name = GameState.players[addr]?.name || GameState.shortAddr(addr);
            ChatUI.addMessage(name, text);
        });

        GameEvents.on('playerLeft', (addr, name) => {
            LobbyUI.addLog(`${name} left the game`);
            if (GameState.phase !== PHASE.LOBBY) GameUI.renderTable(this.myAddress);
            else LobbyUI.render();
        });

        GameEvents.on('gameOver', (winnerAddr) => {
            const name = winnerAddr
                ? (GameState.players[winnerAddr]?.name || GameState.shortAddr(winnerAddr))
                : null;
            GameUI.hideResult();
            this.showScreen('lobby');
            LobbyUI.render();
            LobbyUI.addLog(name ? `🏆 ${name} wins the game! Starting fresh…` : 'Game over. Starting fresh…');
        });
    },

    // ── Screen management ─────────────────────────────────────────────────────

    showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-' + name)?.classList.add('active');
    },

    // ── HTML onclick interface — delegates to focused modules ─────────────────

    fold()  { GameProtocol.sendAction(ACTION.FOLD);                             GameUI.hideActions(); },
    check() { GameProtocol.sendAction(ACTION.CHECK);                            GameUI.hideActions(); },
    call()  { GameProtocol.sendAction(ACTION.CALL,  this.actionCallAmount);     GameUI.hideActions(); },
    raise() {
        const amount = parseInt(document.getElementById('raise-slider').value, 10);
        GameProtocol.sendAction(ACTION.RAISE, amount);
        GameUI.hideActions();
    },
    allIn() { GameProtocol.sendAction(ACTION.ALL_IN);                           GameUI.hideActions(); },

    updateRaiseDisplay() { GameUI.updateRaiseDisplay(); },

    addBot()       { GameProtocol.addBot(); },
    confirmLeave() { if (confirm('Leave the game? Your remaining chips will go into the pot.')) GameProtocol.leaveGame(); },
    leaveGame()    { GameProtocol.leaveGame(); },

    showInvite()  { LobbyUI.showInvite(); },
    closeInvite() { LobbyUI.closeInvite(); },
    copyAddress() { LobbyUI.copyAddress(); },

    toggleChat() { ChatUI.toggle(); },
    sendChat()   { ChatUI.send(); }
};

document.addEventListener('DOMContentLoaded', () => App.init());
