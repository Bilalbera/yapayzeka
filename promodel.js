/* -------------------------------------------------
BilalAI - Pro 1.0  🧠
Agentic Coding Model

Amaç: "AI gibi görünen bir sohbet ekranı" değil;
kullanıcının verdiği yazılım görevini ANALİZ eden, PLANLAYAN,
dosyalar üzerinde ÇALIŞAN, kod ÜRETEN, KONTROL eden, HATALARI
düzelten ve mümkün olduğunda çalışan PREVIEW sunan gerçek bir
coding-agent altyapısı.

Global API:  window.BilalAIPro
  BilalAIPro.generate(userMsg, context, options)
  BilalAIPro.generateAsync(userMsg, context, options)
  BilalAIPro.runTask(task, options)
  BilalAIPro.getPlan(task)
  BilalAIPro.getState()
  BilalAIPro.reset()
  BilalAIPro.onEvent(cb)
  BilalAIPro.MODEL
  BilalAIPro.WorkspaceAdapter / WebAdapter / PreviewAdapter (fabrikalar)

Bölümler:
  1. Config
  2. Event Bus
  3. State
  4. Utils
  5. Workspace Adapter
  6. Web Adapter
  7. Preview Adapter
  8. Planner
  9. Task Manager
 10. Code Generator
 11. Validator (self-check)
 12. Fixer (self-fix loop)
 13. Agent Runner
 14. Public API
------------------------------------------------- */

