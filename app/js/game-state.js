// Game constants and shared mutable state (Single Responsibility: state only, no logic).
// All other modules read/write this object; none duplicate these fields.

const PHASE  = { LOBBY: 'lobby', PREFLOP: 'preflop', FLOP: 'flop', TURN: 'turn', RIVER: 'river', SHOWDOWN: 'showdown' };
const ACTION = { FOLD: 'fold', CHECK: 'check', CALL: 'call', RAISE: 'raise', ALL_IN: 'allin' };
const MSG = {
    JOIN: 'join', START: 'start', HOLE_CARDS: 'hole_cards', COMMUNITY: 'community',
    ACTION_REQ: 'action_req', PLAYER_ACTION: 'player_action', STATE: 'state',
    SHOWDOWN_REVEAL: 'showdown_reveal', RESULT: 'result', NEW_ROUND: 'new_round',
    CHAT: 'chat', BOT_ADD: 'bot_add', LEAVE: 'leave', GAME_OVER: 'game_over'
};

const STARTING_STACK    = 1000;
const SMALL_BLIND       = 10;
const BIG_BLIND         = 20;
const MAX_PLAYERS       = 6;
const SHOWDOWN_DELAY_MS = 3000;
const RESULT_DELAY_MS   = 5000;
const NEW_ROUND_DELAY_MS = 2000;
const BOT_MIN_DELAY_MS  = 800;
const BOT_MAX_DELAY_MS  = 1400;

const GameState = {
    // Session identity
    myAddress:    null,
    sessionId:    null,

    // Host tracking — set when someone clicks "Start Game" (no pre-election)
    isHost:      false,
    hostAddress: null,
    _lobbyInterval: null,

    // Round state
    phase:          PHASE.LOBBY,
    players:        {},   // addr -> { name, stack, bet, folded, allIn, seatIndex, connected, isBot }
    dealerIndex:    0,
    pot:            0,
    communityCards: [],
    myHoleCards:    [],
    allHoleCards:   {},   // host-only: addr -> cards
    revealedHands:  {},
    currentTurnAddr: null,
    deck:           [],
    actionOrder:    [],
    actionIndex:    0,
    roundBet:       0,

    shortAddr(addr) {
        if (!addr) return 'Unknown';
        if (addr.startsWith('bot:')) return 'Bot ' + addr.split(':')[1];
        return addr.slice(0, 4) + '…' + addr.slice(-4);
    }
};
