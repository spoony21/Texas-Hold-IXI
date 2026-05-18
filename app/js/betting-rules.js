// Betting logic — pure state mutations for player actions (Single Responsibility).
// Reads and writes GameState; emits no events and calls no UI code.

const BettingRules = {
    activePlayers() {
        return Object.keys(GameState.players).filter(a => GameState.players[a]?.stack > 0);
    },

    bettingOrder(players, startIdx) {
        return Array.from({ length: players.length }, (_, i) => players[(startIdx + i) % players.length]);
    },

    nextActiveInOrder() {
        for (let i = 0; i < GameState.actionOrder.length; i++) {
            const idx = (GameState.actionIndex + i) % GameState.actionOrder.length;
            const addr = GameState.actionOrder[idx];
            if (!GameState.players[addr]?.folded && !GameState.players[addr]?.allIn) {
                GameState.actionIndex = (idx + 1) % GameState.actionOrder.length;
                return addr;
            }
        }
        return null;
    },

    placeBet(addr, amount) {
        const player = GameState.players[addr];
        if (!player) return;
        const actual = Math.min(amount, player.stack);
        player.bet = (player.bet || 0) + actual;
        player.stack -= actual;
    },

    // Mutates state only — callers must broadcast state and advance game flow afterwards.
    applyAction(addr, action, amount) {
        if (!GameState.isHost) return false;
        if (addr !== GameState.currentTurnAddr) return false;
        const player = GameState.players[addr];
        if (!player || player.folded || player.allIn) return false;

        switch (action) {
            case ACTION.FOLD:
                player.folded = true;
                break;

            case ACTION.CHECK:
                break;

            case ACTION.CALL: {
                const toCall = Math.min(GameState.roundBet - player.bet, player.stack);
                this.placeBet(addr, toCall);
                break;
            }

            case ACTION.RAISE: {
                const toCall  = GameState.roundBet - player.bet;
                const actual  = Math.min(toCall + Math.max(amount, BIG_BLIND), player.stack);
                this.placeBet(addr, actual);
                GameState.roundBet = player.bet;
                const active = this.activePlayers();
                const myIdx  = active.indexOf(addr);
                GameState.actionOrder = this.bettingOrder(active, (myIdx + 1) % active.length);
                GameState.actionIndex = 0;
                break;
            }

            case ACTION.ALL_IN:
                this.placeBet(addr, player.stack);
                player.allIn = true;
                if (player.bet > GameState.roundBet) GameState.roundBet = player.bet;
                break;
        }

        return true;
    }
};
