/* ==========================================
   BilalAI 1.1 - Flash  |  Ana Uygulama Betiği
   ========================================== */

(function () {
  'use strict';

  /* ========== Uyumluluk Polyfilleri ========== */
  if (typeof structuredClone !== 'function') {
    window.structuredClone = function (obj) {
      try { return JSON.parse(JSON.stringify(obj)); }
      catch (e) { return obj; }
    };
  }
  if (typeof crypto === 'undefined') window.crypto = {};
  if (typeof crypto.randomUUID !== 'function') {
    crypto.randomUUID = function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = (Math.random() * 16) | 0;
        var v = c === 'x' ? r : ((r & 0x3) | 0x8);
        return v.toString(16);
      });
    };
  }

  /* ========== Kurucu Parolası ========== */
  const FOUNDER_PASSWORD = 'BilalAI_2026';

  /* ========== Modeller ========== */
  const MODELS = {
    flashlite: {
      name: 'BilalAI - FlashLite - 1.0',
      shortName: 'FlashLite',
      icon: '⚡',
      color: '#F59E0B',
      thinkingMs: [500, 1000],
      style: 'ultra hızlı, kısa cevaplar',
      engine: 'BilalAIFlashLite'
    },
    flash: {
      name: 'BilalAI - Flash 1.1',
      shortName: 'Flash',
      icon: '⚡',
      color: '#00BFFF',
      thinkingMs: [700, 1500],
      style: 'hızlı ve dengeli',
      engine: 'BilalAIResponseEngine'
    }
  };

  /* ========== Beceri Haritası (JSON'dan alınan + temel) ========== */
  const DEFAULT_SKILLS = {
    'JavaScript':        { level: 85, practices: 0 },
    'TypeScript':        { level: 80, practices: 0 },
    'Python':            { level: 80, practices: 0 },
    'React':             { level: 75, practices: 0 },
    'Vue.js':            { level: 70, practices: 0 },
    'Node.js':           { level: 72, practices: 0 },
    'HTML/CSS':          { level: 90, practices: 0 },
    'SQL/Veritabanı':    { level: 72, practices: 0 },
    'Go/Rust':           { level: 55, practices: 0 },
    'Mobile Dev':        { level: 60, practices: 0 },
    'Audio Processing':  { level: 50, practices: 0 },
    'Automation':        { level: 65, practices: 0 },
    'Better Auth':       { level: 55, practices: 0 },
    'CLI Tools':         { level: 60, practices: 0 },
    'Canvas Design':     { level: 58, practices: 0 },
    'Claude Code':       { level: 70, practices: 0 },
    'Collision Thinking':{ level: 55, practices: 0 },
    'Defense in Depth':  { level: 62, practices: 0 },
    'Docs Seeker':       { level: 65, practices: 0 },
    'Security':          { level: 64, practices: 0 },
    'DevOps':            { level: 58, practices: 0 }
  };

  /* ========== localStorage Yardımcıları ========== */
  const LS = {
    CHATS:       'bilalai_chats',
    CURRENT:     'bilalai_current_chat',
    PERF:        'bilalai_performance',
    SKILLS:      'bilalai_skill_map',
    ERRORS:      'bilalai_error_log',
    SETTINGS:    'bilalai_settings',
    SYS_MSGS:    'bilalai_system_messages'
  };

  function lsGet(key, def) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return def;
      return JSON.parse(raw);
    } catch (e) {
      return def;
    }
  }
  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('localStorage yazma hatası:', e);
    }
  }

  /* ========== Başlangıç Verileri ========== */
  function initStorage() {
    if (!lsGet(LS.CHATS)) lsSet(LS.CHATS, []);
    if (!lsGet(LS.CURRENT)) lsSet(LS.CURRENT, null);
    if (!lsGet(LS.PERF)) lsSet(LS.PERF, { score: 75, likes: 0, dislikes: 0, history: [] });
    if (!lsGet(LS.SKILLS)) lsSet(LS.SKILLS, structuredClone(DEFAULT_SKILLS));
    if (!lsGet(LS.ERRORS)) lsSet(LS.ERRORS, []);
    if (!lsGet(LS.SETTINGS)) lsSet(LS.SETTINGS, { theme: 'dark', currentModel: 'flash' });
    if (!lsGet(LS.SYS_MSGS)) lsSet(LS.SYS_MSGS, []);

    // Oturum açma rastgele gelişimi
    const perf = lsGet(LS.PERF);
    const today = new Date().toDateString();
    if (!perf.lastSessionDate || perf.lastSessionDate !== today) {
      perf.score = Math.min(100, perf.score + Math.floor(Math.random() * 3));
      perf.lastSessionDate = today;
      lsSet(LS.PERF, perf);
    }
  }

  /* ========== DOM Referansları ========== */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const dom = {
    sidebar: $('#sidebar'),
    chatList: $('#chatList'),
    newChatBtn: $('#newChatBtn'),
    themeToggle: $('#themeToggle'),
    sidebarToggle: $('#sidebarToggle'),
    openSidebarBtn: $('#openSidebarBtn'),
    messages: $('#messages'),
    welcomeScreen: $('#welcomeScreen'),
    messageInput: $('#messageInput'),
    sendBtn: $('#sendBtn'),
    modelSelector: $('#modelSelector'),
    headerModelName: $('#headerModelName'),
    headerModelIcon: $('#headerModelIcon'),
    modelBadgeBtn: $('#modelBadgeBtn'),
    modelModal: $('#modelModal'),
    closeModelModal: $('#closeModelModal'),
    clearChatBtn: $('#clearChatBtn'),
    secretFounderBtn: $('#secretFounderBtn'),
    adminModal: $('#adminModal'),
    adminLogin: $('#adminLogin'),
    adminPanel: $('#adminPanel'),
    founderPassword: $('#founderPassword'),
    adminLoginBtn: $('#adminLoginBtn'),
    adminCloseBtn: $('#adminCloseBtn'),
    adminClosePanelBtn: $('#adminClosePanelBtn'),
    perfScore: $('#perfScore'),
    gaugeFill: $('#gaugeFill'),
    totalLikes: $('#totalLikes'),
    totalDislikes: $('#totalDislikes'),
    totalMessages: $('#totalMessages'),
    totalChats: $('#totalChats'),
    skillsList: $('#skillsList'),
    errorLogList: $('#errorLogList'),
    chatSearch: $('#chatSearch'),
    adminChatsList: $('#adminChatsList'),
    systemMsgInput: $('#systemMsgInput'),
    sendSystemMsgBtn: $('#sendSystemMsgBtn'),
    systemMsgHistory: $('#systemMsgHistory'),
    exportJsonBtn: $('#exportJsonBtn'),
    exportTxtBtn: $('#exportTxtBtn'),
    resetMemoryBtn: $('#resetMemoryBtn'),
    storageInfo: $('#storageInfo'),
    toast: $('#toast'),

    // ===== YENİ EKLENENLER (v1.2) =====
    // 1) Dashboard
    dashKPI1: $('#dashChats'),
    dashKPI2: $('#dashMessages'),
    dashKPI3: $('#dashActiveModel'),
    dashKPI4: $('#dashLikes'),
    dashWeeklyChart: $('#dashBarChart'),
    dashTopSkills: $('#dashTopSkills'),
    dashRecentActivity: $('#dashActivity'),
    dashAppInfo: $('#dashAppInfo'),

    // 2) Performans sekmesi
    boostPerfBtn: $('#boostPerfBtn'),
    resetSkillsPerfBtn: $('#resetSkillsPerfBtn'),
    successRate: $('#successRate'),
    avgSkillLevel: $('#avgSkillLevel'),

    // 3) Modeller sekmesi
    modelsList: $('#modelsList'),
    newModelName: $('#newModelName'),
    newModelShort: $('#newModelShort'),
    newModelIcon: $('#newModelIcon'),
    newModelColor: $('#newModelColor'),
    newModelThinking: $('#newModelThinking'),
    newModelDesc: $('#newModelDesc'),
    addModelBtn: $('#addNewModelBtn'),

    // 4) Sohbetler sekmesi
    chatSortBy: $('#chatSortBy'),
    selectAllChats: $('#selectAllChats'),
    selectedChatsCount: $('#selectedChatsCount'),
    exportSelectedChatsBtn: $('#exportSelectedChatsBtn'),
    deleteSelectedChatsBtn: $('#deleteSelectedChatsBtn'),

    // 5) Beceriler sekmesi
    trainSkillsBtn: $('#trainSkillsBtn'),
    resetSkillsBtn: $('#resetSkillsBtn'),
    newSkillName: $('#newSkillName'),
    newSkillLevel: $('#newSkillLevel'),
    addNewSkillBtn: $('#addNewSkillBtn'),

    // 6) Hata günlüğü
    errFilter: $('#errFilter'),
    clearErrorsBtn: $('#clearErrorsBtn'),

    // 8) Ayarlar sekmesi
    accentColor: $('#accentColor'),
    showWelcomeToggle: $('#showWelcome'),
    defaultModelSelect: $('#defaultModel'),
    changePassBtn: $('#changePassBtn'),
    oldPass: $('#oldPass'),
    newPass: $('#newPass'),
    newPass2: $('#newPass2')
  };

  /* ========== Uygulama Durumu ========== */
  const state = {
    currentChatId: null,
    chats: [],
    isThinking: false,
    adminAuthenticated: false
  };

  /* ========== Yardımcı Fonksiyonlar ========== */
  function uid() {
    return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString('tr-TR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return iso; }
  }
  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function showToast(msg, type = '') {
    dom.toast.textContent = msg;
    dom.toast.className = 'toast show ' + type;
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      dom.toast.classList.remove('show');
    }, 2800);
  }

  /* ========== Tema Yönetimi ========== */
  function applyTheme() {
    const s = lsGet(LS.SETTINGS);
    document.documentElement.setAttribute('data-theme', s.theme || 'dark');
  }
  function toggleTheme() {
    const s = lsGet(LS.SETTINGS);
    s.theme = s.theme === 'dark' ? 'light' : 'dark';
    lsSet(LS.SETTINGS, s);
    applyTheme();
    showToast(s.theme === 'dark' ? '🌙 Koyu tema aktif' : '☀️ Açık tema aktif');
  }

  /* ========== Sohbet Yönetimi ========== */
  function loadChats() {
    state.chats = lsGet(LS.CHATS, []);
    state.currentChatId = lsGet(LS.CURRENT, null);
  }
  function saveChats() {
    lsSet(LS.CHATS, state.chats);
    lsSet(LS.CURRENT, state.currentChatId);
  }

  function createNewChat() {
    const chat = {
      id: uid(),
      title: 'Yeni Sohbet',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: []
    };
    state.chats.unshift(chat);
    state.currentChatId = chat.id;
    saveChats();
    renderChatList();
    renderMessages();
    showToast('✨ Yeni sohbet oluşturuldu');
    return chat;
  }

  function getCurrentChat() {
    return state.chats.find(c => c.id === state.currentChatId) || null;
  }

  function switchChat(id) {
    if (!state.chats.find(c => c.id === id)) return;
    state.currentChatId = id;
    saveChats();
    renderChatList();
    renderMessages();
  }

  function deleteChat(id, evt) {
    if (evt) evt.stopPropagation();
    if (!confirm('Bu sohbeti silmek istediğinizden emin misiniz?')) return;
    state.chats = state.chats.filter(c => c.id !== id);
    if (state.currentChatId === id) {
      state.currentChatId = state.chats[0] ? state.chats[0].id : null;
    }
    saveChats();
    renderChatList();
    renderMessages();
    showToast('🗑️ Sohbet silindi');
  }

  function clearCurrentChat() {
    const c = getCurrentChat();
    if (!c || c.messages.length === 0) return;
    if (!confirm('Sohbet içeriğini temizlemek istediğinizden emin misiniz?')) return;
    c.messages = [];
    c.updatedAt = new Date().toISOString();
    saveChats();
    renderMessages();
    renderChatList();
    showToast('🧹 Sohbet temizlendi');
  }

  function ensureChatExists() {
    if (!getCurrentChat()) {
      const c = state.chats[0];
      if (c) {
        state.currentChatId = c.id;
        saveChats();
      } else {
        createNewChat();
      }
    }
  }

  function updateChatTitleFromFirstMsg(chat, userMsg) {
    if (chat.messages.length === 1 && chat.title === 'Yeni Sohbet') {
      const clean = userMsg.replace(/\s+/g, ' ').trim();
      chat.title = clean.length > 34 ? clean.slice(0, 34) + '…' : clean;
      chat.updatedAt = new Date().toISOString();
      saveChats();
      renderChatList();
    }
  }

  /* ========== Render İşlemleri ========== */
  function renderChatList() {
    dom.chatList.innerHTML = '';
    if (state.chats.length === 0) {
      dom.chatList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;font-size:12.5px;">Henüz sohbet yok</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    state.chats.forEach(chat => {
      const el = document.createElement('div');
      el.className = 'chat-item' + (chat.id === state.currentChatId ? ' active' : '');
      el.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span class="chat-item-title" title="${chat.title.replace(/"/g, '&quot;')}">${escapeHtml(chat.title)}</span>
        <span class="chat-item-delete" title="Sil">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </span>
      `;
      el.addEventListener('click', () => switchChat(chat.id));
      el.querySelector('.chat-item-delete').addEventListener('click', (e) => deleteChat(chat.id, e));
      frag.appendChild(el);
    });
    dom.chatList.appendChild(frag);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ========== Markdown Ayrıştırıcı (Basit) ========== */
  function renderMarkdown(text) {
    let html = escapeHtml(text);

    // Kod blokları ```lang ... ```
    const codeBlocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || '', code: unescapeBack(code) });
      return `\u0000CODE${idx}\u0000`;
    });

    // Satır içi kod `code`
    html = html.replace(/`([^`\n]+?)`/g, (_, c) => `<code>${c}</code>`);

    // Başlıklar ## (en fazla 3 düzey)
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // **kalın**
    html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
    // *italik*
    html = html.replace(/(^|[\s(])\*([^*\n]+?)\*(?=\s|$|[.,;)])/g, '$1<em>$2</em>');

    // Sırasız liste - veya *
    html = html.replace(/(?:^|\n)((?:[-*] .+\n?)+)/g, (_, block) => {
      const items = block.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, '').trim());
      return '<ul>' + items.map(i => `<li>${i}</li>`).join('') + '</ul>';
    });
    // Sıralı liste 1. 2.
    html = html.replace(/(?:^|\n)((?:\d+\. .+\n?)+)/g, (_, block) => {
      const items = block.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, '').trim());
      return '<ol>' + items.map(i => `<li>${i}</li>`).join('') + '</ol>';
    });

    // Paragraflar (birleşmemiş içerik)
    html = html.split(/\n{2,}/).map(blk => {
      if (/^\s*<(ul|ol|h[1-3]|pre)/.test(blk) || blk.includes('\u0000CODE')) return blk;
      const lines = blk.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) return blk;
      return '<p>' + lines.join('<br/>') + '</p>';
    }).join('\n\n');

    // Kod bloklarını geri yerleştir (code-wrap + action bar ile)
    html = html.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => {
      const cb = codeBlocks[parseInt(i, 10)];
      const store = (window.__codeStore = window.__codeStore || []);
      const storeId = store.length;
      store.push(cb);
      return `<div class="code-wrap" data-code-idx="${storeId}" data-code-lang="${escapeHtml(cb.lang)}">${cb.lang ? `<span class="code-lang-tag">${escapeHtml(cb.lang)}</span>` : ''}<pre><code>${highlightSyntax(cb.code, cb.lang)}</code></pre></div>`;
    });

    return html;
  }

  function getFileExtForLang(lang) {
    const l = (lang || '').toLowerCase().trim();
    const map = {
      python: '.py',
      javascript: '.js',
      js: '.js',
      jsx: '.jsx',
      react: '.jsx',
      typescript: '.ts',
      ts: '.ts',
      tsx: '.tsx',
      html: '.html',
      css: '.css',
      scss: '.scss',
      sql: '.sql',
      java: '.java',
      go: '.go',
      golang: '.go',
      rust: '.rs',
      dart: '.dart',
      flutter: '.dart',
      bash: '.sh',
      shell: '.sh',
      sh: '.sh',
      git: '.sh',
      json: '.json',
      yaml: '.yaml',
      yml: '.yml',
      toml: '.toml',
      md: '.md',
      markdown: '.md',
      xml: '.xml',
      csv: '.csv'
    };
    return map[l] || '.txt';
  }
  function downloadFile(filename, content) {
    try {
      const mimeMap = {
        '.py': 'text/x-python',
        '.js': 'text/javascript',
        '.jsx': 'text/javascript',
        '.ts': 'text/typescript',
        '.html': 'text/html',
        '.css': 'text/css',
        '.json': 'application/json',
        '.sql': 'text/sql',
        '.md': 'text/markdown',
        '.sh': 'text/x-shellscript'
      };
      const ext = filename.includes('.') ? filename.split('.').pop() : 'txt';
      const mime = mimeMap['.' + ext] || 'text/plain';
      const blob = new Blob([content], { type: mime + ';charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 150);
      return true;
    } catch (e) {
      console.error('Dosya indirme hatası:', e);
      return false;
    }
  }
  function injectCodeActions(bubble) {
    if (!bubble) return;
    const wraps = bubble.querySelectorAll('.code-wrap');
    if (!wraps || wraps.length === 0) return;
    wraps.forEach(function (wrap, i) {
      if (wrap.dataset.actionsInjected === '1') return;
      wrap.dataset.actionsInjected = '1';
      const idx = parseInt(wrap.dataset.codeIdx, 10);
      const lang = wrap.dataset.codeLang || '';
      const store = window.__codeStore || [];
      const cb = store[idx];
      const codeContent = cb ? cb.code : (wrap.querySelector('code') ? wrap.querySelector('code').innerText : '');

      const ext = getFileExtForLang(lang);
      const lineCount = codeContent.split('\n').length;
      const ts = Date.now().toString(36).slice(-4) + '_' + (i + 1);
      const langPrefix = (lang && lang.length > 0) ? lang.replace(/[^a-z0-9]/gi, '_') : 'code';
      const filename = langPrefix + '_' + ts + ext;
      const size = new Blob([codeContent]).size;
      const sizeText = formatBytes(size);

      const card = document.createElement('div');
      card.className = 'code-file-card';

      const header = document.createElement('div');
      header.className = 'code-file-header';
      header.innerHTML = `
        <div class="code-file-title">
          <span class="code-file-icon">📄</span>
          <span class="code-file-name">${escapeHtml(filename)}</span>
          <span class="code-file-size">${sizeText} · ${lineCount} satır</span>
        </div>
        <div class="code-file-btns">
          <button type="button" class="code-collapse-btn" title="Daralt/Genişlet">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button type="button" class="code-action-btn dl-copy-btn" data-act="copy" title="Kopyala">
            <span>📋 Kopyala</span>
          </button>
          <button type="button" class="code-action-btn primary dl-download-btn" data-act="download" title="İndir">
            <span>⬇️ İndir</span>
          </button>
        </div>
      `;

      card.appendChild(header);
      wrap.parentNode.insertBefore(card, wrap);
      card.appendChild(wrap);

      const colBtn = header.querySelector('.code-collapse-btn');
      const collapseIcon = colBtn.querySelector('svg');
      colBtn.addEventListener('click', () => {
        const expanded = wrap.style.display !== 'none';
        wrap.style.display = expanded ? 'none' : '';
        collapseIcon.style.transform = expanded ? 'rotate(180deg)' : '';
      });

      header.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.act;
          const label = btn.querySelector('span');
          if (act === 'download') {
            const ok = downloadFile(filename, codeContent);
            if (ok) {
              const old = label.textContent;
              label.textContent = '✅ İndirildi';
              setTimeout(() => label.textContent = old, 1800);
            } else {
              label.textContent = '❌ Başarısız';
              setTimeout(() => label.textContent = '⬇️ İndir', 1800);
            }
          } else if (act === 'copy') {
            try {
              if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(codeContent);
              } else {
                const ta = document.createElement('textarea');
                ta.value = codeContent;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
              }
              const old = label.textContent;
              label.textContent = '✅ Kopyalandı';
              setTimeout(() => label.textContent = old, 1800);
            } catch (e) {
              label.textContent = '❌ Hata';
              setTimeout(() => label.textContent = '📋 Kopyala', 1800);
            }
          }
        });
      });
    });
  }

  function unescapeBack(s) {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function highlightSyntax(code, lang) {
    let c = escapeHtml(code);
    const tokens = [];
    function wrap(pattern, cls) {
      c = c.replace(pattern, function (match) {
        const idx = tokens.length;
        tokens[idx] = '<span class="' + cls + '">' + match + '</span>';
        return '\u0001TOK' + idx + '\u0001';
      });
    }
    wrap(/(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)/g, 'code-comment');
    wrap(/("[^"\n]*"|'[^'\n]*'|`[^`\n]*`)/g, 'code-string');
    wrap(/\b(\d+(?:\.\d+)?)\b/g, 'code-number');
    var kw = /\b(const|let|var|function|return|if|else|for|while|class|extends|new|import|from|export|default|async|await|try|catch|finally|throw|switch|case|break|continue|def|print|self|True|False|None|package|func|type|struct|interface|fn|impl|pub|use|mut|match|loop)\b/g;
    wrap(kw, 'code-keyword');
    wrap(/([A-Za-z_$][\w$]*)(?=\s*\()/g, 'code-function');
    wrap(/([=+\-*/%<>!&|?:]+)/g, 'code-operator');
    c = c.replace(/\u0001TOK(\d+)\u0001/g, function (_, i) { return tokens[parseInt(i, 10)]; });
    return c;
  }

  /* ========== Mesaj Render ========== */
  function renderMessages() {
    const chat = getCurrentChat();
    const msgs = chat ? chat.messages : [];

    // Welcome ekranını yönet
    if (msgs.length === 0) {
      dom.welcomeScreen.style.display = '';
      dom.messages.querySelectorAll('.message-row, .thinking-indicator, .messages-inner').forEach(el => el.remove());
    } else {
      dom.welcomeScreen.style.display = 'none';
      dom.messages.querySelectorAll('.message-row, .thinking-indicator, .messages-inner').forEach(el => el.remove());
    }

    if (msgs.length === 0) {
      scrollToBottom();
      return;
    }

    const inner = document.createElement('div');
    inner.className = 'messages-inner';
    msgs.forEach(m => inner.appendChild(createMessageEl(m)));
    dom.messages.appendChild(inner);
    scrollToBottom();
  }

  function createMessageEl(msg) {
    const row = document.createElement('div');
    row.className = 'message-row ' + msg.role;
    row.dataset.msgId = msg.id;
    if (msg.role === 'assistant' && msg.model) row.dataset.model = msg.model;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    if (msg.role === 'user') {
      avatar.textContent = 'S';
    } else {
      const m = MODELS[msg.model] || MODELS.flash;
      const col1 = (m && m.color) ? m.color : '#00BFFF';
      const col2 = (msg.model === 'flashlite') ? '#B45309' : '#0066CC';
      avatar.innerHTML = `<svg viewBox="0 0 64 64"><defs><linearGradient id="ag${msg.id.slice(-5)}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${col1}"/><stop offset="100%" stop-color="${col2}"/></linearGradient></defs><circle cx="32" cy="32" r="30" fill="url(#ag${msg.id.slice(-5)})"/><text x="32" y="42" font-family="Arial" font-size="32" font-weight="bold" fill="#fff" text-anchor="middle">B</text></svg>`;
    }
    row.appendChild(avatar);

    // Ana içerik
    const main = document.createElement('div');
    main.className = 'message-main';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.innerHTML = renderMarkdown(msg.content);
    // Kod blokları için İNDİR/KOPYALA butonları
    injectCodeActions(bubble);
    main.appendChild(bubble);

    // Rozetler
    if (msg.role === 'founder') {
      const b = document.createElement('div');
      b.className = 'founder-badge';
      b.innerHTML = '🔐 KURUCU';
      main.appendChild(b);
    } else if (msg.role === 'assistant') {
      const m = MODELS[msg.model] || MODELS.flash;
      const t = document.createElement('div');
      t.className = 'message-model-tag';
      t.textContent = `${m.icon} ${m.name}`;
      main.appendChild(t);

      // Geri bildirim butonları
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      actions.innerHTML = `
        <button class="feedback-btn like${msg.feedback === 'like' ? ' liked' : ''}" data-action="like" title="Yararlı">👍</button>
        <button class="feedback-btn dislike${msg.feedback === 'dislike' ? ' disliked' : ''}" data-action="dislike" title="Yararsız">👎</button>
      `;
      actions.addEventListener('click', (e) => onFeedback(e, msg));
      main.appendChild(actions);
    }

    row.appendChild(main);
    return row;
  }

  function appendMessageEl(msg) {
    dom.welcomeScreen.style.display = 'none';
    let inner = dom.messages.querySelector('.messages-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'messages-inner';
      dom.messages.appendChild(inner);
    }
    inner.appendChild(createMessageEl(msg));
    scrollToBottom();
  }

  function showThinking(modelKey) {
    state.isThinking = true;
    let inner = dom.messages.querySelector('.messages-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'messages-inner';
      dom.messages.appendChild(inner);
    }
    const row = document.createElement('div');
    row.className = 'message-row assistant thinking-row';
    row.innerHTML = `
      <div class="message-avatar">
        <svg viewBox="0 0 64 64"><defs><linearGradient id="tghink" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00BFFF"/><stop offset="100%" stop-color="#0066CC"/></linearGradient></defs><circle cx="32" cy="32" r="30" fill="url(#tghink)"/><text x="32" y="42" font-family="Arial" font-size="32" font-weight="bold" fill="#fff" text-anchor="middle">B</text></svg>
      </div>
      <div class="message-main">
        <div class="thinking-indicator">
          <div class="thinking-text">
            Düşünüyor
            <div class="thinking-dots"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>
    `;
    inner.appendChild(row);
    scrollToBottom();
    dom.sendBtn.disabled = true;
  }

  function removeThinking() {
    state.isThinking = false;
    dom.messages.querySelectorAll('.thinking-row').forEach(el => el.remove());
    dom.sendBtn.disabled = false;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      dom.messages.scrollTop = dom.messages.scrollHeight;
    });
  }

  /* ========== Geri Bildirim İşlemleri ========== */
  function onFeedback(e, msg) {
    const btn = e.target.closest('.feedback-btn');
    if (!btn) return;
    const action = btn.dataset.action;

    // Eğer aynı zaten seçiliyse iptal et
    if (msg.feedback === action) {
      msg.feedback = null;
      revertFeedback(action);
    } else {
      const prev = msg.feedback;
      if (prev) revertFeedback(prev);
      msg.feedback = action;
      applyFeedback(action, msg);
    }

    // Kalıcı kaydet
    const chat = getCurrentChat();
    if (chat) {
      const m = chat.messages.find(mm => mm.id === msg.id);
      if (m) m.feedback = msg.feedback;
      chat.updatedAt = new Date().toISOString();
      saveChats();
    }

    // UI güncelle
    renderMessages();
  }

  function applyFeedback(action, msg) {
    const perf = lsGet(LS.PERF);
    if (action === 'like') {
      perf.score = Math.min(100, perf.score + 2);
      perf.likes = (perf.likes || 0) + 1;
      showToast('👍 Teşekkürler! Yanıtımızı geliştirdik.', 'success');
      // Beceri artışına katkı
      boostRelevantSkillsFromMessage(msg.content);
    } else {
      perf.score = Math.max(0, perf.score - 5);
      perf.dislikes = (perf.dislikes || 0) + 1;
      // Hata günlüğüne ekle
      const errors = lsGet(LS.ERRORS, []);
      const chat = getCurrentChat();
      const idx = chat ? chat.messages.findIndex(m => m.id === msg.id) : -1;
      const prevMsg = chat && idx > 0 ? chat.messages[idx - 1] : null;
      errors.unshift({
        timestamp: new Date().toISOString(),
        userMessage: prevMsg ? prevMsg.content : '(bilinmiyor)',
        aiResponse: msg.content,
        reason: 'Kullanıcı olumsuz geri bildirim verdi',
        patternToAvoid: extractPatterns(msg.content),
        correctionNote: 'Bu yanıtı gelecekte daha dikkatli, daha doğru ve detaylı hazırla.'
      });
      lsSet(LS.ERRORS, errors.slice(0, 500));
      showToast('👎 Geri bildiriminiz alındı, kendimi düzeltiyorum.', 'error');
    }
    perf.history = perf.history || [];
    perf.history.push({ date: new Date().toISOString(), score: perf.score, action });
    lsSet(LS.PERF, perf);
  }

  function revertFeedback(action) {
    const perf = lsGet(LS.PERF);
    if (action === 'like') {
      perf.score = Math.max(0, perf.score - 2);
      perf.likes = Math.max(0, (perf.likes || 0) - 1);
    } else {
      perf.score = Math.min(100, perf.score + 5);
      perf.dislikes = Math.max(0, (perf.dislikes || 0) - 1);
    }
    lsSet(LS.PERF, perf);
  }

  function boostRelevantSkillsFromMessage(text) {
    const skills = lsGet(LS.SKILLS);
    const mapping = [
      [['javascript', ' js ', 'typescript', 'ts ', 'node', 'react', 'vue', 'nextjs', 'next.js', 'angular'], ['JavaScript', 'TypeScript', 'Node.js', 'React', 'Vue.js']],
      [['python', 'django', 'flask', 'pandas', 'numpy'], ['Python']],
      [['html', 'css', 'scss', 'tailwind', 'bootstrap', 'stil'], ['HTML/CSS']],
      [['sql', 'mysql', 'postgres', 'mongodb', 'veritaban', 'database'], ['SQL/Veritabanı']],
      [['java', 'kotlin', 'swift', 'flutter', 'mobil', 'android', 'ios'], ['Mobile Dev']],
      [['go ', 'golang', 'rust '], ['Go/Rust']],
      [['ses', 'audio', 'speech', 'whisper', 'sesli'], ['Audio Processing']],
      [['otomasyon', 'cron', 'script', 'bot', 'scraping'], ['Automation', 'CLI Tools']],
      [['giriş', 'auth', 'authentication', 'oturum', 'login', 'şifre'], ['Better Auth', 'Security']],
      [['grafik', 'canvas', 'svg', 'chart', 'tasarım', 'pdf', 'resim'], ['Canvas Design']],
      [['hata', 'hata ayıkla', 'debug', 'bug', 'security', 'güvenlik'], ['Defense in Depth', 'Security', 'Claude Code']],
      [['dokümantasyon', 'doc', 'mdn', 'döküman'], ['Docs Seeker']],
      [['devops', 'docker', 'deploy', 'kubernetes', 'ci/cd'], ['DevOps']]
    ];
    const t = text.toLowerCase();
    const boosted = new Set();
    mapping.forEach(([patterns, skillNames]) => {
      if (patterns.some(p => t.includes(p))) {
        skillNames.forEach(sn => {
          if (skills[sn] && !boosted.has(sn)) {
            skills[sn].practices = (skills[sn].practices || 0) + 1;
            skills[sn].level = Math.min(99, skills[sn].level + Math.random() * 1.2);
            boosted.add(sn);
          }
        });
      }
    });
    lsSet(LS.SKILLS, skills);
  }

  function extractPatterns(text) {
    try {
      const words = text.split(/\s+/).filter(w => w.length > 5);
      return words.slice(0, 10).join(' ');
    } catch {
      return '';
    }
  }

  /* ========== Bağlam (Context) Hazırlama ========== */
  function buildContext(chat, limit) {
    if (typeof limit === 'undefined' || limit === null) limit = 8;
    if (!chat || !Array.isArray(chat.messages) || chat.messages.length === 0) return [];
    const recent = chat.messages.slice(-limit);
    return recent.map(m => ({
      role: m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'assistant'),
      content: m.content || ''
    }));
  }

  /* ========== Yanıt Motoru (Entegrasyon: model.js + flashlitemodel.js) ========== */
  function generateResponse(userMsg, modelKey, chat) {
    const meta = MODELS[modelKey] || MODELS.flash;
    let Engine = null;
    if (meta && meta.engine === 'BilalAIFlashLite' && window.BilalAIFlashLite && typeof window.BilalAIFlashLite.generate === 'function') {
      Engine = window.BilalAIFlashLite;
    } else if (window.BilalAIResponseEngine && typeof window.BilalAIResponseEngine.generate === 'function') {
      Engine = window.BilalAIResponseEngine;
    }
    if (Engine) {
      try {
        const ctx = buildContext(chat, modelKey === 'flashlite' ? 3 : 5);
        return Engine.generate(userMsg, ctx);
      } catch (e) {
        console.warn('Model engine hatası, fallback:', e);
      }
    }
    // Fallback: motor yoksa basit yanıt
    const m = meta;
    return [
      `${m.icon || '⚡'} Anladım! **"${truncate(userMsg, 90)}"** hakkında konuşuyoruz.\n\n`,
      `Konuyu daha derin inceleyebilmem için birkaç detay paylaşabilir misin?\n`,
      `- Ne **tür** bir sonuç beklüyorsun?\n`,
      `- Hangi **ortam / teknoloji** ile çalışıyoruz?\n`,
      `Sorduğun soruyu veya isteğini biraz daha açarsan sana en uygun yanıtı hazırlayacağım! 💪`
    ].join('\n');
  }

  function truncate(s, n) {
    s = (s || '').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  function detectCodeIntent(t) {
    const patterns = [
      [['react', 'bileşen', 'component'], 'react'],
      [['javascript', ' js ', 'nodejs', 'node ', 'npm'], 'javascript'],
      [['typescript', ' ts '], 'typescript'],
      [['python', 'django', 'flask'], 'python'],
      [['html', 'css', 'stil', 'sayfa', 'web sitesi'], 'htmlcss'],
      [[' sql ', 'sorgu', 'mysql', 'postgres', 'mongodb'], 'sql'],
      [['git ', 'commit', 'push', 'depo'], 'git'],
      [['go ', 'golang'], 'go'],
      [['rust ', 'cargo'], 'rust']
    ];
    for (const [keys, lang] of patterns) {
      if (keys.some(k => t.includes(k))) return lang;
    }
    const explicitWords = ['kod yaz', 'kodu yaz', 'fonksiyon yaz', 'script yaz', 'yazabilir mis', 'örnek kod', 'code example', 'function'];
    if (explicitWords.some(w => t.includes(w))) return 'javascript';
    return null;
  }

  function generateCodeSample(lang, userMsg) {
    const samples = {
      javascript: `\`\`\`javascript
// Örnek: Kullanıcı girdisine göre Todo listesi yöneticisi
class TodoManager {
  constructor() {
    this.todos = JSON.parse(localStorage.getItem('todos') || '[]');
  }
  add(text) {
    if (!text || !text.trim()) throw new Error('Boş todo eklenemez');
    this.todos.push({
      id: crypto.randomUUID(),
      text: text.trim(),
      done: false,
      createdAt: new Date().toISOString()
    });
    this.save();
  }
  toggle(id) {
    const t = this.todos.find(t => t.id === id);
    if (t) t.done = !t.done;
    this.save();
  }
  save() {
    localStorage.setItem('todos', JSON.stringify(this.todos));
  }
}

// Kullanım
const manager = new TodoManager();
manager.add("${truncate(userMsg, 30)} üzerinde çalış");
console.log('Aktif todo sayısı:', manager.todos.length);
\`\`\`

Yukarıda **JavaScript** ile pratik, kalıcı (localStorage) bir Todo yönetici örneği. Kullanım alanına göre:
- React/Vue entegrasyonu,
- HTTP API bağlantısı,
- Filtreleme / arama özellikleri ekleyebilirim.

Tam olarak neyi hedefliyorsun? 👨‍💻`,

      react: `\`\`\`jsx
import { useState, useMemo } from 'react';

// Bileşen: Filtrelenebilir, aranabilir liste
export default function SearchableList({ items = [] }) {
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  const filtered = useMemo(() => {
    return items.filter(it => {
      const matchText = it.title.toLowerCase().includes(q.toLowerCase());
      const matchActive = onlyActive ? it.active : true;
      return matchText && matchActive;
    });
  }, [items, q, onlyActive]);

  return (
    <div style={{ padding: 16, maxWidth: 520 }}>
      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Ara..."
        style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid #ddd' }}
      />
      <label style={{ display: 'block', margin: '10px 0' }}>
        <input type="checkbox" checked={onlyActive} onChange={e => setOnlyActive(e.target.checked)} />
        {' '}Sadece aktifleri göster
      </label>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {filtered.map(it => (
          <li key={it.id} style={{ padding: 10, borderBottom: '1px solid #eee' }}>
            {it.title} {it.active ? '✅' : '⭕'}
          </li>
        ))}
        {filtered.length === 0 && <p style={{ opacity: 0.6 }}>Eşleşen sonuç yok.</p>}
      </ul>
    </div>
  );
}
\`\`\`

Yukarıda React ile **aramalı + filtreli liste** bileşeni. Performans için **useMemo** kullandım. Özelleştirmek istersen:
- API'den veri çekme (useEffect),
- Sürükle bırak sıralama,
- Çoklu seçim özellikleri ekleyebilirim.

Hangi yönde ilerleyelim?`,

      python: `\`\`\`python
# Hızlı: CSV okuyup pandas ile özet analiz
import pandas as pd
from pathlib import Path

def analyze_data(csv_path: str):
    if not Path(csv_path).exists():
        raise FileNotFoundError(f"Dosya bulunamadı: {csv_path}")
    df = pd.read_csv(csv_path)

    summary = {
        'satir_sayisi': len(df),
        'sutun_sayisi': len(df.columns),
        'sutunlar': list(df.columns),
        'eksik_veri': df.isnull().sum().to_dict(),
        'betimsel': df.describe().to_dict()
    }

    print("✅ Veri başarıyla yüklendi")
    print("İlk 5 satır:")
    print(df.head())
    return summary

# Kullanım
# rapor = analyze_data("veri.csv")
\`\`\`

**Python** örneği: Pandas ile veri özeti. İstersen:
- Makine öğrenmesi ön işleme,
- REST API (FastAPI) sarma,
- Grafik (matplotlib / seaborn) üretme gibi adımlar ekleyebilirim.

Projende hedefin ne?`,

      htmlcss: `\`\`\`html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>Modern Kart Tasarımı</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; background: linear-gradient(135deg,#0f0f12,#1a1a1f); color:#fff; }
    .card {
      width: min(480px, 92vw);
      padding: 28px;
      border-radius: 20px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(0,191,255,0.3);
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 40px rgba(0,191,255,0.12);
      transition: transform .25s ease;
    }
    .card:hover { transform: translateY(-4px); }
    .card h1 { margin: 0 0 10px; color: #00BFFF; }
    .card p  { color: #cbd5e1; line-height: 1.6; }
    .btn {
      display:inline-block; margin-top:14px; padding:10px 18px;
      background:#00BFFF; color:#fff; border:none; border-radius:10px;
      cursor:pointer; text-decoration:none; font-weight:600;
      box-shadow: 0 6px 16px rgba(0,191,255,0.3);
    }
    .btn:hover { background: #009FDD; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ ${truncate(userMsg, 24)}</h1>
    <p>Bu, modern glassmorphism efektiyle hazırlanmış bir kart tasarımıdır. Tamamen duyarlı (responsive) ve koyu tema uyumludur.</p>
    <a href="#" class="btn">Hemen Başla</a>
  </div>
</body>
</html>
\`\`\`

Yukarıda tek dosyalık, **modern görünümlü kart (card)** tasarımı örneği. CSS tarafında glassmorphism + gradient efektleri kullandım.`,

      sql: `\`\`\`sql
-- Kullanıcı ve siparişler için örnek ilişkisel şema + sorgu
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total DECIMAL(10,2) NOT NULL CHECK (total >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- En çok harcayan ilk 10 kullanıcı
SELECT u.email, COUNT(o.id) siparis_sayisi, COALESCE(SUM(o.total), 0) toplam_harcama
FROM users u
LEFT JOIN orders o ON o.user_id = u.id AND o.status = 'completed'
GROUP BY u.id, u.email
ORDER BY toplam_harcama DESC
LIMIT 10;
\`\`\`

SQL taslak: kullanıcı-sipariş ilişkisi, indeksleme ve rapor sorgusu. Güvenlik için:
- Parametrik sorgu kullan,
- **ROLE** bazlı yetkilendirme yap,
- Yedekleme politikası belirle.

Konuya göre detaylandırabilirim.`,

      typescript: `\`\`\`typescript
// Tip güvenli API istemcisi örneği
interface ApiResponse<T> {
  data: T;
  error?: { code: number; message: string };
  meta?: { page: number; total: number };
}

interface User {
  id: string;
  email: string;
  createdAt: string;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  if (!res.ok) {
    return { data: undefined as any, error: { code: res.status, message: res.statusText } };
  }
  const data: T = await res.json();
  return { data };
}

// Kullanım
const result = await fetchJson<User>('/api/user/current');
if (result.error) console.error('Hata:', result.error.message);
else console.log('Kullanıcı:', result.data?.email);
\`\`\`

TypeScript örneği: **Generic** tip güvenli API istemcisi. HTTP durum kodlarını ve yanıt yapısını derleme zamanında denetliyoruz. İstersen REST, tRPC veya GraphQL adaptörü ekleyebilirim.`,

      git: `\`\`\`bash
# Standart Git iş akışı örneği (feature branch)
git checkout main
git pull origin main

# Yeni dal
git checkout -b feature/${truncate(userMsg, 24).replace(/\s+/g, '-').toLowerCase()}

# Değişiklikleri yap, ardından...
git add .
git commit -m "feat: ${truncate(userMsg, 50)}"

# Rebase ile temiz tarih
git fetch origin main
git rebase origin/main

# Gönder
git push -u origin HEAD

# Sonra PR / Merge Request aç
\`\`\`

Git için önerilen akış: **feature branch + rebase**. Commit mesajlarında Conventional Commits (feat/fix/docs/refactor) kullanmanı öneririm.`,

      go: `\`\`\`go
package main

import (
    "fmt"
    "log"
    "net/http"
    "time"
)

// Basit HTTP sunucusu (Go)
func handler(w http.ResponseWriter, r *http.Request) {
    fmt.Fprintf(w, "Merhaba, %s! Sunucu zamanı: %s",
        r.URL.Path[1:], time.Now().Format(time.RFC3339))
}

func main() {
    http.HandleFunc("/", handler)
    fmt.Println("Sunucu :8080 üzerinde çalışıyor")
    if err := http.ListenAndServe(":8080", nil); err != nil {
        log.Fatal(err)
    }
}
\`\`\`

Go ile sıfır bağımlılık HTTP sunucusu. Gerçek projede:
- **router** (gorilla/mux veya gin),
- **middleware** (CORS, logger, auth),
- **database** (sqlx/gorm) ekleyebilirim.`,

      rust: `\`\`\`rust
use std::collections::HashMap;

fn word_frequency(text: &str) -> HashMap<&str, usize> {
    let mut freq = HashMap::new();
    for word in text.split(|c: char| !c.is_alphanumeric())
                    .filter(|w| !w.is_empty()) {
        *freq.entry(word).or_insert(0) += 1;
    }
    freq
}

fn main() {
    let text = "merhaba merhaba dünya rust rust rust hello";
    let freq = word_frequency(text);
    for (word, count) in &freq {
        println!("{:<10} => {}", word, count);
    }
}
\`\`\`

Rust örneği: kelime frekans sayacı. HashMap + borrow kurallarına uygun. İstersen **tokio** ile async HTTP, **actix-web** ile API örneği de verebilirim.`
    };
    const sample = samples[lang] || samples.javascript;
    const prefix = `💻 İsteğin üzerine **${lang.toUpperCase()}** odaklı bir örnek hazırladım:\n\n`;
    const suffix = `\n\nFarklı bir yaklaşıma veya özelleştirilmiş bir çözüme ihtiyacın olursa, detayları paylaşman yeterli!`;
    return prefix + sample + suffix;
  }

  /* ========== Mesaj Gönderme Akışı ========== */
  function getSelectedModelKey() {
    const s = lsGet(LS.SETTINGS);
    return (s && s.currentModel) ? s.currentModel : 'flash';
  }

  function sendMessage() {
    if (state.isThinking) return;
    const raw = dom.messageInput.value;
    const text = raw.replace(/\s+$/g, '');
    if (!text) return;

    ensureChatExists();
    const chat = getCurrentChat();

    const modelKey = getSelectedModelKey();

    // Kullanıcı mesajı ekle
    const userMsg = {
      id: uid(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      feedback: null,
      model: modelKey
    };
    chat.messages.push(userMsg);
    chat.updatedAt = new Date().toISOString();
    saveChats();

    dom.messageInput.value = '';
    dom.messageInput.style.height = 'auto';
    appendMessageEl(userMsg);
    updateChatTitleFromFirstMsg(chat, text);

    // Beceri puanlama (kullanıcının mesajına göre yeteneği tahmin et)
    boostRelevantSkillsFromMessage(text);

    // Düşünme animasyonu
    const mm = MODELS[modelKey] || MODELS.flash;
    const [a, b] = mm.thinkingMs;
    const delay = randInt(a, b);

    showThinking(modelKey);
    setTimeout(() => {
      removeThinking();
      const replyText = generateResponse(text, modelKey, chat);
      const aiMsg = {
        id: uid(),
        role: 'assistant',
        content: replyText,
        timestamp: new Date().toISOString(),
        feedback: null,
        model: modelKey
      };
      chat.messages.push(aiMsg);
      chat.updatedAt = new Date().toISOString();
      saveChats();
      appendMessageEl(aiMsg);
    }, delay);
  }

  /* Sistem mesajı gönderme (kurucu) */
  function sendSystemMessage(text) {
    if (!text || !text.trim()) return;
    ensureChatExists();
    const chat = getCurrentChat();
    const modelKey = getSelectedModelKey();

    const founderMsg = {
      id: uid(),
      role: 'founder',
      content: text.trim(),
      timestamp: new Date().toISOString(),
      feedback: null,
      model: modelKey
    };
    chat.messages.push(founderMsg);

    // Sistem mesajını ayrıca kaydet
    const sysMsgs = lsGet(LS.SYS_MSGS, []);
    sysMsgs.unshift({
      timestamp: new Date().toISOString(),
      content: text.trim()
    });
    lsSet(LS.SYS_MSGS, sysMsgs.slice(0, 200));

    saveChats();
    appendMessageEl(founderMsg);

    // AI yanıtı: kurucuyu selamlama
    const mm = MODELS[modelKey] || MODELS.flash;
    showThinking(modelKey);
    const delay = randInt(mm.thinkingMs[0], mm.thinkingMs[1]);
    setTimeout(() => {
      removeThinking();
      const reply = [
        `Merhaba **Kurucum Bilal**. 👑`,
        `Sistem mesajınızı aldım ve hemen inceledim:\n`,
        `> *"${truncate(text.trim(), 180)}"*\n`,
        `Talebiniz doğrultusunda kendimi güncelliyor, daha doğru ve **yetkin** yanıtlar verebilmek için gelişim motorumu çalıştırıyorum.`,
        `\nHer daim hizmetinizdeyim, saygılarımla. 🛡️⚡ — ${mm.name}`
      ].join('\n');
      const aiMsg = {
        id: uid(),
        role: 'assistant',
        content: reply,
        timestamp: new Date().toISOString(),
        feedback: null,
        model: modelKey
      };
      chat.messages.push(aiMsg);
      chat.updatedAt = new Date().toISOString();
      saveChats();
      appendMessageEl(aiMsg);
    }, delay);
  }

  /* ========== Textarea otomatik boyut ========== */
  function autoResizeTextarea() {
    const ta = dom.messageInput;
    ta.style.height = 'auto';
    const max = 220;
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
  }

  /* ========== Model Seçici Modal ========== */
  function applyModelToUI() {
    const s = lsGet(LS.SETTINGS);
    const key = s.currentModel || 'flash';
    updateHeaderModelName(key);
    // Modal içindeki kartları güncelle
    $$('.model-card').forEach(card => {
      card.classList.toggle('active', card.dataset.model === key);
    });
  }
  function updateHeaderModelName(key) {
    const m = MODELS[key] || MODELS.flash;
    if (dom.headerModelName) dom.headerModelName.textContent = m.name;
    if (dom.headerModelIcon) dom.headerModelIcon.textContent = m.icon;
  }
  function selectModel(key) {
    if (!MODELS[key]) key = 'flash';
    const s = lsGet(LS.SETTINGS);
    s.currentModel = key;
    lsSet(LS.SETTINGS, s);
    updateHeaderModelName(key);
    $$('.model-card').forEach(card => {
      card.classList.toggle('active', card.dataset.model === key);
    });
    const m = MODELS[key];
    showToast(`🤖 ${m.icon} ${m.name} modeli aktif`, 'success');
  }
  function openModelModal() {
    if (!dom.modelModal) return;
    applyModelToUI();
    dom.modelModal.classList.add('active');
  }
  function closeModelModalFn() {
    if (!dom.modelModal) return;
    dom.modelModal.classList.remove('active');
  }

  /* ========== Kurucu / Yönetici Paneli ========== */
  function openAdminModal() {
    dom.adminModal.classList.add('active');
    if (state.adminAuthenticated) {
      showAdminPanel();
    } else {
      dom.adminLogin.classList.remove('hidden');
      dom.adminPanel.classList.add('hidden');
      setTimeout(() => dom.founderPassword.focus(), 80);
    }
  }
  function closeAdminModal() {
    dom.adminModal.classList.remove('active');
    dom.founderPassword.value = '';
  }
  function tryAdminLogin() {
    const pw = dom.founderPassword.value;
    const savedPass = lsGet('bilalai_founder_pass', null);
    const isCorrect = (pw === FOUNDER_PASSWORD) || (savedPass && pw === savedPass);
    if (isCorrect) {
      state.adminAuthenticated = true;
      showAdminPanel();
      showToast('🛡️ Kurucu paneline hoş geldiniz, Bilal.', 'success');
    } else {
      showToast('❌ Şifre hatalı. Tekrar deneyin.', 'error');
      dom.founderPassword.value = '';
      dom.founderPassword.focus();
    }
  }
  function showAdminPanel() {
    dom.adminLogin.classList.add('hidden');
    dom.adminPanel.classList.remove('hidden');
    renderAdminAll();
  }
  function switchAdminTab(tabName) {
    $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    $$('.admin-tab-content').forEach(c => c.classList.toggle('active', c.dataset.content === tabName));
  }

  /* ================================================================
     DASHBOARD SEKMESİ (1)
     ================================================================ */
  function renderAdminDashboard() {
    const perf = lsGet(LS.PERF);
    const chats = lsGet(LS.CHATS, []);
    const skills = lsGet(LS.SKILLS, {});
    const errors = lsGet(LS.ERRORS, []);

    let totalMsg = 0;
    chats.forEach(c => totalMsg += (c.messages ? c.messages.length : 0));
    const today = new Date().toDateString();
    const todaysMsgs = chats.reduce((acc, c) => {
      return acc + (c.messages || []).filter(m => new Date(m.timestamp).toDateString() === today).length;
    }, 0);

    // 4 KPI kutucuğu
    if (dom.dashKPI1) dom.dashKPI1.textContent = String(chats.length);
    if (dom.dashKPI2) dom.dashKPI2.textContent = String(totalMsg);
    const s = lsGet(LS.SETTINGS, {});
    const activeM = MODELS[s.currentModel] || MODELS.flashlite;
    if (dom.dashKPI3) dom.dashKPI3.textContent = (activeM.shortName || activeM.name || '-').toString();
    if (dom.dashKPI4) dom.dashKPI4.textContent = String(perf.likes || 0);

    // 7 günlük bar chart (rastgele + gerçek veriyi birleştir)
    if (dom.dashWeeklyChart) {
      const bars = [];
      const last7 = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        last7.push(d);
      }
      const maxVal = Math.max(1, ...last7.map(() => Math.round(Math.random() * 8 + 2)));
      last7.forEach((d, i) => {
        const value = chats.reduce((acc, c) => {
          return acc + (c.messages || []).filter(m => new Date(m.timestamp).toDateString() === d.toDateString()).length;
        }, 0) + Math.round(Math.random() * 3);
        const height = Math.max(4, (value / Math.max(1, maxVal)) * 100);
        const dayName = d.toLocaleDateString('tr-TR', { weekday: 'short' });
        bars.push(`
          <div class="bar-col" title="${d.toLocaleDateString('tr-TR')}: ${value} mesaj">
            <div class="bar-value">${value}</div>
            <div class="bar-fill" style="height:${height}%"></div>
            <div class="bar-label">${dayName}</div>
          </div>
        `);
      });
      dom.dashWeeklyChart.innerHTML = bars.join('');
    }

    // Top 5 beceri
    if (dom.dashTopSkills) {
      const top = Object.entries(skills)
        .sort((a, b) => (b[1].level || 0) - (a[1].level || 0))
        .slice(0, 5);
      dom.dashTopSkills.innerHTML = top.length === 0
        ? '<p class="empty-state">Henüz beceri yok.</p>'
        : top.map(([name, info], idx) => {
            const lvl = Math.round(info.level || 0);
            return `
              <div class="top-skill-row">
                <span class="top-skill-rank">${idx + 1}</span>
                <span class="top-skill-name">${escapeHtml(name)}</span>
                <span class="top-skill-bar">
                  <span style="width:${(lvl / 99 * 100).toFixed(0)}%"></span>
                </span>
                <span class="top-skill-level">${lvl}</span>
              </div>
            `;
          }).join('');
    }

    // Son 10 aktivite
    if (dom.dashRecentActivity) {
      const acts = [];
      chats.slice().sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5).forEach(c => {
        acts.push({
          time: c.updatedAt,
          icon: '💬',
          text: `"${escapeHtml(c.title || 'Yeni Sohbet')}" güncellendi`,
          tone: 'chat'
        });
      });
      (perf.history || []).slice().reverse().slice(0, 3).forEach(h => {
        acts.push({
          time: h.date,
          icon: h.action === 'like' ? '👍' : h.action === 'dislike' ? '👎' : '⚡',
          text: `Geri bildirim: ${h.action === 'like' ? 'Beğeni (puan: ' + h.score + ')' : h.action === 'dislike' ? 'Beğenmeme (puan: ' + h.score + ')' : 'Puan güncellemesi: ' + h.score}`,
          tone: 'perf'
        });
      });
      errors.slice(0, 3).forEach(e => {
        acts.push({
          time: e.timestamp,
          icon: '⚠️',
          text: `Hata kaydı: ${escapeHtml(truncate(e.reason || '', 50))}`,
          tone: 'error'
        });
      });
      const sorted = acts
        .sort((a, b) => new Date(b.time) - new Date(a.time))
        .slice(0, 10);
      dom.dashRecentActivity.innerHTML = sorted.length === 0
        ? '<p class="empty-state">Henüz aktivite yok.</p>'
        : sorted.map(a => `
            <div class="activity-item tone-${a.tone || 'neutral'}">
              <span class="activity-icon">${a.icon}</span>
              <div class="activity-body">
                <div class="activity-text">${a.text}</div>
                <div class="activity-time">${formatDate(a.time)}</div>
              </div>
            </div>
          `).join('');
    }

    // Uygulama bilgileri
    if (dom.dashAppInfo) {
      const settings = lsGet(LS.SETTINGS);
      const currentModelKey = settings.currentModel || 'flash';
      const mm = MODELS[currentModelKey] || MODELS.flash;
      const ver = '1.2 (Flash + FlashLite)';
      const nav = (typeof navigator !== 'undefined') ? (navigator.userAgentData && navigator.userAgentData.platform ? navigator.userAgentData.platform : navigator.platform) : 'Unknown';
      const storageTotal = (function () {
        let t = 0; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); t += (k ? new Blob([localStorage.getItem(k) || '']).size : 0); } } catch {} return formatBytes(t);
      })();
      dom.dashAppInfo.innerHTML = `
        <li><span>📱 Uygulama</span><span>BilalAI v${ver}</span></li>
        <li><span>🤖 Aktif Model</span><span>${mm.icon} ${mm.name}</span></li>
        <li><span>🎨 Tema</span><span>${(settings.theme || 'dark') === 'dark' ? '🌙 Koyu' : '☀️ Açık'}</span></li>
        <li><span>💾 Depolama</span><span>${storageTotal}</span></li>
        <li><span>🖥️ Platform</span><span>${escapeHtml(nav)}</span></li>
        <li><span>🕒 Oturum</span><span>${new Date().toLocaleString('tr-TR')}</span></li>
      `;
    }
  }

  /* ================================================================
     MODELLER SEKMESİ (3)
     ================================================================ */
  function renderAdminModels() {
    // LS'den özel eklenmiş modelleri de al
    const extraKey = 'bilalai_custom_models';
    const extra = lsGet(extraKey, {});
    const merged = Object.assign({}, MODELS, extra || {});

    if (dom.modelsList) {
      const entries = Object.entries(merged);
      dom.modelsList.innerHTML = entries.length === 0
        ? '<p class="empty-state">Model bulunamadı.</p>'
        : entries.map(([key, m]) => {
            const defaultModelKey = (lsGet(LS.SETTINGS).currentModel || 'flash');
            const isDefault = key === defaultModelKey;
            const isBuiltIn = !!MODELS[key];
            return `
              <div class="models-admin-list-item ${isDefault ? 'is-default' : ''}" data-model-key="${escapeHtml(key)}">
                <div class="models-admin-head">
                  <div class="models-admin-icon" style="background:${m.color || '#888'}">${m.icon || '🤖'}</div>
                  <div class="models-admin-info">
                    <div class="models-admin-name">
                      ${escapeHtml(m.name || key)}
                      ${isDefault ? '<span class="badge badge-default">Varsayılan</span>' : ''}
                      ${isBuiltIn ? '<span class="badge badge-builtin">Dahili</span>' : '<span class="badge badge-custom">Özel</span>'}
                    </div>
                    <div class="models-admin-meta">
                      ${escapeHtml(m.shortName || '')} · Düşünme: ${m.thinkingMs ? m.thinkingMs[0] + '–' + m.thinkingMs[1] + 'ms' : '—'} · Stil: ${escapeHtml(m.style || '')}
                    </div>
                  </div>
                </div>
                <div class="skill-actions">
                  <button data-act="default" ${isDefault ? 'disabled' : ''} class="btn-default">⭐ Varsayılan Yap</button>
                  ${!isBuiltIn ? `<button data-act="delete" class="btn-danger">🗑️ Sil</button>` : ''}
                </div>
              </div>
            `;
          }).join('');
    }

    // defaultModelSelect (Ayarlar sekmesi) doluysa doldur
    if (dom.defaultModelSelect) {
      const settings = lsGet(LS.SETTINGS);
      const current = settings.currentModel || 'flash';
      dom.defaultModelSelect.innerHTML = Object.entries(merged).map(([key, m]) =>
        `<option value="${escapeHtml(key)}" ${key === current ? 'selected' : ''}>${escapeHtml(m.name || key)}</option>`
      ).join('');
    }
  }

  function renderAdminAll() {
    renderAdminDashboard();
    renderAdminPerformance();
    renderAdminModels();
    renderAdminSkills();
    renderAdminErrors();
    renderAdminChats(dom.chatSearch.value || '');
    renderAdminSystemHistory();
    renderStorageInfo();
  }

  function renderAdminPerformance() {
    const perf = lsGet(LS.PERF);
    const skills = lsGet(LS.SKILLS, {});
    const score = Math.round(perf.score);
    dom.perfScore.textContent = score;
    const circ = 2 * Math.PI * 50;
    const offset = circ * (1 - score / 100);
    dom.gaugeFill.style.strokeDashoffset = offset;
    dom.totalLikes.textContent = perf.likes || 0;
    dom.totalDislikes.textContent = perf.dislikes || 0;

    // Toplam mesaj & sohbet
    const chats = lsGet(LS.CHATS, []);
    let totalMsg = 0;
    chats.forEach(c => totalMsg += (c.messages ? c.messages.length : 0));
    dom.totalMessages.textContent = totalMsg;
    dom.totalChats.textContent = chats.length;

    // Başarı oranı (likes / (likes+dislikes)
    const likes = Number(perf.likes || 0);
    const dislikes = Number(perf.dislikes || 0);
    const denom = likes + dislikes;
    const rate = denom > 0 ? Math.round(likes / denom * 100) : 0;
    if (dom.successRate) dom.successRate.textContent = '%' + rate;

    // Ortalama beceri seviyesi
    const skillEntries = Object.values(skills || {});
    const avgSkill = skillEntries.length === 0 ? 0 :
      Math.round(skillEntries.reduce((a, b) => a + (Number(b.level) || 0), 0) / skillEntries.length);
    if (dom.avgSkillLevel) dom.avgSkillLevel.textContent = (avgSkill || 0).toFixed(1) + ' / 99';
  }

  function renderAdminSkills() {
    const skills = lsGet(LS.SKILLS);
    dom.skillsList.innerHTML = '';
    const frag = document.createDocumentFragment();
    const entries = Object.entries(skills).sort((a, b) => b[1].level - a[1].level);
    entries.forEach(([name, info]) => {
      const level = Math.max(0, Math.min(99, Number(info.level) || 0));
      const el = document.createElement('div');
      el.className = 'skill-item';
      el.dataset.skillName = escapeHtml(name);
      el.innerHTML = `
        <div class="skill-header">
          <span class="skill-name">${escapeHtml(name)}</span>
          <span class="skill-level-num">${level.toFixed(0)} / 99</span>
        </div>
        <div class="skill-bar"><div class="skill-bar-fill" style="width:${(level / 99 * 100).toFixed(1)}%"></div></div>
        <div class="skill-practices">Pratik sayısı: <strong>${info.practices || 0}</strong></div>
        <div class="skill-actions">
          <button class="skill-btn boost" data-act="boost">⬆️ +5 Puan</button>
          <input type="range" min="0" max="99" value="${Math.round(level)}" class="skill-slider" data-act="slider" />
          <button class="skill-btn remove" data-act="remove">🗑️ Sil</button>
        </div>
      `;
      frag.appendChild(el);
    });
    if (entries.length === 0) {
      dom.skillsList.innerHTML = '<p class="empty-state">Henüz beceri verisi yok.</p>';
    } else {
      dom.skillsList.appendChild(frag);
    }
  }

  function renderAdminErrors() {
    const errors = lsGet(LS.ERRORS, []);
    dom.errorLogList.innerHTML = '';

    // Filtre
    let list = errors;
    const filter = dom.errFilter ? (dom.errFilter.value || 'all') : 'all';
    const now = Date.now();
    if (filter === 'day') {
      list = errors.filter(e => now - new Date(e.timestamp).getTime() < 24 * 3600 * 1000);
    } else if (filter === 'week') {
      list = errors.filter(e => now - new Date(e.timestamp).getTime() < 7 * 24 * 3600 * 1000);
    } else if (filter === 'resolved') {
      list = errors.filter(e => !!e.resolved);
    } else if (filter === 'unresolved') {
      list = errors.filter(e => !e.resolved);
    }

    if (list.length === 0) {
      dom.errorLogList.innerHTML = '<p class="empty-state">Bu filtre için hata bulunamadı.</p>';
      return;
    }
    const frag = document.createDocumentFragment();
    list.slice(0, 120).forEach((err, idx) => {
      const resolved = !!err.resolved;
      const severity = (idx < 3) ? 'high' : (idx < 8 ? 'med' : 'low');
      const el = document.createElement('div');
      el.className = 'error-item ' + (resolved ? 'error-resolved' : ('sev-' + severity));
      el.dataset.errIdx = String(idx);
      el.innerHTML = `
        <div class="error-head">
          <div class="error-time">${formatDate(err.timestamp)}</div>
          <span class="error-level sev-${severity}">${severity === 'high' ? 'KRİTİK' : severity === 'med' ? 'ORTA' : 'DÜŞÜK'}</span>
          ${resolved ? '<span class="badge badge-resolved">✅ Düzeltildi</span>' : ''}
        </div>
        <div class="error-field"><span class="error-field-label">👤 Kullanıcı:</span><span class="error-field-content">${escapeHtml(truncate(err.userMessage, 120))}</span></div>
        <div class="error-field"><span class="error-field-label">🤖 Yanıt:</span><span class="error-field-content">${escapeHtml(truncate(err.aiResponse, 120))}</span></div>
        <div class="error-field"><span class="error-field-label">📌 Neden:</span><span class="error-field-content">${escapeHtml(truncate(err.reason, 80))}</span></div>
        <div class="error-field"><span class="error-field-label">🔧 Düzeltme Notu:</span><span class="error-field-content">${escapeHtml(truncate(err.correctionNote, 120))}</span></div>
        <div class="skill-actions">
          <button class="skill-btn resolve-btn" data-act="resolve">${resolved ? '↩️ Geri Al' : '✅ Düzeltildi İşaretle'}</button>
          <button class="skill-btn danger" data-act="delete">🗑️ Sil</button>
        </div>
      `;
      frag.appendChild(el);
    });
    dom.errorLogList.appendChild(frag);
  }

  function renderAdminChats(filter) {
    const chats = lsGet(LS.CHATS, []);
    dom.adminChatsList.innerHTML = '';

    // Sıralama (chatSortBy)
    const sortBy = dom.chatSortBy ? (dom.chatSortBy.value || 'updated_desc') : 'updated_desc';
    let sorted = [...chats];
    if (sortBy === 'updated_desc') sorted.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    else if (sortBy === 'updated_asc') sorted.sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt));
    else if (sortBy === 'created_desc') sorted.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sortBy === 'messages_desc') sorted.sort((a, b) => ((b.messages || []).length) - ((a.messages || []).length));
    else if (sortBy === 'title_asc') sorted.sort((a, b) => String(a.title || '').localeCompare(b.title || '', 'tr'));

    // Filtreleme (kelime arama)
    const q = (filter || '').trim().toLowerCase();
    const filtered = q
      ? sorted.filter(c =>
          (c.title || '').toLowerCase().includes(q) ||
          (c.messages || []).some(m => (m.content || '').toLowerCase().includes(q)))
      : sorted;

    if (chats.length === 0) {
      dom.adminChatsList.innerHTML = '<p class="empty-state">Henüz kayıtlı sohbet yok.</p>';
    } else if (filtered.length === 0) {
      dom.adminChatsList.innerHTML = '<p class="empty-state">Eşleşen sohbet bulunamadı.</p>';
    }

    // Seçili sohbetleri tut (state.selectedChats)
    state.selectedChats = state.selectedChats || new Set();

    // Seçim sayacı
    if (dom.selectedChatsCount) dom.selectedChatsCount.textContent = String(state.selectedChats.size);

    // Tümünü seç checkbox
    if (dom.selectAllChats) {
      dom.selectAllChats.checked = filtered.length > 0 && filtered.every(c => state.selectedChats.has(c.id));
    }

    if (filtered.length === 0) return;

    const frag = document.createDocumentFragment();
    filtered.forEach(chat => {
      const msgs = chat.messages || [];
      const lastMsg = msgs[msgs.length - 1];
      const checked = state.selectedChats.has(chat.id);
      const el = document.createElement('div');
      el.className = 'admin-chat-item' + (checked ? ' selected' : '');
      el.innerHTML = `
        <label class="chat-check-wrap">
          <input type="checkbox" class="chat-check" ${checked ? 'checked' : ''} data-chat-id="${escapeHtml(chat.id)}" />
        </label>
        <div class="admin-chat-title">
          <span>${escapeHtml(chat.title || 'Yeni Sohbet')}</span>
          <small style="color:var(--text-muted);font-weight:400;">${formatDate(chat.updatedAt || chat.createdAt)}</small>
        </div>
        <div class="admin-chat-meta">
          <span>💬 ${msgs.length} mesaj</span>
          <span>🆔 ${chat.id.slice(-6)}</span>
        </div>
        <div class="admin-chat-preview">${lastMsg ? escapeHtml(truncate(lastMsg.content, 140)) : '— Henüz mesaj yok —'}</div>
        <div class="admin-chat-item-actions">
          <button data-action="open">Sohbete Git</button>
          <button data-action="export-json">JSON</button>
          <button data-action="export-txt">TXT</button>
          <button class="del-btn" data-action="delete">Sil</button>
        </div>
      `;
      el.addEventListener('click', (e) => {
        // checkbox click
        if (e.target && e.target.matches('.chat-check')) {
          e.stopPropagation();
          const id = e.target.dataset.chatId;
          if (e.target.checked) state.selectedChats.add(id);
          else state.selectedChats.delete(id);
          el.classList.toggle('selected', e.target.checked);
          if (dom.selectedChatsCount) dom.selectedChatsCount.textContent = String(state.selectedChats.size);
          if (dom.selectAllChats) dom.selectAllChats.checked = filtered.length > 0 && filtered.every(c => state.selectedChats.has(c.id));
          return;
        }
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'open') {
          switchChat(chat.id);
          closeAdminModal();
          showToast('✅ Sohbet açıldı');
        } else if (action === 'delete') {
          deleteChat(chat.id, null);
          state.selectedChats.delete(chat.id);
          renderAdminChats(dom.chatSearch.value || '');
        } else if (action === 'export-json') {
          downloadBlob(JSON.stringify(chat, null, 2), `sohbet_${chat.id.slice(-6)}.json`, 'application/json');
        } else if (action === 'export-txt') {
          downloadBlob(chatToTxt(chat), `sohbet_${chat.id.slice(-6)}.txt`, 'text/plain;charset=utf-8');
        }
      });
      frag.appendChild(el);
    });
    dom.adminChatsList.appendChild(frag);
  }

  function chatToTxt(chat) {
    const lines = [];
    lines.push(`==== BilalAI Sohbet Dökümü ====`);
    lines.push(`Başlık: ${chat.title}`);
    lines.push(`Oluşturulma: ${formatDate(chat.createdAt)}`);
    lines.push(`Güncelleme: ${formatDate(chat.updatedAt)}`);
    lines.push(`ID: ${chat.id}`);
    lines.push('');
    (chat.messages || []).forEach(m => {
      const roleMap = { user: 'KULLANICI', assistant: 'BILALAI', founder: 'KURUCU', system: 'SISTEM' };
      lines.push(`[${formatDate(m.timestamp)}] ${roleMap[m.role] || m.role}`);
      lines.push(`${m.content}`);
      lines.push('----------------------------------------');
    });
    return lines.join('\n');
  }

  function renderAdminSystemHistory() {
    const msgs = lsGet(LS.SYS_MSGS, []);
    if (msgs.length === 0) {
      dom.systemMsgHistory.innerHTML = '<p class="empty-state">Henüz sistem mesajı gönderilmedi.</p>';
      return;
    }
    dom.systemMsgHistory.innerHTML = '';
    const frag = document.createDocumentFragment();
    msgs.slice(0, 50).forEach(m => {
      const el = document.createElement('div');
      el.className = 'sys-msg-item';
      el.innerHTML = `
        <div class="sys-msg-time">${formatDate(m.timestamp)}</div>
        <div class="sys-msg-content">${escapeHtml(m.content)}</div>
      `;
      frag.appendChild(el);
    });
    dom.systemMsgHistory.appendChild(frag);
  }

  function renderStorageInfo() {
    const keys = Object.values(LS);
    const rows = keys.map(k => {
      let size = 0;
      try {
        const raw = localStorage.getItem(k);
        size = raw ? new Blob([raw]).size : 0;
      } catch {}
      return `<li><span>${escapeHtml(k)}</span><span>${formatBytes(size)}</span></li>`;
    }).join('');
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) total += new Blob([localStorage.getItem(k) || '']).size;
      }
    } catch {}
    dom.storageInfo.innerHTML = rows + `<li style="border-top:2px solid var(--accent);margin-top:6px;padding-top:10px;"><strong>TOPLAM</strong><span>${formatBytes(total)}</span></li>`;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  function exportAllJson() {
    const all = {
      exportedAt: new Date().toISOString(),
      app: 'BilalAI 1.1 - Flash',
      chats: lsGet(LS.CHATS, []),
      performance: lsGet(LS.PERF),
      skills: lsGet(LS.SKILLS),
      errorLog: lsGet(LS.ERRORS, []),
      settings: lsGet(LS.SETTINGS),
      systemMessages: lsGet(LS.SYS_MSGS, [])
    };
    downloadBlob(JSON.stringify(all, null, 2), `bilalai_backup_${Date.now()}.json`, 'application/json');
    showToast('⬇️ Tüm veriler JSON olarak indirildi.', 'success');
  }

  function exportAllTxt() {
    const chats = lsGet(LS.CHATS, []);
    const header = [
      '==== BilalAI 1.1 - Flash | TÜM SOHBETLER ====',
      `Dışa Aktarım: ${new Date().toLocaleString('tr-TR')}`,
      `Toplam Sohbet: ${chats.length}`,
      '', ''
    ].join('\n');
    const all = header + chats.map(chatToTxt).join('\n\n\n');
    downloadBlob(all, `bilalai_tum_sohbetler_${Date.now()}.txt`, 'text/plain;charset=utf-8');
    showToast('⬇️ Tüm konuşmalar TXT olarak indirildi.', 'success');
  }

  function resetAllMemory() {
    if (!confirm('❗ DİKKAT: Tüm sohbetler, performans, beceri ve hata kayıtları kalıcı olarak silinecek.\n\nDevam etmek istiyor musunuz?')) return;
    if (!confirm('Son onay: Bu işlem geri alınamaz. Emin misiniz?')) return;
    Object.values(LS).forEach(k => localStorage.removeItem(k));
    initStorage();
    loadChats();
    renderChatList();
    renderMessages();
    renderAdminAll();
    applyTheme();
    applyModelToUI();
    showToast('🧠 Tüm hafıza sıfırlandı, temiz durum.', 'success');
  }

  /* ========== Event Bağlantıları ========== */
  function bindEvents() {
    // Chat actions
    dom.newChatBtn.addEventListener('click', createNewChat);
    dom.themeToggle.addEventListener('click', toggleTheme);
    dom.sidebarToggle.addEventListener('click', () => dom.sidebar.classList.toggle('collapsed'));
    dom.openSidebarBtn.addEventListener('click', () => dom.sidebar.classList.add('mobile-open'));
    dom.clearChatBtn.addEventListener('click', clearCurrentChat);

    // Sidebar outside click kapatma (mobil)
    document.addEventListener('click', (e) => {
      if (dom.sidebar.classList.contains('mobile-open') &&
          !dom.sidebar.contains(e.target) &&
          !dom.openSidebarBtn.contains(e.target)) {
        dom.sidebar.classList.remove('mobile-open');
      }
    });

    // Mesaj gönderme
    dom.sendBtn.addEventListener('click', sendMessage);
    dom.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
    dom.messageInput.addEventListener('input', autoResizeTextarea);

    // Model Modal (tıklanabilir rozet + kapatma + kart seçimi)
    if (dom.modelBadgeBtn) {
      dom.modelBadgeBtn.addEventListener('click', openModelModal);
    }
    if (dom.closeModelModal) {
      dom.closeModelModal.addEventListener('click', closeModelModalFn);
    }
    if (dom.modelModal) {
      dom.modelModal.addEventListener('click', (e) => {
        if (e.target === dom.modelModal) closeModelModalFn();
      });
    }
    document.addEventListener('click', (e) => {
      const card = e.target.closest('.model-card');
      if (!card) return;
      const modelKey = card.dataset.model;
      if (modelKey) {
        selectModel(modelKey);
        closeModelModalFn();
      }
    });

    // Suggestion chips (data-suggest ile)
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const text = chip.dataset.suggest;
      if (!text) return;
      dom.messageInput.value = text;
      autoResizeTextarea();
      sendMessage();
    });

    // Input toolbar hızlı butonları (data-quick)
    const QUICK_ACTIONS = {
      'python-hello':      "Bana basit bir python kodu yaz. print('hello') gibi",
      'js-hello':          "JavaScript ile basit bir hello world örneği yaz",
      'python-factorial':  "Python ile faktöriyel hesaplayan basit bir fonksiyon yaz",
      'js-fibonacci':      "JavaScript ile fibonacci dizisini yazan basit bir örnek",
      'js-todo':           "JavaScript ile modern bir todo uygulaması yaz",
      'movie-suggest':     "Bana en az 3 tane iyi film öner",
      'joke':              "Bana yazılım temalı komik bir espri yap",
      'slash-help':        "/help"
    };
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.input-toolbar-btn');
      if (!btn) return;
      const key = btn.dataset.quick;
      if (!key || !QUICK_ACTIONS[key]) return;
      dom.messageInput.value = QUICK_ACTIONS[key];
      autoResizeTextarea();
      sendMessage();
    });

    // Admin giriş
    dom.secretFounderBtn.addEventListener('click', openAdminModal);
    document.addEventListener('keydown', (e) => {
      // Ctrl + Shift + A  veya Cmd + Shift + A
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        openAdminModal();
      }
      // ESC ile kapat (admin + model modal)
      if (e.key === 'Escape') {
        if (dom.adminModal && dom.adminModal.classList.contains('active')) {
          closeAdminModal();
        } else if (dom.modelModal && dom.modelModal.classList.contains('active')) {
          closeModelModalFn();
        }
      }
    });

    dom.adminCloseBtn.addEventListener('click', closeAdminModal);
    dom.adminClosePanelBtn.addEventListener('click', closeAdminModal);
    dom.adminModal.addEventListener('click', (e) => {
      if (e.target === dom.adminModal) closeAdminModal();
    });

    dom.adminLoginBtn.addEventListener('click', tryAdminLogin);
    dom.founderPassword.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); tryAdminLogin(); }
    });

    // Admin sekmeler
    $$('.admin-tab').forEach(tab => {
      tab.addEventListener('click', () => switchAdminTab(tab.dataset.tab));
    });

    // Admin sohbet arama
    let searchT;
    dom.chatSearch.addEventListener('input', (e) => {
      clearTimeout(searchT);
      const v = e.target.value;
      searchT = setTimeout(() => renderAdminChats(v), 180);
    });

    // Sistem mesajı gönderme
    dom.sendSystemMsgBtn.addEventListener('click', () => {
      const text = dom.systemMsgInput.value;
      if (!text || !text.trim()) {
        showToast('⚠️ Sistem mesajı boş olamaz.', 'error');
        return;
      }
      sendSystemMessage(text.trim());
      dom.systemMsgInput.value = '';
      renderAdminSystemHistory();
      closeAdminModal();
    });

    // Dışa aktarım & sıfırlama
    dom.exportJsonBtn.addEventListener('click', exportAllJson);
    dom.exportTxtBtn.addEventListener('click', exportAllTxt);
    dom.resetMemoryBtn.addEventListener('click', resetAllMemory);

    // ===== YENİ EVENTLER: PERFORMANS SEKMESİ =====
    if (dom.boostPerfBtn) dom.boostPerfBtn.addEventListener('click', () => {
      const p = lsGet(LS.PERF);
      p.score = Math.min(100, Number(p.score || 0) + 10);
      p.history = p.history || [];
      p.history.push({ date: new Date().toISOString(), action: 'boost', score: p.score });
      lsSet(LS.PERF, p);
      renderAdminPerformance();
      showToast('✨ Performans puanı +10 arttırıldı!', 'success');
    });
    if (dom.resetSkillsPerfBtn) dom.resetSkillsPerfBtn.addEventListener('click', () => {
      if (!confirm('Beceri seviyelerini ve performans puanını sıfırlamak istiyor musunuz?')) return;
      lsSet(LS.SKILLS, structuredClone(DEFAULT_SKILLS));
      const p = lsGet(LS.PERF); p.score = 75; p.likes = 0; p.dislikes = 0; p.history = []; lsSet(LS.PERF, p);
      renderAdminSkills(); renderAdminPerformance();
      showToast('🔄 Beceriler ve performans sıfırlandı.', 'success');
    });

    // ===== YENİ EVENTLER: MODELLER SEKMESİ =====
    if (dom.addModelBtn) dom.addModelBtn.addEventListener('click', () => {
      const name = (dom.newModelName.value || '').trim();
      if (!name) { showToast('⚠️ Model adı gerekli.', 'error'); return; }
      const shortName = (dom.newModelShort.value || '').trim() || name.slice(0, 10);
      const icon = (dom.newModelIcon.value || '🤖').trim() || '🤖';
      const color = (dom.newModelColor.value || '#8B5CF6').trim() || '#8B5CF6';
      const thinkingStr = (dom.newModelThinking.value || '800-1800').trim();
      const [tmin, tmax] = thinkingStr.split('-').map(x => parseInt(x, 10));
      const thinkingMs = [isNaN(tmin) ? 800 : tmin, isNaN(tmax) ? 1800 : tmax];
      const style = (dom.newModelDesc.value || '').trim() || 'Özel model';
      const extraKey = 'bilalai_custom_models';
      const extra = lsGet(extraKey, {});
      const key = 'custom_' + Date.now().toString(36);
      extra[key] = { name, shortName, icon, color, thinkingMs, style, engine: 'BilalAIResponseEngine' };
      lsSet(extraKey, extra);
      dom.newModelName.value = '';
      dom.newModelShort.value = '';
      dom.newModelDesc.value = '';
      renderAdminModels(); renderAdminAll();
      showToast('💾 Yeni model kaydedildi: ' + name, 'success');
    });
    // Modeller listesinde action butonları (delegasyon)
    document.addEventListener('click', (e) => {
      const li = e.target.closest('.models-admin-list-item');
      if (!li) return;
      const key = li.dataset.modelKey;
      if (!key) return;
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'default') {
        const s = lsGet(LS.SETTINGS);
        s.currentModel = key;
        lsSet(LS.SETTINGS, s);
        applyModelToUI();
        renderAdminModels();
        showToast('⭐ Varsayılan model güncellendi.', 'success');
      } else if (act === 'delete') {
        if (!confirm('Bu özel modeli silmek istiyor musunuz?')) return;
        const extraKey = 'bilalai_custom_models';
        const extra = lsGet(extraKey, {});
        delete extra[key];
        lsSet(extraKey, extra);
        const s = lsGet(LS.SETTINGS);
        if (s.currentModel === key) { s.currentModel = 'flashlite'; lsSet(LS.SETTINGS, s); applyModelToUI(); }
        renderAdminModels(); renderAdminAll();
        showToast('🗑️ Model silindi.', 'success');
      }
    });

    // ===== YENİ EVENTLER: SOHBETLER SEKMESİ =====
    if (dom.chatSortBy) dom.chatSortBy.addEventListener('change', () => renderAdminChats(dom.chatSearch.value || ''));
    if (dom.selectAllChats) dom.selectAllChats.addEventListener('change', (e) => {
      const chats = lsGet(LS.CHATS, []);
      state.selectedChats = state.selectedChats || new Set();
      if (e.target.checked) chats.forEach(c => state.selectedChats.add(c.id));
      else state.selectedChats.clear();
      renderAdminChats(dom.chatSearch.value || '');
    });
    if (dom.exportSelectedChatsBtn) dom.exportSelectedChatsBtn.addEventListener('click', () => {
      state.selectedChats = state.selectedChats || new Set();
      if (state.selectedChats.size === 0) { showToast('⚠️ Lütfen önce sohbet seçin.', 'error'); return; }
      const chats = lsGet(LS.CHATS, []).filter(c => state.selectedChats.has(c.id));
      downloadBlob(JSON.stringify(chats, null, 2), `secili_sohbetler_${Date.now()}.json`, 'application/json');
      showToast('📥 ' + chats.length + ' sohbet JSON olarak indirildi.', 'success');
    });
    if (dom.deleteSelectedChatsBtn) dom.deleteSelectedChatsBtn.addEventListener('click', () => {
      state.selectedChats = state.selectedChats || new Set();
      if (state.selectedChats.size === 0) { showToast('⚠️ Lütfen önce sohbet seçin.', 'error'); return; }
      if (!confirm(state.selectedChats.size + ' sohbeti silmek istiyor musunuz?')) return;
      const chats = lsGet(LS.CHATS, []).filter(c => !state.selectedChats.has(c.id));
      lsSet(LS.CHATS, chats);
      if (state.currentChatId && state.selectedChats.has(state.currentChatId)) state.currentChatId = null;
      state.selectedChats.clear();
      loadChats(); ensureChatExists(); renderChatList(); renderMessages();
      renderAdminChats(dom.chatSearch.value || ''); renderAdminAll();
      showToast('🗑️ Seçili sohbetler silindi.', 'success');
    });

    // ===== YENİ EVENTLER: BECERİLER SEKMESİ =====
    // newSkillLevel değeri yanındaki span'ı güncelle
    const newSkillLevelEl = document.getElementById('newSkillLevel');
    const newSkillLevelValEl = document.getElementById('newSkillLevelValue');
    if (newSkillLevelEl && newSkillLevelValEl) {
      newSkillLevelEl.addEventListener('input', (e) => { newSkillLevelValEl.textContent = String(e.target.value); });
    }
    if (dom.trainSkillsBtn) dom.trainSkillsBtn.addEventListener('click', () => {
      const skills = lsGet(LS.SKILLS, {});
      Object.keys(skills).forEach(k => {
        skills[k].level = Math.min(99, Number(skills[k].level || 0) + randInt(0, 8));
        skills[k].practices = (skills[k].practices || 0) + 1;
      });
      lsSet(LS.SKILLS, skills);
      renderAdminSkills();
      showToast('🎲 Tüm beceriler rastgele eğitildi!', 'success');
    });
    if (dom.resetSkillsBtn) dom.resetSkillsBtn.addEventListener('click', () => {
      if (!confirm('Tüm becerileri varsayılan seviyeye sıfırlamak istiyor musunuz?')) return;
      lsSet(LS.SKILLS, structuredClone(DEFAULT_SKILLS));
      renderAdminSkills(); renderAdminPerformance(); renderAdminDashboard();
      showToast('🔄 Beceriler sıfırlandı.', 'success');
    });
    if (dom.addNewSkillBtn) dom.addNewSkillBtn.addEventListener('click', () => {
      const name = (dom.newSkillName.value || '').trim();
      if (!name) { showToast('⚠️ Beceri adı gerekli.', 'error'); return; }
      const skills = lsGet(LS.SKILLS, {});
      const lvl = dom.newSkillLevel ? Number(dom.newSkillLevel.value) || 60 : 60;
      if (skills[name]) { showToast('⚠️ Bu beceri zaten var.', 'error'); return; }
      skills[name] = { level: Math.max(0, Math.min(99, lvl)), practices: 0 };
      lsSet(LS.SKILLS, skills);
      dom.newSkillName.value = '';
      if (dom.newSkillLevel) dom.newSkillLevel.value = 60;
      if (newSkillLevelValEl) newSkillLevelValEl.textContent = '60';
      renderAdminSkills(); renderAdminPerformance(); renderAdminDashboard();
      showToast('✅ Yeni beceri eklendi: ' + name, 'success');
    });
    // Beceri listesi action delegasyonu (+5 puan, slider, sil)
    document.addEventListener('click', (e) => {
      const si = e.target.closest('.skill-item');
      if (!si) return;
      const name = si.dataset.skillName;
      if (!name) return;
      const skills = lsGet(LS.SKILLS, {});
      if (!skills[name]) return;
      const boostBtn = e.target.closest('.skill-btn.boost');
      const removeBtn = e.target.closest('.skill-btn.remove');
      if (boostBtn) {
        skills[name].level = Math.min(99, Number(skills[name].level || 0) + 5);
        skills[name].practices = (skills[name].practices || 0) + 1;
        lsSet(LS.SKILLS, skills);
        renderAdminSkills(); renderAdminPerformance(); renderAdminDashboard();
        showToast('⬆️ ' + name + ' +5 puan kazandı!', 'success');
      } else if (removeBtn) {
        if (!confirm(name + ' becerisini silmek istiyor musunuz?')) return;
        delete skills[name];
        lsSet(LS.SKILLS, skills);
        renderAdminSkills(); renderAdminPerformance(); renderAdminDashboard();
        showToast('🗑️ Beceri silindi.', 'success');
      }
    });
    // Beceri slider delegasyonu
    document.addEventListener('input', (e) => {
      const sl = e.target.closest('.skill-slider');
      if (!sl) return;
      const si = sl.closest('.skill-item');
      if (!si) return;
      const name = si.dataset.skillName;
      if (!name) return;
      const val = Number(sl.value) || 0;
      const skills = lsGet(LS.SKILLS, {});
      if (skills[name]) {
        skills[name].level = Math.max(0, Math.min(99, val));
        lsSet(LS.SKILLS, skills);
        si.querySelector('.skill-level-num').textContent = Math.round(skills[name].level) + ' / 99';
        si.querySelector('.skill-bar-fill').style.width = (skills[name].level / 99 * 100).toFixed(1) + '%';
        renderAdminPerformance();
      }
    });

    // ===== YENİ EVENTLER: HATA GÜNLÜĞÜ =====
    if (dom.errFilter) dom.errFilter.addEventListener('change', () => renderAdminErrors());
    if (dom.clearErrorsBtn) dom.clearErrorsBtn.addEventListener('click', () => {
      if (!confirm('Tüm hata kayıtlarını silmek istiyor musunuz?')) return;
      lsSet(LS.ERRORS, []);
      renderAdminErrors(); renderAdminDashboard();
      showToast('🧹 Hata günlüğü temizlendi.', 'success');
    });
    // Hata listesi delegasyonu (düzeltildi/sil)
    document.addEventListener('click', (e) => {
      const errItem = e.target.closest('.error-item');
      if (!errItem) return;
      const idx = parseInt(errItem.dataset.errIdx, 10);
      if (isNaN(idx)) return;
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      const errors = lsGet(LS.ERRORS, []);
      const filter = dom.errFilter ? (dom.errFilter.value || 'all') : 'all';
      let list = errors;
      const now = Date.now();
      if (filter === 'day') list = errors.filter(e => now - new Date(e.timestamp).getTime() < 24 * 3600 * 1000);
      else if (filter === 'week') list = errors.filter(e => now - new Date(e.timestamp).getTime() < 7 * 24 * 3600 * 1000);
      const realErr = list[idx];
      if (!realErr) return;
      const realIdx = errors.indexOf(realErr);
      if (realIdx < 0) return;
      if (act === 'resolve') {
        errors[realIdx].resolved = !errors[realIdx].resolved;
        lsSet(LS.ERRORS, errors);
        renderAdminErrors(); renderAdminDashboard();
        showToast(errors[realIdx].resolved ? '✅ Hata düzeltildi olarak işaretlendi.' : '↩️ İşlem geri alındı.', 'success');
      } else if (act === 'delete') {
        if (!confirm('Bu hata kaydını silmek istiyor musunuz?')) return;
        errors.splice(realIdx, 1);
        lsSet(LS.ERRORS, errors);
        renderAdminErrors(); renderAdminDashboard();
        showToast('🗑️ Hata kaydı silindi.', 'success');
      }
    });

    // ===== YENİ EVENTLER: AYARLAR SEKMESİ =====
    if (dom.accentColor) {
      const s = lsGet(LS.SETTINGS, {});
      if (s.accent) dom.accentColor.value = s.accent;
      dom.accentColor.addEventListener('input', (e) => {
        const color = e.target.value;
        document.documentElement.style.setProperty('--accent', color);
        const st = lsGet(LS.SETTINGS, {});
        st.accent = color;
        lsSet(LS.SETTINGS, st);
      });
    }
    if (dom.showWelcomeToggle) {
      const s = lsGet(LS.SETTINGS, {});
      if (typeof s.showWelcome === 'boolean') dom.showWelcomeToggle.checked = s.showWelcome;
      dom.showWelcomeToggle.addEventListener('change', (e) => {
        const st = lsGet(LS.SETTINGS, {});
        st.showWelcome = e.target.checked;
        lsSet(LS.SETTINGS, st);
        if (!st.showWelcome) dom.welcomeScreen.style.display = 'none';
        else { const chat = getCurrentChat(); if (!chat || !chat.messages || chat.messages.length === 0) dom.welcomeScreen.style.display = ''; }
      });
    }
    if (dom.defaultModelSelect) {
      dom.defaultModelSelect.addEventListener('change', (e) => {
        const st = lsGet(LS.SETTINGS, {});
        st.currentModel = e.target.value;
        lsSet(LS.SETTINGS, st);
        applyModelToUI();
        renderAdminModels();
        showToast('🤖 Varsayılan model: ' + (MODELS[e.target.value] ? MODELS[e.target.value].name : e.target.value), 'success');
      });
    }
    if (dom.changePassBtn) dom.changePassBtn.addEventListener('click', () => {
      const oldP = dom.oldPass.value;
      const newP = dom.newPass.value;
      const newP2 = dom.newPass2.value;
      // LS'den kurucu parolasını al (daha önce değiştirildiyse)
      const savedPass = lsGet('bilalai_founder_pass', null);
      const currentPass = savedPass || FOUNDER_PASSWORD;
      if (oldP !== currentPass) { showToast('❌ Mevcut parola yanlış.', 'error'); return; }
      if (!newP || newP.length < 4) { showToast('⚠️ Yeni parola en az 4 karakter olmalı.', 'error'); return; }
      if (newP !== newP2) { showToast('❌ Yeni parolalar eşleşmiyor.', 'error'); return; }
      lsSet('bilalai_founder_pass', newP);
      dom.oldPass.value = ''; dom.newPass.value = ''; dom.newPass2.value = '';
      showToast('🔑 Kurucu parolası güncellendi!', 'success');
    });
  }

  /* ========== Başlangıç ========== */
  function boot() {
    initStorage();
    applyTheme();
    loadChats();
    ensureChatExists();
    renderChatList();
    renderMessages();
    applyModelToUI();
    autoResizeTextarea();
    bindEvents();
    console.log('%c⚡ BilalAI 1.0 - Flash çalışıyor...', 'color:#00BFFF;font-size:14px;font-weight:bold;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
