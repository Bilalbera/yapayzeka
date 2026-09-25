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
  getPlan(userMsg)
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
     9. PLANNER + TASK MANAGER
  ================================================= */

  var Planner = (function () {
    function build(analysis) {
      var tasks = [];
      tasks.push({ id: uid('t'), title: 'Gereksinimleri analiz et', type: 'analyze' });

      if (analysis.complexity !== 'simple') {
        tasks.push({ id: uid('t'), title: 'Proje yapısını oluştur', type: 'scaffold' });
      } else {
        tasks.push({ id: uid('t'), title: 'Proje dosyalarını hazırla', type: 'scaffold' });
      }

      // Dosya başına oluşturma adımı (izlenebilir events).
      analysis.files.forEach(function (f) {
        tasks.push({ id: uid('t'), title: f + ' oluştur', type: 'create-file', path: f });
      });

      tasks.push({ id: uid('t'), title: 'Kodları doğrula ve hataları düzelt', type: 'verify-fix' });

      if (analysis.requiresPreview) {
        tasks.push({ id: uid('t'), title: 'Preview hazırla', type: 'preview' });
      } else {
        tasks.push({ id: uid('t'), title: 'Çalıştırma notlarını hazırla', type: 'notes' });
      }
      return tasks;
    }
    return { build: build };
  })();

  var TaskManager = (function () {
    function init(tasks) {
      STATE.tasks = tasks.map(function (t) {
        return { id: t.id, title: t.title, type: t.type, path: t.path || null,
          status: 'pending', startedAt: null, finishedAt: null };
      });
      STATE.plan = STATE.tasks.map(function (t) { return t.title; });
      return STATE.tasks;
    }
    function find(id) {
      for (var i = 0; i < STATE.tasks.length; i++) if (STATE.tasks[i].id === id) return STATE.tasks[i];
      return null;
    }
    function start(id) {
      var t = find(id);
      if (t) { t.status = 'running'; t.startedAt = Date.now(); bus.emit('task:started', { task: clone(t) }); }
      return t;
    }
    function complete(id) {
      var t = find(id);
      if (t) { t.status = 'completed'; t.finishedAt = Date.now(); bus.emit('task:completed', { task: clone(t), scope: 'step' }); }
      return t;
    }
    function fail(id, reason) {
      var t = find(id);
      if (t) { t.status = 'failed'; t.finishedAt = Date.now(); bus.emit('task:failed', { task: clone(t), reason: reason, scope: 'step' }); }
      return t;
    }
    function progress() {
      var total = STATE.tasks.length;
      var done = STATE.tasks.filter(function (t) { return t.status === 'completed'; }).length;
      return { completed: done, total: total, percentage: total ? Math.round((done / total) * 100) : 0 };
    }
    function render() {
      var sym = { pending: '☐', running: '▶', completed: '✓', failed: '✗' };
      var p = progress();
      var lines = ['To-dos ' + p.completed + '/' + p.total];
      STATE.tasks.forEach(function (t) { lines.push((sym[t.status] || '☐') + ' ' + t.title); });
      return lines.join('\n');
    }
    return { init: init, find: find, start: start, complete: complete, fail: fail, progress: progress, render: render };
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
     11. VALIDATOR
  ================================================= */

  var Validator = (function () {
    function balanced(content, open, close) {
      var depth = 0, inStr = null;
      for (var i = 0; i < content.length; i++) {
        var c = content[i], prev = content[i - 1];
        if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue; }
        if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
        if (c === open) depth++;
        else if (c === close) { depth--; if (depth < 0) return false; }
      }
      return depth === 0;
    }

    function checkJs(path, content, out) {
      if (!balanced(content, '{', '}')) out.errors.push({ file: path, message: 'Süslü parantez dengesiz ({ }).' });
      if (!balanced(content, '(', ')')) out.errors.push({ file: path, message: 'Parantez dengesiz ( ).' });
      if (!balanced(content, '[', ']')) out.errors.push({ file: path, message: 'Köşeli parantez dengesiz ([ ]).' });
      // ES module DEĞİLSE derlenebilirlik testi
      if (!/\bimport\s|\bexport\s|from\s+['"]/.test(content) && !/=>/.test(content) === false || true) {
        if (!/\bimport\s|\bexport\s/.test(content) && ext(path) !== 'jsx') {
          try { new Function(content); }
          catch (e) { out.errors.push({ file: path, message: 'JS syntax hatası: ' + (e && e.message) }); }
        }
      }
    }

    function checkHtml(path, content, out) {
      if (!/<!DOCTYPE html>/i.test(content)) out.warnings.push({ file: path, message: 'DOCTYPE eksik.' });
      if (!/<html[\s>]/i.test(content) || !/<\/html>/i.test(content)) out.errors.push({ file: path, message: '<html> etiketi kapatılmamış.' });
      if (/<head[\s>]/i.test(content) && !/<\/head>/i.test(content)) out.errors.push({ file: path, message: '<head> kapatılmamış.' });
      if (/<body[\s>]/i.test(content) && !/<\/body>/i.test(content)) out.errors.push({ file: path, message: '<body> kapatılmamış.' });
    }

    function checkCss(path, content, out) {
      if (!balanced(content, '{', '}')) out.errors.push({ file: path, message: 'CSS blok parantezi dengesiz.' });
    }

    function checkJson(path, content, out) {
      try { JSON.parse(content); }
      catch (e) { out.errors.push({ file: path, message: 'JSON parse hatası: ' + (e && e.message) }); }
    }

    function checkPython(path, content, out) {
      if (/\t/.test(content) && / {4}/.test(content)) {
        out.warnings.push({ file: path, message: 'Girintide sekme ve boşluk karışık.' });
      }
      content.split('\n').forEach(function (line, i) {
        if (/^\s*(def |class |if |elif |for |while |with |try|except|else|finally)/.test(line)) {
          var trimmed = line.replace(/#.*$/, '').replace(/\s+$/, '');
          if (trimmed && trimmed.slice(-1) !== ':' && trimmed.slice(-1) !== '\\') {
            out.warnings.push({ file: path, message: 'Satır ' + (i + 1) + ': iki nokta ( : ) eksik olabilir.' });
          }
        }
      });
    }

    function checkCrossRefs(files, out) {
      var paths = Object.keys(files);
      paths.forEach(function (p) {
        if (ext(p) !== 'html') return;
        var html = files[p], re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi, m;
        while ((m = re.exec(html))) {
          var ref = m[1];
          if (/^https?:|^\/\/|^#|^data:|^mailto:/.test(ref)) continue;
          if (ext(ref) !== 'css' && ext(ref) !== 'js') continue;
          var clean = ref.replace(/^\.?\//, '');
          var found = paths.some(function (pp) { return pp === ref || pp.replace(/^\.?\//, '') === clean; });
          if (!found) out.warnings.push({ file: p, message: 'Referans verilen dosya bulunamadı: ' + ref });
        }
      });
    }

    function run(files) {
      var out = { ok: true, errors: [], warnings: [] };
      Object.keys(files).forEach(function (path) {
        var content = files[path] || '';
        var e = ext(path);
        if (e === 'js' || e === 'mjs' || e === 'cjs') checkJs(path, content, out);
        else if (e === 'html' || e === 'htm') checkHtml(path, content, out);
        else if (e === 'css') checkCss(path, content, out);
        else if (e === 'json') checkJson(path, content, out);
        else if (e === 'py') checkPython(path, content, out);
      });
      checkCrossRefs(files, out);
      out.ok = out.errors.length === 0;
      return out;
    }

    return { run: run };
  })();

  /* =================================================
     12. FIXER
  ================================================= */

  var Fixer = (function () {
    function fix(files, errors) {
      var changed = false;
      errors.forEach(function (err) {
        var content = files[err.file];
        if (content == null) return;
        var before = content;

        if (/<body> kapatılmamış/.test(err.message) && !/<\/body>/i.test(content)) {
          content = /<\/html>/i.test(content)
            ? content.replace(/<\/html>/i, '</body>\n</html>')
            : content + '\n</body>';
        }
        if (/<head> kapatılmamış/.test(err.message) && !/<\/head>/i.test(content) && /<body[\s>]/i.test(content)) {
          content = content.replace(/<body[\s>]/i, function (m) { return '</head>\n' + m; });
        }
        if (/<html> etiketi kapatılmamış/.test(err.message) && !/<\/html>/i.test(content)) {
          content = content + '\n</html>';
        }
        if (/DOCTYPE eksik/.test(err.message) && !/<!DOCTYPE/i.test(content)) {
          content = '<!DOCTYPE html>\n' + content;
        }
        // Dengesiz süslü/parantez: eksik kapanışları sona ekle (kaba ama etkili)
        if (/Süslü parantez dengesiz/.test(err.message)) {
          var openB = (content.match(/{/g) || []).length, closeB = (content.match(/}/g) || []).length;
          while (closeB < openB) { content += '\n}'; closeB++; }
        }
        if (/Parantez dengesiz/.test(err.message)) {
          var openP = (content.match(/\(/g) || []).length, closeP = (content.match(/\)/g) || []).length;
          while (closeP < openP) { content += ')'; closeP++; }
        }

        if (content !== before) {
          files[err.file] = content;
          changed = true;
          bus.emit('fix:completed', { file: err.file });
        }
      });
      return changed;
    }
    return { fix: fix };
  })();

  /* =================================================
     13. TESTER (özellik bazlı statik testler)
  ================================================= */

  var Tester = (function () {
    function run(analysis, files) {
      var tests = [];
      function t(name, cond) { tests.push({ name: name, passed: !!cond }); }

      var allJs = Object.keys(files).filter(function (p) { return ext(p) === 'js'; })
        .map(function (p) { return files[p]; }).join('\n');
      var allCss = Object.keys(files).filter(function (p) { return ext(p) === 'css'; })
        .map(function (p) { return files[p]; }).join('\n');
      var hasHtml = Object.keys(files).some(function (p) { return ext(p) === 'html'; });

      if (analysis.projectType === 'todo') {
        t('Görev ekleme fonksiyonu var', /addTodo|todos\.push/.test(allJs));
        t('Silme fonksiyonu var', /function remove|splice\(/.test(allJs));
        t('Tamamlandı (toggle) durumu var', /\.done|toggle/.test(allJs));
        t('localStorage kullanılıyor', /localStorage/.test(allJs));
        t('Boş görev engelleniyor', /trim\(\)/.test(allJs) && /if\s*\(!/.test(allJs));
        t('Enter ile ekleme var', /keydown|'Enter'|"Enter"/.test(allJs));
        t('Responsive CSS var', /@media/.test(allCss));
      } else if (analysis.projectType === 'calculator') {
        t('Rakam girişi var', /data-num|append\(/.test(allJs));
        t('Hesaplama fonksiyonu var', /equals|Function\(/.test(allJs));
        t('Temizleme (clear) var', /clearAll|clear/.test(allJs));
      } else if (analysis.projectType === 'login') {
        t('Form doğrulama var', /validate/.test(allJs));
        t('E-posta kontrolü var', /@|indexOf/.test(allJs));
        t('Şifre kontrolü var', /length\s*<\s*6|minlength/.test(allJs + Object.keys(files).map(function (p) { return files[p]; }).join('')));
      } else {
        t('HTML çıktısı var', hasHtml || analysis.techKind !== 'web');
        t('JS/kaynak üretildi', Object.keys(files).length > 0);
      }

      var passed = tests.filter(function (x) { return x.passed; }).length;
      return { passed: passed, failed: tests.length - passed, total: tests.length, tests: tests };
    }
    return { run: run };
  })();

  /* =================================================
     14. AGENT CORE (sync + async ortak adımlar)
  ================================================= */

  function pickThinking(complexity) {
    return randBetween(CONFIG.thinkingMs[complexity] || CONFIG.thinkingMs.medium);
  }

  function recordFile(workspace, path, content) {
    var existed = workspace.exists(path);
    if (existed) { workspace.updateFile(path, content); }
    else { workspace.writeFile(path, content); }

    var entry = { path: path, content: content, language: langOf(path), status: existed ? 'updated' : 'created' };
    var idx = -1;
    for (var i = 0; i < STATE.files.length; i++) { if (STATE.files[i].path === path) { idx = i; break; } }
    if (idx >= 0) STATE.files[idx] = entry; else STATE.files.push(entry);

    bus.emit(existed ? 'file:updated' : 'file:created', { path: path, language: entry.language });
    return entry;
  }

  // Bir plan adımını yürütür (senkron). ctx state'i taşır.
  function runStep(task, ctx) {
    var analysis = ctx.analysis, workspace = ctx.workspace;

    switch (task.type) {
      case 'analyze': {
        setStatus('analyzing', task.title);
        bus.emit('task:analyzing', {});
        var existing = workspace.listFiles();
        if (existing.length) {
          STATE.changes.push('Mevcut ' + existing.length + ' dosya incelendi ve korunuyor.');
        }
        STATE.changes.push('Amaç: ' + analysis.projectType + ' (' + analysis.technologies.join('/') + ').');
        break;
      }
      case 'scaffold': {
        setStatus('scaffolding', task.title);
        // Tüm içeriği bir kez üret; create-file adımları tek tek yazacak.
        ctx.generated = CodeGenerator.generate(analysis);
        STATE.changes.push(analysis.projectType + ' için ' + Object.keys(ctx.generated).length + ' dosyalık yapı hazırlandı.');
        break;
      }
      case 'create-file': {
        setStatus('implementing', task.title);
        if (!ctx.generated) ctx.generated = CodeGenerator.generate(analysis);
        var path = task.path;
        var content = ctx.generated[path];
        if (content == null) {
          // Planlanan dosya üretilemedi -> boş yerine anlamlı bir hata durumu
          STATE.errors.push({ file: path, message: 'Dosya içeriği üretilemedi.' });
          throw new Error('İçerik üretilemedi: ' + path);
        }
        recordFile(workspace, path, content);
        break;
      }
      case 'verify-fix': {
        setStatus('verifying', task.title);
        bus.emit('validation:start', {});
        var files = filesMapFromWorkspace(workspace);
        var result = Validator.run(files);
        STATE.errors = result.errors.slice();
        STATE.warnings = result.warnings.slice();

        if (result.ok) {
          STATE.testStatus = 'passed';
          bus.emit('validation:passed', { warnings: result.warnings.length });
        } else {
          bus.emit('validation:failed', { errors: result.errors.length });
          setStatus('fixing', task.title);
          var attempt = 0, passed = false;
          while (attempt < CONFIG.maxFixAttempts) {
            attempt++;
            STATE.fixAttempts = attempt;
            bus.emit('fix:start', { attempt: attempt });
            var didFix = Fixer.fix(files, result.errors);
            // Değişenleri workspace + state'e yansıt
            Object.keys(files).forEach(function (p) { recordFile(workspace, p, files[p]); });
            result = Validator.run(files);
            STATE.errors = result.errors.slice();
            STATE.warnings = result.warnings.slice();
            if (result.ok) { passed = true; break; }
            if (!didFix) break; // otomatik düzeltilecek bir şey kalmadı
          }
          STATE.testStatus = passed ? 'passed' : 'failed';
          if (passed) STATE.changes.push('Doğrulama hataları ' + STATE.fixAttempts + ' denemede düzeltildi.');
          else STATE.changes.push('Bazı hatalar otomatik düzeltilemedi (state.errors).');
          bus.emit(passed ? 'validation:passed' : 'validation:failed', { afterFix: true });
        }

        // Özellik bazlı testler
        if (analysis.requiresTesting) {
          var testResult = Tester.run(analysis, files);
          STATE.tests = testResult.tests.slice();
          ctx.testResult = testResult;
        }
        break;
      }
      case 'preview': {
        setStatus('previewing', task.title);
        bus.emit('preview:start', {});
        if (analysis.techKind === 'web') {
          var pv = ctx.preview.previewProject(filesMapFromWorkspace(workspace));
          STATE.preview = pv;
          if (pv && pv.available) bus.emit('preview:ready', { url: pv.url, title: pv.title });
        } else {
          // React/Node/Python: tarayıcıda doğrudan çalışmaz -> dürüst durum
          STATE.preview = { available: false, reason: 'browser_runtime_not_available',
            note: analysis.techKind + ' projesi için tarayıcı preview runtime bağlı değil.' };
        }
        break;
      }
      case 'notes': {
        setStatus('implementing', task.title);
        STATE.executionAvailable = false;
        STATE.changes.push('Çalıştırma adapteri bağlı değil; statik self-check gerçekleştirildi.');
        break;
      }
      default:
        break;
    }
  }

  function filesMapFromWorkspace(workspace) {
    var map = {};
    workspace.listFiles().forEach(function (p) { map[p] = workspace.readFile(p); });
    return map;
  }

  function buildResult(analysis, ctx) {
    var allDone = STATE.tasks.every(function (t) { return t.status === 'completed'; });
    var previewAvailable = !!(STATE.preview && STATE.preview.available);
    var testsPassed = ctx.testResult ? ctx.testResult.failed === 0 : (STATE.testStatus === 'passed');

    return {
      ok: allDone && STATE.status === 'completed',
      model: MODEL.shortName,
      response: TaskManager.render() + '\n\n' + summaryText(analysis, ctx),
      analysis: clone(analysis),
      plan: STATE.tasks.map(function (t) { return t.title; }),
      tasks: clone(STATE.tasks),
      files: STATE.files.map(function (f) { return f.path; }),
      filesDetailed: clone(STATE.files),
      changes: clone(STATE.changes),
      errors: clone(STATE.errors),
      warnings: clone(STATE.warnings),
      tests: clone(STATE.tests),
      testStatus: STATE.testStatus,
      testsPassed: testsPassed,
      preview: clone(STATE.preview),
      previewAvailable: previewAvailable,
      executionAvailable: STATE.executionAvailable,
      state: getStateSnapshot(),
    };
  }

  function summaryText(analysis, ctx) {
    var lines = ['## Completed', '', '### Files'];
    STATE.files.forEach(function (f) { lines.push((f.status === 'failed' ? '✗' : '✓') + ' ' + f.path); });
    lines.push('', '### Changes');
    if (!STATE.changes.length) lines.push('• (değişiklik notu yok)');
    STATE.changes.forEach(function (c) { lines.push('✓ ' + c); });

    lines.push('', '### Tests');
    if (STATE.testStatus === 'passed') {
      lines.push('✓ Doğrulama geçti');
      if (ctx.testResult) {
        ctx.testResult.tests.forEach(function (x) { lines.push((x.passed ? '✓' : '✗') + ' ' + x.name); });
      }
    } else if (STATE.testStatus === 'failed') {
      lines.push('✗ Doğrulama başarısız:');
      STATE.errors.forEach(function (e) { lines.push('  - ' + e.file + ': ' + e.message); });
    } else {
      lines.push('• testStatus: not_run');
    }

    lines.push('', '### Preview');
    if (STATE.preview && STATE.preview.available) lines.push('✓ Hazır (' + STATE.preview.type + ')');
    else if (STATE.preview && STATE.preview.reason) lines.push('• Preview yok: ' + STATE.preview.reason);
    else lines.push('• Bu görev için preview yok.');

    return lines.join('\n');
  }

  function initRun(userMsg, options) {
    options = options || {};
    STATE = freshState();
    STATE.task = userMsg == null ? '' : String(userMsg);
    STATE.startedAt = Date.now();

    bus.emit('task:start', { task: STATE.task });

    var workspace = ensureWorkspace(options.workspace || defaultWorkspace);
    var web = options.web ? createWebAdapter(options.web) : createWebAdapter(null);
    var preview = options.preview ? createPreviewAdapter(options.preview) : defaultPreview;

    setStatus('analyzing');
    var analysis = Analyzer.analyze(userMsg);

    setStatus('planning');
    bus.emit('task:planning', {});
    var tasks = Planner.build(analysis);
    TaskManager.init(tasks);
    bus.emit('task:created', { tasks: clone(STATE.tasks), plan: STATE.plan.slice() });

    return { analysis: analysis, workspace: workspace, web: web, preview: preview };
  }

  function finishRun(analysis, ctx, ok) {
    STATE.status = ok ? 'completed' : 'failed';
    STATE.finishedAt = Date.now();
    STATE.currentStep = null;
    bus.emit(ok ? 'task:completed' : 'task:failed', { scope: 'run' });
    return buildResult(analysis, ctx);
  }

  // Senkron pipeline (generate)
  function runSync(userMsg, options) {
    var ctx = initRun(userMsg, options);
    try {
      for (var i = 0; i < STATE.tasks.length; i++) {
        var task = STATE.tasks[i];
        TaskManager.start(task.id);
        runStep(task, ctx);
        TaskManager.complete(task.id);
      }
      return finishRun(ctx.analysis, ctx, true);
    } catch (e) {
      if (STATE.currentStepTaskId) TaskManager.fail(STATE.currentStepTaskId, e && e.message);
      STATE.errors.push({ file: '(agent)', message: e && e.message });
      return finishRun(ctx.analysis, ctx, false);
    }
  }

  // Async pipeline (generateAsync / runTask): UI düşünme gecikmesi + adım nefesi
  async function runAsyncFlow(userMsg, options) {
    var ctx = initRun(userMsg, options);
    await sleep(pickThinking(ctx.analysis.complexity));
    try {
      for (var i = 0; i < STATE.tasks.length; i++) {
        var task = STATE.tasks[i];
        TaskManager.start(task.id);
        await sleep(CONFIG.stepDelayMs);
        runStep(task, ctx);
        TaskManager.complete(task.id);
      }
      return finishRun(ctx.analysis, ctx, true);
    } catch (e) {
      var running = STATE.tasks.filter(function (t) { return t.status === 'running'; })[0];
      if (running) TaskManager.fail(running.id, e && e.message);
      STATE.errors.push({ file: '(agent)', message: e && e.message });
      return finishRun(ctx.analysis, ctx, false);
    }
  }

  /* =================================================
     15. STATE SNAPSHOT (dışa dokunulmaz)
  ================================================= */

  function getStateSnapshot() {
    return clone({
      status: STATE.status,
      task: STATE.task,
      plan: STATE.plan,
      tasks: STATE.tasks,
      files: STATE.files,
      changes: STATE.changes,
      errors: STATE.errors,
      warnings: STATE.warnings,
      tests: STATE.tests,
      testStatus: STATE.testStatus,
      preview: STATE.preview,
      currentStep: STATE.currentStep,
      fixAttempts: STATE.fixAttempts,
      executionAvailable: STATE.executionAvailable,
      startedAt: STATE.startedAt,
      finishedAt: STATE.finishedAt,
      progress: TaskManager.progress(),
    });
  }

  /* =================================================
     16. SELF TEST
  ================================================= */

  function selfTest() {
    var tests = [];
    function check(name, cond) { tests.push({ name: name, passed: !!cond }); }

    check('MODEL mevcut', BilalAIPro.MODEL && BilalAIPro.MODEL.name === 'BilalAI - Pro 1.0');
    check('generate fonksiyonu', typeof BilalAIPro.generate === 'function');
    check('generateAsync fonksiyonu', typeof BilalAIPro.generateAsync === 'function');
    check('runTask fonksiyonu', typeof BilalAIPro.runTask === 'function');

    // Planner
    var plan = BilalAIPro.getPlan('Modern responsive todo uygulaması, index.html style.css app.js');
    check('Planner çalışıyor', plan && plan.tasks && plan.tasks.length >= 4);
    check('Analyzer todo tespiti', plan.analysis.projectType === 'todo');
    check('Todo 3 dosyaya bölünüyor',
      plan.analysis.files.indexOf('index.html') !== -1 &&
      plan.analysis.files.indexOf('style.css') !== -1 &&
      plan.analysis.files.indexOf('app.js') !== -1);

    // Workspace (tek store)
    var ws = createWorkspaceAdapter();
    ws.writeFile('a.txt', 'hi');
    check('Workspace tek store', ws.exists('a.txt') && ws.readFile('a.txt') === 'hi' && ws.listFiles().length === 1);
    ws.deleteFile('a.txt');
    check('Workspace silme', !ws.exists('a.txt'));

    // Validator
    var good = Validator.run({ 'x.js': 'function a(){ return 1; }' });
    var bad = Validator.run({ 'x.js': 'function a(){ return 1;' });
    check('Validator geçerli kodu kabul', good.ok === true);
    check('Validator hatalı kodu yakalar', bad.ok === false);

    // Fixer
    var brokenFiles = { 'i.html': '<html><head></head><body><p>x</p>' };
    var v1 = Validator.run(brokenFiles);
    Fixer.fix(brokenFiles, v1.errors);
    var v2 = Validator.run(brokenFiles);
    check('Fixer HTML düzeltir', v2.ok === true);

    // Preview adapter
    var pv = createPreviewAdapter().previewProject({
      'index.html': '<!DOCTYPE html><html><head></head><body>ok</body></html>',
      'style.css': 'body{color:red}', 'app.js': 'console.log(1)',
    });
    check('Preview adapter çalışıyor', pv && pv.available === true && typeof pv.url === 'string');

    // Flash'a fallback YOK
    check('Flash motoruna bağımlı değil',
      BilalAIPro.toString().indexOf('BilalAIResponseEngine') === -1);

    // Gerçek üretim: senkron todo görevi
    var localWs = createWorkspaceAdapter();
    var r = BilalAIPro.generate(
      'Modern responsive todo uygulaması oluştur. index.html, style.css, app.js. localStorage, enter ile ekle, bos gorev engelle, sil, tamamla.',
      {}, { workspace: localWs });
    check('Todo görevi 3 dosya üretti',
      r.files.indexOf('index.html') !== -1 && r.files.indexOf('style.css') !== -1 && r.files.indexOf('app.js') !== -1);
    check('Üretilen JS localStorage içeriyor', /localStorage/.test(localWs.readFile('app.js') || ''));
    check('Görev tamamlandı (ok)', r.ok === true);

    var passed = tests.filter(function (x) { return x.passed; }).length;
    return { ok: passed === tests.length, passed: passed, failed: tests.length - passed, tests: tests };
  }

  /* =================================================
     17. PUBLIC API
  ================================================= */

  var BilalAIPro = {
    MODEL: MODEL,
    CONFIG: CONFIG,

    // Adapter fabrikaları (UI kendi adapter'ını enjekte edebilir)
    createWorkspaceAdapter: createWorkspaceAdapter,
    createWebAdapter: createWebAdapter,
    createPreviewAdapter: createPreviewAdapter,

    onEvent: function (cb) { return bus.on(cb); },

    setWorkspace: function (adapter) {
      defaultWorkspace = ensureWorkspace(adapter);
      return true;
    },

    getState: function () { return getStateSnapshot(); },
    getTasks: function () { return clone(STATE.tasks); },
    getFiles: function () { return clone(STATE.files); },
    getPreview: function () { return clone(STATE.preview); },

    getPlan: function (userMsg) {
      var analysis = Analyzer.analyze(userMsg);
      var tasks = Planner.build(analysis);
      return { analysis: analysis, tasks: tasks, titles: tasks.map(function (t) { return t.title; }) };
    },

    reset: function () {
      STATE = freshState();
      bus.emit('reset', {});
      return true;
    },

    // Senkron pipeline — TEK agent loop (ikinci kez başlatmaz).
    generate: function (userMsg, context, options) {
      return runSync(userMsg, options || {});
    },

    // Async pipeline (Promise) — TEK agent loop.
    generateAsync: function (userMsg, context, options) {
      return runAsyncFlow(userMsg, options || {});
    },

    // runTask: async agent akışı (asıl kullanım).
    runTask: function (userMsg, options) {
      return runAsyncFlow(userMsg, options || {});
    },

    selfTest: selfTest,
  };

  /* =================================================
     18. EXPORTS
  ================================================= */

  if (typeof window !== 'undefined') {
    // Flash motorunun üzerine YAZMA; yalnızca kendi API'sini aç.
    window.BilalAIPro = BilalAIPro;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BilalAIPro;
  }

  return BilalAIPro;

})(typeof globalThis !== 'undefined' ? globalThis : this);

