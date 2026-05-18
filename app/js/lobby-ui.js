// Lobby UI — renders the pre-game lobby and invite modal (Single Responsibility).
// Subscribes to GameEvents; never imports game logic directly.

const LobbyUI = {
    render() {
        const list = document.getElementById('lobby-players');
        if (!list) return;

        const joinBanner    = document.getElementById('join-banner');
        const hostControls  = document.getElementById('host-controls');
        const guestControls = document.getElementById('guest-controls');

        // Show join prompt until the player explicitly confirms — hide normal controls.
        if (joinBanner) joinBanner.style.display = GameState.hasJoinedLobby ? 'none' : 'flex';

        if (!GameState.hasJoinedLobby) {
            if (hostControls)  hostControls.style.display  = 'none';
            if (guestControls) guestControls.style.display = 'none';
            return;
        }

        const entries  = Object.entries(GameState.players);
        const count    = entries.length;
        const atMax    = count >= MAX_PLAYERS;

        list.innerHTML = '';
        for (const [addr, p] of entries) {
            const isMe   = addr === GameState.myAddress;
            const isHost = addr === GameState.hostAddress;
            let badges   = '';
            if (isHost) badges += ' <span class="badge badge-host">HOST</span>';
            if (isMe)   badges += ' <span class="badge badge-you">YOU</span>';
            if (p.isBot) badges += ' <span class="badge badge-bot">BOT</span>';
            const li = document.createElement('li');
            li.innerHTML = `<span class="player-dot${p.isBot ? ' bot-dot' : ''}"></span>${p.name}${badges}<span class="chip-count">${p.stack}</span>`;
            list.appendChild(li);
        }

        document.getElementById('lobby-count').textContent = `${count} / ${MAX_PLAYERS} players`;

        const hostConfirmed = GameState.hostAddress !== null;
        const iAmHost       = GameState.isHost && hostConfirmed;

        if (hostControls)  hostControls.style.display  = iAmHost ? 'flex' : 'none';
        if (guestControls) guestControls.style.display = iAmHost ? 'none' : 'flex';

        const startBtn = document.getElementById('btn-start');
        if (startBtn) {
            const humanCount = Object.values(GameState.players).filter(p => !p.isBot).length;
            const botCount   = Object.values(GameState.players).filter(p => p.isBot).length;
            const canStart   = count >= 2;
            startBtn.disabled = !canStart;
            if (canStart) {
                startBtn.textContent = '▶  Start Game';
            } else if (humanCount === 1 && botCount === 0) {
                startBtn.textContent = '▶  Add a bot or invite a player';
            } else {
                const need = 2 - count;
                startBtn.textContent = `▶  Need ${need} more player${need !== 1 ? 's' : ''}`;
            }
        }

        const addBotBtn = document.getElementById('btn-add-bot');
        if (addBotBtn) addBotBtn.disabled = atMax;

        document.querySelectorAll('.btn-invite').forEach(b => {
            b.disabled   = atMax;
            b.textContent = atMax ? '🚫 Table Full' : '👥 Invite Player';
        });
    },

    addLog(text) {
        const el = document.getElementById('lobby-log');
        if (!el) return;
        const div = document.createElement('div');
        div.className   = 'lobby-log-entry';
        div.textContent = text;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    },

    showInvite() {
        const modal = document.getElementById('invite-modal');
        if (!modal) return;
        const input = document.getElementById('invite-address');
        if (input) input.value = GameState.myAddress || '—';
        const btn      = document.getElementById('btn-copy-addr');
        const feedback = document.getElementById('invite-copy-feedback');
        if (btn)      { btn.textContent = 'Copy'; btn.classList.remove('copied'); }
        if (feedback) feedback.textContent = '';
        modal.classList.add('open');
        setTimeout(() => input?.select(), 80);
    },

    closeInvite() {
        document.getElementById('invite-modal')?.classList.remove('open');
    },

    copyAddress() {
        const addr = GameState.myAddress;
        if (!addr || addr === '—') return;

        const btn      = document.getElementById('btn-copy-addr');
        const feedback = document.getElementById('invite-copy-feedback');

        const onSuccess = () => {
            if (btn)      { btn.textContent = '✓ Done'; btn.classList.add('copied'); }
            if (feedback) feedback.textContent = '✓ Address copied to clipboard';
            setTimeout(() => {
                if (btn)      { btn.textContent = 'Copy'; btn.classList.remove('copied'); }
                if (feedback) feedback.textContent = '';
            }, 2500);
        };

        const onFail = () => {
            document.getElementById('invite-address')?.select();
            if (feedback) feedback.textContent = 'Select all + copy manually';
        };

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(addr).then(onSuccess).catch(() => {
                this._execCommandCopy(addr) ? onSuccess() : onFail();
            });
        } else {
            this._execCommandCopy(addr) ? onSuccess() : onFail();
        }
    },

    _execCommandCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
        ta.setAttribute('readonly', '');
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
        return ok;
    }
};
