// Host election — determines which peer acts as game master (Single Responsibility).
// Earliest joinedAt wins; ties broken by lexicographically lower address.

const HostElection = {
    elect() {
        let bestAddr = null, bestTime = Infinity;

        for (const [addr, p] of Object.entries(GameState.players)) {
            if (p.isBot) continue;
            const t = p.joinedAt ?? Infinity;
            if (t < bestTime || (t === bestTime && (bestAddr === null || addr < bestAddr))) {
                bestTime = t;
                bestAddr = addr;
            }
        }

        if (!bestAddr) return;

        if (bestAddr !== GameState.hostAddress) {
            GameState.hostAddress = bestAddr;
            GameState.isHost      = (bestAddr === GameState.myAddress);
            GameEvents.emit('lobbyUpdated');
        }
    }
};
