/* -------------------------------------------------
BilalAI - Pro 1.0  🧠
Bağımsız Agentic Coding Engine

Bu dosya bir "wrapper" DEĞİLDİR. model.js / flashlitemodel.js /
BilalAIResponseEngine üzerine hiçbir şekilde bağımlı değildir ve
normal bir görev sırasında onları ÇAĞIRMAZ.

Amaç: Kullanıcının verdiği yazılım görevini ANALİZ eden, PLAN çıkaran,
yapılacaklar listesini yöneten, proje dosyaları oluşturan/güncelleyen,
GERÇEK çalışan kod üreten, kodu doğrulayan, hata bulursa düzeltmeye
çalışan ve uygun projelerde çalışan bir preview hazırlayan coding agent.

Public API (window.BilalAIPro):
  MODEL
  generate(userMsg, context, options)          -> senkron pipeline
  generateAsync(userMsg, context, options)      -> async pipeline (Promise)
  runTask(userMsg, options)                      -> async agent akışı (Promise)
  analyze(userMsg, options) / plan(userMsg, options) / getPlan(userMsg)
  getChanges()
  getState()
  getTasks()
  getFiles()
  getPreview()
  reset()
  onEvent(callback)
  setWorkspace(adapter)
  selfTest()

Durum akışı:
  IDLE -> ANALYZING -> PLANNING -> SCAFFOLDING -> IMPLEMENTING
       -> VERIFYING -> (FIXING -> VERIFYING)* -> PREVIEWING -> COMPLETED
  Hata: ... -> FAILED
------------------------------------------------- */

