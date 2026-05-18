// Chat UI — manages the chat panel (Single Responsibility).
// Calls GameProtocol.sendChat for outgoing messages; receives incoming via GameEvents.

const ChatUI = {
    open: false,

    toggle() {
        this.open = !this.open;
        document.getElementById('chat-panel').classList.toggle('open', this.open);
    },

    send() {
        const input = document.getElementById('chat-input');
        if (!input || !input.value.trim()) return;
        const text = input.value.trim();
        GameProtocol.sendChat(text);
        this.addMessage('You', text);
        input.value = '';
    },

    addMessage(name, text) {
        const log = document.getElementById('chat-log');
        if (!log) return;
        const div = document.createElement('div');
        div.className = 'chat-msg';
        div.innerHTML = `<b>${name}:</b> ${text}`;
        log.appendChild(div);
        log.scrollTop = log.scrollHeight;
        const btn = document.getElementById('btn-chat');
        btn?.classList.add('flash');
        setTimeout(() => btn?.classList.remove('flash'), 1000);
    }
};
