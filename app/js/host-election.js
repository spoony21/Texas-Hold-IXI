// Host election — the player who opened the app first (smallest joinedAt) is host.
// Ties (or missing timestamps) are broken by lexicographic address order so both
// peers agree on the same result. Only humans participate; bots never host.
const HostElection = {
    elect() {
        if (GameState.phase !== PHASE.LOBBY) return;

        const humans = Object.keys(GameState.players)
            .filter(a => !GameState.players[a].isBot);

        let bestAddr = null, bestTime = Infinity;
        for (const addr of humans) {
            const t = GameState.players[addr].joinedAt ?? Infinity;
            if (t < bestTime || (t === bestTime && (bestAddr === null || addr < bestAddr))) {
                bestTime = t;
                bestAddr = addr;
            }
        }

        const hostAddr = bestAddr || GameState.myAddress;

        if (hostAddr !== GameState.hostAddress) {
            GameState.hostAddress = hostAddr;
            GameState.isHost      = (hostAddr === GameState.myAddress);
            GameEvents.emit('lobbyUpdated');
        }
    }
};