(function (root) {
  'use strict';

  /* =================================================
     1. MODEL META + CONFIG
  ================================================= */

  var MODEL = {
    name: 'BilalAI - Pro 1.0',
    shortName: 'Pro 1.0',
    icon: '🧠',
    version: '2026-09-pro1',
    style: 'agentic coding',
  };

  var CONFIG = {
    maxFixAttempts: 3,
    // UI "düşünme" gecikmesi — gerçek iş süresinden BAĞIMSIZ.
    thinkingMs: {
      simple: [800, 1600],
      medium: [1600, 3200],
      complex: [3200, 6000],
      'very-complex': [4000, 7000],
    },
    stepDelayMs: 90,
    debug: false,
  };

  /* =================================================
     2. UTILS
  ================================================= */

  function clone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function randBetween(range) {
    return Math.floor(range[0] + Math.random() * (range[1] - range[0]));
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9);
  }

  // Türkçe karakterleri sadeleştirerek küçük harfe indir (anahtar kelime eşleşmesi).
  function norm(str) {
    return (str == null ? '' : String(str)).toLowerCase()
      .replace(/ı/g, 'i').replace(/İ/g, 'i')
      .replace(/ş/g, 's').replace(/ğ/g, 'g')
      .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c');
  }

  function hasAny(text, words) {
    for (var i = 0; i < words.length; i++) {
      if (text.indexOf(words[i]) !== -1) return true;
    }
    return false;
  }

  function ext(path) {
    var m = /\.([a-z0-9]+)$/i.exec(path || '');
    return m ? m[1].toLowerCase() : '';
  }

  var LANG_BY_EXT = {
    html: 'html', htm: 'html',
    css: 'css',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    json: 'json',
    py: 'python',
    md: 'markdown',
    txt: 'text',
  };

  function langOf(path) {
    return LANG_BY_EXT[ext(path)] || 'text';
  }

  /* =================================================
     3. EVENT BUS
  ================================================= */

  function createEventBus() {
    var listeners = [];

    // İnsan-okur mesajlar (frontend gösterebilir); yalnızca gerçek event olunca üretilir.
    var HUMAN = {
      'task:start': '🧠 Görev başlatılıyor...',
      'task:analyzing': '🧠 Görev analiz ediliyor...',
      'task:planning': '📋 Plan hazırlanıyor...',
      'task:created': '📋 Plan oluşturuldu.',
      'task:started': '▶ Adım başladı.',
      'file:created': '📁 Dosya oluşturuldu.',
      'file:updated': '✏️ Dosya güncellendi.',
      'validation:start': '🔍 Kod kontrol ediliyor...',
      'validation:passed': '✅ Doğrulama geçti.',
      'validation:failed': '🛠 Hata bulundu, düzeltiliyor...',
      'fix:start': '🛠 Düzeltme deneniyor...',
      'fix:completed': '🔁 Tekrar kontrol ediliyor...',
      'preview:start': '👀 Preview hazırlanıyor...',
      'preview:ready': '👀 Preview hazır.',
      'task:completed': '✅ Görev tamamlandı.',
      'task:failed': '❌ Görev başarısız oldu.',
      'status': '',
    };

    return {
      on: function (cb) {
        if (typeof cb === 'function') listeners.push(cb);
        return function off() {
          var i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      emit: function (type, payload) {
        var evt = Object.assign(
          { type: type, message: HUMAN[type] || '', timestamp: Date.now() },
          payload || {}
        );
        if (CONFIG.debug) {
          try { console.log('[v0][BilalAIPro]', type, evt); } catch (e) {}
        }
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](clone(evt)); } catch (e) {
            try { console.log('[v0] event listener error:', e && e.message); } catch (_) {}
          }
        }
        return evt;
      },
      clear: function () { listeners.length = 0; },
    };
  }

  var bus = createEventBus();

  /* =================================================
     4. STATE
  ================================================= */

  function freshState() {
    return {
      status: 'idle', // idle|analyzing|planning|scaffolding|implementing|verifying|fixing|previewing|completed|failed
      task: null,
      plan: [],
      tasks: [],
      files: [],       // {path, content, language, status}
      changes: [],
      notes: [],
      dependencies: [],
      fixes: [],
      detected: [],
      remainingIssues: [],
      validation: null,
      analysis: null,
      events: [],
      errors: [],
      warnings: [],
      tests: [],
      testStatus: 'not_run', // not_run|passed|failed
      preview: null,
      currentStep: null,
      fixAttempts: 0,
      executionAvailable: false, // gerçek runtime executor yok
      startedAt: null,
      finishedAt: null,
    };
  }

  var STATE = freshState();

  function setStatus(status, step) {
    STATE.status = status;
    if (step !== undefined) STATE.currentStep = step;
    bus.emit('status', { status: status, currentStep: STATE.currentStep });
  }

  /* =================================================
     5. WORKSPACE ADAPTER (tek paylaşılan store)
  ================================================= */

  function createWorkspaceAdapter(seed) {
    // TÜM metotlar aynı `store`'u kullanır. Metot başına ayrı store YOK.
    var store = Object.create(null);
    if (seed && typeof seed === 'object') {
      Object.keys(seed).forEach(function (k) { store[k] = String(seed[k]); });
    }
    return {
      kind: 'in-memory',
      listFiles: function () { return Object.keys(store); },
      readFile: function (path) {
        return Object.prototype.hasOwnProperty.call(store, path) ? store[path] : null;
      },
      writeFile: function (path, content) {
        store[path] = content == null ? '' : String(content);
        return true;
      },
      updateFile: function (path, content) {
        store[path] = content == null ? '' : String(content);
        return true;
      },
      deleteFile: function (path) {
        if (Object.prototype.hasOwnProperty.call(store, path)) { delete store[path]; return true; }
        return false;
      },
      exists: function (path) {
        return Object.prototype.hasOwnProperty.call(store, path);
      },
      clear: function () {
        Object.keys(store).forEach(function (k) { delete store[k]; });
        return true;
      },
    };
  }

  // Dışarıdan gelen kısmi adapter'ı tam sözleşmeye tamamlar (aynı örneği korur).
  function ensureWorkspace(ws) {
    if (!ws) return createWorkspaceAdapter();
    var need = ['listFiles', 'readFile', 'writeFile', 'updateFile', 'deleteFile', 'exists', 'clear'];
    var complete = need.every(function (fn) { return typeof ws[fn] === 'function'; });
    if (complete) return ws;
    // Eksik metotlar varsa: tek bir yedek store üzerinden tamamla.
    var fallback = createWorkspaceAdapter();
    need.forEach(function (fn) {
      if (typeof ws[fn] !== 'function') ws[fn] = fallback[fn];
    });
    if (!ws.kind) ws.kind = 'external';
    return ws;
  }

  var defaultWorkspace = createWorkspaceAdapter();

  /* =================================================
     6. WEB ADAPTER (bağlı değilse sahte sonuç ÜRETME)
  ================================================= */

  function createWebAdapter(impl) {
    var connected = !!(impl && typeof impl.search === 'function');
    return {
      isAvailable: function () { return connected; },
      search: function (query) {
        if (connected) return Promise.resolve(impl.search(query));
        return Promise.resolve({ ok: false, available: false, query: query,
          note: 'Web arama adapteri bağlı değil.' });
      },
    };
  }

  /* =================================================
     7. PREVIEW ADAPTER
  ================================================= */

  function createPreviewAdapter(impl) {
    var lastUrl = null;
    var canBlob = typeof Blob !== 'undefined' && typeof URL !== 'undefined' && !!URL.createObjectURL;

    function combine(files) {
      // files: {path: content}
      var htmlKey = null;
      Object.keys(files).forEach(function (k) {
        if (ext(k) === 'html' && (htmlKey === null || /index\.html$/i.test(k))) htmlKey = k;
      });
      if (htmlKey === null) return null;
      var html = files[htmlKey];

      var css = '', js = '';
      Object.keys(files).forEach(function (k) {
        if (ext(k) === 'css') css += '\n/* ' + k + ' */\n' + files[k];
        if (ext(k) === 'js') js += '\n/* ' + k + ' */\n' + files[k];
      });

      // Harici referansları inline gömüyoruz (blob/data URL göreli path çözemez).
      var out = html
        .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '')
        .replace(/<script[^>]+src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');

      if (css) {
        if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, '<style>' + css + '\n</style></head>');
        else out = '<style>' + css + '\n</style>' + out;
      }
      if (js) {
        if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, '<script>\n' + js + '\n<\/script></body>');
        else out = out + '<script>\n' + js + '\n<\/script>';
      }
      return out;
    }

    return {
      isAvailable: function () { return true; },
      previewProject: function (files) {
        if (impl && typeof impl.previewProject === 'function') {
          var r = impl.previewProject(files);
          lastUrl = (r && r.url) || null;
          return r;
        }
        var html = combine(files);
        if (html == null) {
          return { available: false, reason: 'no_html_entry',
            note: 'Preview için index.html bulunamadı.' };
        }
        var url;
        if (canBlob) {
          try {
            if (lastUrl && lastUrl.indexOf('blob:') === 0) URL.revokeObjectURL(lastUrl);
            url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
          } catch (e) {
            url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
          }
        } else {
          url = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
        }
        lastUrl = url;
        return { available: true, type: 'html', url: url, title: 'BilalAI Preview', html: html };
      },
      getPreviewUrl: function () { return lastUrl; },
    };
  }

  var defaultPreview = createPreviewAdapter();

  /* =================================================
     8. ANALYZER (keyword tek başına değil; çok boyutlu)
  ================================================= */

  var Analyzer = (function () {

    // Mesajda açıkça geçen dosya adlarını yakala (index.html, app.js, src/App.jsx ...)
    function extractExplicitFiles(raw) {
      var files = [];
      var re = /([a-z0-9_\-./]+\.(?:html?|css|jsx?|tsx?|mjs|cjs|json|py|txt|md|env))/gi;
      var m;
      while ((m = re.exec(raw))) {
        var f = m[1].replace(/^\.\//, '');
        if (files.indexOf(f) === -1) files.push(f);
      }
      return files;
    }

    function detectTech(t) {
      if (hasAny(t, ['react', 'jsx', 'next', 'nextjs', 'next.js'])) {
        return { technologies: ['react', 'javascript'], language: 'javascript',
          framework: t.indexOf('next') !== -1 ? 'Next.js' : 'React', kind: 'react' };
      }
      if (hasAny(t, ['vue', 'nuxt'])) {
        return { technologies: ['vue', 'javascript'], language: 'javascript', framework: 'Vue', kind: 'vue' };
      }
      if (hasAny(t, ['python', 'discord bot', 'flask', 'django', 'fastapi', '.py'])) {
        var fw = null;
        if (t.indexOf('flask') !== -1) fw = 'Flask';
        else if (t.indexOf('django') !== -1) fw = 'Django';
        else if (t.indexOf('fastapi') !== -1) fw = 'FastAPI';
        return { technologies: ['python'], language: 'python', framework: fw, kind: 'python' };
      }
      if (hasAny(t, ['express', 'node ', 'nodejs', 'node.js'])) {
        return { technologies: ['node', 'javascript'], language: 'javascript',
          framework: t.indexOf('express') !== -1 ? 'Express' : 'Node.js', kind: 'node' };
      }
      // varsayılan: web (html/css/js)
      return { technologies: ['html', 'css', 'javascript'], language: 'javascript', framework: null, kind: 'web' };
    }

    function detectProject(t) {
      if (hasAny(t, ['todo', 'to-do', 'to do', 'yapilacak', 'gorev listesi'])) return 'todo';
      if (hasAny(t, ['hesap makinesi', 'calculator', 'hesaplama'])) return 'calculator';
      if (hasAny(t, ['login', 'giris', 'sign in', 'signin', 'oturum ac', 'kayit ol', 'auth'])) return 'login';
      if (hasAny(t, ['admin', 'dashboard', 'panel', 'yonetim'])) return 'dashboard';
      if (hasAny(t, ['discord'])) return 'discord-bot';
      if (hasAny(t, ['landing', 'tanitim', 'karsilama', 'acilis'])) return 'landing';
      return 'generic';
    }

    function detectFeatures(t) {
      return {
        localStorage: hasAny(t, ['localstorage', 'local storage', 'kalici', 'kaydet', 'sakla', 'depola']),
        preventEmpty: hasAny(t, ['bos gorev', 'bos eklen', 'engelle', 'validation', 'dogrula']),
        enterKey: hasAny(t, ['enter']),
        responsive: hasAny(t, ['responsive', 'mobil', 'masaustu', 'uyumlu']),
        darkTheme: hasAny(t, ['karanlik', 'dark', 'koyu']),
        delete: hasAny(t, ['sil', 'delete', 'kaldir']),
        toggle: hasAny(t, ['tamamla', 'tamamlandi', 'complete', 'isaretle', 'check']),
        animation: hasAny(t, ['animasyon', 'animation', 'gecis', 'transition']),
      };
    }

    function detectComplexity(t, raw, projectType, techKind, fileCount) {
      var simple = ['basit', 'kucuk', 'mini', 'tek dosya', 'ornek', 'sadece'];
      var complex = ['admin', 'dashboard', 'panel', 'buyuk', 'kapsamli', 'komple', 'full', 'auth', 'backend', 'veritabani', 'database', 'refactor'];
      if (hasAny(t, complex) || techKind === 'react' || projectType === 'dashboard' || fileCount > 4) return 'complex';
      if (hasAny(t, simple) || (raw.length < 45 && fileCount <= 1)) return 'simple';
      return 'medium';
    }

    function defaultFiles(techKind, projectType) {
      if (techKind === 'react') {
        if (projectType === 'dashboard') {
          return ['index.html', 'src/main.jsx', 'src/App.jsx',
            'src/components/Sidebar.jsx', 'src/components/Dashboard.jsx',
            'src/components/StatCard.jsx', 'src/styles.css'];
        }
        return ['index.html', 'src/main.jsx', 'src/App.jsx', 'src/styles.css'];
      }
      if (techKind === 'python') {
        if (projectType === 'discord-bot') return ['bot.py', 'requirements.txt', '.env.example'];
        return ['main.py', 'requirements.txt'];
      }
      if (techKind === 'node') return ['index.js', 'package.json'];
      // web
      return ['index.html', 'style.css', 'app.js'];
    }

    function analyze(userMsg) {
      var raw = userMsg == null ? '' : String(userMsg);
      var t = norm(raw);

      var tech = detectTech(t);
      var projectType = detectProject(t);
      var features = detectFeatures(t);

      var explicit = extractExplicitFiles(raw);
      var files = explicit.length ? explicit.slice() : defaultFiles(tech.kind, projectType);

      var complexity = detectComplexity(t, raw, projectType, tech.kind, files.length);

      // Proje tipi (üst-düzey)
      var type = 'web_app';
      if (tech.kind === 'react') type = 'react_app';
      else if (tech.kind === 'python') type = projectType === 'discord-bot' ? 'discord_bot' : 'python_app';
      else if (tech.kind === 'node') type = 'node_app';

      var requiresPreview = (tech.kind === 'web' || tech.kind === 'react');
      var requiresTesting = true;

      return {
        goal: raw.trim().slice(0, 160) || 'yazılım görevi',
        type: type,
        projectType: projectType,
        language: tech.language,
        technologies: tech.technologies,
        framework: tech.framework,
        techKind: tech.kind,
        complexity: complexity,
        files: files,
        explicitFiles: explicit.length > 0,
        features: features,
        requiresPreview: requiresPreview,
        requiresTesting: requiresTesting,
        raw: raw,
      };
    }

    return { analyze: analyze, extractExplicitFiles: extractExplicitFiles };
  })();


  /* =================================================
     10. CODE GENERATOR (gerçek, çalışan içerik)
  ================================================= */

  var CodeGenerator = (function () {

    function roleOf(path) {
      var e = ext(path);
      if (e === 'html' || e === 'htm') return 'html';
      if (e === 'css') return 'css';
      if (e === 'js' || e === 'mjs' || e === 'cjs') return 'js';
      if (e === 'jsx' || e === 'tsx') return 'jsx';
      if (e === 'py') return 'py';
      if (e === 'json') return 'json';
      if (e === 'txt') return 'txt';
      if (e === 'env') return 'env';
      return e || 'txt';
    }

    // --- Ortak parçalar (web projeleri) ---

    function htmlDoc(title, bodyInner, cssPath, jsPath) {
      return '<!DOCTYPE html>\n' +
        '<html lang="tr">\n' +
        '<head>\n' +
        '  <meta charset="UTF-8" />\n' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
        '  <title>' + title + '</title>\n' +
        (cssPath ? '  <link rel="stylesheet" href="' + cssPath + '" />\n' : '') +
        '</head>\n' +
        '<body>\n' +
        bodyInner +
        (jsPath ? '  <script src="' + jsPath + '"></script>\n' : '') +
        '</body>\n' +
        '</html>\n';
    }

    /* ---------- TODO ---------- */
    function todoBody() {
      return '' +
        '  <main class="app">\n' +
        '    <h1>Yapılacaklar</h1>\n' +
        '    <form id="todo-form" class="todo-form" autocomplete="off">\n' +
        '      <input id="todo-input" type="text" placeholder="Yeni görev ekle..." aria-label="Yeni görev" />\n' +
        '      <button type="submit">Ekle</button>\n' +
        '    </form>\n' +
        '    <ul id="todo-list" class="todo-list" aria-live="polite"></ul>\n' +
        '    <p id="empty-state" class="empty">Henüz görev yok.</p>\n' +
        '  </main>\n';
    }
    function todoCss(dark) {
      var bg = dark ? '#0f172a' : '#f8fafc';
      var card = dark ? '#1e293b' : '#ffffff';
      var text = dark ? '#e2e8f0' : '#0f172a';
      var muted = dark ? '#94a3b8' : '#64748b';
      var border = dark ? '#334155' : '#e2e8f0';
      return '' +
        ':root { --bg:' + bg + '; --card:' + card + '; --accent:#6366f1; --text:' + text + '; --muted:' + muted + '; --border:' + border + '; }\n' +
        '* { box-sizing:border-box; }\n' +
        'body { margin:0; font-family:system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; justify-content:center; padding:2rem 1rem; }\n' +
        '.app { width:100%; max-width:480px; }\n' +
        'h1 { text-align:center; font-weight:700; margin-top:0; }\n' +
        '.todo-form { display:flex; gap:.5rem; margin-bottom:1rem; }\n' +
        '.todo-form input { flex:1; padding:.75rem 1rem; border-radius:.5rem; border:1px solid var(--border); background:var(--card); color:var(--text); font-size:1rem; }\n' +
        '.todo-form button { padding:.75rem 1.25rem; border:none; border-radius:.5rem; background:var(--accent); color:#fff; cursor:pointer; font-weight:600; }\n' +
        '.todo-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:.5rem; }\n' +
        '.todo-item { display:flex; align-items:center; gap:.75rem; background:var(--card); border:1px solid var(--border); padding:.75rem 1rem; border-radius:.5rem; transition:opacity .2s ease; }\n' +
        '.todo-item.done span { text-decoration:line-through; color:var(--muted); }\n' +
        '.todo-item span { flex:1; cursor:pointer; word-break:break-word; }\n' +
        '.todo-item button { background:transparent; border:none; color:var(--muted); cursor:pointer; font-size:1.1rem; line-height:1; }\n' +
        '.todo-item button:hover { color:#f87171; }\n' +
        '.empty { text-align:center; color:var(--muted); }\n' +
        '.empty.hidden { display:none; }\n' +
        '@media (max-width:480px) { body { padding:1rem .75rem; } .todo-form { flex-direction:column; } .todo-form button { width:100%; } }\n';
    }
    function todoJs() {
      return '' +
        "(function () {\n" +
        "  'use strict';\n" +
        "  var STORAGE_KEY = 'bilalai.todos';\n" +
        "  var form = document.getElementById('todo-form');\n" +
        "  var input = document.getElementById('todo-input');\n" +
        "  var list = document.getElementById('todo-list');\n" +
        "  var emptyState = document.getElementById('empty-state');\n" +
        "  var todos = load();\n" +
        "\n" +
        "  function load() {\n" +
        "    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }\n" +
        "    catch (e) { return []; }\n" +
        "  }\n" +
        "  function save() {\n" +
        "    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); } catch (e) {}\n" +
        "  }\n" +
        "  function render() {\n" +
        "    list.innerHTML = '';\n" +
        "    emptyState.classList.toggle('hidden', todos.length > 0);\n" +
        "    todos.forEach(function (todo, index) {\n" +
        "      var li = document.createElement('li');\n" +
        "      li.className = 'todo-item' + (todo.done ? ' done' : '');\n" +
        "      var span = document.createElement('span');\n" +
        "      span.textContent = todo.text;\n" +
        "      span.addEventListener('click', function () { toggle(index); });\n" +
        "      var del = document.createElement('button');\n" +
        "      del.type = 'button';\n" +
        "      del.setAttribute('aria-label', 'Sil');\n" +
        "      del.textContent = '✕';\n" +
        "      del.addEventListener('click', function () { remove(index); });\n" +
        "      li.appendChild(span);\n" +
        "      li.appendChild(del);\n" +
        "      list.appendChild(li);\n" +
        "    });\n" +
        "  }\n" +
        "  function addTodo(text) {\n" +
        "    var value = (text || '').trim();\n" +
        "    if (!value) return false;\n" +
        "    todos.push({ text: value, done: false });\n" +
        "    save(); render();\n" +
        "    return true;\n" +
        "  }\n" +
        "  function toggle(index) {\n" +
        "    if (!todos[index]) return;\n" +
        "    todos[index].done = !todos[index].done;\n" +
        "    save(); render();\n" +
        "  }\n" +
        "  function remove(index) {\n" +
        "    todos.splice(index, 1);\n" +
        "    save(); render();\n" +
        "  }\n" +
        "  form.addEventListener('submit', function (e) {\n" +
        "    e.preventDefault();\n" +
        "    if (addTodo(input.value)) { input.value = ''; input.focus(); }\n" +
        "  });\n" +
        "  input.addEventListener('keydown', function (e) {\n" +
        "    if (e.key === 'Enter' && !e.nativeEvent && !e.isComposing) {\n" +
        "      e.preventDefault();\n" +
        "      if (addTodo(input.value)) { input.value = ''; }\n" +
        "    }\n" +
        "  });\n" +
        "  render();\n" +
        "})();\n";
    }

    /* ---------- CALCULATOR ---------- */
    function calcBody() {
      return '' +
        '  <main class="calc">\n' +
        '    <output id="display" class="display">0</output>\n' +
        '    <div class="keys">\n' +
        '      <button data-action="clear" class="span2">C</button>\n' +
        '      <button data-action="delete">⌫</button>\n' +
        '      <button data-op="/">÷</button>\n' +
        '      <button data-num="7">7</button><button data-num="8">8</button><button data-num="9">9</button><button data-op="*">×</button>\n' +
        '      <button data-num="4">4</button><button data-num="5">5</button><button data-num="6">6</button><button data-op="-">−</button>\n' +
        '      <button data-num="1">1</button><button data-num="2">2</button><button data-num="3">3</button><button data-op="+">+</button>\n' +
        '      <button data-num="0" class="span2">0</button><button data-num=".">.</button><button data-action="equals" class="accent">=</button>\n' +
        '    </div>\n' +
        '  </main>\n';
    }
    function calcCss() {
      return '' +
        ':root { --bg:#0f172a; --card:#1e293b; --key:#334155; --accent:#6366f1; --text:#e2e8f0; }\n' +
        '* { box-sizing:border-box; }\n' +
        'body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1rem; }\n' +
        '.calc { width:320px; max-width:100%; background:var(--card); padding:1rem; border-radius:1rem; }\n' +
        '.display { display:block; text-align:right; font-size:2.25rem; color:var(--text); padding:1rem .5rem; word-break:break-all; min-height:3.5rem; }\n' +
        '.keys { display:grid; grid-template-columns:repeat(4,1fr); gap:.5rem; }\n' +
        'button { padding:1rem; font-size:1.15rem; border:none; border-radius:.5rem; background:var(--key); color:var(--text); cursor:pointer; }\n' +
        'button:active { transform:scale(.97); }\n' +
        '.span2 { grid-column:span 2; }\n' +
        '.accent { background:var(--accent); }\n' +
        '[data-op] { background:#475569; }\n';
    }
    function calcJs() {
      return '' +
        "(function () {\n" +
        "  'use strict';\n" +
        "  var display = document.getElementById('display');\n" +
        "  var current = '0';\n" +
        "  function update() { display.textContent = current; }\n" +
        "  function append(v) {\n" +
        "    if (current === '0' && v !== '.') current = v; else current += v;\n" +
        "    update();\n" +
        "  }\n" +
        "  function clearAll() { current = '0'; update(); }\n" +
        "  function del() { current = current.length > 1 ? current.slice(0, -1) : '0'; update(); }\n" +
        "  function equals() {\n" +
        "    try {\n" +
        "      var expr = current.replace(/[^0-9+\\-*/.]/g, '');\n" +
        "      var result = Function('\"use strict\"; return (' + expr + ')')();\n" +
        "      current = (result == null || !isFinite(result)) ? 'Hata' : String(result);\n" +
        "    } catch (e) { current = 'Hata'; }\n" +
        "    update();\n" +
        "  }\n" +
        "  document.querySelector('.keys').addEventListener('click', function (e) {\n" +
        "    var btn = e.target.closest('button');\n" +
        "    if (!btn) return;\n" +
        "    if (btn.dataset.num != null) return append(btn.dataset.num);\n" +
        "    if (btn.dataset.op != null) return append(btn.dataset.op);\n" +
        "    var a = btn.dataset.action;\n" +
        "    if (a === 'clear') clearAll(); else if (a === 'delete') del(); else if (a === 'equals') equals();\n" +
        "  });\n" +
        "  update();\n" +
        "})();\n";
    }

    /* ---------- LOGIN ---------- */
    function loginBody() {
      return '' +
        '  <main class="auth">\n' +
        '    <form id="login-form" class="card" novalidate>\n' +
        '      <h1>Giriş Yap</h1>\n' +
        '      <label>E-posta\n' +
        '        <input id="email" type="email" required placeholder="ornek@mail.com" />\n' +
        '      </label>\n' +
        '      <label>Şifre\n' +
        '        <input id="password" type="password" required minlength="6" placeholder="••••••••" />\n' +
        '      </label>\n' +
        '      <p id="error" class="error" role="alert"></p>\n' +
        '      <button type="submit">Giriş</button>\n' +
        '    </form>\n' +
        '  </main>\n';
    }
    function loginCss() {
      return '' +
        ':root { --bg:#0f172a; --card:#1e293b; --accent:#6366f1; --text:#e2e8f0; --muted:#94a3b8; --error:#f87171; }\n' +
        '* { box-sizing:border-box; }\n' +
        'body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1rem; }\n' +
        '.card { width:100%; max-width:360px; background:var(--card); padding:2rem; border-radius:1rem; display:flex; flex-direction:column; gap:1rem; }\n' +
        'h1 { margin:0 0 .5rem; text-align:center; }\n' +
        'label { display:flex; flex-direction:column; gap:.35rem; font-size:.9rem; color:var(--muted); }\n' +
        'input { padding:.75rem 1rem; border-radius:.5rem; border:1px solid #334155; background:#0f172a; color:var(--text); font-size:1rem; }\n' +
        'button { padding:.85rem; border:none; border-radius:.5rem; background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }\n' +
        '.error { color:var(--error); font-size:.85rem; min-height:1.1rem; margin:0; }\n';
    }
    function loginJs() {
      return '' +
        "(function () {\n" +
        "  'use strict';\n" +
        "  var form = document.getElementById('login-form');\n" +
        "  var email = document.getElementById('email');\n" +
        "  var password = document.getElementById('password');\n" +
        "  var error = document.getElementById('error');\n" +
        "  function validate() {\n" +
        "    if (!email.value || email.value.indexOf('@') === -1) return 'Geçerli bir e-posta girin.';\n" +
        "    if (password.value.length < 6) return 'Şifre en az 6 karakter olmalı.';\n" +
        "    return '';\n" +
        "  }\n" +
        "  form.addEventListener('submit', function (e) {\n" +
        "    e.preventDefault();\n" +
        "    var msg = validate();\n" +
        "    error.style.color = '';\n" +
        "    error.textContent = msg;\n" +
        "    if (msg) return;\n" +
        "    console.log('[login] gönderiliyor:', email.value);\n" +
        "    error.style.color = '#4ade80';\n" +
        "    error.textContent = 'Giriş başarılı (demo).';\n" +
        "  });\n" +
        "})();\n";
    }

    /* ---------- LANDING ---------- */
    function landingBody() {
      return '' +
        '  <header class="hero">\n' +
        '    <nav class="nav"><span class="logo">Brand</span><a href="#cta" class="btn">Başla</a></nav>\n' +
        '    <div class="hero-inner">\n' +
        '      <h1>Ürününüzü dakikalar içinde yayına alın</h1>\n' +
        '      <p>Hızlı, modern ve responsive bir başlangıç şablonu.</p>\n' +
        '      <a href="#cta" class="btn big">Ücretsiz Dene</a>\n' +
        '    </div>\n' +
        '  </header>\n' +
        '  <section class="features">\n' +
        '    <article><h3>Hızlı</h3><p>Optimize performans.</p></article>\n' +
        '    <article><h3>Güvenli</h3><p>En iyi güvenlik pratikleri.</p></article>\n' +
        '    <article><h3>Esnek</h3><p>İhtiyaca göre ölçeklenir.</p></article>\n' +
        '  </section>\n' +
        '  <section id="cta" class="cta"><h2>Bugün başlayın</h2><a href="#" class="btn big">Kayıt Ol</a></section>\n';
    }
    function landingCss() {
      return '' +
        ':root { --bg:#0b1020; --panel:#141a2e; --accent:#6366f1; --text:#e2e8f0; --muted:#9aa4bf; }\n' +
        '* { box-sizing:border-box; }\n' +
        'body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); }\n' +
        '.nav { display:flex; justify-content:space-between; align-items:center; padding:1.25rem 2rem; }\n' +
        '.logo { font-weight:700; }\n' +
        '.btn { background:var(--accent); color:#fff; padding:.6rem 1.1rem; border-radius:.5rem; text-decoration:none; font-weight:600; }\n' +
        '.btn.big { padding:.9rem 1.6rem; font-size:1.05rem; }\n' +
        '.hero-inner { max-width:720px; margin:0 auto; text-align:center; padding:5rem 1.5rem; }\n' +
        '.hero-inner h1 { font-size:2.6rem; line-height:1.1; }\n' +
        '.hero-inner p { color:var(--muted); font-size:1.15rem; }\n' +
        '.features { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:1rem; padding:3rem 2rem; max-width:1000px; margin:0 auto; }\n' +
        '.features article { background:var(--panel); padding:1.5rem; border-radius:.75rem; }\n' +
        '.cta { text-align:center; padding:4rem 1.5rem; }\n';
    }
    function landingJs() {
      return '' +
        "(function () {\n" +
        "  'use strict';\n" +
        "  document.querySelectorAll('a[href^=\"#\"]').forEach(function (a) {\n" +
        "    a.addEventListener('click', function (e) {\n" +
        "      var target = document.querySelector(a.getAttribute('href'));\n" +
        "      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }\n" +
        "    });\n" +
        "  });\n" +
        "})();\n";
    }

    /* ---------- GENERIC WEB ---------- */
    function genericBody() {
      return '' +
        '  <main class="app">\n' +
        '    <h1>Merhaba</h1>\n' +
        '    <p id="output">BilalAI Pro tarafından oluşturuldu.</p>\n' +
        '    <button id="action">Tıkla</button>\n' +
        '  </main>\n';
    }
    function genericCss() {
      return '' +
        'body { margin:0; font-family:system-ui,sans-serif; background:#0f172a; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; }\n' +
        '.app { text-align:center; }\n' +
        'button { margin-top:1rem; padding:.7rem 1.2rem; border:none; border-radius:.5rem; background:#6366f1; color:#fff; cursor:pointer; }\n';
    }
    function genericJs() {
      return '' +
        "(function () {\n" +
        "  'use strict';\n" +
        "  var out = document.getElementById('output');\n" +
        "  var btn = document.getElementById('action');\n" +
        "  var count = 0;\n" +
        "  btn.addEventListener('click', function () { count++; out.textContent = 'Tıklama: ' + count; });\n" +
        "})();\n";
    }

    // Web projeleri için rol->içerik seçimi
    function webContent(analysis) {
      var p = analysis.projectType;
      var dark = analysis.features.darkTheme || true; // modern koyu varsayılan
      var title, body, css, js;
      if (p === 'todo') { title = 'Todo App'; body = todoBody(); css = todoCss(dark); js = todoJs(); }
      else if (p === 'calculator') { title = 'Hesap Makinesi'; body = calcBody(); css = calcCss(); js = calcJs(); }
      else if (p === 'login') { title = 'Giriş Yap'; body = loginBody(); css = loginCss(); js = loginJs(); }
      else if (p === 'landing') { title = 'Landing'; body = landingBody(); css = landingCss(); js = landingJs(); }
      else { title = 'Uygulama'; body = genericBody(); css = genericCss(); js = genericJs(); }
      return { title: title, body: body, css: css, js: js };
    }

    /* ---------- REACT (dashboard / generic) ---------- */
    function reactFiles(analysis) {
      var files = {};
      files['index.html'] = '<!DOCTYPE html>\n<html lang="tr">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' +
        (analysis.projectType === 'dashboard' ? 'Admin Panel' : 'React App') +
        '</title>\n  <link rel="stylesheet" href="/src/styles.css" />\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>\n';

      files['src/main.jsx'] = "import React from 'react';\n" +
        "import { createRoot } from 'react-dom/client';\n" +
        "import App from './App.jsx';\n" +
        "import './styles.css';\n\n" +
        "createRoot(document.getElementById('root')).render(<App />);\n";

      if (analysis.projectType === 'dashboard') {
        files['src/App.jsx'] = "import React, { useState } from 'react';\n" +
          "import Sidebar from './components/Sidebar.jsx';\n" +
          "import Dashboard from './components/Dashboard.jsx';\n\n" +
          "export default function App() {\n" +
          "  const [active, setActive] = useState('dashboard');\n" +
          "  return (\n" +
          "    <div className=\"layout\">\n" +
          "      <Sidebar active={active} onNavigate={setActive} />\n" +
          "      <main className=\"content\">\n" +
          "        <Dashboard section={active} />\n" +
          "      </main>\n" +
          "    </div>\n" +
          "  );\n" +
          "}\n";

        files['src/components/Sidebar.jsx'] = "import React from 'react';\n\n" +
          "const ITEMS = [\n" +
          "  { id: 'dashboard', label: 'Genel Bakış' },\n" +
          "  { id: 'users', label: 'Kullanıcılar' },\n" +
          "  { id: 'orders', label: 'Siparişler' },\n" +
          "  { id: 'settings', label: 'Ayarlar' },\n" +
          "];\n\n" +
          "export default function Sidebar({ active, onNavigate }) {\n" +
          "  return (\n" +
          "    <aside className=\"sidebar\">\n" +
          "      <div className=\"brand\">Admin</div>\n" +
          "      <nav>\n" +
          "        {ITEMS.map((item) => (\n" +
          "          <button\n" +
          "            key={item.id}\n" +
          "            className={active === item.id ? 'nav-item active' : 'nav-item'}\n" +
          "            onClick={() => onNavigate(item.id)}\n" +
          "          >\n" +
          "            {item.label}\n" +
          "          </button>\n" +
          "        ))}\n" +
          "      </nav>\n" +
          "    </aside>\n" +
          "  );\n" +
          "}\n";

        files['src/components/StatCard.jsx'] = "import React from 'react';\n\n" +
          "export default function StatCard({ label, value, delta }) {\n" +
          "  const positive = String(delta).trim().startsWith('+');\n" +
          "  return (\n" +
          "    <div className=\"stat-card\">\n" +
          "      <span className=\"stat-label\">{label}</span>\n" +
          "      <strong className=\"stat-value\">{value}</strong>\n" +
          "      <span className={positive ? 'stat-delta up' : 'stat-delta down'}>{delta}</span>\n" +
          "    </div>\n" +
          "  );\n" +
          "}\n";

        files['src/components/Dashboard.jsx'] = "import React from 'react';\n" +
          "import StatCard from './StatCard.jsx';\n\n" +
          "const STATS = [\n" +
          "  { label: 'Toplam Gelir', value: '₺84.2K', delta: '+12%' },\n" +
          "  { label: 'Aktif Kullanıcı', value: '1.294', delta: '+4%' },\n" +
          "  { label: 'Sipariş', value: '327', delta: '-2%' },\n" +
          "  { label: 'Dönüşüm', value: '%3.8', delta: '+0.6%' },\n" +
          "];\n\n" +
          "export default function Dashboard({ section }) {\n" +
          "  return (\n" +
          "    <div>\n" +
          "      <header className=\"page-head\"><h1>{section}</h1></header>\n" +
          "      <section className=\"stats-grid\">\n" +
          "        {STATS.map((s) => (<StatCard key={s.label} {...s} />))}\n" +
          "      </section>\n" +
          "    </div>\n" +
          "  );\n" +
          "}\n";

        files['src/styles.css'] = ":root { --bg:#0f172a; --panel:#1e293b; --accent:#6366f1; --text:#e2e8f0; --muted:#94a3b8; }\n" +
          "* { box-sizing:border-box; }\n" +
          "body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); }\n" +
          ".layout { display:flex; min-height:100vh; }\n" +
          ".sidebar { width:220px; background:var(--panel); padding:1.5rem 1rem; }\n" +
          ".brand { font-weight:700; font-size:1.25rem; margin-bottom:1.5rem; }\n" +
          ".nav-item { display:block; width:100%; text-align:left; padding:.65rem .85rem; margin-bottom:.35rem; border:none; border-radius:.5rem; background:transparent; color:var(--muted); cursor:pointer; }\n" +
          ".nav-item.active, .nav-item:hover { background:var(--accent); color:#fff; }\n" +
          ".content { flex:1; padding:2rem; }\n" +
          ".page-head h1 { margin-top:0; text-transform:capitalize; }\n" +
          ".stats-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:1rem; }\n" +
          ".stat-card { background:var(--panel); padding:1.25rem; border-radius:.75rem; display:flex; flex-direction:column; gap:.35rem; }\n" +
          ".stat-label { color:var(--muted); font-size:.85rem; }\n" +
          ".stat-value { font-size:1.6rem; }\n" +
          ".stat-delta.up { color:#4ade80; }\n" +
          ".stat-delta.down { color:#f87171; }\n";
      } else {
        files['src/App.jsx'] = "import React, { useState } from 'react';\n\n" +
          "export default function App() {\n" +
          "  const [count, setCount] = useState(0);\n" +
          "  return (\n" +
          "    <main className=\"app\">\n" +
          "      <h1>BilalAI React App</h1>\n" +
          "      <button onClick={() => setCount((c) => c + 1)}>Sayaç: {count}</button>\n" +
          "    </main>\n" +
          "  );\n" +
          "}\n";
        files['src/styles.css'] = "body { margin:0; font-family:system-ui,sans-serif; background:#0f172a; color:#e2e8f0; }\n" +
          ".app { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1rem; }\n" +
          "button { padding:.7rem 1.2rem; border:none; border-radius:.5rem; background:#6366f1; color:#fff; cursor:pointer; }\n";
      }
      return files;
    }

    /* ---------- PYTHON ---------- */
    function pythonFiles(analysis) {
      var files = {};
      if (analysis.projectType === 'discord-bot') {
        files['bot.py'] = 'import os\n' +
          'import discord\n' +
          'from discord.ext import commands\n' +
          'from dotenv import load_dotenv\n\n' +
          'load_dotenv()\n' +
          'TOKEN = os.getenv("DISCORD_TOKEN")\n\n' +
          'intents = discord.Intents.default()\n' +
          'intents.message_content = True\n\n' +
          'bot = commands.Bot(command_prefix="!", intents=intents)\n\n\n' +
          '@bot.event\n' +
          'async def on_ready():\n' +
          '    print(f"Giriş yapıldı: {bot.user}")\n\n\n' +
          '@bot.command(name="ping")\n' +
          'async def ping(ctx):\n' +
          '    await ctx.send(f"Pong! {round(bot.latency * 1000)}ms")\n\n\n' +
          '@bot.command(name="selam")\n' +
          'async def selam(ctx):\n' +
          '    await ctx.send(f"Selam {ctx.author.mention}!")\n\n\n' +
          'def main():\n' +
          '    if not TOKEN:\n' +
          '        raise SystemExit("DISCORD_TOKEN tanımlı değil. .env dosyasını doldurun.")\n' +
          '    bot.run(TOKEN)\n\n\n' +
          'if __name__ == "__main__":\n' +
          '    main()\n';
        files['requirements.txt'] = 'discord.py>=2.3\npython-dotenv>=1.0\n';
        files['.env.example'] = '# Discord Developer Portal > Bot > Token\nDISCORD_TOKEN=your-bot-token-here\n';
      } else {
        files['main.py'] = 'def main():\n    print("BilalAI Pro tarafından oluşturuldu.")\n\n\nif __name__ == "__main__":\n    main()\n';
        files['requirements.txt'] = '';
      }
      return files;
    }

    /* ---------- NODE ---------- */
    function nodeFiles() {
      return {
        'index.js': "'use strict';\n\nfunction main() {\n  console.log('BilalAI Pro tarafından oluşturuldu.');\n}\n\nmain();\n",
        'package.json': '{\n  "name": "bilalai-app",\n  "version": "1.0.0",\n  "type": "commonjs",\n  "scripts": { "start": "node index.js" }\n}\n',
      };
    }

    // Ana giriş: analysis.files listesine GÖRE içerik üretir.
    function generate(analysis) {
      var out = {};

      if (analysis.techKind === 'react') {
        var rf = reactFiles(analysis);
        // Planlanan dosya listesi react şablonuyla örtüşür; eksikleri şablondan tamamla.
        analysis.files.forEach(function (p) { if (rf[p] != null) out[p] = rf[p]; });
        // Şablonda olup planda olmayan zorunlu dosyaları da ekle (çalışabilirlik).
        Object.keys(rf).forEach(function (p) { if (out[p] == null) out[p] = rf[p]; });
        return out;
      }

      if (analysis.techKind === 'python') {
        var pf = pythonFiles(analysis);
        analysis.files.forEach(function (p) { if (pf[p] != null) out[p] = pf[p]; });
        Object.keys(pf).forEach(function (p) { if (out[p] == null) out[p] = pf[p]; });
        return out;
      }

      if (analysis.techKind === 'node') {
        var nf = nodeFiles();
        analysis.files.forEach(function (p) { if (nf[p] != null) out[p] = nf[p]; });
        Object.keys(nf).forEach(function (p) { if (out[p] == null) out[p] = nf[p]; });
        return out;
      }

      // WEB: rol bazında dağıt (kullanıcının verdiği dosya adlarına saygı göster)
      var web = webContent(analysis);
      var htmlPath = null, cssPath = null, jsPath = null;
      analysis.files.forEach(function (p) {
        var r = roleOf(p);
        if (r === 'html' && !htmlPath) htmlPath = p;
        else if (r === 'css' && !cssPath) cssPath = p;
        else if (r === 'js' && !jsPath) jsPath = p;
      });
      if (!htmlPath) htmlPath = 'index.html';
      if (!cssPath) cssPath = 'style.css';
      if (!jsPath) jsPath = 'app.js';

      out[cssPath] = web.css;
      out[jsPath] = web.js;
      out[htmlPath] = htmlDoc(web.title, web.body, cssPath, jsPath);

      // Kullanıcı fazladan dosya istediyse (nadiren) makul boş iskelet verme yerine atla.
      analysis.files.forEach(function (p) {
        if (out[p] == null) {
          var r = roleOf(p);
          if (r === 'html') out[p] = htmlDoc(web.title, web.body, cssPath, jsPath);
          else if (r === 'css') out[p] = web.css;
          else if (r === 'js') out[p] = web.js;
          else if (r === 'json') out[p] = '{}\n';
          else out[p] = '';
        }
      });

      return out;
    }

    return { generate: generate, roleOf: roleOf };
  })();


  /* =================================================
     11. EVENT HELPERS (standart event şeması)
     Her event: { type, timestamp, message, metadata, ...metadata }
     Eski dinleyiciler için metadata alanları düz olarak da taşınır.
  ================================================= */

  function emit(type, message, metadata, legacyType) {
    var meta = metadata || {};
    var payload = Object.assign({}, meta, { message: message || '', metadata: clone(meta) });
    var evt = bus.emit(type, payload);
    if (STATE.events) {
      STATE.events.push({ type: type, timestamp: evt.timestamp, message: message || '', metadata: clone(meta) });
      if (STATE.events.length > 400) STATE.events.shift();
    }
    if (legacyType) bus.emit(legacyType, payload);
    return evt;
  }

  function note(text) { STATE.notes.push(text); }

  function recordError(err, info) {
    info = info || {};
    var rec = {
      type: info.type || (err && err.name) || 'AgentError',
      message: (err && err.message) || String(err),
      task: info.task || STATE.currentStep || null,
      file: info.file || null,
      stack: (err && err.stack) || null,
      timestamp: Date.now(),
    };
    STATE.errors.push(rec);
    return rec;
  }

  /* =================================================
     12. CONTEXT MEMORY (önceki mesajlar + son proje)
  ================================================= */

  var MEMORY = { history: [], project: null };

  function remember(userMsg, analysis) {
    MEMORY.history.push({ message: String(userMsg || '').slice(0, 400), intent: analysis.intent,
      projectType: analysis.projectType, techKind: analysis.techKind, timestamp: Date.now() });
    if (MEMORY.history.length > 30) MEMORY.history.shift();
    MEMORY.project = { projectType: analysis.projectType, techKind: analysis.techKind,
      framework: analysis.framework, files: STATE.files.map(function (f) { return f.path; }) };
  }

  /* =================================================
     13. PROJECT ANALYZER (workspace'i okur)
  ================================================= */

  function filesMapFromWorkspace(workspace) {
    var map = {};
    workspace.listFiles().forEach(function (p) {
      var c = workspace.readFile(p);
      if (c != null) map[p] = String(c);
    });
    return map;
  }

  function firstByExt(files, exts) {
    var keys = Object.keys(files);
    for (var i = 0; i < keys.length; i++) {
      if (exts.indexOf(ext(keys[i])) !== -1 && /(^|\/)index\.html?$/i.test(keys[i])) return keys[i];
    }
    for (var j = 0; j < keys.length; j++) if (exts.indexOf(ext(keys[j])) !== -1) return keys[j];
    return null;
  }

  var ProjectAnalyzer = (function () {
    function analyze(workspace) {
      var files = filesMapFromWorkspace(workspace);
      var paths = Object.keys(files);
      var all = paths.map(function (p) { return files[p]; }).join('\n');
      var pkg = null;
      if (files['package.json']) { try { pkg = JSON.parse(files['package.json']); } catch (e) { pkg = null; } }
      var deps = pkg ? Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {}) : {};

      var techKind = 'none', framework = null;
      if (deps.react || paths.some(function (p) { return /\.(jsx|tsx)$/.test(p); })) { techKind = 'react'; framework = deps.next ? 'Next.js' : 'React'; }
      else if (paths.some(function (p) { return ext(p) === 'py'; })) { techKind = 'python'; framework = /discord/.test(all) ? 'discord.py' : null; }
      else if (pkg && !paths.some(function (p) { return ext(p) === 'html'; })) { techKind = 'node'; framework = deps.express ? 'Express' : 'Node.js'; }
      else if (paths.some(function (p) { return ext(p) === 'html'; })) { techKind = 'web'; framework = 'vanilla'; }

      var entry = null;
      ['index.html', 'src/main.jsx', 'main.py', 'bot.py', 'index.js'].forEach(function (e) { if (!entry && files[e] != null) entry = e; });
      if (!entry) entry = paths[0] || null;

      var projectType = 'generic';
      if (/addTodo|todo-list|todos/.test(all)) projectType = 'todo';
      else if (/data-num|calc/.test(all)) projectType = 'calculator';
      else if (/Dashboard|StatCard/.test(all)) projectType = 'dashboard';
      else if (/discord/.test(all)) projectType = 'discord-bot';
      else if (/login-form/.test(all)) projectType = 'login';
      else if (/hero|landing/i.test(all)) projectType = 'landing';

      var features = {
        localStorage: /localStorage/.test(all),
        responsive: /@media/.test(all),
        darkMode: /theme-toggle|theme-dark/.test(all),
        login: paths.some(function (p) { return /login/i.test(p); }) || /login-form/.test(all),
      };

      return {
        fileCount: paths.length, files: paths, techKind: techKind, framework: framework, entry: entry,
        projectType: projectType, dependencies: Object.keys(deps), features: features,
        structure: paths.map(function (p) { return { path: p, language: langOf(p), lines: files[p].split('\n').length }; }),
      };
    }
    return { analyze: analyze };
  })();

  /* =================================================
     14. CONTEXT ANALYZER (yeni proje mi, mevcut projede değişiklik mi?)
  ================================================= */

  var ContextAnalyzer = (function () {
    var MODIFY_RE = /(^|[\s,.;])(ekle|ekler misin|ekleyin|ekleyelim|ekleyebilir misin|guncelle|degistir|iyilestir|duzenle|yap)([\s,.;!?]|$)/;
    var EXIST_RE = /mevcut|bu proje|projeye|projemi|projemde|uygulamasina|uygulamaya|var olan|onceki|dosyasindaki|dosyasinda/;
    var FIX_RE = /hata|bug|duzelt|fix|calismiyor|bozuk/;
    var CREATE_RE = /olustur|gelistir|create|build|sifirdan|yeni /;
    var NEW_RE = /yeni proje|sifirdan|bastan|yeni bir/;

    function modificationsFrom(t) {
      var mods = [];
      if (/dark|karanlik|koyu|tema/.test(t)) mods.push({ kind: 'dark-mode', title: 'Dark mode ekle' });
      if (/responsive|mobil|uyumlu/.test(t)) mods.push({ kind: 'responsive', title: 'Responsive düzeni güçlendir' });
      if (/login|giris|oturum|auth|kayit/.test(t)) mods.push({ kind: 'login', title: 'Login sistemi ekle' });
      return mods;
    }

    function analyze(t, base, project) {
      var hasProject = project.fileCount > 0;
      var intent = 'create', reason = 'Yeni proje isteği.';
      var isFix = FIX_RE.test(t) && !CREATE_RE.test(t);
      if (isFix) { intent = 'fix'; reason = 'Hata bulma/düzeltme isteği.'; }
      else if (hasProject && !NEW_RE.test(t)) {
        var mods = modificationsFrom(t);
        var existCue = EXIST_RE.test(t);
        var modifyCue = MODIFY_RE.test(t) && !CREATE_RE.test(t);
        if ((existCue || modifyCue) && (mods.length || existCue)) {
          intent = 'modify'; reason = 'Mevcut projede değişiklik isteği (workspace: ' + project.fileCount + ' dosya).';
        } else if (t.length < 60 && base.projectType === 'generic' && mods.length) {
          intent = 'modify'; reason = 'Kısa takip mesajı; önceki proje üzerinde değişiklik olarak yorumlandı.';
        }
      }
      var mods2 = intent === 'modify' ? modificationsFrom(t) : [];
      return { intent: intent, reason: reason, hasProject: hasProject, modifications: mods2,
        previous: MEMORY.history.length ? MEMORY.history[MEMORY.history.length - 1] : null };
    }
    return { analyze: analyze, modificationsFrom: modificationsFrom };
  })();

  /* =================================================
     15. COMPLEXITY ANALYZER
  ================================================= */

  var ComplexityAnalyzer = (function () {
    var VERY = /saas|full.?stack|platform|e-?ticaret|marketplace|mikroservis|microservice|multi.?tenant/;
    var HEAVY = ['jwt', 'auth', 'postgres', 'mysql', 'mongodb', 'veritabani', 'database', 'rest api', ' api', 'admin',
      'dashboard', 'backend', 'react', 'express', 'websocket', 'odeme', 'payment'];
    var LIGHT = /basit|iki sayi|topla|hello world|kucuk|mini|ornek/;
    function classify(t, base) {
      if (VERY.test(t)) return 'very-complex';
      var hits = HEAVY.filter(function (w) { return t.indexOf(w) !== -1; }).length;
      if (hits >= 2 || base.complexity === 'complex') return 'complex';
      if (LIGHT.test(t) || base.complexity === 'simple') return 'simple';
      return 'medium';
    }
    return { classify: classify };
  })();

  /* =================================================
     16. REQUIREMENT EXTRACTOR
  ================================================= */

  var RequirementExtractor = (function () {
    var FEATURE_DEFAULTS = {
      todo: ['Görev ekleme', 'Görev silme', 'Görev tamamlama', 'LocalStorage kalıcılığı', 'Boş görev engelleme', 'Enter ile ekleme'],
      calculator: ['Rakam girişi', 'Dört işlem', 'Temizleme', 'Hatalı ifade koruması'],
      login: ['E-posta doğrulama', 'Şifre uzunluk kontrolü', 'Hata mesajları'],
      dashboard: ['Kenar menü', 'İstatistik kartları', 'Dashboard görünümü'],
      'discord-bot': ['Komut işleme', '.env ile token yönetimi'],
      landing: ['Hero bölümü', 'Yumuşak kaydırma'],
    };
    function extract(t, base, ctx) {
      var f = base.features;
      var functional = (FEATURE_DEFAULTS[base.projectType] || ['Temel uygulama akışı']).slice();
      ctx.modifications.forEach(function (m) { functional.push(m.title); });
      var ui = [];
      if (f.responsive || /responsive/.test(t)) ui.push('Responsive tasarım');
      if (/modern/.test(t)) ui.push('Modern UI');
      if (f.darkTheme) ui.push('Koyu tema');
      if (f.animation) ui.push('Animasyonlar');
      var explicit = [];
      if (base.explicitFiles) explicit.push('Ayrı dosyalar: ' + base.files.join(', '));
      if (f.localStorage) explicit.push('LocalStorage desteği');
      ui.forEach(function (u) { explicit.push(u); });
      if (/plan/.test(t)) explicit.push('Önce plan çıkarılması');
      if (/self.?check|kontrol/.test(t)) explicit.push('Self-check yapılması');
      var implicit = ['Semantik HTML', 'Erişilebilir etiketler', 'Güvenli DOM yazımı (textContent)', 'Viewport meta etiketi'];
      if (base.techKind === 'python') implicit = ['Token/sırların koddan ayrılması', 'Hata yakalama', 'main guard'];
      if (base.techKind === 'react') implicit = ['Bileşen ayrımı', 'Import tutarlılığı', 'package.json bağımlılıkları'];
      var technical = [base.language, base.framework || 'vanilla'].concat(base.files);
      return {
        explicitRequirements: explicit,
        implicitRequirements: implicit,
        technicalRequirements: technical,
        uiRequirements: ui,
        functionalRequirements: functional,
        features: functional,
        priority: /acil|hemen|asap|urgent|kritik/.test(t) ? 'high' : 'normal',
      };
    }
    return { extract: extract };
  })();

  /* =================================================
     17. REQUEST ANALYZER (tüm analizleri birleştirir)
  ================================================= */

  var RequestAnalyzer = (function () {
    function analyze(userMsg, workspace) {
      var base = Analyzer.analyze(userMsg);
      var t = norm(base.raw);
      var project = ProjectAnalyzer.analyze(workspace || defaultWorkspace);
      var ctx = ContextAnalyzer.analyze(t, base, project);
      var a = Object.assign({}, base);

      if ((ctx.intent === 'modify' || ctx.intent === 'fix') && project.fileCount) {
        a.techKind = project.techKind === 'none' ? base.techKind : project.techKind;
        if (project.projectType !== 'generic') a.projectType = project.projectType;
        a.framework = project.framework;
        a.files = project.files.slice();
        a.explicitFiles = false;
      }
      // Dosya adı verilmiş ama proje türü belirsiz: mevcut projenin türünü koru (işi silme).
      if (ctx.intent === 'create' && base.projectType === 'generic' && project.projectType !== 'generic' && project.techKind === base.techKind) {
        a.projectType = project.projectType;
      }
      a.intent = ctx.intent;
      a.context = ctx;
      a.project = project;
      a.complexity = ComplexityAnalyzer.classify(t, base);
      a.requirements = RequirementExtractor.extract(t, base, ctx);
      a.priority = a.requirements.priority;
      a.projectKind = a.techKind === 'python' ? 'python-app' : a.techKind === 'node' ? 'node-app' : a.techKind === 'react' ? 'react-app' : 'web-app';
      a.frameworkName = a.framework || 'vanilla';
      a.requiresPreview = a.techKind === 'web' || a.techKind === 'react';
      a.requiresTesting = true;
      a.targetFiles = Analyzer.extractExplicitFiles(base.raw);
      a.needsResearch = /\b(react|next|vue)\s?\d{2}\b|dokumantasyon|documentation|docs/.test(t);
      return a;
    }
    return { analyze: analyze };
  })();

  /* =================================================
     18. CHANGE TRACKER + WORKSPACE MANAGER
  ================================================= */

  var ChangeTracker = (function () {
    function record(action, path, before, after, reason, extra) {
      var c = Object.assign({ id: uid('chg'), action: action, path: path,
        before: before == null ? null : before, after: after == null ? null : after,
        reason: reason || '', timestamp: Date.now() }, extra || {});
      STATE.changes.push(c);
      return c;
    }
    function summary() {
      return STATE.changes.map(function (c) {
        return c.action.toUpperCase() + ' ' + (c.from ? c.from + ' → ' : '') + c.path;
      });
    }
    function counts() {
      var out = { create: 0, update: 0, delete: 0, rename: 0, move: 0 };
      STATE.changes.forEach(function (c) { out[c.action] = (out[c.action] || 0) + 1; });
      return out;
    }
    return { record: record, summary: summary, counts: counts };
  })();

  var WorkspaceManager = (function () {
    function upsertState(path, content, status) {
      var entry = { path: path, content: content, language: langOf(path), status: status };
      for (var i = 0; i < STATE.files.length; i++) {
        if (STATE.files[i].path === path) {
          if (STATE.files[i].status === 'created' && status === 'updated') entry.status = 'created';
          STATE.files[i] = entry; return entry;
        }
      }
      STATE.files.push(entry);
      return entry;
    }
    function write(ws, path, content, reason) {
      var existed = ws.exists(path);
      var before = existed ? ws.readFile(path) : null;
      if (existed && before === content) { upsertState(path, content, 'unchanged'); return null; }
      if (existed) ws.updateFile(path, content); else ws.writeFile(path, content);
      var action = existed ? 'update' : 'create';
      ChangeTracker.record(action, path, before, content, reason);
      var entry = upsertState(path, content, existed ? 'updated' : 'created');
      emit(existed ? 'file:update' : 'file:create', (existed ? '✏️ ' : '📁 ') + path + (existed ? ' güncellendi.' : ' oluşturuldu.'),
        { path: path, language: entry.language, reason: reason || '' }, existed ? 'file:updated' : 'file:created');
      return entry;
    }
    function remove(ws, path, reason) {
      if (!ws.exists(path)) return false;
      var before = ws.readFile(path);
      ws.deleteFile(path);
      ChangeTracker.record('delete', path, before, null, reason);
      STATE.files = STATE.files.filter(function (f) { return f.path !== path; });
      emit('file:delete', '🗑 ' + path + ' silindi.', { path: path, reason: reason || '' }, 'file:deleted');
      return true;
    }
    function rename(ws, from, to, reason, action) {
      if (!ws.exists(from)) return false;
      var content = ws.readFile(from);
      ws.writeFile(to, content);
      ws.deleteFile(from);
      ChangeTracker.record(action || 'rename', to, content, content, reason, { from: from });
      STATE.files = STATE.files.filter(function (f) { return f.path !== from; });
      upsertState(to, content, 'created');
      emit('file:' + (action || 'rename'), '🔀 ' + from + ' → ' + to, { from: from, path: to, reason: reason || '' });
      return true;
    }
    function move(ws, from, to, reason) { return rename(ws, from, to, reason, 'move'); }
    return { write: write, remove: remove, rename: rename, move: move };
  })();

  /* =================================================
     19. CODE EDITOR (mevcut projede değişiklik)
  ================================================= */

  var CodeEditor = (function () {
    var THEME_CSS = '\n/* BilalAI Pro: tema (dark mode) */\n' +
      '.theme-toggle {\n  position: fixed;\n  top: 12px;\n  right: 12px;\n  z-index: 50;\n  width: 42px;\n  height: 42px;\n' +
      '  border-radius: 999px;\n  border: 1px solid rgba(127, 127, 127, 0.4);\n  background: rgba(127, 127, 127, 0.15);\n' +
      '  color: inherit;\n  font-size: 18px;\n  cursor: pointer;\n}\n' +
      'body.theme-dark {\n  background: #0f1115;\n  color: #e6e6e6;\n}\n' +
      'body.theme-dark main, body.theme-dark .app, body.theme-dark form, body.theme-dark li, body.theme-dark .card {\n' +
      '  background-color: #171a21;\n  color: #e6e6e6;\n  border-color: #2a2f3a;\n}\n' +
      'body.theme-dark input, body.theme-dark textarea, body.theme-dark select {\n  background: #1f232c;\n  color: #e6e6e6;\n  border-color: #343a46;\n}\n' +
      'body.theme-light {\n  background: #f5f6f8;\n  color: #1b1d22;\n}\n' +
      'body.theme-light main, body.theme-light .app, body.theme-light form, body.theme-light li, body.theme-light .card {\n' +
      '  background-color: #ffffff;\n  color: #1b1d22;\n  border-color: #dde1e7;\n}\n' +
      'body.theme-light input, body.theme-light textarea, body.theme-light select {\n  background: #ffffff;\n  color: #1b1d22;\n  border-color: #cfd4dc;\n}\n';

    var THEME_JS = '\n// BilalAI Pro: tema (dark mode) değiştirici\n(function () {\n' +
      "  var KEY = 'bilalai-theme';\n" +
      "  var btn = document.getElementById('theme-toggle');\n" +
      '  function apply(theme) {\n' +
      "    document.body.classList.toggle('theme-dark', theme === 'dark');\n" +
      "    document.body.classList.toggle('theme-light', theme === 'light');\n" +
      "    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';\n" +
      '  }\n' +
      '  var saved = null;\n' +
      '  try { saved = localStorage.getItem(KEY); } catch (e) { saved = null; }\n' +
      "  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;\n" +
      "  apply(saved || (prefersDark ? 'dark' : 'light'));\n" +
      '  if (btn) {\n' +
      "    btn.addEventListener('click', function () {\n" +
      "      var next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';\n" +
      '      apply(next);\n' +
      '      try { localStorage.setItem(KEY, next); } catch (e) { /* depolama kapalı olabilir */ }\n' +
      '    });\n' +
      '  }\n' +
      '})();\n';

    var RESPONSIVE_CSS = '\n/* BilalAI Pro: responsive kırılım noktaları */\n' +
      '@media (max-width: 768px) {\n  body {\n    padding: 12px;\n  }\n  main, .app {\n    width: 100%;\n    max-width: 100%;\n  }\n}\n' +
      '@media (max-width: 480px) {\n  h1 {\n    font-size: 1.4rem;\n  }\n  form {\n    flex-direction: column;\n  }\n' +
      '  button, input {\n    width: 100%;\n    min-height: 44px;\n  }\n}\n';

    function insertAfterBodyOpen(html, snippet) {
      if (/<body[^>]*>/i.test(html)) return html.replace(/<body[^>]*>/i, function (m) { return m + '\n' + snippet; });
      return snippet + html;
    }
    function ensureViewport(html) {
      if (/name=["']viewport["']/i.test(html)) return html;
      return html.replace(/<head[^>]*>/i, function (m) {
        return m + '\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />';
      });
    }
    function addScriptTag(html, src) {
      var tag = '  <script src="' + src + '"></script>\n';
      if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, tag + '</body>');
      return html + '\n' + tag;
    }

    function darkMode(ws, files) {
      var htmlP = firstByExt(files, ['html', 'htm']);
      if (!htmlP) return { ok: false, message: 'Dark mode için HTML dosyası bulunamadı.' };
      if (/theme-toggle/.test(files[htmlP])) return { ok: true, skipped: true, message: 'Dark mode zaten mevcut.' };
      var cssP = firstByExt(files, ['css']) || 'style.css';
      var jsP = null;
      Object.keys(files).forEach(function (p) { if (!jsP && ext(p) === 'js' && !/\bimport\s/.test(files[p])) jsP = p; });
      var html = insertAfterBodyOpen(files[htmlP],
        '  <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Temayı değiştir">🌙</button>');
      if (!files[cssP]) html = html.replace(/<\/head>/i, '  <link rel="stylesheet" href="' + cssP + '" />\n</head>');
      if (!jsP) { jsP = 'theme.js'; html = addScriptTag(html, jsP); }
      WorkspaceManager.write(ws, htmlP, html, 'Dark mode: tema değiştirme butonu eklendi');
      WorkspaceManager.write(ws, cssP, (files[cssP] || '') + THEME_CSS, 'Dark mode: açık/koyu tema stilleri eklendi');
      WorkspaceManager.write(ws, jsP, (files[jsP] || '') + THEME_JS, 'Dark mode: tema değiştirici ve LocalStorage tercihi eklendi');
      return { ok: true, message: 'Dark mode eklendi (' + htmlP + ', ' + cssP + ', ' + jsP + ').' };
    }

    function responsive(ws, files) {
      var htmlP = firstByExt(files, ['html', 'htm']);
      var cssP = firstByExt(files, ['css']);
      if (!cssP) return { ok: false, message: 'Responsive düzen için CSS dosyası bulunamadı.' };
      if (/BilalAI Pro: responsive/.test(files[cssP])) return { ok: true, skipped: true, message: 'Responsive kırılımlar zaten mevcut.' };
      WorkspaceManager.write(ws, cssP, files[cssP] + RESPONSIVE_CSS, 'Responsive: 768px ve 480px kırılım noktaları eklendi');
      if (htmlP && !/name=["']viewport["']/i.test(files[htmlP])) {
        WorkspaceManager.write(ws, htmlP, ensureViewport(files[htmlP]), 'Responsive: viewport meta etiketi eklendi');
      }
      return { ok: true, message: 'Responsive kırılım noktaları eklendi (' + cssP + ').' };
    }

    function login(ws, files, analysis) {
      if (files['login.html']) return { ok: true, skipped: true, message: 'Login sayfası zaten mevcut.' };
      var gen = CodeGenerator.generate(Object.assign({}, analysis, {
        techKind: 'web', projectType: 'login', files: ['login.html', 'login.css', 'login.js'] }));
      ['login.html', 'login.css', 'login.js'].forEach(function (p) {
        WorkspaceManager.write(ws, p, gen[p], 'Login sistemi: ' + p + ' oluşturuldu');
      });
      var htmlP = firstByExt(files, ['html', 'htm']);
      if (htmlP && !/href=["']login\.html["']/.test(files[htmlP])) {
        var html = insertAfterBodyOpen(files[htmlP],
          '  <nav class="top-nav" aria-label="Hesap"><a href="login.html">Giriş yap</a></nav>');
        WorkspaceManager.write(ws, htmlP, html, 'Login sistemi: ana sayfaya giriş bağlantısı eklendi');
        var cssP = firstByExt(files, ['css']);
        if (cssP) {
          WorkspaceManager.write(ws, cssP, files[cssP] +
            '\n/* BilalAI Pro: giriş bağlantısı */\n.top-nav {\n  display: flex;\n  justify-content: flex-end;\n  padding: 8px 12px;\n}\n.top-nav a {\n  color: inherit;\n  font-weight: 600;\n}\n',
            'Login sistemi: giriş bağlantısı stili eklendi');
        }
      }
      return { ok: true, message: 'Login sistemi eklendi (login.html, login.css, login.js).' };
    }

    function apply(kind, ws, analysis) {
      var files = filesMapFromWorkspace(ws);
      if (kind === 'dark-mode') return darkMode(ws, files);
      if (kind === 'responsive') return responsive(ws, files);
      if (kind === 'login') return login(ws, files, analysis);
      return { ok: false, message: 'Bu değişiklik türü için otomatik düzenleyici yok: ' + kind };
    }
    return { apply: apply };
  })();

  /* =================================================
     20. VALIDATOR (statik sözdizimi kontrolü)
  ================================================= */

  var Validator = (function () {
    function balanced(content, open, close) {
      var depth = 0, inStr = null;
      for (var i = 0; i < content.length; i++) {
        var c = content[i], prev = content[i - 1];
        if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue; }
        if (c === '/' && content[i + 1] === '/') { var nl = content.indexOf('\n', i); if (nl === -1) break; i = nl; continue; }
        if (c === '/' && content[i + 1] === '*') { var endc = content.indexOf('*/', i + 2); if (endc === -1) break; i = endc + 1; continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === open) depth++;
        else if (c === close) { depth--; if (depth < 0) return false; }
      }
      return depth === 0;
    }
    function add(out, file, message, kind) { out.errors.push({ kind: kind || 'syntax', severity: 'error', file: file, message: message }); }
    function warn(out, file, message, kind) { out.warnings.push({ kind: kind || 'style', severity: 'warning', file: file, message: message }); }

    function checkJs(path, content, out) {
      if (!balanced(content, '{', '}')) add(out, path, 'Süslü parantez dengesiz ({ }).');
      if (!balanced(content, '(', ')')) add(out, path, 'Parantez dengesiz ( ).');
      if (!balanced(content, '[', ']')) add(out, path, 'Köşeli parantez dengesiz ([ ]).');
      if (!/\bimport\s|\bexport\s/.test(content) && ext(path) === 'js') {
        try { new Function(content); }
        catch (e) { add(out, path, 'JS syntax hatası: ' + (e && e.message)); }
      }
    }
    function checkHtml(path, content, out) {
      if (!/<!DOCTYPE html>/i.test(content)) warn(out, path, 'DOCTYPE eksik.');
      if (!/<html[\s>]/i.test(content) || !/<\/html>/i.test(content)) add(out, path, '<html> etiketi kapatılmamış.', 'html');
      if (/<head[\s>]/i.test(content) && !/<\/head>/i.test(content)) add(out, path, '<head> kapatılmamış.', 'html');
      if (/<body[\s>]/i.test(content) && !/<\/body>/i.test(content)) add(out, path, '<body> kapatılmamış.', 'html');
    }
    function checkCss(path, content, out) {
      if (!balanced(content, '{', '}')) add(out, path, 'CSS blok parantezi dengesiz.', 'css');
    }
    function checkJson(path, content, out) {
      try { JSON.parse(content); } catch (e) { add(out, path, 'JSON parse hatası: ' + (e && e.message), 'json'); }
    }
    function checkPython(path, content, out) {
      if (/\t/.test(content) && / {4}/.test(content)) warn(out, path, 'Girintide sekme ve boşluk karışık.');
      content.split('\n').forEach(function (line, i) {
        if (/^\s*(def |class |if |elif |for |while |with |try|except|else|finally|async def )/.test(line)) {
          var trimmed = line.replace(/#.*$/, '').replace(/\s+$/, '');
          if (trimmed && trimmed.slice(-1) !== ':' && trimmed.slice(-1) !== '\\' && trimmed.slice(-1) !== ',' && trimmed.slice(-1) !== '(') {
            add(out, path, 'Satır ' + (i + 1) + ': iki nokta ( : ) eksik.', 'python');
          }
        }
      });
      if (!balanced(content, '(', ')')) add(out, path, 'Parantez dengesiz ( ).', 'python');
    }
    function run(files) {
      var out = { ok: true, errors: [], warnings: [], checked: 0 };
      Object.keys(files).forEach(function (path) {
        var content = files[path] || '';
        var e = ext(path);
        out.checked++;
        if (e === 'js' || e === 'mjs' || e === 'cjs' || e === 'jsx') checkJs(path, content, out);
        else if (e === 'html' || e === 'htm') checkHtml(path, content, out);
        else if (e === 'css') checkCss(path, content, out);
        else if (e === 'json') checkJson(path, content, out);
        else if (e === 'py') checkPython(path, content, out);
      });
      out.ok = out.errors.length === 0;
      return out;
    }
    return { run: run, balanced: balanced };
  })();

  /* =================================================
     21. CODE REVIEWER (self-review: DOM, referans, import, placeholder)
  ================================================= */

  var CodeReviewer = (function () {
    function htmlIds(files) {
      var ids = {};
      Object.keys(files).forEach(function (p) {
        if (ext(p) !== 'html' && ext(p) !== 'htm') return;
        var re = /\sid\s*=\s*["']([^"']+)["']/gi, m;
        while ((m = re.exec(files[p]))) ids[m[1]] = p;
      });
      return ids;
    }
    function jsIdRefs(content) {
      var refs = [], m;
      var re1 = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
      var re2 = /querySelector(?:All)?\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g;
      while ((m = re1.exec(content))) if (refs.indexOf(m[1]) === -1) refs.push(m[1]);
      while ((m = re2.exec(content))) if (refs.indexOf(m[1]) === -1) refs.push(m[1]);
      return refs;
    }
    function resolveRel(fromPath, ref) {
      var clean = ref.replace(/^\//, '');
      if (!/^\.\.?\//.test(ref)) return clean;
      var parts = fromPath.split('/'); parts.pop();
      ref.split('/').forEach(function (seg) {
        if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg);
      });
      return parts.join('/');
    }

    function review(files, analysis) {
      var issues = [];
      function issue(sev, kind, file, message, detail) {
        issues.push({ severity: sev, kind: kind, file: file, message: message, detail: detail || null });
      }
      var paths = Object.keys(files);
      var ids = htmlIds(files);
      var hasHtml = paths.some(function (p) { return ext(p) === 'html'; });

      paths.forEach(function (p) {
        var c = files[p] || '', e = ext(p);
        if (/\b(TODO|FIXME)\b|ADD CODE HERE|IMPLEMENT LATER|PLACEHOLDER/.test(c)) {
          issue('warning', 'placeholder', p, 'Placeholder / yarım kod işareti bulundu.');
        }
        if (e === 'js' && hasHtml && !/\bimport\s/.test(c)) {
          jsIdRefs(c).forEach(function (id) {
            if (!ids[id]) issue('error', 'dom-selector', p, '`#' + id + '` JS içinde kullanılıyor fakat HTML\'de bu id yok.', { id: id });
          });
          if (/JSON\.parse\(\s*localStorage/.test(c) && !/try\s*{[\s\S]*JSON\.parse\(\s*localStorage/.test(c)) {
            issue('warning', 'localstorage', p, 'localStorage verisi try/catch olmadan JSON.parse ediliyor.');
          }
        }
        if (e === 'html') {
          var re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi, m;
          while ((m = re.exec(c))) {
            var ref = m[1];
            if (/^https?:|^\/\/|^#|^data:|^mailto:/.test(ref)) continue;
            if (['css', 'js', 'jsx'].indexOf(ext(ref)) === -1) continue;
            var target = resolveRel(p, ref);
            if (!paths.some(function (pp) { return pp === target; })) {
              issue('error', 'broken-ref', p, 'Referans verilen dosya bulunamadı: ' + ref, { ref: ref, refExt: ext(ref) });
            }
          }
          var headPart = (c.split(/<\/head>/i)[0] || '');
          if (/<script\s+src=/i.test(headPart) && !/defer|type=["']module/i.test(headPart)) {
            issue('warning', 'script-order', p, 'Script <head> içinde defer olmadan yükleniyor.');
          }
        }
        if (e === 'jsx' || (e === 'js' && /\bimport\s/.test(c))) {
          var ri = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g, mi;
          while ((mi = ri.exec(c))) {
            var tgt = resolveRel(p, mi[1]);
            var cands = [tgt, tgt + '.js', tgt + '.jsx', tgt + '/index.js', tgt + '/index.jsx'];
            if (!cands.some(function (x) { return files[x] != null; })) {
              issue('error', 'missing-import', p, 'Import edilen dosya yok: ' + mi[1], { ref: mi[1] });
            }
          }
        }
        if (e === 'py') {
          var needsDiscord = /^\s*import discord|^\s*from discord/m.test(c);
          if (needsDiscord && files['requirements.txt'] != null && !/discord/.test(files['requirements.txt'])) {
            issue('error', 'dependency', p, 'discord import ediliyor fakat requirements.txt içinde yok.', { dep: 'discord.py' });
          }
        }
      });
      return issues;
    }
    return { review: review, jsIdRefs: jsIdRefs, htmlIds: htmlIds };
  })();

  /* =================================================
     22. DEBUGGER (hata açıklama) + AUTO FIXER
  ================================================= */

  var Debugger = (function () {
    function explain(err) {
      var k = err.kind, m = err.message || '';
      if (k === 'dom-selector') return 'JS, HTML\'de olmayan bir elemana erişiyor; çalışma anında null hatası verir.';
      if (k === 'broken-ref') return 'HTML var olmayan bir dosyayı yüklüyor; stil/script uygulanmaz.';
      if (k === 'missing-import') return 'Import edilen modül workspace\'te yok; derleme başarısız olur.';
      if (k === 'dependency') return 'Kullanılan paket bağımlılık listesinde yok; kurulumda eksik kalır.';
      if (/parantez/i.test(m)) return 'Açılan bir blok kapatılmamış; dosya parse edilemez.';
      if (/<\w+>/.test(m)) return 'HTML iskeletinde kapanmamış etiket var.';
      if (/iki nokta/.test(m)) return 'Python blok satırı ":" ile bitmeli.';
      return 'Statik doğrulama hatası.';
    }
    return { explain: explain };
  })();

  var AutoFixer = (function () {
    function fixOne(files, err) {
      var content = files[err.file];
      if (content == null) return null;
      var before = content, m = err.message || '';

      if (err.kind === 'dom-selector' && err.detail) {
        var htmlP = firstByExt(files, ['html', 'htm']);
        if (htmlP) {
          var el = '  <div id="' + err.detail.id + '"></div>\n';
          var h = files[htmlP];
          h = /<script/i.test(h) ? h.replace(/(\s*)<script/i, '\n' + el + '$1<script') : h.replace(/<\/body>/i, el + '</body>');
          files[htmlP] = h;
          return { file: htmlP, action: '#' + err.detail.id + ' elemanı HTML\'e eklendi' };
        }
        return null;
      }
      if (err.kind === 'broken-ref' && err.detail) {
        var cand = Object.keys(files).filter(function (p) { return ext(p) === err.detail.refExt && p !== err.file; })[0];
        if (cand) {
          content = content.split(err.detail.ref).join(cand);
          files[err.file] = content;
          return { file: err.file, action: err.detail.ref + ' referansı ' + cand + ' ile değiştirildi' };
        }
        return null;
      }
      if (err.kind === 'dependency' && err.detail && files['requirements.txt'] != null) {
        files['requirements.txt'] = files['requirements.txt'].replace(/\s*$/, '\n') + err.detail.dep + '\n';
        return { file: 'requirements.txt', action: err.detail.dep + ' bağımlılığı eklendi' };
      }
      if (/<body> kapatılmamış/.test(m) && !/<\/body>/i.test(content)) {
        content = /<\/html>/i.test(content) ? content.replace(/<\/html>/i, '</body>\n</html>') : content + '\n</body>';
      }
      if (/<head> kapatılmamış/.test(m) && !/<\/head>/i.test(content) && /<body[\s>]/i.test(content)) {
        content = content.replace(/<body[\s>]/i, function (x) { return '</head>\n' + x; });
      }
      if (/<html> etiketi kapatılmamış/.test(m) && !/<\/html>/i.test(content)) content = content + '\n</html>';
      if (/DOCTYPE eksik/.test(m) && !/<!DOCTYPE/i.test(content)) content = '<!DOCTYPE html>\n' + content;
      if (/Süslü parantez dengesiz|CSS blok parantezi dengesiz/.test(m)) {
        var ob = (content.match(/{/g) || []).length, cb = (content.match(/}/g) || []).length;
        while (cb < ob) { content += '\n}'; cb++; }
      }
      if (/Parantez dengesiz/.test(m)) {
        var op = (content.match(/\(/g) || []).length, cp = (content.match(/\)/g) || []).length;
        while (cp < op) { content += ')'; cp++; }
      }
      if (/Köşeli parantez dengesiz/.test(m)) {
        var oq = (content.match(/\[/g) || []).length, cq = (content.match(/]/g) || []).length;
        while (cq < oq) { content += ']'; cq++; }
      }
      var line = /Satır (\d+): iki nokta/.exec(m);
      if (line) {
        var lines = content.split('\n'), idx = +line[1] - 1;
        if (lines[idx] != null) { lines[idx] = lines[idx].replace(/\s*$/, ':'); content = lines.join('\n'); }
      }
      if (content !== before) { files[err.file] = content; return { file: err.file, action: m }; }
      return null;
    }
    function fix(files, errors) {
      var applied = [];
      errors.forEach(function (err) {
        var r = fixOne(files, err);
        if (r) applied.push(Object.assign({ explanation: Debugger.explain(err), error: err.message }, r));
      });
      return applied;
    }
    return { fix: fix };
  })();

  /* =================================================
     23. DEPENDENCY ANALYZER
  ================================================= */

  var DependencyAnalyzer = (function () {
    var REASONS = {
      react: 'UI bileşen kütüphanesi', 'react-dom': 'React bileşenlerini DOM\'a render etme',
      vite: 'Geliştirme sunucusu ve bundler', '@vitejs/plugin-react': 'Vite için JSX/React desteği',
      express: 'HTTP sunucusu', jsonwebtoken: 'JWT kimlik doğrulama', pg: 'PostgreSQL istemcisi',
      'discord.py': 'Discord API istemcisi', discord: 'Discord API istemcisi', 'python-dotenv': '.env dosyasından token okuma',
      flask: 'Python web sunucusu', requests: 'HTTP istekleri',
    };
    function analyze(files) {
      var deps = {};
      function add(name, file) {
        if (!deps[name]) deps[name] = { name: name, reason: REASONS[name] || 'Projede kullanılan paket', files: [] };
        if (file && deps[name].files.indexOf(file) === -1) deps[name].files.push(file);
      }
      Object.keys(files).forEach(function (p) {
        var c = files[p] || '';
        if (p === 'package.json') {
          try { var pkg = JSON.parse(c); Object.keys(Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {})).forEach(function (d) { add(d, p); }); } catch (e) { /* validator raporlar */ }
        }
        if (p === 'requirements.txt') {
          c.split('\n').forEach(function (l) { var n = l.trim().split(/[=<>~\s]/)[0]; if (n && n[0] !== '#') add(n, p); });
        }
        if (['js', 'jsx', 'mjs'].indexOf(ext(p)) !== -1) {
          var re = /(?:from\s+|require\()\s*['"]([^'"./][^'"]*)['"]/g, m;
          while ((m = re.exec(c))) add(m[1].split('/')[0] === m[1] ? m[1] : m[1], p);
        }
      });
      return Object.keys(deps).map(function (k) { return deps[k]; });
    }
    return { analyze: analyze };
  })();

  /* =================================================
     24. TEST RUNNER (proje tipine göre statik test stratejisi)
  ================================================= */

  var TestRunner = (function () {
    function run(analysis, files, reviewIssues) {
      var tests = [];
      function t(name, cond, kind) { tests.push({ name: name, passed: !!cond, status: cond ? 'PASS' : 'FAIL', kind: kind || 'feature' }); }
      var paths = Object.keys(files);
      function join(exts) { return paths.filter(function (p) { return exts.indexOf(ext(p)) !== -1; }).map(function (p) { return files[p]; }).join('\n'); }
      var js = join(['js']), css = join(['css']), html = join(['html', 'htm']), all = paths.map(function (p) { return files[p]; }).join('\n');
      var v = Validator.run(files);
      var domIssues = (reviewIssues || []).filter(function (i) { return i.kind === 'dom-selector'; });
      var refIssues = (reviewIssues || []).filter(function (i) { return i.kind === 'broken-ref' || i.kind === 'missing-import'; });
      var kind = analysis.techKind;

      t('Statik sözdizimi doğrulaması', v.ok, 'static');

      if (kind === 'web') {
        t('DOM tutarlılığı (JS selector → HTML id)', domIssues.length === 0, 'dom');
        t('Dosya referansları (CSS/JS) çözülüyor', refIssues.length === 0, 'static');
        if (analysis.projectType === 'todo') {
          t('TEST: görev ekleme', /addTodo|todos\.push/.test(js));
          t('TEST: görev silme', /function remove|splice\(|filter\(/.test(js));
          t('TEST: görev tamamlama', /\.done|toggle|completed/.test(js));
          t('TEST: localStorage save', /localStorage\.setItem/.test(js));
          t('TEST: localStorage restore', /localStorage\.getItem/.test(js) && /JSON\.parse/.test(js));
          t('TEST: boş görev engelleme', /trim\(\)/.test(js));
        } else if (analysis.projectType === 'calculator') {
          t('TEST: rakam girişi', /data-num|append\(/.test(js));
          t('TEST: hesaplama', /equals|Function\(|eval|calculate/.test(js));
          t('TEST: temizleme', /clearAll|clear/.test(js));
        } else if (analysis.projectType === 'login') {
          t('TEST: form doğrulama', /validate/.test(js));
          t('TEST: e-posta kontrolü', /@|indexOf|test\(/.test(js));
          t('TEST: şifre kontrolü', /length\s*<\s*6|minlength/.test(js + html));
        }
        if (/@media/.test(css) || analysis.requirements && analysis.requirements.uiRequirements.indexOf('Responsive tasarım') !== -1) {
          t('TEST: responsive CSS (@media)', /@media/.test(css));
        }
        if (/theme-toggle/.test(html)) {
          t('TEST: dark mode butonu', /id=["']theme-toggle["']/.test(html));
          t('TEST: dark mode stilleri', /theme-dark/.test(css));
          t('TEST: tema tercihi kaydediliyor', /bilalai-theme/.test(js));
        }
        if (files['login.html'] != null) {
          t('TEST: login sayfası mevcut', true);
          t('TEST: login doğrulaması', /validate/.test(files['login.js'] || ''));
        }
      } else if (kind === 'react') {
        t('Import tutarlılığı', refIssues.length === 0, 'static');
        t('package.json geçerli', (function () { try { JSON.parse(files['package.json'] || ''); return true; } catch (e) { return false; } })(), 'static');
        t('react bağımlılığı tanımlı', /"react"/.test(files['package.json'] || ''), 'static');
        t('Root bileşeni render ediliyor', /createRoot\(/.test(all));
        t('Bileşenler export ediliyor', /export default/.test(all));
      } else if (kind === 'python') {
        var py = join(['py']);
        t('Fonksiyon/komut tanımları mevcut', /\bdef\s+\w+|async def/.test(py));
        t('Importlar bağımlılık listesiyle uyumlu', !(reviewIssues || []).some(function (i) { return i.kind === 'dependency'; }), 'static');
        t('Token koda gömülmemiş (env)', !/TOKEN\s*=\s*['"][A-Za-z0-9._-]{20,}['"]/.test(py));
        t('Giriş noktası (__main__ / run) var', /__main__|\.run\(/.test(py));
      } else if (kind === 'node') {
        t('package.json geçerli', (function () { try { JSON.parse(files['package.json'] || ''); return true; } catch (e) { return false; } })(), 'static');
        t('Giriş dosyası mevcut', !!files['index.js']);
      }
      var passed = tests.filter(function (x) { return x.passed; }).length;
      return { passed: passed, failed: tests.length - passed, total: tests.length, tests: tests,
        mode: 'static', note: 'Runtime yürütme yok; testler statik analizdir.' };
    }
    return { run: run };
  })();

  // Geriye dönük uyumluluk
  var Fixer = { fix: function (files, errors) { return AutoFixer.fix(files, errors).length > 0; } };
  var Tester = TestRunner;

  /* =================================================
     25. PLANNER + TASK MANAGER (dinamik, karmaşıklığa göre)
  ================================================= */

  var Planner = (function () {
    function build(analysis, generatedFiles) {
      var tasks = [], cx = analysis.complexity;
      function add(title, type, extra) { tasks.push(Object.assign({ id: uid('t'), title: title, type: type }, extra || {})); }
      add('Talebi analiz et', 'analyze');
      add('Workspace\'i analiz et', 'workspace');
      if (cx === 'complex' || cx === 'very-complex') add('Gereksinimleri çıkar', 'requirements');
      if (cx === 'very-complex') add('Mimariyi ve modülleri tasarla', 'architecture');

      if (analysis.intent === 'create') {
        add(cx === 'simple' ? 'Dosyaları hazırla' : 'Proje yapısını oluştur', 'scaffold');
        (generatedFiles || analysis.files).forEach(function (f) { add(f + ' oluştur', 'create-file', { path: f }); });
      } else if (analysis.intent === 'modify') {
        if (!analysis.context.modifications.length) add('Değişiklik kapsamını belirle', 'review');
        analysis.context.modifications.forEach(function (m) { add(m.title, 'edit', { mod: m.kind }); });
      } else {
        add('Mevcut kodu incele ve hataları tespit et', 'review');
      }
      if (cx === 'complex' || cx === 'very-complex' || analysis.techKind === 'python' || analysis.techKind === 'react') {
        add('Bağımlılıkları analiz et', 'dependencies');
      }
      add('Self-check yap ve hataları düzelt', 'verify-fix');
      add('Testleri çalıştır (statik)', 'test');
      if (analysis.requiresPreview) add('Preview hazırla', 'preview');
      else add('Çalıştırma notlarını hazırla', 'notes');
      if (cx !== 'simple') add('Final raporu hazırla', 'report');
      return tasks;
    }
    return { build: build };
  })();

  var TaskManager = (function () {
    function init(tasks) {
      STATE.tasks = tasks.map(function (t) {
        return { id: t.id, title: t.title, type: t.type, path: t.path || null, mod: t.mod || null,
          status: 'pending', startedAt: null, finishedAt: null, error: null };
      });
      STATE.plan = STATE.tasks.map(function (t) { return t.title; });
      return STATE.tasks;
    }
    function find(id) {
      for (var i = 0; i < STATE.tasks.length; i++) if (STATE.tasks[i].id === id) return STATE.tasks[i];
      return null;
    }
    function set(id, status, extra) {
      var t = find(id);
      if (!t) return null;
      t.status = status;
      if (status === 'running') t.startedAt = Date.now(); else t.finishedAt = Date.now();
      if (extra && extra.error) t.error = extra.error;
      var p = progress();
      var meta = { taskId: t.id, title: t.title, status: status, progress: p.completed + '/' + p.total, task: clone(t) };
      if (status === 'running') emit('task:start', '▶ ' + t.title, meta, 'task:started');
      else if (status === 'completed') emit('task:complete', '✓ ' + t.title + ' (' + meta.progress + ')', meta, 'task:completed');
      else if (status === 'failed') emit('task:fail', '✗ ' + t.title, Object.assign(meta, { reason: extra && extra.error }), 'task:failed');
      else if (status === 'skipped') emit('task:skip', '↷ ' + t.title, meta);
      return t;
    }
    function start(id) { return set(id, 'running'); }
    function complete(id) { return set(id, 'completed'); }
    function fail(id, reason) { return set(id, 'failed', { error: reason }); }
    function skip(id) { return set(id, 'skipped'); }
    function progress() {
      var total = STATE.tasks.length;
      var done = STATE.tasks.filter(function (t) { return t.status === 'completed' || t.status === 'skipped'; }).length;
      return { completed: done, total: total, percentage: total ? Math.round((done / total) * 100) : 0 };
    }
    function render() {
      var sym = { pending: '[ ]', running: '[▶]', completed: '[x]', failed: '[✗]', skipped: '[-]' };
      var p = progress();
      var lines = ['**' + p.completed + '/' + p.total + '** görev'];
      STATE.tasks.forEach(function (t) { lines.push('- ' + (sym[t.status] || '[ ]') + ' ' + t.title); });
      return lines.join('\n');
    }
    return { init: init, find: find, start: start, complete: complete, fail: fail, skip: skip, progress: progress, render: render };
  })();

  /* =================================================
     26. PREVIEW MANAGER
  ================================================= */

  var PreviewManager = (function () {
    function prepare(ctx) {
      var a = ctx.analysis;
      if (a.techKind === 'web') {
        var pv = ctx.preview.previewProject(filesMapFromWorkspace(ctx.workspace));
        return pv || { available: false, reason: 'preview_failed' };
      }
      return { available: false, reason: 'browser_runtime_not_available',
        note: a.techKind + ' projesi tarayıcıda doğrudan çalıştırılamaz; preview oluşturulmadı.' };
    }
    return { prepare: prepare };
  })();

  /* =================================================
     27. AGENT CORE — adımlar
  ================================================= */

  function pickThinking(complexity) {
    return randBetween(CONFIG.thinkingMs[complexity] || CONFIG.thinkingMs.medium);
  }

  // Geriye dönük uyumluluk
  function recordFile(workspace, path, content, reason) { return WorkspaceManager.write(workspace, path, content, reason || 'Dosya yazıldı'); }

  function runVerifyFix(ctx, title) {
    var ws = ctx.workspace;
    setStatus('verifying', title);
    emit('validation:start', '🔍 Self-check başlatıldı (statik doğrulama + kod incelemesi).', {});
    var files = filesMapFromWorkspace(ws);

    function check() {
      var v = Validator.run(files);
      var r = CodeReviewer.review(files, ctx.analysis);
      return {
        errors: v.errors.concat(r.filter(function (i) { return i.severity === 'error'; })),
        warnings: v.warnings.concat(r.filter(function (i) { return i.severity === 'warning'; })),
        review: r, checked: v.checked,
      };
    }
    var res = check();
    STATE.validation = { initialErrors: res.errors.length, rounds: [] };
    STATE.issues = clone(res.errors);
    emit('validation:complete', res.errors.length ? '🛠 ' + res.errors.length + ' hata bulundu.' : '✅ Self-check temiz.',
      { ok: res.errors.length === 0, errors: res.errors.length, warnings: res.warnings.length },
      res.errors.length ? 'validation:failed' : 'validation:passed');

    var attempt = 0;
    while (res.errors.length && attempt < CONFIG.maxFixAttempts) {
      attempt++;
      STATE.fixAttempts = attempt;
      setStatus('fixing', title);
      emit('fix:start', '🛠 Düzeltme denemesi ' + attempt + '/' + CONFIG.maxFixAttempts, { attempt: attempt, errors: res.errors.length });
      var applied = AutoFixer.fix(files, res.errors);
      applied.forEach(function (fx) {
        WorkspaceManager.write(ws, fx.file, files[fx.file], 'Auto-fix (deneme ' + attempt + '): ' + fx.action);
      });
      STATE.fixes.push({ attempt: attempt, detected: res.errors.map(function (e) { return e.file + ': ' + e.message; }), applied: applied });
      emit('fix:complete', '🔁 Deneme ' + attempt + ': ' + applied.length + ' düzeltme uygulandı, tekrar doğrulanıyor.', { attempt: attempt, applied: applied.length }, 'fix:completed');
      var before = res.errors.length;
      res = check();
      STATE.validation.rounds.push({ attempt: attempt, before: before, after: res.errors.length });
      emit('validation:complete', res.errors.length ? '⚠️ Kalan hata: ' + res.errors.length : '✅ Yeniden doğrulama geçti.',
        { ok: res.errors.length === 0, attempt: attempt, errors: res.errors.length }, res.errors.length ? 'validation:failed' : 'validation:passed');
      if (!applied.length) break;
    }
    STATE.remainingIssues = clone(res.errors);
    STATE.warnings = clone(res.warnings);
    STATE.testStatus = res.errors.length ? 'failed' : 'passed';
    ctx.review = res.review;
    ctx.files = files;
    ctx.checkedFiles = res.checked;
  }

  function runStep(task, ctx) {
    var a = ctx.analysis, ws = ctx.workspace;
    switch (task.type) {
      case 'analyze': {
        setStatus('analyzing', task.title);
        emit('analysis:complete', '🧠 Talep analiz edildi: ' + a.projectKind + ' / ' + a.frameworkName + ' / ' + a.complexity + '.', {
          projectType: a.projectType, framework: a.frameworkName, complexity: a.complexity, intent: a.intent, files: a.files });
        note('Mod: ' + (a.intent === 'create' ? 'yeni proje' : a.intent === 'modify' ? 'mevcut projede değişiklik' : 'hata ayıklama') + ' — ' + a.context.reason);
        if (a.needsResearch) {
          note(ctx.web.isAvailable() ? 'Dokümantasyon araştırması için web adapteri mevcut.'
            : 'Web/dokümantasyon adapteri bağlı değil; araştırma yapılmadı, yerleşik bilgi kullanıldı.');
        }
        break;
      }
      case 'workspace': {
        setStatus('analyzing', task.title);
        var pr = a.project;
        note(pr.fileCount ? 'Workspace: ' + pr.fileCount + ' dosya okundu (framework: ' + (pr.framework || '-') + ', giriş: ' + (pr.entry || '-') + ').'
          : 'Workspace boş; yeni proje oluşturulacak.');
        break;
      }
      case 'requirements': {
        setStatus('planning', task.title);
        note('Gereksinimler: ' + a.requirements.functionalRequirements.length + ' fonksiyonel, ' + a.requirements.implicitRequirements.length + ' örtük.');
        break;
      }
      case 'architecture': {
        setStatus('planning', task.title);
        note('Mimari: istek çok kapsamlı; bu tarayıcı motoru çekirdek modülü (' + a.files.join(', ') + ') üretir, kalan servisler raporda listelenir.');
        break;
      }
      case 'scaffold': {
        setStatus('scaffolding', task.title);
        if (!ctx.generated) ctx.generated = CodeGenerator.generate(a);
        break;
      }
      case 'create-file': {
        setStatus('implementing', task.title);
        if (!ctx.generated) ctx.generated = CodeGenerator.generate(a);
        var content = ctx.generated[task.path];
        if (content == null) {
          var err = new Error('İçerik üretilemedi: ' + task.path);
          recordError(err, { type: 'GenerationError', task: task.title, file: task.path });
          throw err;
        }
        WorkspaceManager.write(ws, task.path, content, a.projectType + ' projesi için ' + task.path + ' üretildi');
        break;
      }
      case 'edit': {
        setStatus('implementing', task.title);
        var r = CodeEditor.apply(task.mod, ws, a);
        note((r.ok ? '' : '⚠️ ') + r.message);
        if (!r.ok) STATE.warnings.push({ kind: 'edit', severity: 'warning', file: null, message: r.message });
        break;
      }
      case 'review': {
        setStatus('verifying', task.title);
        var files = filesMapFromWorkspace(ws);
        if (!Object.keys(files).length) { note('Workspace boş; incelenecek kod bulunamadı.'); break; }
        var found = Validator.run(files).errors.concat(CodeReviewer.review(files, a).filter(function (i) { return i.severity === 'error'; }));
        STATE.detected = found.map(function (e) { return { file: e.file, message: e.message, explanation: Debugger.explain(e) }; });
        note('İnceleme: ' + Object.keys(files).length + ' dosya tarandı, ' + found.length + ' hata tespit edildi.');
        if (a.intent === 'modify' && !a.context.modifications.length) {
          note('Bu değişiklik isteği için otomatik düzenleyici eşleşmedi; mevcut kod korunarak yalnızca inceleme yapıldı.');
        }
        break;
      }
      case 'dependencies': {
        setStatus('verifying', task.title);
        STATE.dependencies = DependencyAnalyzer.analyze(filesMapFromWorkspace(ws));
        break;
      }
      case 'verify-fix': runVerifyFix(ctx, task.title); break;
      case 'test': {
        setStatus('verifying', task.title);
        emit('test:start', '🧪 Statik testler çalışıyor...', {});
        var files2 = ctx.files || filesMapFromWorkspace(ws);
        ctx.testResult = TestRunner.run(a, files2, CodeReviewer.review(files2, a));
        STATE.tests = ctx.testResult.tests.slice();
        if (!STATE.dependencies.length) STATE.dependencies = DependencyAnalyzer.analyze(files2);
        emit('test:complete', '🧪 ' + ctx.testResult.passed + '/' + ctx.testResult.total + ' test geçti.', {
          passed: ctx.testResult.passed, failed: ctx.testResult.failed, total: ctx.testResult.total });
        break;
      }
      case 'preview': {
        setStatus('previewing', task.title);
        emit('preview:start', '👀 Preview hazırlanıyor...', {});
        STATE.preview = PreviewManager.prepare(ctx);
        if (STATE.preview && STATE.preview.available) {
          emit('preview:create', '👀 Preview gerçek workspace dosyalarından hazırlandı.', { url: STATE.preview.url, title: STATE.preview.title }, 'preview:ready');
        }
        break;
      }
      case 'notes': {
        setStatus('implementing', task.title);
        STATE.executionAvailable = false;
        STATE.preview = PreviewManager.prepare(ctx);
        note('Runtime yürütme adapteri bağlı değil; yalnızca statik doğrulama yapıldı.');
        break;
      }
      case 'report': setStatus('previewing', task.title); break;
      default: break;
    }
  }

  /* =================================================
     28. FINAL REPORTER
  ================================================= */

  var FinalReporter = (function () {
    var ACTION_TR = { create: 'CREATE', update: 'EDIT', delete: 'DELETE', rename: 'RENAME', move: 'MOVE' };
    function report(a, ctx, ok) {
      var L = [];
      var p = TaskManager.progress();
      var remaining = STATE.remainingIssues || [];
      var head = !ok ? '## Görev tamamlanamadı' : remaining.length ? '## Görev tamamlandı (kalan hatalarla)'
        : a.intent === 'create' ? '## Proje tamamlandı' : a.intent === 'modify' ? '## Değişiklikler tamamlandı' : '## Hata ayıklama tamamlandı';
      L.push(head, '');
      L.push('**Mod:** ' + (a.intent === 'create' ? 'Yeni proje' : a.intent === 'modify' ? 'Mevcut projede değişiklik' : 'Hata ayıklama') +
        ' · **Tip:** ' + a.projectKind + ' · **Framework:** ' + a.frameworkName + ' · **Karmaşıklık:** ' + a.complexity + ' · **Öncelik:** ' + a.priority);

      L.push('', '### Plan', TaskManager.render());

      L.push('', '### Dosya değişiklikleri');
      if (!STATE.changes.length) L.push('- Dosya değişikliği yapılmadı.');
      STATE.changes.forEach(function (c) {
        L.push('- `' + (ACTION_TR[c.action] || c.action) + '` ' + (c.from ? c.from + ' → ' : '') + '**' + c.path + '** — ' + c.reason);
      });

      var feats = a.requirements.functionalRequirements;
      if (a.intent !== 'fix' && feats.length) {
        L.push('', '### Yapılan özellikler');
        feats.concat(a.requirements.uiRequirements).forEach(function (f) { L.push('- ' + f); });
      }

      if (STATE.dependencies.length) {
        L.push('', '### Bağımlılıklar');
        STATE.dependencies.forEach(function (d) { L.push('- `' + d.name + '` — ' + d.reason + (d.files.length ? ' (' + d.files.join(', ') + ')' : '')); });
      }

      L.push('', '### Self-check (statik doğrulama)');
      var initial = STATE.validation ? STATE.validation.initialErrors : 0;
      L.push('- ' + (ctx.checkedFiles || 0) + ' dosya kontrol edildi; ilk taramada ' + initial + ' hata bulundu.');
      if (STATE.detected && STATE.detected.length) {
        STATE.detected.forEach(function (d) { L.push('- Tespit: `' + d.file + '` — ' + d.message + ' _(' + d.explanation + ')_'); });
      }
      STATE.fixes.forEach(function (f) {
        L.push('- **Deneme ' + f.attempt + ':** ' + (f.applied.length ? f.applied.map(function (x) { return x.file + ' → ' + x.action; }).join('; ') : 'otomatik düzeltme uygulanamadı'));
      });
      if (remaining.length) {
        L.push('- ⚠️ ' + CONFIG.maxFixAttempts + ' deneme sınırı içinde düzeltilemeyen hatalar:');
        remaining.forEach(function (e) { L.push('  - `' + e.file + '`: ' + e.message); });
      } else if (initial) {
        L.push('- ✅ Tüm hatalar düzeltildi, yeniden doğrulama temiz.');
      } else {
        L.push('- ✅ Hata bulunmadı.');
      }
      if (STATE.warnings.length) L.push('- Uyarılar: ' + STATE.warnings.map(function (w) { return w.message; }).join(' · '));

      if (ctx.testResult) {
        L.push('', '### Testler (' + ctx.testResult.passed + '/' + ctx.testResult.total + ' — statik)');
        ctx.testResult.tests.forEach(function (x) { L.push('- ' + x.status + ' — ' + x.name); });
      }

      var cnt = ChangeTracker.counts();
      L.push('', '### Değişiklik özeti');
      L.push('- ' + cnt.create + ' yeni dosya, ' + cnt.update + ' güncelleme' + (cnt.delete ? ', ' + cnt.delete + ' silme' : '') + (cnt.rename || cnt.move ? ', ' + (cnt.rename + cnt.move) + ' taşıma' : '') + '.');

      L.push('', '### Preview');
      if (STATE.preview && STATE.preview.available) L.push('- Hazır — workspace dosyalarından oluşturuldu.');
      else if (STATE.preview && STATE.preview.note) L.push('- ' + STATE.preview.note);
      else L.push('- Bu görev için preview yok.');

      if (STATE.notes.length) { L.push('', '### Notlar'); STATE.notes.forEach(function (n) { L.push('- ' + n); }); }
      STATE.errors.forEach(function (e) { L.push('- ❌ ' + e.type + ': ' + e.message + (e.file ? ' (' + e.file + ')' : '')); });
      L.push('', '_Kod gerçek bir runtime\'da çalıştırılmadı; kontroller ve testler statik analizdir._');
      return L.join('\n');
    }
    return { report: report };
  })();

  function summaryText(analysis, ctx) { return FinalReporter.report(analysis, ctx, STATE.status !== 'failed'); }

  /* =================================================
     29. RUN LIFECYCLE
  ================================================= */

  function buildResult(analysis, ctx) {
    var allDone = STATE.tasks.every(function (t) { return t.status === 'completed' || t.status === 'skipped'; });
    var previewAvailable = !!(STATE.preview && STATE.preview.available);
    var testsPassed = ctx.testResult ? ctx.testResult.failed === 0 : STATE.testStatus === 'passed';
    return {
      ok: allDone && STATE.status === 'completed',
      model: MODEL.shortName,
      response: FinalReporter.report(analysis, ctx, STATE.status === 'completed'),
      analysis: clone(Object.assign({}, analysis, { project: undefined })),
      intent: analysis.intent,
      plan: STATE.tasks.map(function (t) { return t.title; }),
      tasks: clone(STATE.tasks),
      files: STATE.files.map(function (f) { return f.path; }),
      filesDetailed: clone(STATE.files),
      changes: clone(STATE.changes),
      notes: STATE.notes.slice(),
      dependencies: clone(STATE.dependencies),
      errors: clone(STATE.errors),
      issues: clone(STATE.remainingIssues || []),
      warnings: clone(STATE.warnings),
      fixes: clone(STATE.fixes),
      fixAttempts: STATE.fixAttempts,
      tests: clone(STATE.tests),
      testStatus: STATE.testStatus,
      testsPassed: testsPassed,
      preview: clone(STATE.preview),
      previewAvailable: previewAvailable,
      executionAvailable: STATE.executionAvailable,
      state: getStateSnapshot(),
    };
  }

  function initRun(userMsg, options) {
    options = options || {};
    var events = [];
    STATE = freshState();
    STATE.events = events;
    STATE.task = userMsg == null ? '' : String(userMsg);
    STATE.startedAt = Date.now();
    emit('agent:start', '🧠 Pro 1.0 agent başlatıldı.', { task: STATE.task }, 'task:analyzing');

    var workspace = ensureWorkspace(options.workspace || defaultWorkspace);
    var web = createWebAdapter(options.web || null);
    var preview = options.preview ? createPreviewAdapter(options.preview) : defaultPreview;

    setStatus('analyzing');
    emit('analysis:start', '🧠 Talep, bağlam ve workspace analiz ediliyor...', {});
    var analysis = RequestAnalyzer.analyze(userMsg, workspace);
    STATE.analysis = clone(Object.assign({}, analysis, { project: undefined }));

    var ctx = { analysis: analysis, workspace: workspace, web: web, preview: preview };
    var fileList = null;
    if (analysis.intent === 'create') {
      ctx.generated = CodeGenerator.generate(analysis);
      if (analysis.techKind === 'react' && ctx.generated['package.json'] == null) {
        ctx.generated['package.json'] = JSON.stringify({
          name: 'bilalai-react-app', private: true, version: '1.0.0', type: 'module',
          scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
          dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
          devDependencies: { vite: '^7.0.0', '@vitejs/plugin-react': '^5.0.0' },
        }, null, 2) + '\n';
      }
      fileList = analysis.files.filter(function (f) { return ctx.generated[f] != null; });
      Object.keys(ctx.generated).forEach(function (f) { if (fileList.indexOf(f) === -1) fileList.push(f); });
    }

    setStatus('planning');
    TaskManager.init(Planner.build(analysis, fileList));
    emit('plan:create', '📋 Plan oluşturuldu: ' + STATE.tasks.length + ' görev.', { tasks: clone(STATE.tasks), plan: STATE.plan.slice() }, 'task:created');
    return ctx;
  }

  function finishRun(ctx, ok) {
    STATE.status = ok ? 'completed' : 'failed';
    STATE.finishedAt = Date.now();
    STATE.currentStep = null;
    if (ok) remember(STATE.task, ctx.analysis);
    var result = buildResult(ctx.analysis, ctx);
    if (ok) emit('agent:complete', '✅ Görev tamamlandı.', { files: result.files, tests: result.tests.length }, 'task:completed');
    else emit('agent:error', '❌ Agent hata ile durdu.', { errors: clone(STATE.errors) }, 'task:failed');
    return result;
  }

  function failRun(ctx, e) {
    var running = STATE.tasks.filter(function (t) { return t.status === 'running'; })[0];
    if (!STATE.errors.some(function (x) { return x.message === (e && e.message); })) {
      recordError(e, { task: running ? running.title : null });
    }
    if (running) TaskManager.fail(running.id, e && e.message);
    STATE.tasks.forEach(function (t) { if (t.status === 'pending') TaskManager.skip(t.id); });
    return finishRun(ctx, false);
  }

  function runSync(userMsg, options) {
    var ctx;
    try { ctx = initRun(userMsg, options); }
    catch (e) { recordError(e, { type: 'AnalysisError' }); return finishRun({ analysis: RequestAnalyzer.analyze('', createWorkspaceAdapter()) }, false); }
    try {
      for (var i = 0; i < STATE.tasks.length; i++) {
        var task = STATE.tasks[i];
        TaskManager.start(task.id);
        runStep(task, ctx);
        TaskManager.complete(task.id);
      }
      return finishRun(ctx, true);
    } catch (e) { return failRun(ctx, e); }
  }

  async function runAsyncFlow(userMsg, options) {
    var ctx;
    try { ctx = initRun(userMsg, options); }
    catch (e) { recordError(e, { type: 'AnalysisError' }); return finishRun({ analysis: RequestAnalyzer.analyze('', createWorkspaceAdapter()) }, false); }
    await sleep(pickThinking(ctx.analysis.complexity));
    try {
      for (var i = 0; i < STATE.tasks.length; i++) {
        var task = STATE.tasks[i];
        TaskManager.start(task.id);
        await sleep(CONFIG.stepDelayMs);
        runStep(task, ctx);
        TaskManager.complete(task.id);
      }
      return finishRun(ctx, true);
    } catch (e) { return failRun(ctx, e); }
  }

  /* =================================================
     30. STATE SNAPSHOT
  ================================================= */

  function getStateSnapshot() {
    return clone({
      status: STATE.status, task: STATE.task, analysis: STATE.analysis, plan: STATE.plan, tasks: STATE.tasks,
      files: STATE.files, changes: STATE.changes, notes: STATE.notes, dependencies: STATE.dependencies,
      errors: STATE.errors, issues: STATE.remainingIssues || [], warnings: STATE.warnings, fixes: STATE.fixes,
      tests: STATE.tests, testStatus: STATE.testStatus, preview: STATE.preview, currentStep: STATE.currentStep,
      fixAttempts: STATE.fixAttempts, executionAvailable: STATE.executionAvailable, events: STATE.events,
      startedAt: STATE.startedAt, finishedAt: STATE.finishedAt, progress: TaskManager.progress(),
      memory: { history: MEMORY.history, project: MEMORY.project },
    });
  }

  /* =================================================
     31. SELF TEST
  ================================================= */

  function selfTest() {
    var tests = [];
    function check(group, name, fn) {
      var passed = false, error = null;
      try { passed = !!fn(); } catch (e) { error = e && e.message; }
      tests.push({ group: group, name: name, passed: passed, error: error });
    }
    var savedState = STATE, savedMem = { history: MEMORY.history.slice(), project: MEMORY.project };

    check('API', 'Public API mevcut', function () {
      return ['generate', 'generateAsync', 'runTask', 'analyze', 'plan', 'getPlan', 'getTasks', 'getFiles', 'getChanges',
        'getState', 'getPreview', 'reset', 'onEvent', 'setWorkspace', 'selfTest'].every(function (k) { return typeof BilalAIPro[k] === 'function'; })
        && BilalAIPro.MODEL.name === 'BilalAI - Pro 1.0';
    });
    check('Analyzer', 'Todo isteği analiz ediliyor', function () {
      var a = BilalAIPro.analyze('Modern responsive todo uygulaması oluştur. index.html, style.css, app.js ayrı olsun.', { workspace: createWorkspaceAdapter() });
      return a.projectType === 'todo' && a.intent === 'create' && a.complexity === 'medium' &&
        a.files.join(',') === 'index.html,style.css,app.js' && a.requirements.functionalRequirements.length >= 4;
    });
    check('Analyzer', 'Karmaşıklık sınıfları', function () {
      var ws = createWorkspaceAdapter();
      return BilalAIPro.analyze('Python\'da iki sayıyı topla', { workspace: ws }).complexity === 'simple' &&
        BilalAIPro.analyze('JWT authentication + PostgreSQL + admin dashboard + REST API oluştur', { workspace: ws }).complexity === 'complex' &&
        BilalAIPro.analyze('Bana full-stack SaaS platformu geliştir', { workspace: ws }).complexity === 'very-complex';
    });
    check('Analyzer', 'Bağlam: mevcut projeye değişiklik', function () {
      var ws = createWorkspaceAdapter({ 'index.html': '<html><body></body></html>', 'style.css': 'body{}', 'app.js': 'var todos=[];' });
      var a = BilalAIPro.analyze('Mevcut Todo uygulamasına dark mode ekle', { workspace: ws });
      var b = BilalAIPro.analyze('app.js dosyasındaki hatayı bul ve düzelt', { workspace: ws });
      return a.intent === 'modify' && a.context.modifications[0].kind === 'dark-mode' && b.intent === 'fix';
    });
    check('Planner', 'Plan karmaşıklığa göre değişiyor', function () {
      var ws = createWorkspaceAdapter();
      var s = BilalAIPro.plan('Bana basit bir hesap makinesi yap', { workspace: ws }).tasks.length;
      var c = BilalAIPro.plan('React ile admin dashboard oluştur', { workspace: ws }).tasks.length;
      return s >= 4 && c > s;
    });
    check('TaskManager', 'Durum geçişleri', function () {
      STATE = freshState(); STATE.events = [];
      TaskManager.init([{ id: 'a', title: 'A', type: 'x' }, { id: 'b', title: 'B', type: 'x' }]);
      TaskManager.start('a'); TaskManager.complete('a'); TaskManager.skip('b');
      return TaskManager.progress().completed === 2 && TaskManager.find('a').status === 'completed';
    });
    check('Workspace', 'CREATE/EDIT/RENAME/DELETE + change tracking', function () {
      STATE = freshState(); STATE.events = [];
      var ws = createWorkspaceAdapter();
      WorkspaceManager.write(ws, 'a.js', '1', 'test'); WorkspaceManager.write(ws, 'a.js', '2', 'test');
      WorkspaceManager.rename(ws, 'a.js', 'b.js', 'test'); WorkspaceManager.move(ws, 'b.js', 'src/b.js', 'test');
      WorkspaceManager.remove(ws, 'src/b.js', 'test');
      return STATE.changes.map(function (c) { return c.action; }).join(',') === 'create,update,rename,move,delete' && ws.listFiles().length === 0;
    });
    check('CodeGenerator', 'Placeholder\'sız gerçek kod', function () {
      var g = CodeGenerator.generate(RequestAnalyzer.analyze('todo uygulaması index.html style.css app.js localStorage', createWorkspaceAdapter()));
      return /localStorage/.test(g['app.js']) && !/\bTODO\b|PLACEHOLDER/.test(g['app.js'] + g['index.html']);
    });
    check('Validator', 'Sözdizimi hatası yakalanıyor', function () {
      return Validator.run({ 'x.js': 'function a(){ return 1; }' }).ok && !Validator.run({ 'x.js': 'function a(){ return 1;' }).ok;
    });
    check('Reviewer', 'Eksik DOM selector tespit ediliyor', function () {
      var r = CodeReviewer.review({ 'index.html': '<html><body><ul id="list"></ul></body></html>', 'app.js': "document.getElementById('todoList');" }, {});
      return r.some(function (i) { return i.kind === 'dom-selector' && i.detail.id === 'todoList'; });
    });
    check('Fixer', 'DOM + HTML hataları düzeltiliyor', function () {
      var f = { 'index.html': '<!DOCTYPE html><html><head></head><body><script src="app.js"></script>', 'app.js': "document.getElementById('todoList');" };
      var errs = Validator.run(f).errors.concat(CodeReviewer.review(f, {}).filter(function (i) { return i.severity === 'error'; }));
      AutoFixer.fix(f, errs);
      return Validator.run(f).ok && CodeReviewer.review(f, {}).filter(function (i) { return i.severity === 'error'; }).length === 0;
    });
    check('Tester', 'Todo feature testleri', function () {
      var g = CodeGenerator.generate(RequestAnalyzer.analyze('todo uygulaması index.html style.css app.js localStorage', createWorkspaceAdapter()));
      var r = TestRunner.run({ techKind: 'web', projectType: 'todo', requirements: { uiRequirements: [] } }, g, CodeReviewer.review(g, {}));
      return r.total >= 7 && r.failed === 0;
    });
    check('Preview', 'Gerçek dosyalardan preview', function () {
      var pv = createPreviewAdapter().previewProject({ 'index.html': '<!DOCTYPE html><html><head></head><body>ok</body></html>', 'style.css': 'body{color:red}', 'app.js': 'console.log(1)' });
      return pv.available && /color:red/.test(pv.html) && /console\.log\(1\)/.test(pv.html);
    });
    check('EventBus', 'Standart event şeması', function () {
      var got = null, off = bus.on(function (e) { if (e.type === 'selftest:ping') got = e; });
      emit('selftest:ping', 'ping', { a: 1 }); off();
      return got && got.timestamp && got.message === 'ping' && got.metadata.a === 1;
    });
    check('Pipeline', 'Todo uçtan uca + dark mode takibi', function () {
      var ws = createWorkspaceAdapter();
      var r1 = BilalAIPro.generate('Modern responsive Todo uygulaması oluştur. index.html, style.css ve app.js ayrı olsun, localStorage olsun.', {}, { workspace: ws });
      var r2 = BilalAIPro.generate('Mevcut Todo uygulamasına dark mode ekle', {}, { workspace: ws });
      return r1.ok && r1.files.length === 3 && r1.testsPassed && r2.ok && r2.intent === 'modify' && /theme-toggle/.test(ws.readFile('index.html'));
    });
    check('Bağımsızlık', 'Flash motorlarına referans yok', function () {
      var src = String(runAsyncFlow) + String(runStep) + String(initRun);
      return !/BilalAIResponseEngine|BilalAIFlashLite|__BilalAIFlashCore/.test(src);
    });

    STATE = savedState; MEMORY.history = savedMem.history; MEMORY.project = savedMem.project;
    var passed = tests.filter(function (x) { return x.passed; }).length;
    var groups = {};
    tests.forEach(function (x) { groups[x.group] = groups[x.group] || { passed: 0, total: 0 }; groups[x.group].total++; if (x.passed) groups[x.group].passed++; });
    return { ok: passed === tests.length, passed: passed, failed: tests.length - passed, total: tests.length, groups: groups, tests: tests };
  }

  /* =================================================
     32. PUBLIC API
  ================================================= */

  function wsFrom(options) { return ensureWorkspace((options && options.workspace) || defaultWorkspace); }

  var BilalAIPro = {
    MODEL: MODEL,
    CONFIG: CONFIG,
    createWorkspaceAdapter: createWorkspaceAdapter,
    createWebAdapter: createWebAdapter,
    createPreviewAdapter: createPreviewAdapter,

    onEvent: function (cb) { return bus.on(cb); },
    setWorkspace: function (adapter) { defaultWorkspace = ensureWorkspace(adapter); return true; },

    analyze: function (userMsg, options) {
      var a = RequestAnalyzer.analyze(userMsg, wsFrom(options));
      return clone(a);
    },
    plan: function (userMsg, options) {
      var a = RequestAnalyzer.analyze(userMsg, wsFrom(options));
      var files = null;
      if (a.intent === 'create') files = Object.keys(CodeGenerator.generate(a));
      var tasks = Planner.build(a, files);
      return { analysis: clone(a), tasks: tasks, titles: tasks.map(function (t) { return t.title; }) };
    },
    getPlan: function (userMsg, options) { return BilalAIPro.plan(userMsg, options); },

    getState: function () { return getStateSnapshot(); },
    getTasks: function () { return clone(STATE.tasks); },
    getFiles: function () { return clone(STATE.files); },
    getChanges: function () { return clone(STATE.changes); },
    getPreview: function () { return clone(STATE.preview); },
    getMemory: function () { return clone(MEMORY); },

    reset: function (options) {
      STATE = freshState();
      if (options && options.memory) { MEMORY.history = []; MEMORY.project = null; }
      bus.emit('reset', { message: 'Agent sıfırlandı.' });
      return true;
    },

    generate: function (userMsg, context, options) { return runSync(userMsg, options || {}); },
    generateAsync: function (userMsg, context, options) { return runAsyncFlow(userMsg, options || {}); },
    runTask: function (userMsg, options) { return runAsyncFlow(userMsg, options || {}); },

    selfTest: selfTest,
  };

  /* =================================================
     33. EXPORTS
  ================================================= */

  if (typeof window !== 'undefined') {
    window.BilalAIPro = BilalAIPro;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BilalAIPro;
  }
  return BilalAIPro;

})(typeof globalThis !== 'undefined' ? globalThis : this);
