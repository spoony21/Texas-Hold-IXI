// Message handler registry — Open/Closed Principle.
// New message types are added by registering a new handler here, not by editing GameProtocol.
// Each handler receives (senderAddr, msg) and may mutate GameState, call GameFlow,
// or emit GameEvents. No direct UI calls.

const MessageHandlers = {
    [MSG.JOIN](sender, msg) {
        if (msg.address === GameState.myAddress) return;
        if (GameState.phase !== PHASE.LOBBY) return;

        const isNew = !GameState.players[msg.address];
        if (isNew) {
            GameState.players[msg.address] = {
                name: msg.name || GameState.shortAddr(msg.address),
                stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
                seatIndex: Object.keys(GameState.players).length,
                connected: true, isBot: false
            };
            GameEvents.emit('playerJoined', msg.address);

            // Reply once so the joining peer sees us without waiting for the next heartbeat
            GameProtocol._send({
                type: MSG.JOIN,
                address: GameState.myAddress,
                name: GameState.players[GameState.myAddress]?.name
            });
        }

        HostElection.elect();
        GameEvents.emit('lobbyUpdated');
    },

    [MSG.BOT_ADD](sender, msg) {
        if (!GameState.players[msg.address]) {
            GameState.players[msg.address] = {
                name: msg.name, stack: STARTING_STACK, bet: 0,
                folded: false, allIn: false,
                seatIndex: Object.keys(GameState.players).length,
                connected: true, isBot: true
            };
        }
        GameEvents.emit('playerJoined', msg.address);
    },

    [MSG.START](sender, msg) {
        if (GameState.phase !== PHASE.LOBBY) return;
        clearInterval(GameState._lobbyInterval);
        GameState._lobbyInterval = null;
        GameState.phase       = PHASE.PREFLOP;
        GameState.hostAddress = msg.host || sender;
        GameState.isHost      = (GameState.hostAddress === GameState.myAddress);
        GameState.pot         = msg.pot;

        for (const addr of msg.players) {
            if (!GameState.players[addr]) {
                GameState.players[addr] = {
                    name: addr.startsWith('bot:') ? 'Bot ' + addr.split(':')[1] : GameState.shortAddr(addr),
                    stack: msg.stacks[addr] ?? STARTING_STACK,
                    bet: msg.bets[addr] || 0,
                    folded: false, allIn: false,
                    seatIndex: Object.keys(GameState.players).length,
                    connected: true, isBot: addr.startsWith('bot:')
                };
            } else {
                GameState.players[addr].stack  = msg.stacks[addr];
                GameState.players[addr].bet    = msg.bets[addr] || 0;
                GameState.players[addr].folded = false;
                GameState.players[addr].allIn  = false;
            }
        }

        GameEvents.emit('gameStarted', msg);
    },

    [MSG.HOLE_CARDS](sender, msg) {
        if (sender === GameState.hostAddress) {
            GameState.myHoleCards = msg.cards;
            GameEvents.emit('holeCards', msg.cards);
        }
    },

    [MSG.COMMUNITY](sender, msg) {
        GameState.communityCards = msg.cards;
        GameState.phase          = msg.phase;
        GameEvents.emit('communityCards', msg.cards, msg.phase);
    },

    [MSG.ACTION_REQ](sender, msg) {
        GameState.currentTurnAddr = msg.address;
        GameState.pot             = msg.pot;
        GameEvents.emit('actionRequest', msg.address, msg.callAmount, msg.pot, msg.roundBet);
    },

    [MSG.PLAYER_ACTION](sender, msg) {
        if (GameState.isHost && !msg.address?.startsWith('bot:')) {
            GameFlow.handlePlayerAction(msg.address, msg.action, msg.amount || 0);
        }
        GameEvents.emit('playerAction', msg.address, msg.action, msg.amount);
    },

    [MSG.STATE](sender, msg) {
        GameState.pot = msg.pot;
        for (const [addr, stack] of Object.entries(msg.stacks  || {})) { if (GameState.players[addr]) GameState.players[addr].stack  = stack; }
        for (const [addr, bet]   of Object.entries(msg.bets    || {})) { if (GameState.players[addr]) GameState.players[addr].bet    = bet;   }
        for (const [addr, fold]  of Object.entries(msg.folded  || {})) { if (GameState.players[addr]) GameState.players[addr].folded = fold;  }
        GameEvents.emit('stateUpdate', msg);
    },

    [MSG.SHOWDOWN_REVEAL](sender, msg) {
        if (msg.players) {
            GameState.communityCards = msg.communityCards || GameState.communityCards;
            if (!GameState.players[GameState.myAddress]?.folded) {
                GameProtocol._send({ type: MSG.SHOWDOWN_REVEAL, address: GameState.myAddress, cards: GameState.myHoleCards });
            }
            GameEvents.emit('showdown', msg.players, msg.communityCards);
        } else if (msg.address && msg.cards) {
            GameState.revealedHands[msg.address] = msg.cards;
            GameEvents.emit('reveal', msg.address, msg.cards);
        }
    },

    [MSG.RESULT](sender, msg) {
        GameState.phase = PHASE.LOBBY;
        for (const [addr, stack] of Object.entries(msg.stacks || {})) {
            if (GameState.players[addr]) GameState.players[addr].stack = stack;
        }
        GameEvents.emit('result', msg.winners, msg.pot, msg.hands);
    },

    [MSG.NEW_ROUND](sender, msg) {
        GameState.myHoleCards = [];
        GameEvents.emit('newRound');
    },

    [MSG.CHAT](sender, msg) {
        GameEvents.emit('chat', sender, msg.text);
    },

    [MSG.LEAVE](sender, msg) {
        const leaver = GameState.players[msg.address];
        if (!leaver) return;

        if (GameState.phase !== PHASE.LOBBY) {
            GameState.pot += leaver.stack;
            leaver.stack   = 0;
            leaver.folded  = true;
        }
        delete GameState.players[msg.address];
        HostElection.elect();

        if (GameState.isHost && GameState.phase !== PHASE.LOBBY) {
            if (GameState.currentTurnAddr === msg.address) {
                const canAct = BettingRules.activePlayers()
                    .filter(a => !GameState.players[a]?.folded && !GameState.players[a]?.allIn);
                if (canAct.length <= 1) { GameFlow.advancePhase(); }
                else                   { GameFlow.requestNextAction(); }
            }
            const unfolded = BettingRules.activePlayers().filter(a => !GameState.players[a]?.folded);
            if (unfolded.length <= 1) GameFlow._endRound(unfolded);
        }

        GameEvents.emit('playerLeft', msg.address, leaver.name || GameState.shortAddr(msg.address));
    },

    [MSG.GAME_OVER](sender, msg) {
        clearInterval(GameState._lobbyInterval);
        GameState._lobbyInterval = null;

        GameState.phase          = PHASE.LOBBY;
        GameState.pot            = 0;
        GameState.communityCards = [];
        GameState.revealedHands  = {};
        GameState.myHoleCards    = [];
        GameState.allHoleCards   = {};
        GameState.currentTurnAddr = null;
        GameState.deck           = [];
        GameState.actionOrder    = [];

        for (const addr of Object.keys(GameState.players)) {
            GameState.players[addr].stack  = STARTING_STACK;
            GameState.players[addr].bet    = 0;
            GameState.players[addr].folded = false;
            GameState.players[addr].allIn  = false;
        }

        // Re-add self in case _endRound deleted us when the host went bust
        if (!GameState.players[GameState.myAddress]) {
            GameState.players[GameState.myAddress] = {
                name: GameState.shortAddr(GameState.myAddress),
                stack: STARTING_STACK, bet: 0, folded: false, allIn: false,
                seatIndex: 0, connected: true, isBot: false
            };
        }

        GameState.isHost      = false;
        GameState.hostAddress = null;
        GameProtocol._startLobbyBroadcast();
        HostElection.elect();
        GameEvents.emit('gameOver', msg.winner);
    }
};
