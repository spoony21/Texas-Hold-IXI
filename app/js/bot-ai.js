// Bot AI — automated decision-making for bot players (Single Responsibility).
// References GameProtocol and GameFlow at call-time (not at parse-time), so load
// order is fine even though this file is parsed before those modules.

const BotAI = {
    scheduleAction(addr) {
        const delay = BOT_MIN_DELAY_MS + Math.random() * BOT_MAX_DELAY_MS;
        setTimeout(() => this._act(addr), delay);
    },

    _act(addr) {
        if (!GameState.isHost || GameState.currentTurnAddr !== addr) return;
        const player = GameState.players[addr];
        if (!player || player.folded || player.allIn) return;

        const callAmount = Math.max(0, GameState.roundBet - player.bet);
        let action, amount = 0;

        if (callAmount === 0) {
            if (Math.random() < 0.35) { action = ACTION.RAISE; amount = BIG_BLIND * (1 + Math.floor(Math.random() * 3)); }
            else { action = ACTION.CHECK; }
        } else if (callAmount >= player.stack) {
            action = Math.random() < 0.5 ? ACTION.ALL_IN : ACTION.FOLD;
        } else {
            const r = Math.random();
            if (r < 0.2)       { action = ACTION.FOLD; }
            else if (r < 0.65) { action = ACTION.CALL; }
            else               { action = ACTION.RAISE; amount = callAmount + BIG_BLIND; }
        }

        GameFlow.handlePlayerAction(addr, action, amount);
        GameProtocol._broadcast({ type: MSG.PLAYER_ACTION, address: addr, action, amount });
    }
};
