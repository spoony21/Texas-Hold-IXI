// Main application — UI logic and Spixi event handlers

const App = {
    myAddress: null,
    actionCallAmount: 0,
    chatOpen: false,

    init() {
        SpixiAppSdk.onInit = (sessionId, myAddress, ...remoteAddresses) => {
            this.myAddress = myAddress;
            GameProtocol.init(sessionId, myAddress, remoteAddresses);
            this.showScreen('lobby');
            this.renderLobby();
        };

        SpixiAppSdk.onNetworkData = (senderAddr, data) => {
            GameProtocol.handleMessage(senderAddr, data);
        };

        SpixiAppSdk.fireOnLoad();
    },

    // ─── Screen management ───────────────────────────────────────────────────

    showScreen(name) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        document.getElementById('screen-' + name)?.classList.add('active');
    },

    // ─── Lobby ───────────────────────────────────────────────────────────────

    renderLobby() {
        const list = document.getElementById('lobby-players');
        if (!list) return;

        const connected = Object.entries(GameProtocol.players);
        const count = connected.length;
        const atMax = count >= MAX_PLAYERS;

        // Player list — only live players (sent JOIN)
        list.innerHTML = '';
        for (const [addr, p] of connected) {
            const isMe = addr === GameProtocol.myAddress;
            const isHost = addr === GameProtocol.hostAddress;
            const isBot = p.isBot;
            const li = document.createElement('li');
            let badges = '';
            if (isHost) badges += ' <span class="badge badge-host">HOST</span>';
            if (isMe) badges += ' <span class="badge badge-you">YOU</span>';
            if (isBot) badges += ' <span class="badge badge-bot">BOT</span>';
            li.innerHTML = `<span class="player-dot${isBot ? ' bot-dot' : ''}"></span>${p.name}${badges}<span class="chip-count">${p.stack}</span>`;
            list.appendChild(li);
        }

        document.getElementById('lobby-count').textContent = `${count} / ${MAX_PLAYERS} players`;

        // Only show host controls once host is confirmed (hostAddress is set)
        // isHost alone can be true on both devices during the race — wait for tiebreak
        const hostConfirmed = GameProtocol.hostAddress !== null;
        const iAmHost = GameProtocol.isHost && hostConfirmed;
        const hostControls = document.getElementById('host-controls');
        const guestControls = document.getElementById('guest-controls');
        if (hostControls) hostControls.style.display = iAmHost ? 'flex' : 'none';
        if (guestControls) guestControls.style.display = iAmHost ? 'none' : 'flex';

        // Start button — host only, needs ≥2 players
        const startBtn = document.getElementById('btn-start');
        if (startBtn) {
            const canStart = count >= 2;
            startBtn.disabled = !canStart;
            startBtn.textContent = canStart ? `▶  Start Game` : `▶  Need ${2 - count} more player${2 - count !== 1 ? 's' : ''}`;
        }

        // Add bot button — host only, not at max
        const addBotBtn = document.getElementById('btn-add-bot');
        if (addBotBtn) addBotBtn.disabled = atMax;

        // Invite button — both host and guest, not at max
        document.querySelectorAll('.btn-invite').forEach(b => {
            b.disabled = atMax;
            b.textContent = atMax ? '🚫 Table Full' : '👥 Invite Player';
        });
    },

    onPlayerJoined(addr) {
        this.renderLobby();
        const p = GameProtocol.players[addr];
        const label = p?.isBot ? `${p.name} joined as a bot` : `${p?.name || GameProtocol._shortAddr(addr)} joined the table`;
        this.addLobbyLog(label);
    },

    addLobbyLog(text) {
        const el = document.getElementById('lobby-log');
        if (!el) return;
        const div = document.createElement('div');
        div.className = 'lobby-log-entry';
        div.textContent = text;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    },

    // ─── Invite modal ────────────────────────────────────────────────────────

    showInvite() {
        const modal = document.getElementById('invite-modal');
        if (!modal) return;
        const input = document.getElementById('invite-address');
        if (input) {
            input.value = GameProtocol.myAddress || '—';
        }
        // Reset copy state
        const btn = document.getElementById('btn-copy-addr');
        if (btn) { btn.textContent = 'Copy'; btn.classList.remove('copied'); }
        const feedback = document.getElementById('invite-copy-feedback');
        if (feedback) feedback.textContent = '';
        modal.classList.add('open');
        // Auto-select address so user can copy manually if clipboard API is unavailable
        setTimeout(() => input?.select(), 80);
    },

    closeInvite() {
        document.getElementById('invite-modal')?.classList.remove('open');
    },

    copyAddress() {
        const addr = GameProtocol.myAddress;
        if (!addr || addr === '—') return;

        const btn = document.getElementById('btn-copy-addr');
        const feedback = document.getElementById('invite-copy-feedback');

        const onSuccess = () => {
            if (btn) { btn.textContent = '✓ Done'; btn.classList.add('copied'); }
            if (feedback) feedback.textContent = '✓ Address copied to clipboard';
            // Reset after 2.5 s so user can copy again
            setTimeout(() => {
                if (btn) { btn.textContent = 'Copy'; btn.classList.remove('copied'); }
                if (feedback) feedback.textContent = '';
            }, 2500);
        };

        const onFail = () => {
            // Fallback: select the input so the user can copy manually
            const input = document.getElementById('invite-address');
            input?.select();
            if (feedback) feedback.textContent = 'Select all + copy manually';
        };

        // 1. Modern async clipboard (works in most browsers)
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(addr).then(onSuccess).catch(() => {
                // 2. execCommand fallback (works in WebViews that block navigator.clipboard)
                this._execCommandCopy(addr) ? onSuccess() : onFail();
            });
        } else {
            // 2. execCommand fallback directly
            this._execCommandCopy(addr) ? onSuccess() : onFail();
        }
    },

    _execCommandCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        return ok;
    },

    addBot() {
        GameProtocol.addBot();
    },

    // ─── Game started ────────────────────────────────────────────────────────

    onGameStarted(msg) {
        this.showScreen('game');
        this.renderTable();
        this.addLog(`New hand — Dealer: ${GameProtocol._shortAddr(msg.dealer)}`);
        document.getElementById('actions').style.display = 'none';
    },

    onHoleCards(cards) {
        const el = document.getElementById('my-cards');
        if (!el) return;
        el.innerHTML = cards.map(c => PokerEngine.cardHTML(c)).join('');
        el.classList.add('card-deal');
    },

    onCommunityCards(cards, phase) {
        const el = document.getElementById('community-cards');
        if (!el) return;
        el.innerHTML = cards.map(c => PokerEngine.cardHTML(c)).join('');
        this.addLog(`--- ${phase.toUpperCase()} ---`);
        this.renderTable();
    },

    onActionRequest(addr, callAmount, pot, roundBet) {
        this.actionCallAmount = callAmount;
        document.getElementById('pot-display').textContent = `Pot: ${pot}`;
        this.renderTable();

        const isMyTurn = addr === this.myAddress;
        const actions = document.getElementById('actions');
        if (!actions) return;
        actions.style.display = isMyTurn ? 'flex' : 'none';

        if (isMyTurn) {
            document.getElementById('btn-call').textContent = callAmount > 0 ? `Call ${callAmount}` : 'Check';
            const myStack = GameProtocol.players[this.myAddress]?.stack || 0;
            document.getElementById('raise-slider').max = myStack;
            document.getElementById('raise-slider').value = Math.min(callAmount + BIG_BLIND, myStack);
            this.updateRaiseDisplay();
        }
        this.renderTable();
    },

    onPlayerAction(addr, action, amount) {
        const name = GameProtocol.players[addr]?.name || GameProtocol._shortAddr(addr);
        let msg = `${name}: ${action.toUpperCase()}`;
        if (amount > 0) msg += ` ${amount}`;
        this.addLog(msg);
        this.renderTable();
    },

    onStateUpdate(state) {
        document.getElementById('pot-display').textContent = `Pot: ${state.pot}`;
        this.renderTable();
    },

    onShowdown(players, communityCards) {
        this.addLog('--- SHOWDOWN ---');
        document.getElementById('actions').style.display = 'none';
        this.renderTable();
    },

    onReveal(addr, cards) {
        const name = GameProtocol.players[addr]?.name || GameProtocol._shortAddr(addr);
        this.addLog(`${name} shows: ${cards.map(c => PokerEngine.cardLabel(c)).join(' ')}`);
        this.renderTable();
    },

    onResult(winners, pot, hands) {
        const winNames = winners.map(a => GameProtocol.players[a]?.name || GameProtocol._shortAddr(a));
        const share = Math.floor(pot / winners.length);
        this.addLog(`🏆 ${winNames.join(' & ')} wins ${share} chips! (${winners.map(w => hands[w]).filter(Boolean).join(', ')})`);
        document.getElementById('actions').style.display = 'none';
        this.renderTable();
        this.showResult(winNames.join(' & '), share, winners.map(w => hands[w]).filter(Boolean).join(', '));
    },

    onNewRound() {
        this.addLog('New round starting…');
        document.getElementById('result-banner')?.classList.remove('show');
        document.getElementById('my-cards').innerHTML = '<div class="card face-down">🂠</div><div class="card face-down">🂠</div>';
        document.getElementById('community-cards').innerHTML = '';
        document.getElementById('actions').style.display = 'none';
    },

    onChat(addr, text) {
        const name = GameProtocol.players[addr]?.name || GameProtocol._shortAddr(addr);
        this.addChatMessage(name, text);
    },

    // ─── Table rendering ─────────────────────────────────────────────────────

    renderTable() {
        const container = document.getElementById('player-seats');
        if (!container) return;
        container.innerHTML = '';

        const others = Object.keys(GameProtocol.players).filter(a => a !== this.myAddress);
        const total = others.length;

        others.forEach((addr, i) => {
            const p = GameProtocol.players[addr];
            const angle = (i / Math.max(total, 1)) * Math.PI;
            const x = 50 + 42 * Math.cos(Math.PI + angle);
            const y = 22 + 32 * Math.sin(Math.PI + angle);

            const seat = document.createElement('div');
            seat.className = 'seat'
                + (p.folded ? ' folded' : '')
                + (addr === GameProtocol.currentTurnAddr ? ' active-seat' : '');
            seat.style.left = `${x}%`;
            seat.style.top = `${y}%`;

            const isHost = addr === GameProtocol.hostAddress;
            const cards = GameProtocol.revealedHands[addr]
                ? GameProtocol.revealedHands[addr].map(c => PokerEngine.cardHTML(c)).join('')
                : (!p.folded ? '<div class="card face-down sm">🂠</div><div class="card face-down sm">🂠</div>' : '');

            seat.innerHTML = `
                <div class="seat-cards">${cards}</div>
                <div class="seat-info">
                    <div class="seat-name">${p.name}${isHost ? ' 👑' : ''}${p.isBot ? ' 🤖' : ''}</div>
                    <div class="seat-stack">${p.stack}${p.bet > 0 ? ` <span class="bet-chip">${p.bet}</span>` : ''}</div>
                    ${p.folded ? '<div class="folded-label">FOLDED</div>' : ''}
                    ${p.allIn ? '<div class="allin-label">ALL IN</div>' : ''}
                </div>`;
            container.appendChild(seat);
        });

        const myBet = GameProtocol.players[this.myAddress]?.bet || 0;
        const myStack = GameProtocol.players[this.myAddress]?.stack || 0;
        const myInfo = document.getElementById('my-info');
        if (myInfo) {
            myInfo.innerHTML = `${myStack} chips${myBet > 0 ? ` <span class="bet-chip">${myBet}</span>` : ''}`;
        }
    },

    showResult(winner, amount, handName) {
        const banner = document.getElementById('result-banner');
        if (!banner) return;
        banner.innerHTML = `<div class="result-inner">🏆 ${winner}<br><small>wins ${amount} chips</small>${handName ? `<br><small>${handName}</small>` : ''}</div>`;
        banner.classList.add('show');
    },

    // ─── Actions ─────────────────────────────────────────────────────────────

    fold()  { GameProtocol.sendAction(ACTION.FOLD);  document.getElementById('actions').style.display = 'none'; },
    check() { GameProtocol.sendAction(ACTION.CHECK); document.getElementById('actions').style.display = 'none'; },
    call()  { GameProtocol.sendAction(ACTION.CALL, this.actionCallAmount); document.getElementById('actions').style.display = 'none'; },
    raise() {
        const amount = parseInt(document.getElementById('raise-slider').value, 10);
        GameProtocol.sendAction(ACTION.RAISE, amount);
        document.getElementById('actions').style.display = 'none';
    },
    allIn() { GameProtocol.sendAction(ACTION.ALL_IN); document.getElementById('actions').style.display = 'none'; },

    updateRaiseDisplay() {
        const slider = document.getElementById('raise-slider');
        const display = document.getElementById('raise-amount');
        if (slider && display) display.textContent = slider.value;
    },

    // ─── Chat ────────────────────────────────────────────────────────────────

    toggleChat() {
        this.chatOpen = !this.chatOpen;
        document.getElementById('chat-panel').classList.toggle('open', this.chatOpen);
    },

    sendChat() {
        const input = document.getElementById('chat-input');
        if (!input || !input.value.trim()) return;
        GameProtocol.sendChat(input.value.trim());
        this.addChatMessage('You', input.value.trim());
        input.value = '';
    },

    addChatMessage(name, text) {
        const log = document.getElementById('chat-log');
        if (!log) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<b>${name}:</b> ${text}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
        document.getElementById('btn-chat')?.classList.add('flash');
        setTimeout(() => document.getElementById('btn-chat')?.classList.remove('flash'), 1000);
    },

    addLog(text) {
        const log = document.getElementById('game-log');
        if (!log) return;
        const div = document.createElement('div');
        div.className = 'log-entry';
        div.textContent = text;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