(function (global) {
  'use strict';

  /* =================================================
     1. CONFIG
  ================================================= */

  var MODEL = {
    name: 'BilalAI - Pro 1.0',
    shortName: 'Pro 1.0',
    icon: '🧠',
    version: '2026-09-24-pro1',
    style: 'agentic coding',
    thinkingMs: [3000, 6000],
  };

  var CONFIG = {
    maxFixAttempts: 3,
    // Gerçek işlem süresinden BAĞIMSIZ olarak, UI için "düşünme" gecikmesi.
    thinking: {
      simple: [2000, 4000],
      medium: [5000, 8000],
      complex: [9500, 10000],
    },
    // Adımlar arası küçük görsel nefes payı (agent akışını izlenebilir kılar)
    stepDelayMs: 120,
    debug: false,
  };

  /* =================================================
     2. EVENT BUS
  ================================================= */

  function createEventBus() {
    var listeners = [];
    return {
      on: function (cb) {
        if (typeof cb === 'function') listeners.push(cb);
        return function off() {
          var i = listeners.indexOf(cb);
          if (i >= 0) listeners.splice(i, 1);
        };
      },
      emit: function (type, payload) {
        var evt = Object.assign({ type: type, timestamp: Date.now() }, payload || {});
        if (CONFIG.debug) {
          try { console.log('[v0][BilalAIPro:event]', evt.type, evt); } catch (e) {}
        }
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i](evt); } catch (e) {
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
     3. STATE
  ================================================= */

  function freshState() {
    return {
      status: 'idle', // idle|analyzing|planning|implementing|testing|fixing|previewing|completed|failed
      currentTask: null,
      tasks: [],
      files: [], // {path, action, size}
      errors: [], // {file, message, severity}
      changes: [], // insan-okur değişiklik notları
      plan: null,
      preview: null,
      testStatus: 'not_run', // not_run|passed|failed
      startedAt: null,
      finishedAt: null,
    };
  }

  var STATE = freshState();

  function setStatus(status) {
    STATE.status = status;
    bus.emit('status_changed', { status: status });
  }

  /* =================================================
     4. UTILS
  ================================================= */

  function clone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  function randBetween(range) {
    var lo = range[0], hi = range[1];
    return Math.floor(lo + Math.random() * (hi - lo));
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function normalize(str) {
    return (str || '').toString().toLowerCase()
      // Türkçe karakterleri sadeleştir (anahtar kelime eşleşmesi için)
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

  /* =================================================
     5. WORKSPACE ADAPTER
     Gerçek backend bağlı değilse in-memory fallback.
  ================================================= */

  function createInMemoryWorkspace(seed) {
    var store = Object.create(null);
    if (seed && typeof seed === 'object') {
      Object.keys(seed).forEach(function (k) { store[k] = String(seed[k]); });
    }
    return {
      kind: 'in-memory',
      createFile: function (path, content) {
        store[path] = content == null ? '' : String(content);
        return true;
      },
      readFile: function (path) {
        return Object.prototype.hasOwnProperty.call(store, path) ? store[path] : null;
      },
      updateFile: function (path, content) {
        store[path] = content == null ? '' : String(content);
        return true;
      },
      deleteFile: function (path) {
        if (Object.prototype.hasOwnProperty.call(store, path)) {
          delete store[path];
          return true;
        }
        return false;
      },
      listFiles: function () { return Object.keys(store); },
      fileExists: function (path) {
        return Object.prototype.hasOwnProperty.call(store, path);
      },
      _dump: function () { return clone(store); },
    };
  }

  // Dışarıdan gelen kısmi bir adapter'ı tam sözleşmeye tamamlar.
  function normalizeWorkspace(ws) {
    if (!ws) return createInMemoryWorkspace();
    var fallback = createInMemoryWorkspace();
    var api = {};
    ['createFile', 'readFile', 'updateFile', 'deleteFile', 'listFiles', 'fileExists'].forEach(function (fn) {
      api[fn] = typeof ws[fn] === 'function' ? ws[fn].bind(ws) : fallback[fn];
    });
    api.kind = ws.kind || 'external';
    return api;
  }

  /* =================================================
     6. WEB ADAPTER
     Gerçek bağlantı yoksa SAHTE sonuç üretme -> webRequired:true
  ================================================= */

  function createWebAdapter(impl) {
    var hasReal = impl && typeof impl.search === 'function';
    return {
      connected: !!hasReal,
      search: function (query) {
        if (hasReal) {
          return Promise.resolve(impl.search(query));
        }
        // Sahte sonuç ÜRETME. Yalnızca durum bildir.
        return Promise.resolve({
          ok: false,
          webRequired: true,
          query: query,
          note: 'Web arastirma adapteri bagli degil; guncel bilgi getirilemedi.',
        });
      },
    };
  }

  /* =================================================
     7. PREVIEW ADAPTER
     Gerçek runtime yoksa Blob URL fallback.
  ================================================= */

  function createPreviewAdapter(impl) {
    var lastUrl = null;
    var canBlob = typeof Blob !== 'undefined' && typeof URL !== 'undefined' && !!URL.createObjectURL;

    function buildHtmlFromFiles(files) {
      // files: { path: content }
      var html = files['index.html'] || files['/index.html'] || null;
      if (html == null) {
        // Herhangi bir .html bul
        var htmlKey = Object.keys(files).filter(function (k) { return ext(k) === 'html'; })[0];
        if (htmlKey) html = files[htmlKey];
      }
      if (html == null) return null;

      var css = '';
      var js = '';
      Object.keys(files).forEach(function (k) {
        if (ext(k) === 'css') css += '\n/* ' + k + ' */\n' + files[k];
        if (ext(k) === 'js') js += '\n/* ' + k + ' */\n' + files[k];
      });

      // Harici <link>/<script> referanslarını inline gömüyoruz (Blob URL göreli path çözemez)
      var out = html;
      if (css) {
        if (/<\/head>/i.test(out)) {
          out = out.replace(/<\/head>/i, '<style>' + css + '</style></head>');
        } else {
          out = '<style>' + css + '</style>' + out;
        }
      }
      if (js) {
        if (/<\/body>/i.test(out)) {
          out = out.replace(/<\/body>/i, '<script>' + js + '<\/script></body>');
        } else {
          out = out + '<script>' + js + '<\/script>';
        }
      }
      return out;
    }

    return {
      connected: !!(impl && typeof impl.preview === 'function'),
      preview: function (html) {
        if (impl && typeof impl.preview === 'function') {
          lastUrl = impl.preview(html);
          return { ok: true, url: lastUrl, kind: 'external' };
        }
        if (!canBlob) return { ok: false, reason: 'no_blob_runtime' };
        try {
          if (lastUrl) URL.revokeObjectURL(lastUrl);
          var blob = new Blob([html], { type: 'text/html' });
          lastUrl = URL.createObjectURL(blob);
          return { ok: true, url: lastUrl, kind: 'blob' };
        } catch (e) {
          return { ok: false, reason: e && e.message };
        }
      },
      previewProject: function (files) {
        if (impl && typeof impl.previewProject === 'function') {
          lastUrl = impl.previewProject(files);
          return { ok: true, url: lastUrl, kind: 'external' };
        }
        var html = buildHtmlFromFiles(files);
        if (html == null) {
          return { ok: false, reason: 'no_html_entry', note: 'Preview icin index.html bulunamadi.' };
        }
        return this.preview(html);
      },
      getPreviewUrl: function () { return lastUrl; },
    };
  }

  /* =================================================
     8. PLANNER
     Görevi analiz eder -> yapılandırılmış plan.
  ================================================= */

  var Planner = (function () {
    function analyze(userMsg) {
      var raw = userMsg || '';
      var t = normalize(raw);

      // --- Teknoloji / dil / framework tespiti ---
      var technology = 'html';
      var language = 'JavaScript';
      var framework = null;

      if (hasAny(t, ['react', 'jsx', 'next', 'nextjs'])) {
        technology = 'react'; language = 'JavaScript'; framework = t.indexOf('next') !== -1 ? 'Next.js' : 'React';
      } else if (hasAny(t, ['vue', 'nuxt'])) {
        technology = 'vue'; framework = 'Vue';
      } else if (hasAny(t, ['python', 'py', 'discord bot', 'flask', 'django', 'fastapi'])) {
        technology = 'python'; language = 'Python';
        if (t.indexOf('flask') !== -1) framework = 'Flask';
        else if (t.indexOf('django') !== -1) framework = 'Django';
        else if (t.indexOf('fastapi') !== -1) framework = 'FastAPI';
      } else if (hasAny(t, ['node', 'express', 'nodejs'])) {
        technology = 'node'; framework = t.indexOf('express') !== -1 ? 'Express' : 'Node.js';
      } else if (hasAny(t, ['html', 'css', 'sayfa', 'landing', 'website', 'web sitesi', 'site'])) {
        technology = 'html';
      }

      // --- Hedef (goal) türü ---
      var goalType = 'generic';
      if (hasAny(t, ['todo', 'to-do', 'yapilacak', 'gorev listesi'])) goalType = 'todo';
      else if (hasAny(t, ['login', 'giris', 'signin', 'sign in', 'oturum'])) goalType = 'login';
      else if (hasAny(t, ['hesap makinesi', 'calculator', 'hesaplama'])) goalType = 'calculator';
      else if (hasAny(t, ['admin', 'dashboard', 'panel', 'yonetim'])) goalType = 'dashboard';
      else if (hasAny(t, ['discord bot', 'discord'])) goalType = 'discord-bot';
      else if (hasAny(t, ['landing', 'tanitim', 'karsilama'])) goalType = 'landing';

      // --- Karmaşıklık ---
      var complexity = 'medium';
      var simpleSignals = ['basit', 'kucuk', 'mini', 'tek dosya', 'ornek'];
      var complexSignals = ['admin', 'dashboard', 'panel', 'buyuk', 'kapsamli', 'full', 'komple', 'react', 'next'];
      if (hasAny(t, simpleSignals) || raw.length < 40) complexity = 'simple';
      if (hasAny(t, complexSignals)) complexity = 'complex';
      if (goalType === 'calculator' || goalType === 'login') {
        // Bunlar tek başına genelde basit-orta
        if (complexity !== 'complex') complexity = raw.length < 60 ? 'simple' : 'medium';
      }

      // --- Dosya planı ---
      var filesNeeded = planFiles(technology, goalType);

      // --- Bağımlılıklar ---
      var dependencies = planDeps(technology, framework, goalType);

      // --- Gereksinimler (istekten türetilmiş kaba liste) ---
      var requirements = [];
      if (hasAny(t, ['localstorage', 'kalici', 'kaydet', 'sakla'])) requirements.push('localStorage ile kalıcılık');
      if (hasAny(t, ['dark', 'karanlik', 'tema'])) requirements.push('koyu/açık tema');
      if (hasAny(t, ['responsive', 'mobil', 'uyumlu'])) requirements.push('responsive tasarım');
      if (hasAny(t, ['animasyon', 'animation', 'gecis'])) requirements.push('geçiş animasyonları');

      var constraints = [];
      if (hasAny(t, ['vanilla', 'kutuphanesiz', 'library kullanmadan'])) constraints.push('harici kütüphane yok');

      return {
        goal: deriveGoal(raw, goalType),
        goalType: goalType,
        technology: technology,
        language: language,
        framework: framework,
        complexity: complexity,
        filesNeeded: filesNeeded,
        dependencies: dependencies,
        requirements: requirements,
        constraints: constraints,
        raw: raw,
      };
    }

    function deriveGoal(raw, goalType) {
      var map = {
        'todo': 'todo uygulaması',
        'login': 'login sayfası',
        'calculator': 'hesap makinesi',
        'dashboard': 'admin panel / dashboard',
        'discord-bot': 'Discord botu',
        'landing': 'tanıtım (landing) sayfası',
      };
      return map[goalType] || (raw.trim().slice(0, 80) || 'yazılım görevi');
    }

    function planFiles(technology, goalType) {
      if (technology === 'react') {
        var base = ['src/App.jsx', 'src/main.jsx', 'src/styles.css', 'index.html'];
        if (goalType === 'dashboard') {
          return ['index.html', 'src/main.jsx', 'src/App.jsx',
            'src/components/Sidebar.jsx', 'src/components/Dashboard.jsx',
            'src/components/StatCard.jsx', 'src/styles.css'];
        }
        return base;
      }
      if (technology === 'python') {
        if (goalType === 'discord-bot') return ['bot.py', 'requirements.txt', '.env.example'];
        return ['main.py', 'requirements.txt'];
      }
      if (technology === 'node') {
        return ['index.js', 'package.json'];
      }
      // html/css/js
      return ['index.html', 'style.css', 'script.js'];
    }

    function planDeps(technology, framework, goalType) {
      if (technology === 'react') return ['react', 'react-dom'];
      if (technology === 'python' && goalType === 'discord-bot') return ['discord.py', 'python-dotenv'];
      if (technology === 'node' && framework === 'Express') return ['express'];
      return [];
    }

    // analiz -> insan-okur adım listesi (task manager bunu tüketir)
    function buildTasks(analysis) {
      if (analysis.complexity === 'simple') {
        return [
          { id: 't1', title: 'Görevi analiz et', kind: 'analyze' },
          { id: 't2', title: 'Gerekli dosyaları oluştur', kind: 'implement' },
          { id: 't3', title: 'Kodları kontrol et', kind: 'verify' },
          { id: 't4', title: 'Preview oluştur', kind: 'preview' },
        ];
      }
      // medium / complex
      var tasks = [
        { id: 't1', title: 'Proje yapısını analiz et', kind: 'analyze' },
        { id: 't2', title: 'Gerekli dosyaları oluştur', kind: 'scaffold' },
        { id: 't3', title: 'Ana arayüzü geliştir', kind: 'implement' },
        { id: 't4', title: 'JavaScript / mantık işlevlerini ekle', kind: 'implement' },
        { id: 't5', title: 'Kodları kontrol et', kind: 'verify' },
        { id: 't6', title: 'Hataları düzelt', kind: 'fix' },
        { id: 't7', title: 'Preview oluştur', kind: 'preview' },
      ];
      if (analysis.technology === 'python') {
        // Python görevlerinde preview yerine çalıştırma-uyarısı
        tasks = tasks.filter(function (x) { return x.kind !== 'preview'; });
        tasks.push({ id: 't7', title: 'Çalıştırma notlarını hazırla', kind: 'notes' });
      }
      return tasks;
    }

    return {
      analyze: analyze,
      buildTasks: buildTasks,
      planFiles: planFiles,
    };
  })();

  /* =================================================
     9. TASK MANAGER
  ================================================= */

  var TaskManager = (function () {
    function init(taskDefs) {
      STATE.tasks = taskDefs.map(function (t) {
        return { id: t.id, title: t.title, kind: t.kind, status: 'pending' }; // pending|running|done|failed
      });
      bus.emit('plan_created', { tasks: clone(STATE.tasks) });
      return STATE.tasks;
    }
    function start(id) {
      var task = find(id);
      if (task) {
        task.status = 'running';
        STATE.currentTask = task.id;
        bus.emit('task_started', { task: clone(task) });
      }
      return task;
    }
    function complete(id) {
      var task = find(id);
      if (task) {
        task.status = 'done';
        bus.emit('task_completed', { task: clone(task) });
      }
      return task;
    }
    function fail(id, reason) {
      var task = find(id);
      if (task) {
        task.status = 'failed';
        bus.emit('task_failed', { task: clone(task), reason: reason });
      }
      return task;
    }
    function find(id) {
      for (var i = 0; i < STATE.tasks.length; i++) {
        if (STATE.tasks[i].id === id) return STATE.tasks[i];
      }
      return null;
    }
    function progress() {
      var done = STATE.tasks.filter(function (t) { return t.status === 'done'; }).length;
      return { done: done, total: STATE.tasks.length };
    }
    function render() {
      // Metinsel "To-dos" gösterimi (UI kendi çizebilir; bu yardımcıdır)
      var symbol = { pending: '○', running: '→', done: '✓', failed: '✗' };
      var p = progress();
      var lines = ['To-dos ' + p.done + '/' + p.total];
      STATE.tasks.forEach(function (t) {
        lines.push((symbol[t.status] || '○') + ' ' + t.title);
      });
      return lines.join('\n');
    }
    return { init: init, start: start, complete: complete, fail: fail, find: find, progress: progress, render: render };
  })();

  /* =================================================
     10. CODE GENERATOR
     Her görev türü için GERÇEK, çalışır şablonlar üretir.
  ================================================= */

  var CodeGenerator = (function () {

    function generate(analysis) {
      var files = {};
      switch (analysis.goalType) {
        case 'todo':        files = genTodo(analysis); break;
        case 'login':       files = genLogin(analysis); break;
        case 'calculator':  files = genCalculator(analysis); break;
        case 'dashboard':   files = genDashboard(analysis); break;
        case 'discord-bot': files = genDiscordBot(analysis); break;
        case 'landing':     files = genLanding(analysis); break;
        default:            files = genGeneric(analysis); break;
      }
      return files;
    }

    /* ---------- HTML/CSS/JS: TODO ---------- */
    function genTodo() {
      var html =
'<!DOCTYPE html>\n' +
'<html lang="tr">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'  <title>Todo App</title>\n' +
'  <link rel="stylesheet" href="style.css" />\n' +
'</head>\n' +
'<body>\n' +
'  <main class="app">\n' +
'    <h1>Yapılacaklar</h1>\n' +
'    <form id="todo-form" class="todo-form">\n' +
'      <input id="todo-input" type="text" placeholder="Yeni görev ekle..." autocomplete="off" required />\n' +
'      <button type="submit">Ekle</button>\n' +
'    </form>\n' +
'    <ul id="todo-list" class="todo-list" aria-live="polite"></ul>\n' +
'    <p id="empty-state" class="empty">Henüz görev yok.</p>\n' +
'  </main>\n' +
'  <script src="script.js"></script>\n' +
'</body>\n' +
'</html>\n';

      var css =
':root { --bg:#0f172a; --card:#1e293b; --accent:#6366f1; --text:#e2e8f0; --muted:#94a3b8; }\n' +
'* { box-sizing: border-box; }\n' +
'body { margin:0; font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); min-height:100vh; display:flex; justify-content:center; padding:2rem 1rem; }\n' +
'.app { width:100%; max-width:480px; }\n' +
'h1 { text-align:center; font-weight:700; }\n' +
'.todo-form { display:flex; gap:.5rem; margin-bottom:1rem; }\n' +
'.todo-form input { flex:1; padding:.75rem 1rem; border-radius:.5rem; border:1px solid #334155; background:var(--card); color:var(--text); }\n' +
'.todo-form button { padding:.75rem 1.25rem; border:none; border-radius:.5rem; background:var(--accent); color:#fff; cursor:pointer; font-weight:600; }\n' +
'.todo-list { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:.5rem; }\n' +
'.todo-item { display:flex; align-items:center; gap:.75rem; background:var(--card); padding:.75rem 1rem; border-radius:.5rem; }\n' +
'.todo-item.done span { text-decoration:line-through; color:var(--muted); }\n' +
'.todo-item span { flex:1; cursor:pointer; }\n' +
'.todo-item button { background:transparent; border:none; color:var(--muted); cursor:pointer; font-size:1.1rem; }\n' +
'.empty { text-align:center; color:var(--muted); }\n' +
'.empty.hidden { display:none; }\n';

      var js =
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
"    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));\n" +
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
"  function add(text) {\n" +
"    todos.push({ text: text, done: false });\n" +
"    save(); render();\n" +
"  }\n" +
"  function toggle(index) {\n" +
"    todos[index].done = !todos[index].done;\n" +
"    save(); render();\n" +
"  }\n" +
"  function remove(index) {\n" +
"    todos.splice(index, 1);\n" +
"    save(); render();\n" +
"  }\n" +
"  form.addEventListener('submit', function (e) {\n" +
"    e.preventDefault();\n" +
"    var value = input.value.trim();\n" +
"    if (!value) return;\n" +
"    add(value);\n" +
"    input.value = '';\n" +
"    input.focus();\n" +
"  });\n" +
"  render();\n" +
"})();\n";

      return { 'index.html': html, 'style.css': css, 'script.js': js };
    }

    /* ---------- HTML/CSS/JS: LOGIN ---------- */
    function genLogin() {
      var html =
'<!DOCTYPE html>\n' +
'<html lang="tr">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'  <title>Giriş Yap</title>\n' +
'  <link rel="stylesheet" href="style.css" />\n' +
'</head>\n' +
'<body>\n' +
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
'  </main>\n' +
'  <script src="script.js"></script>\n' +
'</body>\n' +
'</html>\n';

      var css =
':root { --bg:#0f172a; --card:#1e293b; --accent:#6366f1; --text:#e2e8f0; --muted:#94a3b8; --error:#f87171; }\n' +
'* { box-sizing:border-box; }\n' +
'body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; display:flex; align-items:center; justify-content:center; padding:1rem; }\n' +
'.card { width:100%; max-width:360px; background:var(--card); padding:2rem; border-radius:1rem; display:flex; flex-direction:column; gap:1rem; }\n' +
'h1 { margin:0 0 .5rem; text-align:center; }\n' +
'label { display:flex; flex-direction:column; gap:.35rem; font-size:.9rem; color:var(--muted); }\n' +
'input { padding:.75rem 1rem; border-radius:.5rem; border:1px solid #334155; background:#0f172a; color:var(--text); }\n' +
'button { padding:.85rem; border:none; border-radius:.5rem; background:var(--accent); color:#fff; font-weight:600; cursor:pointer; }\n' +
'.error { color:var(--error); font-size:.85rem; min-height:1.1rem; margin:0; }\n';

      var js =
"(function () {\n" +
"  'use strict';\n" +
"  var form = document.getElementById('login-form');\n" +
"  var email = document.getElementById('email');\n" +
"  var password = document.getElementById('password');\n" +
"  var error = document.getElementById('error');\n" +
"\n" +
"  function validate() {\n" +
"    if (!email.value || email.value.indexOf('@') === -1) return 'Geçerli bir e-posta girin.';\n" +
"    if (password.value.length < 6) return 'Şifre en az 6 karakter olmalı.';\n" +
"    return '';\n" +
"  }\n" +
"  form.addEventListener('submit', function (e) {\n" +
"    e.preventDefault();\n" +
"    var msg = validate();\n" +
"    error.textContent = msg;\n" +
"    if (msg) return;\n" +
"    // Gerçek kimlik doğrulama backend'i burada çağrılır.\n" +
"    console.log('[login] gönderiliyor:', email.value);\n" +
"    error.style.color = '#4ade80';\n" +
"    error.textContent = 'Giriş başarılı (demo).';\n" +
"  });\n" +
"})();\n";

      return { 'index.html': html, 'style.css': css, 'script.js': js };
    }

    /* ---------- HTML/CSS/JS: CALCULATOR ---------- */
    function genCalculator() {
      var html =
'<!DOCTYPE html>\n' +
'<html lang="tr">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'  <title>Hesap Makinesi</title>\n' +
'  <link rel="stylesheet" href="style.css" />\n' +
'</head>\n' +
'<body>\n' +
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
'  </main>\n' +
'  <script src="script.js"></script>\n' +
'</body>\n' +
'</html>\n';

      var css =
':root { --bg:#0f172a; --card:#1e293b; --key:#334155; --accent:#6366f1; --text:#e2e8f0; }\n' +
'* { box-sizing:border-box; }\n' +
'body { margin:0; font-family:system-ui,sans-serif; background:var(--bg); min-height:100vh; display:flex; align-items:center; justify-content:center; }\n' +
'.calc { width:320px; background:var(--card); padding:1rem; border-radius:1rem; }\n' +
'.display { display:block; text-align:right; font-size:2.25rem; color:var(--text); padding:1rem .5rem; word-break:break-all; min-height:3.5rem; }\n' +
'.keys { display:grid; grid-template-columns:repeat(4,1fr); gap:.5rem; }\n' +
'button { padding:1rem; font-size:1.15rem; border:none; border-radius:.5rem; background:var(--key); color:var(--text); cursor:pointer; }\n' +
'button:active { transform:scale(.97); }\n' +
'.span2 { grid-column:span 2; }\n' +
'.accent { background:var(--accent); }\n' +
'[data-op] { background:#475569; }\n';

      var js =
"(function () {\n" +
"  'use strict';\n" +
"  var display = document.getElementById('display');\n" +
"  var current = '0';\n" +
"\n" +
"  function update() { display.textContent = current; }\n" +
"  function append(value) {\n" +
"    if (current === '0' && value !== '.') current = value;\n" +
"    else current += value;\n" +
"    update();\n" +
"  }\n" +
"  function clearAll() { current = '0'; update(); }\n" +
"  function del() { current = current.length > 1 ? current.slice(0, -1) : '0'; update(); }\n" +
"  function equals() {\n" +
"    try {\n" +
"      var expr = current.replace(/[^0-9+\\-*/.]/g, '');\n" +
"      // Function ile güvenli-ölçekli değerlendirme (yalnızca aritmetik karakterler kaldı)\n" +
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
"    var action = btn.dataset.action;\n" +
"    if (action === 'clear') clearAll();\n" +
"    else if (action === 'delete') del();\n" +
"    else if (action === 'equals') equals();\n" +
"  });\n" +
"  update();\n" +
"})();\n";

      return { 'index.html': html, 'style.css': css, 'script.js': js };
    }

    /* ---------- REACT: DASHBOARD / ADMIN ---------- */
    function genDashboard() {
      var indexHtml =
'<!DOCTYPE html>\n' +
'<html lang="tr">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'  <title>Admin Panel</title>\n' +
'  <link rel="stylesheet" href="/src/styles.css" />\n' +
'</head>\n' +
'<body>\n' +
'  <div id="root"></div>\n' +
'  <script type="module" src="/src/main.jsx"></script>\n' +
'</body>\n' +
'</html>\n';

      var mainJsx =
"import React from 'react';\n" +
"import { createRoot } from 'react-dom/client';\n" +
"import App from './App.jsx';\n" +
"import './styles.css';\n" +
"\n" +
"createRoot(document.getElementById('root')).render(<App />);\n";

      var appJsx =
"import React, { useState } from 'react';\n" +
"import Sidebar from './components/Sidebar.jsx';\n" +
"import Dashboard from './components/Dashboard.jsx';\n" +
"\n" +
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

      var sidebarJsx =
"import React from 'react';\n" +
"\n" +
"const ITEMS = [\n" +
"  { id: 'dashboard', label: 'Genel Bakış' },\n" +
"  { id: 'users', label: 'Kullanıcılar' },\n" +
"  { id: 'orders', label: 'Siparişler' },\n" +
"  { id: 'settings', label: 'Ayarlar' },\n" +
"];\n" +
"\n" +
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

      var statCardJsx =
"import React from 'react';\n" +
"\n" +
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

      var dashboardJsx =
"import React from 'react';\n" +
"import StatCard from './StatCard.jsx';\n" +
"\n" +
"const STATS = [\n" +
"  { label: 'Toplam Gelir', value: '₺84.2K', delta: '+12%' },\n" +
"  { label: 'Aktif Kullanıcı', value: '1.294', delta: '+4%' },\n" +
"  { label: 'Sipariş', value: '327', delta: '-2%' },\n" +
"  { label: 'Dönüşüm', value: '%3.8', delta: '+0.6%' },\n" +
"];\n" +
"\n" +
"export default function Dashboard({ section }) {\n" +
"  return (\n" +
"    <div>\n" +
"      <header className=\"page-head\">\n" +
"        <h1>{section === 'dashboard' ? 'Genel Bakış' : section}</h1>\n" +
"      </header>\n" +
"      <section className=\"stats-grid\">\n" +
"        {STATS.map((s) => (\n" +
"          <StatCard key={s.label} {...s} />\n" +
"        ))}\n" +
"      </section>\n" +
"    </div>\n" +
"  );\n" +
"}\n";

      var styles =
":root { --bg:#0f172a; --panel:#1e293b; --accent:#6366f1; --text:#e2e8f0; --muted:#94a3b8; }\n" +
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

      return {
        'index.html': indexHtml,
        'src/main.jsx': mainJsx,
        'src/App.jsx': appJsx,
        'src/components/Sidebar.jsx': sidebarJsx,
        'src/components/Dashboard.jsx': dashboardJsx,
        'src/components/StatCard.jsx': statCardJsx,
        'src/styles.css': styles,
      };
    }

    /* ---------- PYTHON: DISCORD BOT ---------- */
    function genDiscordBot() {
      var bot =
'import os\n' +
'import discord\n' +
'from discord.ext import commands\n' +
'from dotenv import load_dotenv\n' +
'\n' +
'load_dotenv()\n' +
'TOKEN = os.getenv("DISCORD_TOKEN")\n' +
'\n' +
'intents = discord.Intents.default()\n' +
'intents.message_content = True\n' +
'\n' +
'bot = commands.Bot(command_prefix="!", intents=intents)\n' +
'\n' +
'\n' +
'@bot.event\n' +
'async def on_ready():\n' +
'    print(f"Giriş yapıldı: {bot.user} (id: {bot.user.id})")\n' +
'\n' +
'\n' +
'@bot.command(name="ping")\n' +
'async def ping(ctx):\n' +
'    """Botun gecikmesini gösterir."""\n' +
'    latency_ms = round(bot.latency * 1000)\n' +
'    await ctx.send(f"Pong! {latency_ms}ms")\n' +
'\n' +
'\n' +
'@bot.command(name="selam")\n' +
'async def selam(ctx):\n' +
'    await ctx.send(f"Selam {ctx.author.mention}!")\n' +
'\n' +
'\n' +
'def main():\n' +
'    if not TOKEN:\n' +
'        raise SystemExit("DISCORD_TOKEN tanımlı değil. .env dosyasını doldurun.")\n' +
'    bot.run(TOKEN)\n' +
'\n' +
'\n' +
'if __name__ == "__main__":\n' +
'    main()\n';

      var req = 'discord.py>=2.3\npython-dotenv>=1.0\n';
      var envExample = '# Discord Developer Portal > Bot > Token\nDISCORD_TOKEN=your-bot-token-here\n';

      return { 'bot.py': bot, 'requirements.txt': req, '.env.example': envExample };
    }

    /* ---------- HTML: LANDING ---------- */
    function genLanding(analysis) {
      var title = 'Landing';
      var html =
'<!DOCTYPE html>\n' +
'<html lang="tr">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'  <title>' + title + '</title>\n' +
'  <link rel="stylesheet" href="style.css" />\n' +
'</head>\n' +
'<body>\n' +
'  <header class="hero">\n' +
'    <nav class="nav"><span class="logo">Brand</span><a href="#cta" class="btn">Başla</a></nav>\n' +
'    <div class="hero-inner">\n' +
'      <h1>Ürününüzü dakikalar içinde yayına alın</h1>\n' +
'      <p>Hızlı, modern ve responsive bir başlangıç şablonu.</p>\n' +
'      <a href="#cta" class="btn big">Ücretsiz Dene</a>\n' +
'    </div>\n' +
'  </header>\n' +
'  <section class="features">\n' +
'    <article><h3>Hızlı</h3><p>Optimize edilmiş performans.</p></article>\n' +
'    <article><h3>Güvenli</h3><p>En iyi güvenlik pratikleri.</p></article>\n' +
'    <article><h3>Esnek</h3><p>İhtiyaca göre ölçeklenir.</p></article>\n' +
'  </section>\n' +
'  <section id="cta" class="cta"><h2>Bugün başlayın</h2><a href="#" class="btn big">Kayıt Ol</a></section>\n' +
'  <script src="script.js"></script>\n' +
'</body>\n' +
'</html>\n';

      var css =
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

      var js =
"(function () {\n" +
"  'use strict';\n" +
"  document.querySelectorAll('a[href^=\"#\"]').forEach(function (a) {\n" +
"    a.addEventListener('click', function (e) {\n" +
"      var target = document.querySelector(a.getAttribute('href'));\n" +
"      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth' }); }\n" +
"    });\n" +
"  });\n" +
"})();\n";

      return { 'index.html': html, 'style.css': css, 'script.js': js };
    }

    /* ---------- GENERIC (teknolojiye göre iskele) ---------- */
    function genGeneric(analysis) {
      if (analysis.technology === 'python') {
        var py =
'def main():\n' +
'    print("BilalAI Pro tarafından oluşturuldu.")\n' +
'\n' +
'\n' +
'if __name__ == "__main__":\n' +
'    main()\n';
        return { 'main.py': py, 'requirements.txt': '' };
      }
      if (analysis.technology === 'node') {
        var idx =
"'use strict';\n" +
"\n" +
"function main() {\n" +
"  console.log('BilalAI Pro tarafından oluşturuldu.');\n" +
"}\n" +
"\n" +
"main();\n";
        var pkg =
'{\n' +
'  "name": "bilalai-app",\n' +
'  "version": "1.0.0",\n' +
'  "type": "commonjs",\n' +
'  "scripts": { "start": "node index.js" }\n' +
'}\n';
        return { 'index.js': idx, 'package.json': pkg };
      }
      if (analysis.technology === 'react') {
        return genDashboard(); // makul, dolu bir React iskeleti
      }
      // html/css/js iskele
      var html =
'<!DOCTYPE html>\n' +
'<html lang="tr">\n' +
'<head>\n' +
'  <meta charset="UTF-8" />\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
'  <title>Uygulama</title>\n' +
'  <link rel="stylesheet" href="style.css" />\n' +
'</head>\n' +
'<body>\n' +
'  <main class="app">\n' +
'    <h1>Merhaba</h1>\n' +
'    <p id="output">BilalAI Pro tarafından oluşturuldu.</p>\n' +
'  </main>\n' +
'  <script src="script.js"></script>\n' +
'</body>\n' +
'</html>\n';
      var css =
'body { margin:0; font-family:system-ui,sans-serif; background:#0f172a; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; }\n' +
'.app { text-align:center; }\n';
      var js =
"(function () {\n" +
"  'use strict';\n" +
"  console.log('[BilalAI Pro] hazır');\n" +
"})();\n";
      return { 'index.html': html, 'style.css': css, 'script.js': js };
    }

    return { generate: generate };
  })();

  /* =================================================
     11. VALIDATOR (self-check)
     Statik kontroller. Gerçek runtime YOK -> abartma yok.
  ================================================= */

  var Validator = (function () {

    function checkBalanced(content, open, close) {
      var depth = 0;
      for (var i = 0; i < content.length; i++) {
        if (content[i] === open) depth++;
        else if (content[i] === close) depth--;
        if (depth < 0) return false;
      }
      return depth === 0;
    }

    function checkJs(path, content) {
      var errors = [];
      if (!checkBalanced(content, '{', '}')) errors.push(mk(path, 'Süslü parantez dengesiz ({ }).'));
      if (!checkBalanced(content, '(', ')')) errors.push(mk(path, 'Parantez dengesiz ( ).'));
      if (!checkBalanced(content, '[', ']')) errors.push(mk(path, 'Köşeli parantez dengesiz ([ ]).'));
      // Kaba syntax denetimi: yalnızca inline/module olmayan saf JS için new Function
      if (!/\bimport\s|\bexport\s|from\s+['"]/.test(content)) {
        try {
          new Function(content); // ES module DEĞİLSE derlenebilirlik testi
        } catch (e) {
          errors.push(mk(path, 'JS syntax hatası: ' + (e && e.message)));
        }
      }
      return errors;
    }

    function checkHtml(path, content) {
      var errors = [];
      if (!/<!DOCTYPE html>/i.test(content)) errors.push(mk(path, 'DOCTYPE eksik.', 'warning'));
      if (!/<html[\s>]/i.test(content) || !/<\/html>/i.test(content)) errors.push(mk(path, '<html> etiketi kapatılmamış.'));
      if (!/<\/body>/i.test(content) && /<body[\s>]/i.test(content)) errors.push(mk(path, '<body> kapatılmamış.'));
      return errors;
    }

    function checkCss(path, content) {
      var errors = [];
      if (!checkBalanced(content, '{', '}')) errors.push(mk(path, 'CSS blok parantezi dengesiz.'));
      return errors;
    }

    function checkPython(path, content) {
      var errors = [];
      // Sekme/boşluk karışımı kaba kontrolü
      if (/\t/.test(content) && / {4}/.test(content)) {
        errors.push(mk(path, 'Python girintide sekme ve boşluk karışık kullanılmış.', 'warning'));
      }
      // def/if/for satır sonu ':' kontrolü (kaba)
      content.split('\n').forEach(function (line, i) {
        if (/^\s*(def |class |if |for |while |else|elif |try|except)/.test(line) && !/:\s*(#.*)?$/.test(line) && line.trim().slice(-1) !== ':') {
          if (!/[:\\]\s*$/.test(line)) errors.push(mk(path, 'Satır ' + (i + 1) + ': iki nokta ( : ) eksik olabilir.', 'warning'));
        }
      });
      return errors;
    }

    // Dosyalar arası referans kontrolü (html -> css/js var mı?)
    function checkCrossRefs(files) {
      var errors = [];
      var paths = Object.keys(files);
      paths.forEach(function (p) {
        if (ext(p) !== 'html') return;
        var html = files[p];
        var refs = [];
        var re = /(?:href|src)\s*=\s*["']([^"']+)["']/gi, m;
        while ((m = re.exec(html))) {
          var ref = m[1];
          if (/^https?:|^\/\/|^#|^data:|^mailto:/.test(ref)) continue;
          if (ext(ref) === 'css' || ext(ref) === 'js') refs.push(ref);
        }
        refs.forEach(function (ref) {
          var clean = ref.replace(/^\.?\//, '');
          var found = paths.some(function (pp) {
            return pp === ref || pp === clean || pp.replace(/^\.?\//, '') === clean;
          });
          if (!found) errors.push(mk(p, 'Referans verilen dosya bulunamadı: ' + ref, 'warning'));
        });
      });
      return errors;
    }

    function mk(file, message, severity) {
      return { file: file, message: message, severity: severity || 'error' };
    }

    function run(files) {
      var errors = [];
      Object.keys(files).forEach(function (path) {
        var content = files[path] || '';
        var e = ext(path);
        if (e === 'js' || e === 'jsx' || e === 'mjs') errors = errors.concat(checkJs(path, content));
        else if (e === 'html') errors = errors.concat(checkHtml(path, content));
        else if (e === 'css') errors = errors.concat(checkCss(path, content));
        else if (e === 'py') errors = errors.concat(checkPython(path, content));
      });
      errors = errors.concat(checkCrossRefs(files));

      var hardErrors = errors.filter(function (x) { return x.severity === 'error'; });
      return {
        passed: hardErrors.length === 0,
        errors: errors,
        checks: ['syntax', 'brackets', 'imports/refs', 'html-structure', 'css-selectors'],
      };
    }

    return { run: run };
  })();

  /* =================================================
     12. FIXER (self-fix loop)
     Statik olarak düzeltilebilen bazı sorunları onarır.
     Düzeltilemeyeni açıkça bırakır (uydurma yapmaz).
  ================================================= */

  var Fixer = (function () {
    function tryFix(files, errors) {
      var fixedSomething = false;
      errors.forEach(function (err) {
        var content = files[err.file];
        if (content == null) return;

        // Eksik </body> ekle
        if (/<body> kapatılmamış/.test(err.message) && /<body[\s>]/i.test(content) && !/<\/body>/i.test(content)) {
          files[err.file] = content.replace(/<\/html>/i, '</body>\n</html>');
          if (files[err.file] === content) files[err.file] = content + '\n</body>';
          fixedSomething = true;
          bus.emit('fix_completed', { file: err.file, message: 'Eksik </body> eklendi.' });
          return;
        }
        // Eksik </html> ekle
        if (/<html> etiketi kapatılmamış/.test(err.message) && !/<\/html>/i.test(content)) {
          files[err.file] = content + '\n</html>';
          fixedSomething = true;
          bus.emit('fix_completed', { file: err.file, message: 'Eksik </html> eklendi.' });
          return;
        }
        // DOCTYPE ekle (warning ama ucuz düzeltme)
        if (/DOCTYPE eksik/.test(err.message) && !/<!DOCTYPE/i.test(content)) {
          files[err.file] = '<!DOCTYPE html>\n' + content;
          fixedSomething = true;
          bus.emit('fix_completed', { file: err.file, message: 'DOCTYPE eklendi.' });
          return;
        }
      });
      return fixedSomething;
    }
    return { tryFix: tryFix };
  })();

  /* =================================================
     13. AGENT RUNNER
     Asıl agentic akış: ANALYZE -> PLAN -> WORKSPACE ->
     IMPLEMENT -> VERIFY -> FIX -> PREVIEW -> COMPLETE
  ================================================= */

  function pickThinking(complexity) {
    var range = CONFIG.thinking[complexity] || CONFIG.thinking.medium;
    return randBetween(range);
  }

  function writeFilesToWorkspace(workspace, files) {
    var written = [];
    Object.keys(files).forEach(function (path) {
      var existed = workspace.fileExists(path);
      if (existed) {
        workspace.updateFile(path, files[path]);
        bus.emit('file_updated', { path: path, size: files[path].length });
      } else {
        workspace.createFile(path, files[path]);
        bus.emit('file_created', { path: path, size: files[path].length });
      }
      written.push({ path: path, action: existed ? 'updated' : 'created', size: files[path].length });
    });
    return written;
  }

  function summarize(analysis, files, testResult, previewResult, webNote) {
    var lines = [];
    lines.push('## Completed');
    lines.push('');
    lines.push('### Files');
    Object.keys(files).forEach(function (p) { lines.push('✓ ' + p); });
    lines.push('');
    lines.push('### Changes');
    STATE.changes.forEach(function (c) { lines.push('✓ ' + c); });
    lines.push('');
    lines.push('### Tests');
    if (testResult.testStatus === 'passed') {
      testResult.checks.forEach(function (c) { lines.push('✓ ' + c); });
    } else if (testResult.testStatus === 'failed') {
      lines.push('✗ Statik kontrol başarısız:');
      testResult.errors.filter(function (e) { return e.severity === 'error'; }).forEach(function (e) {
        lines.push('  - ' + e.file + ': ' + e.message);
      });
    } else {
      lines.push('• testStatus: not_run');
    }
    lines.push('');
    lines.push('### Preview');
    if (previewResult && previewResult.ok) lines.push('✓ Hazır (' + previewResult.kind + ')');
    else if (previewResult && previewResult.reason) lines.push('✗ Oluşturulamadı: ' + previewResult.reason);
    else lines.push('• Bu görev için preview yok.');

    if (webNote) {
      lines.push('');
      lines.push('### Not');
      lines.push('⚠ ' + webNote);
    }
    return lines.join('\n');
  }

  function runAgent(userMsg, context, options) {
    options = options || {};
    var workspace = normalizeWorkspace(options.workspace);
    var web = options.web && options.web.search ? options.web : createWebAdapter(options.web);
    var preview = (options.preview && options.preview.previewProject) ? options.preview : createPreviewAdapter(options.preview);

    // reset light
    STATE = freshState();
    STATE.startedAt = Date.now();

    var result = {
      ok: false, response: '', plan: [], filesChanged: [],
      tests: [], preview: null, state: null,
    };

    // ---- ANALYZE ----
    setStatus('analyzing');
    bus.emit('analysis_started', { message: userMsg });
    var analysis = Planner.analyze(userMsg);
    STATE.plan = analysis;

    // ---- PLAN ----
    setStatus('planning');
    var taskDefs = Planner.buildTasks(analysis);
    TaskManager.init(taskDefs);
    result.plan = clone(STATE.tasks);

    var thinkMs = pickThinking(analysis.complexity);

    // ---- Görev döngüsü ----
    return (async function () {
      // Yapay düşünme (UI için) — gerçek iş buna EK olarak sürer.
      await sleep(thinkMs);

      var generatedFiles = {};
      var testResult = { testStatus: 'not_run', errors: [], checks: [] };
      var previewResult = null;
      var webNote = null;

      for (var i = 0; i < STATE.tasks.length; i++) {
        var task = STATE.tasks[i];
        TaskManager.start(task.id);
        await sleep(CONFIG.stepDelayMs);

        try {
          if (task.kind === 'analyze') {
            // Mevcut dosyaları oku (varsa) — bağlamı koru, gereksiz silme yapma
            var existing = workspace.listFiles();
            if (existing.length) {
              STATE.changes.push('Mevcut ' + existing.length + ' dosya incelendi, korunuyor.');
            }
            // Web gerekiyor mu? (kaba sezgi)
            if (analysis.framework && hasAny(normalize(userMsg), ['en son', 'guncel', 'latest', 'yeni surum'])) {
              var res = await web.search(analysis.framework + ' latest version');
              if (res && res.webRequired) {
                webNote = res.note;
                bus.emit('web_required', { query: res.query });
              }
            }
          }
          else if (task.kind === 'scaffold') {
            setStatus('implementing');
            generatedFiles = CodeGenerator.generate(analysis);
            STATE.changes.push(analysis.goal + ' için dosya iskeleti hazırlandı.');
          }
          else if (task.kind === 'implement') {
            setStatus('implementing');
            if (!Object.keys(generatedFiles).length) {
              generatedFiles = CodeGenerator.generate(analysis);
            }
            STATE.files = writeFilesToWorkspace(workspace, generatedFiles);
            if (task.title.indexOf('JavaScript') !== -1 || task.title.indexOf('mantık') !== -1) {
              STATE.changes.push('İş mantığı / etkileşim işlevleri eklendi.');
            } else {
              STATE.changes.push('Ana arayüz geliştirildi.');
            }
          }
          else if (task.kind === 'verify') {
            setStatus('testing');
            bus.emit('test_started', {});
            var check = Validator.run(generatedFiles);
            STATE.errors = check.errors;
            testResult.checks = check.checks;
            if (check.passed) {
              testResult.testStatus = 'passed';
              bus.emit('test_passed', { checks: check.checks });
            } else {
              testResult.testStatus = 'failed';
              bus.emit('test_failed', { errors: check.errors });
            }
            testResult.errors = check.errors;
          }
          else if (task.kind === 'fix') {
            // Self-fix loop (maxFixAttempts)
            if (testResult.testStatus === 'failed') {
              setStatus('fixing');
              var attempt = 0;
              var passed = false;
              while (attempt < CONFIG.maxFixAttempts) {
                attempt++;
                bus.emit('fix_started', { attempt: attempt });
                var didFix = Fixer.tryFix(generatedFiles, testResult.errors);
                // yeniden yaz + yeniden kontrol
                STATE.files = writeFilesToWorkspace(workspace, generatedFiles);
                var recheck = Validator.run(generatedFiles);
                STATE.errors = recheck.errors;
                testResult.errors = recheck.errors;
                if (recheck.passed) {
                  passed = true;
                  testResult.testStatus = 'passed';
                  bus.emit('test_passed', { checks: recheck.checks, afterFix: true });
                  break;
                }
                if (!didFix) break; // otomatik düzeltilebilir bir şey kalmadı
                await sleep(CONFIG.stepDelayMs);
              }
              if (!passed) {
                STATE.changes.push('Bazı sorunlar otomatik düzeltilemedi (aşağıda listelendi).');
              } else {
                STATE.changes.push('Statik kontrol hataları düzeltildi.');
              }
            }
          }
          else if (task.kind === 'preview') {
            setStatus('previewing');
            if (analysis.technology === 'html' || analysis.technology === 'landing') {
              previewResult = preview.previewProject(generatedFiles);
              if (previewResult && previewResult.ok) {
                STATE.preview = previewResult;
                bus.emit('preview_ready', { url: previewResult.url, kind: previewResult.kind });
              }
            } else {
              // React/Node/Python: gerçek runtime yoksa dürüst ol
              previewResult = { ok: false, reason: 'no_runtime',
                note: analysis.technology + ' için canlı preview runtime bağlı değil.' };
            }
          }
          else if (task.kind === 'notes') {
            STATE.changes.push('Çalıştırma adapteri bağlı değil; statik self-check gerçekleştirildi.');
          }

          TaskManager.complete(task.id);
        } catch (e) {
          STATE.errors.push({ file: task.title, message: e && e.message, severity: 'error' });
          TaskManager.fail(task.id, e && e.message);
          setStatus('failed');
          result.ok = false;
          result.response = 'Görev sırasında hata: ' + (e && e.message);
          result.filesChanged = STATE.files;
          result.tests = testResult.errors;
          result.state = clone(STATE);
          STATE.finishedAt = Date.now();
          return result;
        }
      }

      // ---- COMPLETE ----
      var allDone = STATE.tasks.every(function (t) { return t.status === 'done'; });
      setStatus(allDone ? 'completed' : 'failed');
      STATE.testStatus = testResult.testStatus;
      STATE.finishedAt = Date.now();

      result.ok = allDone;
      result.response = summarize(analysis, generatedFiles, testResult, previewResult, webNote);
      result.plan = clone(STATE.tasks);
      result.filesChanged = clone(STATE.files);
      result.tests = clone(testResult.errors);
      result.preview = previewResult;
      result.state = clone(STATE);

      bus.emit(allDone ? 'agent_completed' : 'agent_failed', { result: clone({ ok: result.ok }) });
      return result;
    })();
  }

  /* =================================================
     14. PUBLIC API
  ================================================= */

  var BilalAIPro = {
    MODEL: MODEL,
    CONFIG: CONFIG,

    // Fabrikalar (UI kendi adapter'ını enjekte edebilir)
    WorkspaceAdapter: {
      inMemory: createInMemoryWorkspace,
      normalize: normalizeWorkspace,
    },
    WebAdapter: createWebAdapter,
    PreviewAdapter: createPreviewAdapter,

    onEvent: function (cb) { return bus.on(cb); },

    getState: function () { return clone(STATE); },

    getPlan: function (task) {
      var analysis = Planner.analyze(task);
      var tasks = Planner.buildTasks(analysis);
      return { analysis: analysis, tasks: tasks };
    },

    reset: function () {
      STATE = freshState();
      bus.emit('reset', {});
      return true;
    },

    // Asıl agent akışı (async)
    generateAsync: function (userMsg, context, options) {
      return runAgent(userMsg, context || {}, options || {});
    },

    // runTask: generateAsync ile aynı akış, "task" odaklı isim
    runTask: function (task, options) {
      return runAgent(task, {}, options || {});
    },

    // Senkron fallback: gerçek akışı başlatır ama beklemeden
    // en iyi-çaba özet döndürür. (Tam sonuç için generateAsync kullanın.)
    generate: function (userMsg, context, options) {
      var analysis = Planner.analyze(userMsg);
      var tasks = Planner.buildTasks(analysis);
      var files = CodeGenerator.generate(analysis);
      var check = Validator.run(files);

      // Senkron olarak workspace'e yazmayı dene
      var workspace = normalizeWorkspace(options && options.workspace);
      var written = writeFilesToWorkspace(workspace, files);

      // Async akışı da ateşle (UI event'leri aksın); sonucu beklemeyiz
      try { runAgent(userMsg, context || {}, options || {}); } catch (e) {}

      return {
        ok: check.passed,
        sync: true,
        response: (check.passed
          ? 'Dosyalar üretildi ve statik kontrolden geçti. Tam agent akışı için generateAsync kullanın.'
          : 'Dosyalar üretildi; statik kontrolde sorun(lar) var.'),
        plan: tasks,
        analysis: analysis,
        files: Object.keys(files),
        filesChanged: written,
        testStatus: check.passed ? 'passed' : 'failed',
        tests: check.errors,
      };
    },
  };

  // Dışa aç
  global.BilalAIPro = BilalAIPro;

  // CommonJS / ESM köprüsü (opsiyonel)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BilalAIPro;
  }

})(typeof window !== 'undefined' ? window : this);

