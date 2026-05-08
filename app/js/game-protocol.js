// Game state management and Spixi messaging protocol

const PHASE = { LOBBY: 'lobby', PREFLOP: 'preflop', FLOP: 'flop', TURN: 'turn', RIVER: 'river', SHOWDOWN: 'showdown' };
const ACTION = { FOLD: 'fold', CHECK: 'check', CALL: 'call', RAISE: 'raise', ALL_IN: 'allin' };
const MSG = {
    JOIN: 'join', START: 'start', HOLE_CARDS: 'hole_cards', COMMUNITY: 'community',
    ACTION_REQ: 'action_req', PLAYER_ACTION: 'player_action', STATE: 'state',
    SHOWDOWN_REVEAL: 'showdown_reveal', RESULT: 'result', NEW_ROUND: 'new_round',
    CHAT: 'chat', BOT_ADD: 'bot_add'
};

const STARTING_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;
const MAX_PLAYERS = 6;

const GameProtocol = {
    myAddress: null,
    sessionId: null,
    allAddresses: [],    // everyone in Spixi session (from onInit)
    isHost: false,
    hostAddress: null,

    phase: PHASE.LOBBY,
    players: {},         // only those who sent JOIN — the live list
    dealerIndex: 0,
    pot: 0,
    communityCards: [],
    myHoleCards: [],
    allHoleCards: {},    // host-only: addr -> cards (for bot showdown)
    revealedHands: {},
    currentTurnAddr: null,
    deck: [],
    actionOrder: [],
    actionIndex: 0,
    roundBet: 0,

    init(sessionId, myAddress, remoteAddresses) {
        this.sessionId = sessionId;
        this.myAddress = myAddress;
        this.allAddresses = [myAddress, ...remoteAddresses];

        // Only add yourself to the live player list immediately
        this.players[myAddress] = {
            name: this._shortAddr(myAddress),
            stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
            seatIndex: 0, connected: true, isBot: false
        };

        // If alone when app opens, claim host
        if (remoteAddresses.length === 0) {
            this.isHost = true;
            this.hostAddress = myAddress;
        }

        // Announce presence (claimHost flag so others know who opened first)
        this._send({
            type: MSG.JOIN,
            address: myAddress,
            name: this.players[myAddress].name,
            claimHost: this.isHost
        });
    },

    // Only host can start
    startGame() {
        if (!this.isHost) return;
        if (this.phase !== PHASE.LOBBY) return;
        if (Object.keys(this.players).length < 2) return;
        this.dealerIndex = 0;
        this._startRound();
    },

    // Host adds a bot (up to MAX_PLAYERS total)
    addBot() {
        if (!this.isHost) return;
        if (Object.keys(this.players).length >= MAX_PLAYERS) return;
        const botNum = Object.keys(this.players).filter(a => a.startsWith('bot:')).length + 1;
        const botAddr = `bot:${botNum}`;
        const botName = `Bot ${botNum}`;
        // Broadcast so all players see the new bot
        this._broadcast({ type: MSG.BOT_ADD, address: botAddr, name: botName });
    },

    _startRound() {
        this.phase = PHASE.PREFLOP;
        this.pot = 0;
        this.communityCards = [];
        this.revealedHands = {};
        this.allHoleCards = {};
        this.deck = PokerEngine.shuffle(PokerEngine.createDeck());

        const activePlayers = this._activePlayers();
        for (const addr of activePlayers) {
            this.players[addr].bet = 0;
            this.players[addr].folded = false;
            this.players[addr].allIn = false;
        }

        const sbIndex = (this.dealerIndex + 1) % activePlayers.length;
        const bbIndex = (this.dealerIndex + 2) % activePlayers.length;
        const sbAddr = activePlayers[sbIndex];
        const bbAddr = activePlayers[bbIndex];

        this._placeBet(sbAddr, SMALL_BLIND);
        this._placeBet(bbAddr, BIG_BLIND);
        this.roundBet = BIG_BLIND;

        // Deal hole cards — store all on host, send privately to humans
        for (const addr of activePlayers) {
            const cards = [this.deck.pop(), this.deck.pop()];
            this.allHoleCards[addr] = cards;
            if (addr === this.myAddress) {
                this.myHoleCards = cards;
            } else if (!addr.startsWith('bot:')) {
                SpixiAppSdk.sendNetworkData(
                    JSON.stringify({ type: MSG.HOLE_CARDS, cards }), addr
                );
            }
        }

        const stacks = {}, bets = {};
        for (const addr of activePlayers) {
            stacks[addr] = this.players[addr].stack;
            bets[addr] = this.players[addr].bet;
        }

        this._broadcast({
            type: MSG.START,
            host: this.myAddress,
            dealer: activePlayers[this.dealerIndex],
            sb: sbAddr, bb: bbAddr,
            players: activePlayers,
            stacks, bets, pot: this.pot
        });

        this.actionOrder = this._bettingOrder(activePlayers, (bbIndex + 1) % activePlayers.length);
        this.actionIndex = 0;
        this._requestNextAction();
    },

    _requestNextAction() {
        const addr = this._nextActiveInOrder();
        if (!addr) { this._advancePhase(); return; }

        this.currentTurnAddr = addr;
        const callAmount = Math.max(0, this.roundBet - (this.players[addr]?.bet || 0));
        this._broadcast({
            type: MSG.ACTION_REQ,
            address: addr, callAmount, pot: this.pot, roundBet: this.roundBet
        });

        // Auto-play for bots — host only
        if (this.isHost && addr.startsWith('bot:')) {
            setTimeout(() => this._autoBotAction(addr), 800 + Math.random() * 1400);
        }
    },

    _autoBotAction(addr) {
        if (!this.isHost || this.currentTurnAddr !== addr) return;
        const player = this.players[addr];
        if (!player || player.folded || player.allIn) return;

        const callAmount = Math.max(0, this.roundBet - player.bet);
        let action, amount = 0;

        if (callAmount === 0) {
            if (Math.random() < 0.35) { action = ACTION.RAISE; amount = BIG_BLIND * (1 + Math.floor(Math.random() * 3)); }
            else { action = ACTION.CHECK; }
        } else if (callAmount >= player.stack) {
            action = Math.random() < 0.5 ? ACTION.ALL_IN : ACTION.FOLD;
        } else {
            const r = Math.random();
            if (r < 0.2) action = ACTION.FOLD;
            else if (r < 0.65) action = ACTION.CALL;
            else { action = ACTION.RAISE; amount = callAmount + BIG_BLIND; }
        }

        this.processAction(addr, action, amount);
        this._broadcast({ type: MSG.PLAYER_ACTION, address: addr, action, amount });
    },

    _nextActiveInOrder() {
        const start = this.actionIndex;
        for (let i = 0; i < this.actionOrder.length; i++) {
            const idx = (start + i) % this.actionOrder.length;
            const addr = this.actionOrder[idx];
            if (!this.players[addr]?.folded && !this.players[addr]?.allIn) {
                this.actionIndex = (idx + 1) % this.actionOrder.length;
                if (i > 0 || this.actionIndex !== 0) return addr;
            }
        }
        return null;
    },

    processAction(addr, action, amount) {
        if (!this.isHost) return;
        if (addr !== this.currentTurnAddr) return;
        const player = this.players[addr];
        if (!player || player.folded || player.allIn) return;

        switch (action) {
            case ACTION.FOLD: player.folded = true; break;
            case ACTION.CHECK: break;
            case ACTION.CALL: {
                const toCall = Math.min(this.roundBet - player.bet, player.stack);
                this._placeBet(addr, toCall);
                break;
            }
            case ACTION.RAISE: {
                const toCall = this.roundBet - player.bet;
                const actual = Math.min(toCall + Math.max(amount, BIG_BLIND), player.stack);
                this._placeBet(addr, actual);
                this.roundBet = player.bet;
                const active = this._activePlayers();
                const myIdx = active.indexOf(addr);
                this.actionOrder = this._bettingOrder(active, (myIdx + 1) % active.length);
                this.actionIndex = 0;
                break;
            }
            case ACTION.ALL_IN: {
                this._placeBet(addr, player.stack);
                player.allIn = true;
                if (player.bet > this.roundBet) this.roundBet = player.bet;
                break;
            }
        }

        this._broadcastState();

        const stillActive = this._activePlayers().filter(a => !this.players[a].folded && !this.players[a].allIn);
        if (stillActive.length <= 1) { this._advancePhase(); return; }

        const allMatched = this._activePlayers()
            .filter(a => !this.players[a].folded && !this.players[a].allIn)
            .every(a => this.players[a].bet >= this.roundBet);

        if (allMatched) { this._advancePhase(); }
        else { this._requestNextAction(); }
    },

    _advancePhase() {
        for (const addr of Object.keys(this.players)) {
            this.pot += this.players[addr].bet;
            this.players[addr].bet = 0;
        }
        this.roundBet = 0;

        const active = this._activePlayers().filter(a => !this.players[a].folded);
        if (active.length <= 1) { this._endRound(active); return; }

        switch (this.phase) {
            case PHASE.PREFLOP:
                this.phase = PHASE.FLOP;
                this.communityCards = [this.deck.pop(), this.deck.pop(), this.deck.pop()];
                this._broadcastCommunity('flop'); break;
            case PHASE.FLOP:
                this.phase = PHASE.TURN;
                this.communityCards.push(this.deck.pop());
                this._broadcastCommunity('turn'); break;
            case PHASE.TURN:
                this.phase = PHASE.RIVER;
                this.communityCards.push(this.deck.pop());
                this._broadcastCommunity('river'); break;
            case PHASE.RIVER:
                this.phase = PHASE.SHOWDOWN;
                this._startShowdown(); return;
        }

        const sbIdx = (this.dealerIndex + 1) % active.length;
        this.actionOrder = this._bettingOrder(active, sbIdx);
        this.actionIndex = 0;
        this._requestNextAction();
    },

    _startShowdown() {
        const active = this._activePlayers().filter(a => !this.players[a].folded);
        // Reveal bot cards immediately from host's stored deck
        if (this.isHost) {
            for (const addr of active) {
                if (addr.startsWith('bot:') && this.allHoleCards[addr]) {
                    this.revealedHands[addr] = this.allHoleCards[addr];
                    this._broadcast({
                        type: MSG.SHOWDOWN_REVEAL,
                        address: addr,
                        cards: this.allHoleCards[addr]
                    });
                }
            }
        }
        this._broadcast({ type: MSG.SHOWDOWN_REVEAL, players: active, communityCards: this.communityCards });
        setTimeout(() => this._resolveShowdown(), 3000);
    },

    _resolveShowdown() {
        const active = this._activePlayers().filter(a => !this.players[a].folded);
        const holeCardsMap = {};
        for (const addr of active) {
            if (this.revealedHands[addr]) holeCardsMap[addr] = this.revealedHands[addr];
        }
        const { winners, hands } = PokerEngine.determineWinners(holeCardsMap, this.communityCards);
        this._endRound(winners, hands);
    },

    _endRound(winners, hands = {}) {
        const totalPot = this.pot + Object.values(this.players).reduce((s, p) => s + p.bet, 0);
        const share = Math.floor(totalPot / winners.length);
        for (const w of winners) { this.players[w].stack += share; }
        this.pot = 0;

        const handNames = {};
        for (const [addr, h] of Object.entries(hands)) { handNames[addr] = h?.name || ''; }

        this._broadcast({
            type: MSG.RESULT, winners, pot: totalPot, hands: handNames,
            stacks: Object.fromEntries(Object.entries(this.players).map(([a, p]) => [a, p.stack]))
        });

        for (const addr of Object.keys(this.players)) {
            if (this.players[addr].stack <= 0) {
                delete this.players[addr];
                this.allAddresses = this.allAddresses.filter(a => a !== addr);
            }
        }

        setTimeout(() => {
            const remaining = this._activePlayers();
            if (remaining.length >= 2) {
                this.dealerIndex = (this.dealerIndex + 1) % remaining.length;
                this._broadcast({ type: MSG.NEW_ROUND, dealer: remaining[this.dealerIndex] });
                setTimeout(() => this._startRound(), 2000);
            }
        }, 5000);
    },

    handleMessage(senderAddr, data) {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        switch (msg.type) {
            case MSG.JOIN: {
                // First claimHost received wins
                if (msg.claimHost && !this.hostAddress) {
                    this.hostAddress = msg.address;
                    this.isHost = (msg.address === this.myAddress);
                }
                // Add to allAddresses if new
                if (!this.allAddresses.includes(msg.address)) {
                    this.allAddresses.push(msg.address);
                }
                // Add to live player list
                if (!this.players[msg.address]) {
                    this.players[msg.address] = {
                        name: msg.name || this._shortAddr(msg.address),
                        stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
                        seatIndex: Object.keys(this.players).length,
                        connected: true, isBot: false
                    };
                }
                // Reply so late arrivals see us
                if (msg.address !== this.myAddress) {
                    this._send({
                        type: MSG.JOIN, address: this.myAddress,
                        name: this.players[this.myAddress]?.name,
                        claimHost: this.isHost
                    });
                }
                if (typeof App !== 'undefined') App.onPlayerJoined(msg.address);
                break;
            }

            case MSG.BOT_ADD: {
                if (!this.players[msg.address]) {
                    this.players[msg.address] = {
                        name: msg.name, stack: STARTING_STACK, bet: 0,
                        folded: false, allIn: false,
                        seatIndex: Object.keys(this.players).length,
                        connected: true, isBot: true
                    };
                }
                if (!this.allAddresses.includes(msg.address)) {
                    this.allAddresses.push(msg.address);
                }
                if (typeof App !== 'undefined') App.onPlayerJoined(msg.address);
                break;
            }

            case MSG.START:
                if (this.phase !== PHASE.LOBBY) break;
                this.phase = PHASE.PREFLOP;
                this.hostAddress = msg.host || senderAddr;
                this.isHost = (this.hostAddress === this.myAddress);
                this.pot = msg.pot;
                for (const addr of msg.players) {
                    if (this.players[addr]) {
                        this.players[addr].stack = msg.stacks[addr];
                        this.players[addr].bet = msg.bets[addr] || 0;
                        this.players[addr].folded = false;
                        this.players[addr].allIn = false;
                    }
                }
                if (typeof App !== 'undefined') App.onGameStarted(msg);
                break;

            case MSG.HOLE_CARDS:
                if (senderAddr === this.hostAddress) {
                    this.myHoleCards = msg.cards;
                    if (typeof App !== 'undefined') App.onHoleCards(msg.cards);
                }
                break;

            case MSG.COMMUNITY:
                this.communityCards = msg.cards;
                this.phase = msg.phase;
                if (typeof App !== 'undefined') App.onCommunityCards(msg.cards, msg.phase);
                break;

            case MSG.ACTION_REQ:
                this.currentTurnAddr = msg.address;
                this.pot = msg.pot;
                if (typeof App !== 'undefined') App.onActionRequest(msg.address, msg.callAmount, msg.pot, msg.roundBet);
                break;

            case MSG.PLAYER_ACTION:
                if (this.isHost && !msg.address?.startsWith('bot:')) {
                    this.processAction(msg.address, msg.action, msg.amount || 0);
                }
                if (typeof App !== 'undefined') App.onPlayerAction(msg.address, msg.action, msg.amount);
                break;

            case MSG.STATE:
                this.pot = msg.pot;
                for (const [addr, stack] of Object.entries(msg.stacks || {})) {
                    if (this.players[addr]) this.players[addr].stack = stack;
                }
                for (const [addr, bet] of Object.entries(msg.bets || {})) {
                    if (this.players[addr]) this.players[addr].bet = bet;
                }
                for (const [addr, folded] of Object.entries(msg.folded || {})) {
                    if (this.players[addr]) this.players[addr].folded = folded;
                }
                if (typeof App !== 'undefined') App.onStateUpdate(msg);
                break;

            case MSG.SHOWDOWN_REVEAL:
                if (msg.players) {
                    this.communityCards = msg.communityCards || this.communityCards;
                    if (!this.players[this.myAddress]?.folded) {
                        this._send({ type: MSG.SHOWDOWN_REVEAL, address: this.myAddress, cards: this.myHoleCards });
                    }
                    if (typeof App !== 'undefined') App.onShowdown(msg.players, msg.communityCards);
                } else if (msg.address && msg.cards) {
                    this.revealedHands[msg.address] = msg.cards;
                    if (typeof App !== 'undefined') App.onReveal(msg.address, msg.cards);
                }
                break;

            case MSG.RESULT:
                this.phase = PHASE.LOBBY;
                for (const [addr, stack] of Object.entries(msg.stacks || {})) {
                    if (this.players[addr]) this.players[addr].stack = stack;
                }
                if (typeof App !== 'undefined') App.onResult(msg.winners, msg.pot, msg.hands);
                break;

            case MSG.NEW_ROUND:
                if (typeof App !== 'undefined') App.onNewRound();
                break;

            case MSG.CHAT:
                if (typeof App !== 'undefined') App.onChat(senderAddr, msg.text);
                break;
        }
    },

    sendAction(action, amount = 0) {
        const msg = { type: MSG.PLAYER_ACTION, address: this.myAddress, action, amount };
        if (this.isHost) this.processAction(this.myAddress, action, amount);
        this._broadcast(msg);
    },

    sendChat(text) {
        this._broadcast({ type: MSG.CHAT, address: this.myAddress, text });
    },

    _activePlayers() {
        return Object.keys(this.players).filter(a => this.players[a]?.stack > 0);
    },

    _bettingOrder(players, startIdx) {
        return Array.from({ length: players.length }, (_, i) => players[(startIdx + i) % players.length]);
    },

    _placeBet(addr, amount) {
        const player = this.players[addr];
        if (!player) return;
        const actual = Math.min(amount, player.stack);
        player.bet = (player.bet || 0) + actual;
        player.stack -= actual;
    },

    _broadcastCommunity(phase) {
        this._broadcast({ type: MSG.COMMUNITY, cards: this.communityCards, phase });
    },

    _broadcastState() {
        const stacks = {}, bets = {}, folded = {};
        for (const [addr, p] of Object.entries(this.players)) {
            stacks[addr] = p.stack; bets[addr] = p.bet; folded[addr] = p.folded;
        }
        this._broadcast({ type: MSG.STATE, pot: this.pot, stacks, bets, folded });
    },

    _broadcast(msg) {
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
        this.handleMessage(this.myAddress, JSON.stringify(msg));
    },

    _send(msg) {
        SpixiAppSdk.sendNetworkData(JSON.stringify(msg));
    },

    _shortAddr(addr) {
        if (!addr) return 'Unknown';
        if (addr.startsWith('bot:')) return 'Bot ' + addr.split(':')[1];
        return addr.slice(0, 6) + '…' + addr.slice(-4);
    }
};
