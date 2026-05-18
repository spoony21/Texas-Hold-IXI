// Game table UI — renders the felt, seats, cards, pot, and action bar (Single Responsibility).
// Reads GameState and PokerEngine; never calls game logic or network code.

const GameUI = {
    // ── Chip rendering ────────────────────────────────────────────────────────

    renderChipStack(amount) {
        if (!amount || amount <= 0) return '';

        const denoms = [
            { cls: 'chip-gold',   value: 500 },
            { cls: 'chip-blue',   value: 100 },
            { cls: 'chip-purple', value: 25  },
            { cls: 'chip-green',  value: 5   },
            { cls: 'chip-white',  value: 1   },
        ];

        let remaining = amount, towers = '';
        const spacing = 7, chipH = 20;

        for (const d of denoms) {
            const count = Math.floor(remaining / d.value);
            if (count < 1) continue;
            const stack  = Math.min(count, 6);
            const towerH = chipH + (stack - 1) * spacing;
            let discs = '';
            for (let i = 0; i < stack; i++) {
                discs += `<div class="chip-disc ${d.cls}" style="bottom:${i * spacing}px"></div>`;
            }
            towers   += `<div class="chip-tower" style="height:${towerH}px">${discs}</div>`;
            remaining -= count * d.value;
            if (remaining <= 0) break;
        }

        return `<div class="chip-pile">${towers}<span class="chip-pile-label">${amount}</span></div>`;
    },

    updatePot(pot) {
        const text  = document.getElementById('pot-text');
        const chips = document.getElementById('pot-chips');
        if (text)  text.textContent = `Pot: ${pot}`;
        if (chips) chips.innerHTML  = pot > 0 ? this.renderChipStack(pot) : '';
    },

    // ── Table rendering ───────────────────────────────────────────────────────

    renderTable(myAddress) {
        const container = document.getElementById('player-seats');
        if (!container) return;
        container.innerHTML = '';

        const others = Object.keys(GameState.players).filter(a => a !== myAddress);
        const total  = others.length;

        others.forEach((addr, i) => {
            const p      = GameState.players[addr];
            const spread = Math.min(Math.PI * 0.8, Math.PI * (0.4 + (total - 1) * 0.2));
            const startA = -Math.PI / 2 - spread / 2;
            const angle  = total <= 1 ? -Math.PI / 2 : startA + (i / (total - 1)) * spread;
            const x = 50 + 38 * Math.cos(angle);
            const y = 30 + 22 * Math.sin(angle);

            const seat = document.createElement('div');
            seat.className = 'seat'
                + (p.folded ? ' folded' : '')
                + (addr === GameState.currentTurnAddr ? ' active-seat' : '');
            seat.style.left = `${x}%`;
            seat.style.top  = `${y}%`;

            const isHost = addr === GameState.hostAddress;
            const cards  = GameState.revealedHands[addr]
                ? GameState.revealedHands[addr].map(c => PokerEngine.cardHTML(c)).join('')
                : (!p.folded ? '<div class="card face-down sm">🂠</div><div class="card face-down sm">🂠</div>' : '');

            seat.innerHTML = `
                <div class="seat-cards">${cards}</div>
                <div class="seat-info">
                    <div class="seat-name">${p.name}${isHost ? ' 👑' : ''}${p.isBot ? ' 🤖' : ''}</div>
                    <div class="seat-stack">${p.stack}</div>
                    ${p.folded ? '<div class="folded-label">FOLDED</div>' : ''}
                    ${p.allIn  ? '<div class="allin-label">ALL IN</div>'  : ''}
                </div>
                ${p.bet > 0 ? `<div class="seat-bet-chips">${this.renderChipStack(p.bet)}</div>` : ''}`;
            container.appendChild(seat);
        });

        const myBet   = GameState.players[myAddress]?.bet   || 0;
        const myStack = GameState.players[myAddress]?.stack || 0;

        const myInfo = document.getElementById('my-info');
        if (myInfo) myInfo.textContent = `${myStack} chips`;

        const myBetChips = document.getElementById('my-bet-chips');
        if (myBetChips) myBetChips.innerHTML = myBet > 0 ? this.renderChipStack(myBet) : '';

        const myCardsEl = document.getElementById('my-cards');
        if (myCardsEl && GameState.myHoleCards.length > 0) {
            myCardsEl.innerHTML = GameState.myHoleCards.map(c => PokerEngine.cardHTML(c)).join('');
        }
    },

    // ── Action bar ────────────────────────────────────────────────────────────

    showActions(callAmount, myStack) {
        const actions = document.getElementById('actions');
        if (!actions) return;
        actions.style.display = 'flex';
        document.getElementById('btn-call').textContent = callAmount > 0 ? `Call ${callAmount}` : 'Check';
        const slider = document.getElementById('raise-slider');
        if (slider) {
            slider.max   = myStack;
            slider.value = Math.min(callAmount + BIG_BLIND, myStack);
        }
        this.updateRaiseDisplay();
    },

    hideActions() {
        const el = document.getElementById('actions');
        if (el) el.style.display = 'none';
    },

    updateRaiseDisplay() {
        const slider  = document.getElementById('raise-slider');
        const display = document.getElementById('raise-amount');
        if (slider && display) display.textContent = slider.value;
    },

    // ── Result banner ─────────────────────────────────────────────────────────

    showResult(winner, amount, handName) {
        const banner = document.getElementById('result-banner');
        if (!banner) return;
        banner.innerHTML = `<div class="result-inner">🏆 ${winner}<br><small>wins ${amount} chips</small>${handName ? `<br><small>${handName}</small>` : ''}</div>`;
        banner.classList.add('show');
    },

    hideResult() {
        document.getElementById('result-banner')?.classList.remove('show');
    },

    // ── Game log ──────────────────────────────────────────────────────────────

    addLog(text) {
        const log = document.getElementById('game-log');
        if (!log) return;
        const div = document.createElement('div');
        div.className   = 'log-entry';
        div.textContent = text;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
    }
};
