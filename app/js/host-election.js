// Host election — deterministic, no clocks involved.
// The host is the lexicographically smallest human address in the lobby.
// Both peers agree on the same result without needing synchronised time.
const HostElection = {
    elect() {
        if (GameState.phase !== PHASE.LOBBY) return;

        const humans = Object.keys(GameState.players)
            .filter(a => !GameState.players[a].isBot)
            .sort();

        const hostAddr = humans[0] || GameState.myAddress;

        if (hostAddr !== GameState.hostAddress) {
            GameState.hostAddress = hostAddr;
            GameState.isHost      = (hostAddr === GameState.myAddress);
            GameEvents.emit('lobbyUpdated');
        }
    }
};
