/* -------------------------------------------------------------------------
   UMOF site assistant — floating chat widget (vanilla JS, no framework)

   Talks to the /api/chat serverless function, which holds the Gemini API key
   and the class knowledge base. The widget itself ships no secrets.
   ------------------------------------------------------------------------- */
import './chat.css';

const CONTACT_EMAIL = 'info@umof.org';
const ENDPOINT = '/api/chat';

const GREETING =
  "Hi! I'm Jaance, the UMOF assistant \u{1F44B}. Ask me anything about The Entrepreneur's Journey: Funding Masterclass — the schedule, tuition, what you'll learn, or how to enroll.";

const SUGGESTIONS = [
  'How is this different from a bank loan?',
  'What kinds of funding can I get?',
  'How much is tuition?',
  'How do I enroll?',
];

/* ----- tiny safe rich-text renderer (escape first, then linkify) ----- */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function renderRich(raw) {
  let s = escapeHtml(raw);
  const tokens = [];
  // Wrap each index in guillemet sentinels so the restore step can't collide
  // with real digits in the text (e.g. "$10,000", "150,000 or more").
  const stash = (html) => {
    tokens.push(html);
    return '«' + (tokens.length - 1) + '»';
  };
  // markdown links [label](url)
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => stash('<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>')
  );
  // bare URLs
  s = s.replace(/(https?:\/\/[^\s<]+)/g, (url) =>
    stash('<a href="' + url + '" target="_blank" rel="noopener">' + url.replace(/^https?:\/\//, '') + '</a>')
  );
  // emails
  s = s.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (em) =>
    stash('<a href="mailto:' + em + '">' + em + '</a>')
  );
  // **bold**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // line breaks
  s = s.replace(/\n/g, '<br>');
  // restore stashed anchors
  s = s.replace(/«(\d+)»/g, (_, i) => tokens[Number(i)]);
  return s;
}

const icon = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
};

function buildWidget() {
  const root = document.createElement('div');
  root.className = 'umof-chat';
  root.innerHTML = `
    <div class="umof-chat-panel" role="dialog" aria-modal="false" aria-label="UMOF assistant chat" hidden>
      <div class="umof-chat-header">
        <div class="umof-chat-header-avatar" aria-hidden="true">J</div>
        <div class="umof-chat-header-text">
          <div class="umof-chat-header-title">UMOF Assistant</div>
          <div class="umof-chat-header-sub"><span class="umof-chat-status-dot"></span> Funding Readiness Coach</div>
        </div>
        <button type="button" class="umof-chat-close" aria-label="Close chat">${icon.close}</button>
      </div>
      <div class="umof-chat-log" role="log" aria-live="polite"></div>
      <form class="umof-chat-form">
        <textarea class="umof-chat-input" rows="1" placeholder="Ask about the class…" aria-label="Type your message" maxlength="1500"></textarea>
        <button type="submit" class="umof-chat-send" aria-label="Send message" disabled>${icon.send}</button>
      </form>
      <div class="umof-chat-foot">
        Can't find your answer? <a href="mailto:${CONTACT_EMAIL}">Email ${CONTACT_EMAIL}</a>
      </div>
    </div>
    <button type="button" class="umof-chat-launcher" aria-label="Open chat with the UMOF assistant" aria-haspopup="dialog">
      ${icon.chat}<span class="umof-chat-launcher-label">Ask a question</span>
    </button>
  `;
  document.body.appendChild(root);
  return root;
}

function initChat() {
  if (document.querySelector('.umof-chat')) return;

  const root = buildWidget();
  const panel = root.querySelector('.umof-chat-panel');
  const launcher = root.querySelector('.umof-chat-launcher');
  const closeBtn = root.querySelector('.umof-chat-close');
  const log = root.querySelector('.umof-chat-log');
  const form = root.querySelector('.umof-chat-form');
  const input = root.querySelector('.umof-chat-input');
  const sendBtn = root.querySelector('.umof-chat-send');

  /** Conversation history sent to the API: [{ role, content }] */
  const history = [];
  let greeted = false;
  let busy = false;

  const scrollDown = () => { log.scrollTop = log.scrollHeight; };

  function addMessage(role, text) {
    const el = document.createElement('div');
    el.className = `umof-chat-msg umof-chat-msg-${role === 'user' ? 'user' : 'bot'}`;
    el.innerHTML = role === 'user' ? escapeHtml(text).replace(/\n/g, '<br>') : renderRich(text);
    log.appendChild(el);
    scrollDown();
    return el;
  }

  function addSuggestions() {
    const wrap = document.createElement('div');
    wrap.className = 'umof-chat-suggestions';
    SUGGESTIONS.forEach((q) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'umof-chat-chip';
      chip.textContent = q;
      chip.addEventListener('click', () => {
        wrap.remove();
        sendMessage(q);
      });
      wrap.appendChild(chip);
    });
    log.appendChild(wrap);
    scrollDown();
  }

  function showTyping() {
    const t = document.createElement('div');
    t.className = 'umof-chat-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    log.appendChild(t);
    scrollDown();
    return t;
  }

  async function sendMessage(text) {
    const message = (text || '').trim();
    if (!message || busy) return;

    busy = true;
    addMessage('user', message);
    history.push({ role: 'user', content: message });
    input.value = '';
    autoGrow();
    setSendEnabled();

    const typing = showTyping();

    let reply;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(0, -1) }),
      });
      const data = await res.json().catch(() => ({}));
      reply =
        data.reply ||
        `Sorry, I couldn't reach the assistant just now. Please email ${CONTACT_EMAIL} and the UMOF team will help you.`;
    } catch {
      reply = `Sorry, I'm having trouble connecting right now. Please email ${CONTACT_EMAIL} and the UMOF team will help you.`;
    }

    typing.remove();
    addMessage('assistant', reply);
    history.push({ role: 'assistant', content: reply });

    busy = false;
    setSendEnabled();
    if (root.classList.contains('is-open')) input.focus();
  }

  function openPanel() {
    root.classList.add('is-open');
    panel.hidden = false;
    if (!greeted) {
      greeted = true;
      addMessage('assistant', GREETING);
      addSuggestions();
    }
    setTimeout(() => input.focus(), 50);
  }
  function closePanel() {
    root.classList.remove('is-open');
    panel.hidden = true;
    launcher.focus();
  }

  function setSendEnabled() {
    sendBtn.disabled = busy || input.value.trim().length === 0;
  }
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 110)}px`;
  }

  launcher.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);

  input.addEventListener('input', () => { autoGrow(); setSendEnabled(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) closePanel();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChat);
} else {
  initChat();
}
