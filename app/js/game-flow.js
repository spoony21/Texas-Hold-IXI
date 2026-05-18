// Game flow — manages round lifecycle and phase transitions (Single Responsibility).
// Calls GameProtocol._broadcast for network messages and emits GameEvents for UI updates.

const GameFlow = {
    startRound() {
        GameState.phase         = PHASE.PREFLOP;
        GameState.pot           = 0;
        GameState.communityCards = [];
        GameState.revealedHands  = {};
        GameState.allHoleCards   = {};
        GameState.deck           = PokerEngine.shuffle(PokerEngine.createDeck());

        const active = BettingRules.activePlayers();
        for (const addr of active) {
            GameState.players[addr].bet    = 0;
            GameState.players[addr].folded = false;
            GameState.players[addr].allIn  = false;
        }

        const sbIdx  = (GameState.dealerIndex + 1) % active.length;
        const bbIdx  = (GameState.dealerIndex + 2) % active.length;
        const sbAddr = active[sbIdx];
        const bbAddr = active[bbIdx];

        BettingRules.placeBet(sbAddr, SMALL_BLIND);
        BettingRules.placeBet(bbAddr, BIG_BLIND);
        GameState.roundBet = BIG_BLIND;

        for (const addr of active) {
            const cards = [GameState.deck.pop(), GameState.deck.pop()];
            GameState.allHoleCards[addr] = cards;
            if (addr === GameState.myAddress) GameState.myHoleCards = cards;
        }

        const stacks = {}, bets = {};
        for (const addr of active) {
            stacks[addr] = GameState.players[addr].stack;
            bets[addr]   = GameState.players[addr].bet;
        }

        const startMsg = {
            type: MSG.START,
            host: GameState.myAddress,
            dealer: active[GameState.dealerIndex],
            sb: sbAddr, bb: bbAddr,
            players: active, stacks, bets, pot: GameState.pot
        };
        GameProtocol._broadcast(startMsg);

        // Unicast hole cards — bots never receive network messages, so skip them
        for (const addr of active) {
            if (addr !== GameState.myAddress && !addr.startsWith('bot:')) {
                SpixiAppSdk.sendNetworkData(
                    JSON.stringify({ type: MSG.HOLE_CARDS, cards: GameState.allHoleCards[addr] }), addr
                );
            }
        }

        // The host's START echo is blocked by the phase guard in handleMessage, so
        // trigger the host UI directly here instead of going through the message loop.
        GameEvents.emit('gameStarted', startMsg);
        GameEvents.emit('holeCards', GameState.myHoleCards);

        GameState.actionOrder = BettingRules.bettingOrder(active, (bbIdx + 1) % active.length);
        GameState.actionIndex = 0;
        this.requestNextAction();
    },

    requestNextAction() {
        const addr = BettingRules.nextActiveInOrder();
        if (!addr) { this.advancePhase(); return; }

        GameState.currentTurnAddr = addr;
        const callAmount = Math.max(0, GameState.roundBet - (GameState.players[addr]?.bet || 0));
        GameProtocol._broadcast({
            type: MSG.ACTION_REQ,
            address: addr, callAmount, pot: GameState.pot, roundBet: GameState.roundBet
        });

        if (GameState.isHost && addr.startsWith('bot:')) {
            BotAI.scheduleAction(addr);
        }
    },

    // Called after BettingRules.applyAction — broadcasts updated state then advances.
    handlePlayerAction(addr, action, amount) {
        if (!BettingRules.applyAction(addr, action, amount)) return;

        this._broadcastState();

        const canAct = BettingRules.activePlayers()
            .filter(a => !GameState.players[a].folded && !GameState.players[a].allIn);

        if (canAct.length <= 1) { this.advancePhase(); return; }

        const allMatched = canAct.every(a => GameState.players[a].bet >= GameState.roundBet);
        if (allMatched) { this.advancePhase(); }
        else            { this.requestNextAction(); }
    },

    advancePhase() {
        for (const addr of Object.keys(GameState.players)) {
            GameState.pot += GameState.players[addr].bet;
            GameState.players[addr].bet = 0;
        }
        GameState.roundBet = 0;

        const active = BettingRules.activePlayers().filter(a => !GameState.players[a].folded);
        if (active.length <= 1) { this._endRound(active); return; }

        switch (GameState.phase) {
            case PHASE.PREFLOP:
                GameState.phase = PHASE.FLOP;
                GameState.communityCards = [GameState.deck.pop(), GameState.deck.pop(), GameState.deck.pop()];
                this._broadcastCommunity();
                break;
            case PHASE.FLOP:
                GameState.phase = PHASE.TURN;
                GameState.communityCards.push(GameState.deck.pop());
                this._broadcastCommunity();
                break;
            case PHASE.TURN:
                GameState.phase = PHASE.RIVER;
                GameState.communityCards.push(GameState.deck.pop());
                this._broadcastCommunity();
                break;
            case PHASE.RIVER:
                GameState.phase = PHASE.SHOWDOWN;
                this._startShowdown();
                return;
        }

        const sbIdx = (GameState.dealerIndex + 1) % active.length;
        GameState.actionOrder = BettingRules.bettingOrder(active, sbIdx);
        GameState.actionIndex = 0;
        this.requestNextAction();
    },

    _startShowdown() {
        const active = BettingRules.activePlayers().filter(a => !GameState.players[a].folded);

        if (GameState.isHost) {
            for (const addr of active) {
                if (addr.startsWith('bot:') && GameState.allHoleCards[addr]) {
                    GameState.revealedHands[addr] = GameState.allHoleCards[addr];
                    GameProtocol._broadcast({
                        type: MSG.SHOWDOWN_REVEAL,
                        address: addr,
                        cards: GameState.allHoleCards[addr]
                    });
                }
            }
        }

        GameProtocol._broadcast({
            type: MSG.SHOWDOWN_REVEAL,
            players: active,
            communityCards: GameState.communityCards
        });

        setTimeout(() => this._resolveShowdown(), SHOWDOWN_DELAY_MS);
    },

    _resolveShowdown() {
        const active = BettingRules.activePlayers().filter(a => !GameState.players[a].folded);
        const holeCardsMap = {};
        for (const addr of active) {
            if (GameState.revealedHands[addr]) holeCardsMap[addr] = GameState.revealedHands[addr];
        }
        const { winners, hands } = PokerEngine.determineWinners(holeCardsMap, GameState.communityCards);
        this._endRound(winners, hands);
    },

    _endRound(winners, hands = {}) {
        const totalPot = GameState.pot + Object.values(GameState.players).reduce((s, p) => s + p.bet, 0);
        const share    = Math.floor(totalPot / winners.length);
        for (const w of winners) GameState.players[w].stack += share;
        GameState.pot = 0;

        const handNames = {};
        for (const [addr, h] of Object.entries(hands)) handNames[addr] = h?.name || '';

        GameProtocol._broadcast({
            type: MSG.RESULT, winners, pot: totalPot, hands: handNames,
            stacks: Object.fromEntries(Object.entries(GameState.players).map(([a, p]) => [a, p.stack]))
        });

        for (const addr of Object.keys(GameState.players)) {
            if (GameState.players[addr].stack <= 0) {
                delete GameState.players[addr];
                GameState.allAddresses = GameState.allAddresses.filter(a => a !== addr);
            }
        }

        setTimeout(() => {
            const remaining = BettingRules.activePlayers();
            if (remaining.length >= 2) {
                GameState.dealerIndex = (GameState.dealerIndex + 1) % remaining.length;
                GameProtocol._broadcast({ type: MSG.NEW_ROUND, dealer: remaining[GameState.dealerIndex] });
                setTimeout(() => this.startRound(), NEW_ROUND_DELAY_MS);
            } else if (GameState.isHost) {
                this._broadcastGameOver(remaining[0] || null);
            }
        }, RESULT_DELAY_MS);
    },

    _broadcastGameOver(winnerAddr) {
        if (winnerAddr && GameState.players[winnerAddr]) {
            GameState.players[winnerAddr].stack += GameState.pot;
            GameState.pot = 0;
        }
        const stacks = {};
        for (const addr of Object.keys(GameState.players)) {
            GameState.players[addr].stack = STARTING_STACK;
            stacks[addr] = STARTING_STACK;
        }
        GameProtocol._broadcast({ type: MSG.GAME_OVER, winner: winnerAddr, stacks });
    },

    _broadcastCommunity() {
        GameProtocol._broadcast({ type: MSG.COMMUNITY, cards: GameState.communityCards, phase: GameState.phase });
    },

    _broadcastState() {
        const stacks = {}, bets = {}, folded = {};
        for (const [addr, p] of Object.entries(GameState.players)) {
            stacks[addr]  = p.stack;
            bets[addr]    = p.bet;
            folded[addr]  = p.folded;
        }
        GameProtocol._broadcast({ type: MSG.STATE, pot: GameState.pot, stacks, bets, folded });
    }
};
