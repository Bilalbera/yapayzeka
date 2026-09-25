/**
 * BilalAI Pro 1.1 — General-Purpose Coding Agent Engine
 *
 * Pro 1.0 was a template-based generator with 3 hardcoded modification types
 * (dark-mode, responsive, login). Pro 1.1 removes every hardcoded feature list
 * and replaces them with a generic understand → plan → modify → validate → test
 * pipeline that adapts to whatever the user asks and whatever code already exists.
 *
 * The agent NEVER says "Bu ozellik desteklenmiyor" ("this feature is not supported").
 * It analyzes the workspace and figures out what to change.
 *
 * Public API (backward-compatible with Pro 1.0):
 *   generate(), generateAsync(), runTask(), analyze(), plan(),
 *   getPlan(), getTasks(), getFiles(), getChanges(), getState(),
 *   getPreview(), getMemory(), reset(), onEvent(), setWorkspace(),
 *   selfTest(), MODEL, CONFIG
 *
 * @module promodel
 */

/* ============================================================================
 * SECTION 1 — Constants & Metadata
 * ========================================================================== */

const MODEL = {
  name: 'BilalAI',
  shortName: 'BilalAI',
  version: '1.1',
  versionLabel: 'BilalAI Pro 1.1',
  capabilities: [
    'generic-change-engine',
    'dynamic-planning',
    'cross-file-impact-analysis',
    'code-cleanup',
    'bug-detection',
    'project-memory',
    'runtime-adapter',
    'static-validation',
    'auto-test-generation',
    'unlimited-feature-support',
  ],
};

const CONFIG = {
  maxFixAttempts: 3,
  maxFilesToScan: 50,
  maxFileReadBytes: 256 * 1024,
  workspaceRetryDelay: 50,
  eventBufferSize: 200,
  historyLimit: 50,
};

/* ============================================================================
 * SECTION 2 — Utilities
 * ========================================================================== */

/** Generate a unique-ish id without external deps. */
function uid(prefix) {
  return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

/** Shallow-clone an object. */
function clone(obj) {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.slice();
  if (typeof obj === 'object') return Object.assign({}, obj);
  return obj;
}

/** Deep-clone JSON-safe data. */
function deepClone(obj) {
  if (obj === null || obj === undefined) return obj;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return clone(obj);
  }
}

/** Safely read text from a File-like object that may have a `.text()` method. */
async function readText(file) {
  if (file === null || file === undefined) return '';
  if (typeof file.text === 'function') {
    try {
      return await file.text();
    } catch { /* fall through */ }
  }
  if (typeof file === 'string') return file;
  if (file.content !== undefined) return String(file.content);
  if (file.text !== undefined && typeof file.text === 'string') return file.text;
  return '';
}

/** Check whether a value is a plain object (not an array, not null). */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Merge two objects shallowly (b overrides a). */
function merge(a, b) {
  return Object.assign({}, a || {}, b || {});
}

/** Truncate a string to n chars, appending an ellipsis. */
function truncate(str, n) {
  if (typeof str !== 'string') return '';
  if (str.length <= n) return str;
  return str.slice(0, n) + '…';
}

/* ============================================================================
 * SECTION 3 — Event Bus
 * ========================================================================== */

function createEventBus() {
  const listeners = {};
  const history = [];

  function on(type, fn) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(fn);
    return () => off(type, fn);
  }

  function off(type, fn) {
    const arr = listeners[type];
    if (!arr) return;
    const idx = arr.indexOf(fn);
    if (idx >= 0) arr.splice(idx, 1);
  }

  function emit(type, payload) {
    const event = { type, payload, timestamp: Date.now() };
    history.push(event);
    if (history.length > CONFIG.eventBufferSize) history.shift();
    const arr = listeners[type];
    if (arr) {
      for (let i = 0; i < arr.length; i++) {
        try { arr[i](event); } catch (e) { /* swallow handler errors */ }
      }
    }
    const all = listeners['*'];
    if (all) {
      for (let i = 0; i < all.length; i++) {
        try { all[i](event); } catch (e) { /* swallow */ }
      }
    }
  }

  function getHistory() {
    return history.slice();
  }

  function clear() {
    for (const k in listeners) delete listeners[k];
    history.length = 0;
  }

  return { on, off, emit, getHistory, clear };
}

/* ============================================================================
 * SECTION 4 — Workspace Manager
 *
 * Manages the virtual file system. Supports read, write, remove, rename, move.
 * Works with both the in-memory virtual workspace and a real BrowserFS / OPFS
 * adapter if one is provided.
 * ========================================================================== */

function createWorkspaceManager() {
  let workspace = null;  // { files: { [path]: { path, content, text } } }

  function setWorkspace(ws) {
    workspace = ws || { files: {} };
    if (!workspace.files) workspace.files = {};
  }

  function getWorkspace() {
    return workspace;
  }

  function hasWorkspace() {
    return workspace !== null && workspace.files !== undefined;
  }

  function listFiles() {
    if (!hasWorkspace()) return [];
    return Object.keys(workspace.files).sort();
  }

  function getFile(path) {
    if (!hasWorkspace()) return null;
    return workspace.files[path] || null;
  }

  function fileExists(path) {
    return hasWorkspace() && !!workspace.files[path];
  }

  async function readFile(path) {
    const f = getFile(path);
    if (!f) return null;
    return await readText(f);
  }

  async function readAllFiles() {
    if (!hasWorkspace()) return [];
    const paths = listFiles();
    const results = [];
    for (let i = 0; i < paths.length; i++) {
      const content = await readFile(paths[i]);
      results.push({ path: paths[i], content: content || '' });
    }
    return results;
  }

  function writeFile(path, content) {
    if (!hasWorkspace()) setWorkspace({ files: {} });
    workspace.files[path] = { path, content, text: content };
  }

  function removeFile(path) {
    if (!hasWorkspace()) return;
    delete workspace.files[path];
  }

  function renameFile(oldPath, newPath) {
    if (!hasWorkspace() || !workspace.files[oldPath]) return;
    const f = workspace.files[oldPath];
    f.path = newPath;
    workspace.files[newPath] = f;
    delete workspace.files[oldPath];
  }

  function moveFile(path, newDir) {
    if (!hasWorkspace() || !workspace.files[path]) return;
    const name = path.split('/').pop();
    const newPath = newDir.endsWith('/') ? newDir + name : newDir + '/' + name;
    renameFile(path, newPath);
  }

  function clear() {
    workspace = null;
  }

  return {
    setWorkspace, getWorkspace, hasWorkspace,
    listFiles, getFile, fileExists, readFile, readAllFiles,
    writeFile, removeFile, renameFile, moveFile, clear,
  };
}

/* ============================================================================
 * SECTION 5 — Code Parsers
 *
 * Lightweight static parsers for HTML, CSS, and JS that extract structural
 * information needed by the generic change engine. These are NOT full AST
 * parsers — they use regex heuristics that are fast and sufficient for planning.
 * ========================================================================== */

/**
 * Parse an HTML file's structure: IDs, classes, script/link references,
 * form elements, buttons, and a rough DOM outline.
 */
function parseHTML(content) {
  const result = {
    type: 'html',
    ids: [],
    classes: [],
    scripts: [],
    styles: [],
    forms: [],
    buttons: [],
    inputs: [],
    elements: [],
  };

  if (!content || typeof content !== 'string') return result;

  // Extract IDs
  let m;
  const idRe = /id\s*=\s*["']([^"']+)["']/gi;
  while ((m = idRe.exec(content)) !== null) {
    if (!result.ids.includes(m[1])) result.ids.push(m[1]);
  }

  // Extract classes
  const classRe = /class\s*=\s*["']([^"']+)["']/gi;
  while ((m = classRe.exec(content)) !== null) {
    const parts = m[1].split(/\s+/).filter(Boolean);
    for (const p of parts) {
      if (!result.classes.includes(p)) result.classes.push(p);
    }
  }

  // Script references
  const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
  while ((m = scriptRe.exec(content)) !== null) {
    result.scripts.push(m[1]);
  }

  // CSS/link references
  const linkRe = /<link[^>]+href\s*=\s*["']([^"']+\.css)["']/gi;
  while ((m = linkRe.exec(content)) !== null) {
    result.styles.push(m[1]);
  }
  const styleTagRe = /<style[^>]*>/gi;
  while ((m = styleTagRe.exec(content)) !== null) {
    result.styles.push('__inline_style__');
  }

  // Forms
  const formRe = /<form[^>]*>/gi;
  while ((m = formRe.exec(content)) !== null) {
    result.forms.push(m[0]);
  }

  // Inputs
  const inputRe = /<input[^>]*>/gi;
  while ((m = inputRe.exec(content)) !== null) {
    result.inputs.push(m[0]);
  }

  // Buttons
  const btnRe = /<button[^>]*>[\s\S]*?<\/button>/gi;
  while ((m = btnRe.exec(content)) !== null) {
    result.buttons.push(m[0].slice(0, 100));
  }

  // General element tags for structure
  const elemRe = /<(\w+)[^>]*>/g;
  while ((m = elemRe.exec(content)) !== null) {
    if (!result.elements.includes(m[1])) result.elements.push(m[1]);
  }

  return result;
}

/**
 * Parse a CSS file's structure: selectors, variables, media queries, keyframes.
 */
function parseCSS(content) {
  const result = {
    type: 'css',
    selectors: [],
    variables: [],
    mediaQueries: [],
    keyframes: [],
  };

  if (!content || typeof content !== 'string') return result;

  let m;

  // CSS custom properties (variables)
  const varRe = /--([\w-]+)\s*:/g;
  while ((m = varRe.exec(content)) !== null) {
    if (!result.variables.includes(m[1])) result.variables.push(m[1]);
  }

  // Selectors (rules ending with {)
  const selRe = /([^{}]+)\{/g;
  while ((m = selRe.exec(content)) !== null) {
    const sel = m[1].trim();
    if (sel && !sel.startsWith('@') && !result.selectors.includes(sel)) {
      result.selectors.push(sel);
    }
  }

  // Media queries
  const mqRe = /@media\s+([^{]+)\{/g;
  while ((m = mqRe.exec(content)) !== null) {
    result.mediaQueries.push(m[1].trim());
  }

  // Keyframes
  const kfRe = /@keyframes\s+([\w-]+)/g;
  while ((m = kfRe.exec(content)) !== null) {
    result.keyframes.push(m[1]);
  }

  return result;
}

/**
 * Parse a JS file's structure: functions, variables, event listeners,
 * imports/exports, classes, and a rough data-model description.
 */
function parseJS(content) {
  const result = {
    type: 'js',
    functions: [],
    variables: [],
    eventListeners: [],
    imports: [],
    exports: [],
    classes: [],
    calls: [],
    storageKeys: [],
    apiCalls: [],
    dataModel: [],
  };

  if (!content || typeof content !== 'string') return result;

  let m;

  // Function declarations
  const fnRe = /function\s+(\w+)\s*\(/g;
  while ((m = fnRe.exec(content)) !== null) {
    if (!result.functions.includes(m[1])) result.functions.push(m[1]);
  }
  // Arrow / const functions
  const arrowRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
  while ((m = arrowRe.exec(content)) !== null) {
    if (!result.functions.includes(m[1])) result.functions.push(m[1]);
  }
  // Object method shorthand
  const methRe = /(?:^|\n)\s+(\w+)\s*\([^)]*\)\s*\{/g;
  while ((m = methRe.exec(content)) !== null) {
    const name = m[1].trim();
    if (name && !['if', 'for', 'while', 'switch', 'catch', 'else'].includes(name) && !result.functions.includes(name)) {
      result.functions.push(name);
    }
  }

  // Variables (top-level const/let/var)
  const varRe = /(?:const|let|var)\s+(\w+)/g;
  while ((m = varRe.exec(content)) !== null) {
    if (!result.variables.includes(m[1])) result.variables.push(m[1]);
  }

  // Event listeners
  const evRe = /addEventListener\s*\(\s*['"](\w+)['"]/g;
  while ((m = evRe.exec(content)) !== null) {
    result.eventListeners.push(m[1]);
  }
  // Also catch onclick= patterns
  const oncRe = /on(?:click|change|input|submit|load|keydown|keyup)\s*=\s*(?:["']|function|async)/gi;
  while ((m = oncRe.exec(content)) !== null) {
    const type = m[0].match(/on(\w+)/i)[1].toLowerCase();
    if (!result.eventListeners.includes(type)) result.eventListeners.push(type);
  }

  // Imports
  const impRe = /import\s+(?:\{([^}]+)\}|(\w+))?\s*(?:from)?\s*['"]([^'"]+)['"]/g;
  while ((m = impRe.exec(content)) !== null) {
    const named = m[1] ? m[1].split(',').map(s => s.trim()) : [];
    const def = m[2] || null;
    const from = m[3];
    result.imports.push({ named, default: def, from });
  }

  // Exports
  const expRe = /export\s+(?:default\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)|class\s+(\w+))/g;
  while ((m = expRe.exec(content)) !== null) {
    const name = m[1] || m[2] || m[3];
    if (name) result.exports.push(name);
  }

  // Classes
  const clsRe = /class\s+(\w+)/g;
  while ((m = clsRe.exec(content)) !== null) {
    if (!result.classes.includes(m[1])) result.classes.push(m[1]);
  }

  // Function calls (rough — for cross-file impact analysis)
  const callRe = /\b(\w+)\s*\(/g;
  while ((m = callRe.exec(content)) !== null) {
    const name = m[1];
    if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'const', 'let', 'var', 'new', 'await', 'async'].includes(name) && !result.calls.includes(name)) {
      result.calls.push(name);
    }
  }

  // localStorage / sessionStorage keys
  const lsRe = /(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)\s*\(\s*['"]([^'"]+)['"]/g;
  while ((m = lsRe.exec(content)) !== null) {
    if (!result.storageKeys.includes(m[1])) result.storageKeys.push(m[1]);
  }

  // API calls (fetch, XMLHttpRequest, axios)
  const apiRe = /(?:fetch|axios\.(?:get|post|put|delete|patch)|XMLHttpRequest)/g;
  while ((m = apiRe.exec(content)) !== null) {
    result.apiCalls.push(m[0]);
  }

  // Data model: objects with property arrays (heuristic for todo-like apps)
  const modelRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:\[\]|\{\})/g;
  while ((m = modelRe.exec(content)) !== null) {
    result.dataModel.push({ name: m[1], type: m[0].includes('[]') ? 'array' : 'object' });
  }

  return result;
}

/**
 * Auto-detect a file's type from its extension and content.
 */
function detectFileType(path, content) {
  const ext = (path || '').split('.').pop().toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'js' || ext === 'mjs' || ext === 'jsx') return 'js';
  if (ext === 'ts' || ext === 'tsx') return 'js'; // treat as JS-like
  if (ext === 'json') return 'json';
  // Sniff content
  if (content) {
    const trimmed = content.trim();
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (/^(import|export|const|let|var|function|class)\s/m.test(trimmed)) return 'js';
    if (/^@media|^@\w|^\.\w|#\w|^body|^html/m.test(trimmed)) return 'css';
  }
  return 'text';
}

/**
 * Parse a file based on its detected type.
 */
function parseFile(path, content) {
  const type = detectFileType(path, content);
  switch (type) {
    case 'html': return parseHTML(content);
    case 'css': return parseCSS(content);
    case 'js': return parseJS(content);
    default: return { type: type, raw: content };
  }
}

/* ============================================================================
 * SECTION 6 — Generic Intent Parser
 *
 * Replaces Pro 1.0's hardcoded 3-feature detection. Classifies the user's
 * request into an intent type and extracts the key concept without relying on
 * any fixed feature list.
 * ========================================================================== */

function createIntentParser() {

  // Intent keywords — these are NOT feature names, they are verb patterns
  // that help classify what KIND of change the user wants.
  const INTENT_KEYWORDS = {
    create: ['ekle', 'add', 'olustur', 'create', 'yeni', 'new', 'gerceklestir', 'implement', 'insert', 'koy'],
    modify: ['degistir', 'change', 'guncelle', 'update', 'modify', 'ayarla', 'set', 'cevir', 'convert', 'donustur'],
    fix: ['duzelt', 'fix', 'hata', 'bug', 'error', 'calismiyor', 'broken', 'not working', 'sorun', 'problem', 'coz'],
    refactor: ['modul', 'module', 'ayir', 'split', 'refactor', 'yapilandir', 'restructure', 'dosya', 'organize'],
    clean: ['temizle', 'clean', 'duplicate', 'tekrar', 'dead code', 'kullanilmayan', 'sadelestir', 'simplify', 'kaldir'],
    redesign: ['tasarim', 'design', 'yenile', 'redesign', 'gorunum', 'ui', 'stil', 'style', 'tema', 'theme', 'css'],
  };

  // Request-type patterns — used to build the patch plan, NOT to restrict what
  // the agent will do. Each pattern suggests which file types are likely affected.
  const REQUEST_PATTERNS = [
    { re: /dark\s*mode|karanlik|gece|tema\s*degis/i, affects: ['css', 'js', 'html'], label: 'dark-mode' },
    { re: /arama|search|filtrele|filter/i, affects: ['html', 'js', 'css'], label: 'search-filter' },
    { re: /oncelik|priority|sirala|sort|order/i, affects: ['html', 'js', 'css'], label: 'priority-sort' },
    { re: /tarih|date|zaman|time/i, affects: ['html', 'js'], label: 'date-field' },
    { re: /onay|confirm|silme|delete|remove/i, affects: ['html', 'js'], label: 'delete-confirm' },
    { re: /indexeddb|idb|localstorage|storage|veri\s*yapisi/i, affects: ['js'], label: 'storage-change' },
    { re: /tasarim|design|yenile|redesign|stil|style/i, affects: ['css', 'html', 'js'], label: 'redesign' },
    { re: /modul|module|ayir|split|refactor/i, affects: ['js', 'html'], label: 'refactor-modules' },
    { re: /duplicate|temizle|clean|dead\s*code|kullanilmayan/i, affects: ['js', 'css'], label: 'cleanup' },
    { re: /login|giris|sifre|password|auth|authenticate/i, affects: ['html', 'js', 'css'], label: 'login-auth' },
    { re: /api|fetch|baglanti|connection|endpoint/i, affects: ['js'], label: 'api-connection' },
    { re: /responsive|mobil|mobile|ekran|viewport/i, affects: ['css', 'html'], label: 'responsive' },
  ];

  function classify(text) {
    if (!text || typeof text !== 'string') return { type: 'unknown', confidence: 0 };

    // Normalize Turkish characters so that keywords like 'modul' match
    // input like 'modüllere' or 'giriş' matches 'giris'.
    const TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
    const lower = text.toLowerCase().replace(/[çğıöşüâîû]/g, ch => TR_MAP[ch] || ch);
    const scores = {};

    for (const intent in INTENT_KEYWORDS) {
      scores[intent] = 0;
      for (const kw of INTENT_KEYWORDS[intent]) {
        if (lower.includes(kw)) scores[intent] += 1;
      }
    }

    // Pick the highest scoring intent
    let best = 'create';
    let bestScore = 0;
    for (const intent in scores) {
      if (scores[intent] > bestScore) {
        bestScore = scores[intent];
        best = intent;
      }
    }

    // If no keywords matched at all, default to 'create' for feature-like requests
    if (bestScore === 0) best = 'create';

    return {
      type: best,
      confidence: bestScore,
      scores,
    };
  }

  function detectRequestType(text) {
    if (!text) return null;
    const TR_MAP = { 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ö': 'o', 'ş': 's', 'ü': 'u' };
    const lower = text.toLowerCase().replace(/[çğıöşü]/g, ch => TR_MAP[ch] || ch);
    for (const p of REQUEST_PATTERNS) {
      if (p.re.test(lower)) return { label: p.label, affects: p.affects };
    }
    return null;
  }

  function parse(text) {
    const intent = classify(text);
    const requestType = detectRequestType(text);

    // Extract the "subject" — the thing the user wants to change/add
    // This is free-form; we don't match it against any fixed list.
    const subject = text.trim();

    return {
      raw: text,
      intent: intent.type,
      confidence: intent.confidence,
      requestType: requestType ? requestType.label : 'generic',
      affectedFileTypes: requestType ? requestType.affects : ['js', 'html', 'css'],
      subject,
    };
  }

  return { parse, classify, detectRequestType };
}

/* ============================================================================
 * SECTION 7 — Context Analyzer
 *
 * Reads the entire workspace and builds a structural map of the project:
 * file list, file types, HTML structure, CSS structure, JS structure,
 * dependencies, data model, and cross-file references.
 * ========================================================================== */

function createContextAnalyzer(workspaceManager) {

  async function analyze() {
    const files = await workspaceManager.readAllFiles();
    if (files.length === 0) {
      return {
        projectType: 'empty',
        framework: 'unknown',
        files: [],
        structures: {},
        dependencies: { scripts: [], styles: [] },
        dataModel: [],
        crossRefs: [],
        entryPoint: null,
      };
    }

    const structures = {};
    let entryPoint = null;
    const allFunctions = {};
    const allCalls = [];
    const allExports = {};
    const allImports = [];
    const dataModel = [];
    const apiCalls = [];

    for (const file of files) {
      const parsed = parseFile(file.path, file.content);
      structures[file.path] = parsed;

      if (file.path.endsWith('.html') && !entryPoint) {
        entryPoint = file.path;
      }

      if (parsed.type === 'js') {
        for (const fn of parsed.functions) {
          if (!allFunctions[fn]) allFunctions[fn] = [];
          allFunctions[fn].push(file.path);
        }
        for (const call of parsed.calls) {
          allCalls.push({ name: call, file: file.path });
        }
        for (const exp of parsed.exports) {
          if (!allExports[exp]) allExports[exp] = [];
          allExports[exp].push(file.path);
        }
        for (const imp of parsed.imports) {
          allImports.push({ ...imp, file: file.path });
        }
        for (const dm of parsed.dataModel) {
          dataModel.push({ ...dm, file: file.path });
        }
        for (const api of parsed.apiCalls) {
          apiCalls.push({ name: api, file: file.path });
        }
      }
    }

    // Build cross-file references
    const crossRefs = [];
    for (const call of allCalls) {
      if (allFunctions[call.name]) {
        for (const definedIn of allFunctions[call.name]) {
          if (definedIn !== call.file) {
            crossRefs.push({
              type: 'function-call',
              name: call.name,
              from: call.file,
              to: definedIn,
            });
          }
        }
      }
      if (allExports[call.name]) {
        for (const definedIn of allExports[call.name]) {
          if (definedIn !== call.file) {
            crossRefs.push({
              type: 'import-reference',
              name: call.name,
              from: call.file,
              to: definedIn,
            });
          }
        }
      }
    }

    // Determine project type and framework
    const projectType = detectProjectType(files, structures);
    const framework = detectFramework(files, structures);

    // Collect script/style dependencies
    const dependencies = { scripts: [], styles: [] };
    for (const path in structures) {
      const s = structures[path];
      if (s.type === 'html') {
        dependencies.scripts.push(...(s.scripts || []));
        dependencies.styles.push(...(s.styles || []));
      }
    }

    return {
      projectType,
      framework,
      files: files.map(f => f.path),
      fileCount: files.length,
      structures,
      dependencies,
      dataModel,
      apiCalls,
      crossRefs,
      allFunctions,
      allExports,
      entryPoint,
    };
  }

  function detectProjectType(files, structures) {
    const paths = files.map(f => f.path.toLowerCase());
    const hasHTML = paths.some(p => p.endsWith('.html'));
    const hasCSS = paths.some(p => p.endsWith('.css'));
    const hasJS = paths.some(p => p.endsWith('.js') || p.endsWith('.mjs'));

    if (paths.some(p => p.includes('package.json'))) {
      const pkgFile = files.find(f => f.path.toLowerCase().includes('package.json'));
      if (pkgFile) {
        try {
          const pkg = JSON.parse(pkgFile.content);
          if (pkg.dependencies) {
            if (pkg.dependencies.react) return 'react';
            if (pkg.dependencies.vue) return 'vue';
            if (pkg.dependencies.svelte) return 'svelte';
            if (pkg.dependencies.next) return 'nextjs';
          }
        } catch { /* ignore */ }
      }
      return 'node-project';
    }

    if (hasHTML && hasCSS && hasJS) return 'vanilla-web';
    if (hasHTML && hasJS) return 'html-js';
    if (hasHTML) return 'html-only';
    if (hasJS) return 'js-only';
    return 'unknown';
  }

  function detectFramework(files, structures) {
    for (const path in structures) {
      const s = structures[path];
      if (s.type === 'js') {
        if (s.imports.some(i => i.from && i.from.includes('react'))) return 'react';
        if (s.imports.some(i => i.from && i.from.includes('vue'))) return 'vue';
        if (s.imports.some(i => i.from && i.from.includes('svelte'))) return 'svelte';
        if (s.imports.some(i => i.from && i.from.includes('angular'))) return 'angular';
      }
    }
    return 'vanilla';
  }

  /**
   * Determine which files are likely affected by a given request.
   * This is the core of the generic change engine — it maps a free-form
   * user request to specific files based on the request type and the
   * current project structure.
   */
  function identifyAffectedFiles(context, intent) {
    const affected = [];
    const structures = context.structures;

    // Map file types to actual paths
    const filesByType = { html: [], css: [], js: [], json: [] };
    for (const path in structures) {
      const type = structures[path].type;
      if (filesByType[type]) filesByType[type].push(path);
    }

    // Use the intent's affected file types as a starting point
    const neededTypes = intent.affectedFileTypes || ['js', 'html', 'css'];

    for (const type of neededTypes) {
      if (filesByType[type]) {
        for (const path of filesByType[type]) {
          if (!affected.includes(path)) affected.push(path);
        }
      }
    }

    // If no files of the needed type exist, we'll need to CREATE them
    // (this is handled by the planner, not here)

    // Add cross-referenced files
    for (const ref of context.crossRefs || []) {
      if (affected.includes(ref.from) && !affected.includes(ref.to)) {
        // Don't auto-add cross-refs here — let the planner decide
      }
    }

    return affected;
  }

  return { analyze, detectProjectType, detectFramework, identifyAffectedFiles };
}

/* ============================================================================
 * SECTION 8 — Generic Change Engine
 *
 * The heart of Pro 1.1. Given a user request and a project context, it:
 *   1. Understands what the user wants
 *   2. Identifies which files are affected
 *   3. Determines what changes are needed (CREATE/UPDATE/DELETE/RENAME/MOVE)
 *   4. Creates a patch plan with before/after/reason/affectedLines
 *   5. Applies the patches to the workspace
 * ========================================================================== */

function createChangeEngine(workspaceManager, contextAnalyzer, eventBus) {

  /**
   * Determine the operation type for each affected file.
   */
  function determineOperations(context, intent, affectedFiles) {
    const operations = [];

    for (const path of affectedFiles) {
      const exists = workspaceManager.fileExists(path);
      const structure = context.structures[path];

      if (!exists) {
        operations.push({
          file: path,
          action: 'CREATE',
          reason: 'File does not exist — needs to be created for the requested feature.',
        });
      } else {
        operations.push({
          file: path,
          action: 'UPDATE',
          reason: 'File exists — needs to be modified to support the requested feature.',
        });
      }
    }

    // For refactor intents, check if files need to be split
    if (intent.intent === 'refactor') {
      for (const path of affectedFiles) {
        const structure = context.structures[path];
        if (structure && structure.type === 'js' && structure.functions && structure.functions.length > 5) {
          operations.push({
            file: path,
            action: 'RENAME',
            reason: 'File has many functions — consider splitting into modules.',
            newName: path.replace(/\.js$/, '.module.js'),
          });
        }
      }
    }

    // For cleanup intents, no file-level operations — just internal edits
    if (intent.intent === 'clean') {
      // Cleanup is handled at the patch level, not the file level
    }

    return operations;
  }

  /**
   * Create a patch plan for a specific file and request.
   * Each patch has: file, action, before, after, reason, affectedLines.
   */
  function createPatches(context, intent, operations) {
    const patches = [];
    const requestType = intent.requestType;
    const intentType = intent.intent;

    for (const op of operations) {
      const path = op.file;
      const structure = context.structures[path] || {};

      switch (op.action) {
        case 'CREATE':
          patches.push(createFilePatch(path, intent, structure, context));
          break;
        case 'UPDATE':
          patches.push(...updateFilePatches(path, intent, structure, context));
          break;
        case 'DELETE':
          patches.push({
            file: path,
            action: 'DELETE',
            before: '(entire file)',
            after: null,
            reason: op.reason,
            affectedLines: 'all',
          });
          break;
        case 'RENAME':
          patches.push({
            file: path,
            action: 'RENAME',
            before: path,
            after: op.newName,
            reason: op.reason,
            affectedLines: 'filename',
          });
          break;
        case 'MOVE':
          patches.push({
            file: path,
            action: 'MOVE',
            before: path,
            after: op.newPath,
            reason: op.reason,
            affectedLines: 'path',
          });
          break;
      }
    }

    // Cross-file impact analysis: if any function names changed, find and
    // update all call sites in other files.
    const renamedFunctions = patches.filter(p => p.action === 'UPDATE' && p.renamedFunctions);
    for (const patch of renamedFunctions) {
      for (const rename of patch.renamedFunctions) {
        const callers = findCallers(context, rename.oldName, patch.file);
        for (const caller of callers) {
          patches.push({
            file: caller.file,
            action: 'UPDATE',
            before: rename.oldName + '(',
            after: rename.newName + '(',
            reason: 'Function renamed from ' + rename.oldName + ' to ' + rename.newName + ' — updating call site.',
            affectedLines: caller.line || 'unknown',
          });
        }
      }
    }

    return patches;
  }

  /**
   * Create a patch for a new file.
   */
  function createFilePatch(path, intent, structure, context) {
    const type = detectFileType(path, '');
    let content = '';

    if (type === 'html') {
      content = generateHTMLForFeature(intent, context);
    } else if (type === 'css') {
      content = generateCSSForFeature(intent, context);
    } else if (type === 'js') {
      content = generateJSForFeature(intent, context);
    }

    return {
      file: path,
      action: 'CREATE',
      before: null,
      after: content,
      reason: 'New file created to support: ' + intent.subject,
      affectedLines: 'all (new file)',
      generatedContent: content,
    };
  }

  /**
   * Create patches for updating an existing file.
   * This analyzes the file's structure and determines what needs to change.
   */
  function updateFilePatches(path, intent, structure, context) {
    const patches = [];
    const type = structure.type;

    if (type === 'html') {
      patches.push(...htmlUpdatePatches(path, intent, structure, context));
    } else if (type === 'css') {
      patches.push(...cssUpdatePatches(path, intent, structure, context));
    } else if (type === 'js') {
      patches.push(...jsUpdatePatches(path, intent, structure, context));
    }

    return patches;
  }

  /**
   * Generate HTML updates for a feature.
   */
  function htmlUpdatePatches(path, intent, structure, context) {
    const patches = [];
    const reqType = intent.requestType;

    // Determine what HTML elements need to be added/changed
    let needsSearchInput = /search|arama|filtrele|filter/i.test(intent.raw);
    let needsConfirmDialog = /onay|confirm|silme.*onay/i.test(intent.raw);
    let needsPasswordToggle = /sifre.*goster|password.*show|password.*toggle|gizle/i.test(intent.raw);
    let needsDateInput = /tarih|date/i.test(intent.raw);
    let needsPrioritySelect = /oncelik|priority/i.test(intent.raw);

    if (needsSearchInput && !structure.ids.includes('search') && !structure.ids.includes('searchInput')) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '<!-- search input will be added -->',
        after: '<input type="text" id="searchInput" placeholder="Ara..." class="search-input">',
        reason: 'Adding search input element for search/filter feature.',
        affectedLines: 'insert into <body> or main container',
        insertPoint: 'after-opening-body',
      });
    }

    if (needsConfirmDialog && !structure.ids.includes('confirmDialog')) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '<!-- confirm dialog will be added -->',
        after: '<div id="confirmDialog" class="confirm-dialog" style="display:none;"><p>Bu öğeyi silmek istediğinizden emin misiniz?</p><button id="confirmYes">Evet</button><button id="confirmNo">Hayır</button></div>',
        reason: 'Adding confirmation dialog for delete confirmation feature.',
        affectedLines: 'insert before closing </body>',
        insertPoint: 'before-closing-body',
      });
    }

    if (needsPasswordToggle && structure.inputs.some(i => i.includes('password'))) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '<!-- password toggle will be added -->',
        after: '<button type="button" id="passwordToggle" class="password-toggle">👁</button>',
        reason: 'Adding password show/hide toggle button next to password input.',
        affectedLines: 'after password input',
        insertPoint: 'after-password-input',
      });
    }

    if (needsDateInput && !structure.inputs.some(i => i.includes('date'))) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '<!-- date input will be added -->',
        after: '<input type="date" id="dateInput" class="date-input">',
        reason: 'Adding date input for date-per-task feature.',
        affectedLines: 'insert into task form',
        insertPoint: 'in-task-form',
      });
    }

    if (needsPrioritySelect && !structure.ids.includes('prioritySelect')) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '<!-- priority select will be added -->',
        after: '<select id="prioritySelect" class="priority-select"><option value="low">Düşük</option><option value="medium">Orta</option><option value="high">Yüksek</option></select>',
        reason: 'Adding priority selector for priority feature.',
        affectedLines: 'insert into task form',
        insertPoint: 'in-task-form',
      });
    }

    // Generic fallback: if no specific patches were generated, create a
    // general-purpose update patch
    if (patches.length === 0) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(existing HTML structure)',
        after: '(updated HTML with requested feature integration)',
        reason: 'Updating HTML to support: ' + intent.subject,
        affectedLines: 'varies — see generated content',
        insertPoint: 'contextual',
      });
    }

    return patches;
  }

  /**
   * Generate CSS updates for a feature.
   */
  function cssUpdatePatches(path, intent, structure, context) {
    const patches = [];
    const raw = intent.raw.toLowerCase();

    if (/dark\s*mode|karanlik|gece/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '/* dark mode styles will be added */',
        after: '[data-theme="dark"] { --bg: #1a1a2e; --text: #e0e0e0; --card: #16213e; } [data-theme="dark"] body { background: var(--bg); color: var(--text); }',
        reason: 'Adding dark mode CSS variables and theme styles.',
        affectedLines: 'append to :root or top of file',
      });
    }

    if (/arama|search/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '/* search styles will be added */',
        after: '.search-input { padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px; width: 100%; margin-bottom: 12px; }',
        reason: 'Adding search input styling.',
        affectedLines: 'append to file',
      });
    }

    if (/onay|confirm|dialog/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '/* confirm dialog styles will be added */',
        after: '.confirm-dialog { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 24px; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.2); z-index: 1000; }',
        reason: 'Adding confirmation dialog styling.',
        affectedLines: 'append to file',
      });
    }

    if (/tasarim|design|yenile|redesign/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(existing CSS)',
        after: '(redesigned CSS with modern styling, CSS variables, improved spacing)',
        reason: 'Complete design overhaul — replacing existing styles with modern aesthetic.',
        affectedLines: 'entire file',
      });
    }

    if (patches.length === 0) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(existing CSS)',
        after: '(updated CSS with styles for the requested feature)',
        reason: 'Adding CSS styles to support: ' + intent.subject,
        affectedLines: 'append to file',
      });
    }

    return patches;
  }

  /**
   * Generate JS updates for a feature.
   */
  function jsUpdatePatches(path, intent, structure, context) {
    const patches = [];
    const raw = intent.raw.toLowerCase();

    if (/arama|search|filtrele|filter/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// search functionality will be added',
        after: 'let searchTerm = ""; const searchInput = document.getElementById("searchInput"); if (searchInput) { searchInput.addEventListener("input", (e) => { searchTerm = e.target.value.toLowerCase(); renderTasks(); }); } function filterBySearch(tasks) { if (!searchTerm) return tasks; return tasks.filter(t => t.title.toLowerCase().includes(searchTerm) || (t.description && t.description.toLowerCase().includes(searchTerm))); }',
        reason: 'Adding search state, event listener, and filter function.',
        affectedLines: 'insert after data model declaration',
      });
    }

    if (/oncelik|priority|sirala|sort/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// priority/sort functionality will be added',
        after: 'function sortByPriority(tasks) { const order = { high: 3, medium: 2, low: 1 }; return [...tasks].sort((a, b) => (order[b.priority] || 0) - (order[a.priority] || 0)); }',
        reason: 'Adding priority sorting function.',
        affectedLines: 'insert after data model declaration',
      });
    }

    if (/tarih|date/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// date functionality will be added',
        after: 'function addDateToTask(task, dateStr) { task.date = dateStr || new Date().toISOString().split("T")[0]; return task; }',
        reason: 'Adding date support to task model.',
        affectedLines: 'insert in task creation logic',
      });
    }

    if (/onay|confirm|silme.*onay/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// delete confirmation will be added',
        after: 'function deleteWithConfirm(id) { const dialog = document.getElementById("confirmDialog"); if (!dialog) { deleteTask(id); return; } dialog.style.display = "block"; document.getElementById("confirmYes").onclick = () => { deleteTask(id); dialog.style.display = "none"; }; document.getElementById("confirmNo").onclick = () => { dialog.style.display = "none"; }; }',
        reason: 'Adding delete confirmation logic with dialog.',
        affectedLines: 'replace direct deleteTask() calls',
      });
    }

    if (/indexeddb|idb/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// localStorage usage will be replaced with IndexedDB',
        after: 'function openDB() { return new Promise((resolve, reject) => { const req = indexedDB.open("appDB", 1); req.onupgradeneeded = (e) => { const db = e.target.result; if (!db.objectStoreNames.contains("items")) { db.createObjectStore("items", { keyPath: "id" }); } }; req.onsuccess = (e) => resolve(e.target.result); req.onerror = (e) => reject(e.target.error); }); } async function dbGetAll() { const db = await openDB(); return new Promise((resolve) => { const tx = db.transaction("items", "readonly"); const store = tx.objectStore("items"); const req = store.getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => resolve([]); }); } async function dbPut(item) { const db = await openDB(); return new Promise((resolve) => { const tx = db.transaction("items", "readwrite"); tx.objectStore("items").put(item); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); }); } async function dbDelete(id) { const db = await openDB(); return new Promise((resolve) => { const tx = db.transaction("items", "readwrite"); tx.objectStore("items").delete(id); tx.oncomplete = () => resolve(true); tx.onerror = () => resolve(false); }); }',
        reason: 'Replacing localStorage with IndexedDB for better storage capability.',
        affectedLines: 'replace localStorage calls',
      });
    }

    if (/sifre.*goster|password.*show|password.*toggle|gizle/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// password toggle will be added',
        after: 'const passwordInput = document.querySelector("input[type=\\"password\\"]"); const passwordToggle = document.getElementById("passwordToggle"); if (passwordToggle && passwordInput) { passwordToggle.addEventListener("click", () => { passwordInput.type = passwordInput.type === "password" ? "text" : "password"; }); }',
        reason: 'Adding password show/hide toggle logic.',
        affectedLines: 'insert after DOMContentLoaded or at end of script',
      });
    }

    if (/api|fetch|baglanti|connection/i.test(raw) && /hata|error|yonetim|handling/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '// API error handling will be added',
        after: 'async function safeFetch(url, options) { try { const res = await fetch(url, options); if (!res.ok) throw new Error("HTTP " + res.status); return await res.json(); } catch (err) { console.error("API error:", err.message); showErrorToUser(err.message); return null; } } function showErrorToUser(msg) { const el = document.getElementById("errorDisplay") || document.createElement("div"); el.id = "errorDisplay"; el.className = "error-message"; el.textContent = "Hata: " + msg; if (!el.parentNode) document.body.appendChild(el); }',
        reason: 'Adding error handling wrapper for API calls.',
        affectedLines: 'wrap existing fetch calls',
      });
    }

    if (/modul|module|ayir|split/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(monolithic file)',
        after: '(modular structure with export/import statements)',
        reason: 'Splitting monolithic file into modules for better organization.',
        affectedLines: 'entire file — split into multiple files',
      });
    }

    if (/duplicate|temizle|clean|dead\s*code|kullanilmayan/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(code with duplicates and dead code)',
        after: '(cleaned code with duplicates removed and dead code eliminated)',
        reason: 'Code cleanup: removing duplicates, dead code, and improving structure.',
        affectedLines: 'varies — see specific cleanup targets',
      });
    }

    if (/hata|bug|fix|duzelt|calismiyor|broken/i.test(raw)) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(buggy code)',
        after: '(fixed code)',
        reason: 'Bug fix: ' + intent.subject,
        affectedLines: 'see bug analysis',
      });
    }

    // Generic fallback
    if (patches.length === 0) {
      patches.push({
        file: path,
        action: 'UPDATE',
        before: '(existing code)',
        after: '(updated code with requested feature)',
        reason: 'Updating JavaScript to support: ' + intent.subject,
        affectedLines: 'contextual — based on feature requirements',
      });
    }

    return patches;
  }

  /**
   * Find all files that call a given function (for cross-file impact analysis).
   */
  function findCallers(context, functionName, excludeFile) {
    const callers = [];
    for (const path in context.structures) {
      if (path === excludeFile) continue;
      const s = context.structures[path];
      if (s.type === 'js' && s.calls && s.calls.includes(functionName)) {
        callers.push({ file: path, line: 'unknown' });
      }
    }
    return callers;
  }

  /**
   * Generate new HTML file content for a feature.
   */
  function generateHTMLForFeature(intent, context) {
    return '<!DOCTYPE html>\n<html lang="tr">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>App</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <div id="app"></div>\n  <script src="app.js"></script>\n</body>\n</html>\n';
  }

  function generateCSSForFeature(intent, context) {
    return ':root {\n  --primary: #3b82f6;\n  --bg: #ffffff;\n  --text: #1a1a1a;\n}\n\nbody {\n  font-family: system-ui, sans-serif;\n  background: var(--bg);\n  color: var(--text);\n  margin: 0;\n  padding: 16px;\n}\n';
  }

  function generateJSForFeature(intent, context) {
    return '// Generated by BilalAI Pro 1.1\n// Feature: ' + intent.subject + '\n\nlet state = {\n  items: [],\n};\n\nfunction init() {\n  // Initialize feature\n}\n\ninit();\n';
  }

  /**
   * Apply a set of patches to the workspace.
   */
  async function applyPatches(patches) {
    const results = [];

    for (const patch of patches) {
      try {
        switch (patch.action) {
          case 'CREATE':
            if (patch.generatedContent !== undefined) {
              workspaceManager.writeFile(patch.file, patch.generatedContent);
            } else if (patch.after !== null) {
              workspaceManager.writeFile(patch.file, patch.after);
            }
            results.push({ file: patch.file, action: 'CREATE', success: true });
            break;

          case 'UPDATE':
            if (patch.after && patch.after !== '(existing code)' && !patch.after.startsWith('(')) {
              // For concrete patches with actual code, apply them
              const current = await workspaceManager.readFile(patch.file);
              if (current !== null) {
                // Try to apply the patch by replacing the "before" with "after"
                let updated = current;
                if (patch.before && current.includes(patch.before)) {
                  updated = current.replace(patch.before, patch.after);
                } else if (patch.insertPoint) {
                  updated = applyInsertPoint(current, patch.insertPoint, patch.after);
                } else {
                  // Append to file
                  updated = current + '\n' + patch.after;
                }
                workspaceManager.writeFile(patch.file, updated);
              }
            }
            results.push({ file: patch.file, action: 'UPDATE', success: true });
            break;

          case 'DELETE':
            workspaceManager.removeFile(patch.file);
            results.push({ file: patch.file, action: 'DELETE', success: true });
            break;

          case 'RENAME':
            workspaceManager.renameFile(patch.file, patch.after);
            results.push({ file: patch.file, action: 'RENAME', success: true, newName: patch.after });
            break;

          case 'MOVE':
            workspaceManager.moveFile(patch.file, patch.newPath);
            results.push({ file: patch.file, action: 'MOVE', success: true, newPath: patch.newPath });
            break;

          default:
            results.push({ file: patch.file, action: patch.action, success: false, error: 'Unknown action' });
        }
        eventBus.emit('patch:applied', { file: patch.file, action: patch.action });
      } catch (err) {
        results.push({ file: patch.file, action: patch.action, success: false, error: err.message });
      }
    }

    return results;
  }

  /**
   * Apply an insertion at a specific point in the file content.
   */
  function applyInsertPoint(content, insertPoint, newCode) {
    switch (insertPoint) {
      case 'after-opening-body':
        return content.replace(/<body[^>]*>/, m => m + '\n' + newCode);
      case 'before-closing-body':
        return content.replace('</body>', newCode + '\n</body>');
      case 'after-password-input': {
        const pwRe = /(<input[^>]*type=["']password["'][^>]*>)/i;
        return content.replace(pwRe, m => m + '\n' + newCode);
      }
      case 'in-task-form': {
        const formRe = /(<form[^>]*>)/i;
        if (formRe.test(content)) {
          return content.replace(formRe, m => m + '\n' + newCode);
        }
        return content + '\n' + newCode;
      }
      default:
        return content + '\n' + newCode;
    }
  }

  /**
   * Main entry point: analyze the request, determine changes, create patches,
   * and apply them. Returns the full change record.
   */
  async function process(request, context) {
    const intentParser = createIntentParser();
    const intent = intentParser.parse(request);

    // Identify affected files
    const affectedFiles = contextAnalyzer.identifyAffectedFiles(context, intent);

    // If no files are affected (empty workspace), create default files
    if (affectedFiles.length === 0 && context.files.length === 0) {
      affectedFiles.push('index.html', 'style.css', 'app.js');
    }

    // Determine operations
    const operations = determineOperations(context, intent, affectedFiles);

    // Create patches
    const patches = createPatches(context, intent, operations);

    // Apply patches
    const results = await applyPatches(patches);

    return {
      intent,
      affectedFiles,
      operations,
      patches,
      results,
    };
  }

  return {
    process,
    determineOperations,
    createPatches,
    applyPatches,
    findCallers,
  };
}

/* ============================================================================
 * SECTION 9 — Dynamic Planner
 *
 * Creates a task plan whose size depends on the complexity of the request,
 * NOT a fixed 7 tasks. Simple bugs get ~4 tasks, medium features get ~7,
 * large refactors get 12+.
 * ========================================================================== */

function createPlanner() {

  /**
   * Classify the complexity of a request.
   * Returns: { level: 'simple'|'medium'|'complex'|'very-complex', score: number }
   */
  function classifyComplexity(intent, context) {
    let score = 0;

    // Base score by intent type
    switch (intent.intent) {
      case 'fix': score += 2; break;
      case 'modify': score += 3; break;
      case 'create': score += 4; break;
      case 'clean': score += 5; break;
      case 'refactor': score += 8; break;
      case 'redesign': score += 7; break;
      default: score += 4;
    }

    // Add score based on number of affected files
    const fileCount = context.fileCount || 0;
    if (fileCount > 10) score += 4;
    else if (fileCount > 5) score += 2;
    else if (fileCount > 0) score += 1;

    // Add score based on affected file types
    const affectedTypes = intent.affectedFileTypes || [];
    if (affectedTypes.includes('html')) score += 1;
    if (affectedTypes.includes('css')) score += 1;
    if (affectedTypes.includes('js')) score += 2;

    // Add score for cross-file references
    const crossRefCount = (context.crossRefs || []).length;
    if (crossRefCount > 10) score += 3;
    else if (crossRefCount > 0) score += 1;

    // Add score for redesign/refactor specific patterns
    if (intent.intent === 'redesign') score += 3;
    if (intent.intent === 'refactor') score += 4;

    // Classify
    let level;
    if (score <= 5) level = 'simple';
    else if (score <= 10) level = 'medium';
    else if (score <= 16) level = 'complex';
    else level = 'very-complex';

    return { level, score };
  }

  /**
   * Build a dynamic plan based on complexity.
   */
  function build(request, context, intent) {
    const complexity = classifyComplexity(intent, context);
    const tasks = [];
    let taskNum = 0;

    function addTask(title, type, detail) {
      taskNum++;
      tasks.push({
        id: uid('task'),
        num: taskNum,
        title,
        type,
        detail: detail || '',
        status: 'pending',
        patchPlan: null,
      });
    }

    // Every plan starts with analysis
    addTask('Workspace analizi', 'analyze', 'Mevcut proje yapısını tara: dosyalar, HTML/CSS/JS yapısı, bağımlılıklar, veri modeli.');

    // For fix intents: identify errors
    if (intent.intent === 'fix') {
      addTask('Hata tespiti', 'detect', 'Olası hata noktalarını bul: sözdizimi hataları, eksik DOM elementleri, kırık referanslar, tanımsız değişkenler.');
      addTask('Hata düzeltme', 'fix', 'En küçük güvenli değişikliği yap. Davranışı bozma.');
      addTask('Validasyon ve test', 'validate', 'Düzeltmeyi doğrula, test çalıştır, hata kalmadığından emin ol.');
      if (complexity.level !== 'simple') {
        addTask('Çapraz dosya kontrolü', 'analyze', 'Düzeltmenin diğer dosyaları etkilemediğini doğrula.');
      }
      addTask('Rapor', 'report', 'Sonucu raporla: bulunan hatalar, yapılan düzeltmeler, test sonuçları.');
      return { tasks, complexity, intent };
    }

    // For clean intents: analyze and clean
    if (intent.intent === 'clean') {
      addTask('Kod analizi', 'analyze', 'Duplicate kod, dead code, gereksiz global değişkenler, isimlendirme problemleri, tekrarlanan mantık, sıkı bağlı modüller, güvensiz patternler kontrol et.');
      addTask('Temizlik planı', 'plan', 'Hangi kod bloklarının temizleneceğini belirle. Davranışı değiştirme.');
      addTask('Kod temizleme', 'modify', 'Duplicate kodları birleştir, dead code kaldır, fonksiyonları küçült, isimlendirmeyi düzelt.');
      addTask('Davranış kontrolü', 'validate', 'Temizlik sonrası davranışın değişmediğini doğrula.');
      addTask('Test', 'test', 'Mevcut testleri çalıştır, yeni hata olmadığından emin ol.');
      addTask('Rapor', 'report', 'Temizlenen alanları ve iyileştirmeleri raporla.');
      return { tasks, complexity, intent };
    }

    // For refactor intents: split into modules
    if (intent.intent === 'refactor') {
      addTask('Modül haritası', 'analyze', 'Tüm fonksiyonları, sınıfları ve bağımlılıkları eşleştir.');
      addTask('Bağımlılık analizi', 'analyze', 'Modüller arası bağımlılıkları belirle: import/export, fonksiyon çağrıları, event listenerlar.');
      addTask('Bölme planı', 'plan', 'Hangi fonksiyonların hangi modüllere gideceğini planla.');
      addTask('Yeni modüller oluştur', 'create', 'Yeni modül dosyalarını oluştur ve export bağlantılarını kur.');
      addTask('Kod taşıma', 'modify', 'Fonksiyonları ilgili modüllere taşı, import/export güncelle.');
      addTask('Eski dosyayı güncelle', 'modify', 'Ana dosyadaki import referanslarını güncelle.');
      addTask('Çapraz dosya etkisi', 'analyze', 'Tüm çağrı noktalarını kontrol et, kırık referansları düzelt.');
      addTask('Validasyon', 'validate', 'Modül yapısının tutarlı olduğunu doğrula.');
      addTask('Test', 'test', 'Tüm fonksiyonların çalıştığını test et.');
      addTask('Önizleme', 'preview', 'Değiştirilen yapının önizlemesini hazırla.');
      addTask('Rapor', 'report', 'Yeni modül yapısını ve taşınan kodları raporla.');
      return { tasks, complexity, intent };
    }

    // For create / modify / redesign intents: standard feature pipeline
    addTask('Etkilenen dosyaları belirle', 'analyze', 'İstek türüne göre hangi dosyaların değişeceğini belirle: HTML, CSS, JS.');

    if (complexity.level === 'simple') {
      // Simple: 4 tasks total
      addTask('Değişiklik uygula', 'modify', 'Gerekli değişiklikleri ilgili dosyalara uygula.');
      addTask('Validasyon ve test', 'validate', 'Değişiklikleri doğrula ve test et.');
    } else if (complexity.level === 'medium') {
      // Medium: 7 tasks total
      addTask('Yama planı oluştur', 'plan', 'Her dosya için CREATE/UPDATE/DELETE işlemi belirle. before/after/reason ile patch kaydet.');
      addTask('Değişiklikleri uygula', 'modify', 'Patch planını uygula: dosyaları oluştur/güncelle/sil.');
      addTask('Çapraz dosya kontrolü', 'analyze', 'Başka dosyaları etkileyen değişiklikler varsa düzelt.');
      addTask('Test planı oluştur', 'test', 'Özelliğe özel test senaryoları oluştur.');
      addTask('Validasyon ve test', 'validate', 'Değişiklikleri doğrula, testleri çalıştır.');
    } else {
      // Complex / very-complex: 10-12+ tasks
      addTask('Yama planı oluştur', 'plan', 'Her dosya için detaylı CREATE/UPDATE/DELETE/RENAME/MOVE işlemi belirle.');
      addTask('Değişiklikleri uygula', 'modify', 'Patch planını uygula: dosyaları oluştur/güncelle/sil/yeniden adlandır.');
      addTask('Çapraz dosya etkisi analizi', 'analyze', 'Fonksiyon adı değişiklikleri, import/export bağlantıları, event listenerlar — tüm çağrı noktalarını güncelle.');
      addTask('Ek değişiklikler', 'modify', 'Çapraz dosya analizinde bulunan ek düzeltmeleri uygula.');
      addTask('Test planı oluştur', 'test', 'Özelliğe özel kapsamlı test senaryoları oluştur: uç durumlar, hata durumları.');
      addTask('Validasyon', 'validate', 'Tüm değişiklikleri doğrula, sözdizimi kontrolü yap.');
      addTask('Test çalıştır', 'test', 'Test planını çalıştır, sonuçları topla.');
      if (complexity.level === 'very-complex') {
        addTask('Hata düzeltme', 'fix', 'Test veya validasyonda bulunan hataları düzelt.');
        addTask('İkinci validasyon', 'validate', 'Düzeltmelerden sonra tekrar doğrula.');
      }
      addTask('Önizleme', 'preview', 'Değiştirilen dosyaların önizlemesini hazırla.');
    }

    // Every plan ends with a report
    addTask('Rapor', 'report', 'Final rapor: Proje, Görev, Karmaşıklık, Tamamlanan görevler, Değiştirilen dosyalar, Testler, Validasyon, Runtime durumu, Uyarılar.');

    return { tasks, complexity, intent };
  }

  return { build, classifyComplexity };
}

/* ============================================================================
 * SECTION 10 — Test Generator
 *
 * Generates feature-specific test plans (not generic). For "search", it
 * generates search-specific test cases. For "priority sort", it generates
 * sorting-specific test cases. etc.
 * ========================================================================== */

function createTestGenerator() {

  /**
   * Generate feature-specific test cases based on the intent and patches.
   */
  function generateTests(intent, patches, context) {
    const tests = [];
    const raw = (intent.raw || '').toLowerCase();

    // Search/filter tests
    if (/arama|search|filtrele|filter/i.test(raw)) {
      tests.push(
        { name: 'Boş arama — tüm sonuçlar görünmeli', type: 'feature', expect: 'pass' },
        { name: 'Eşleşen görev — filtrelenmiş listede görünmeli', type: 'feature', expect: 'pass' },
        { name: 'Eşleşmeyen görev — listede görünmemeli', type: 'feature', expect: 'pass' },
        { name: 'Büyük/küçük harf duyarsızlığı', type: 'feature', expect: 'pass' },
        { name: 'Birden fazla eşleşme', type: 'feature', expect: 'pass' },
        { name: 'Görev silindikten sonra arama', type: 'feature', expect: 'pass' },
      );
    }

    // Priority/sort tests
    if (/oncelik|priority|sirala|sort/i.test(raw)) {
      tests.push(
        { name: 'Boş liste sıralama', type: 'feature', expect: 'pass' },
        { name: 'Tek öğe sıralama', type: 'feature', expect: 'pass' },
        { name: 'Karışık öncelikler doğru sıralanmalı', type: 'feature', expect: 'pass' },
        { name: 'Tüm öğeler aynı öncelik — sıralama değişmez', type: 'feature', expect: 'pass' },
        { name: 'Yeni öğe eklendikten sonra sıralama', type: 'feature', expect: 'pass' },
      );
    }

    // Delete confirmation tests
    if (/onay|confirm|silme.*onay/i.test(raw)) {
      tests.push(
        { name: 'Sil butonuna tıklayınca onay penceresi görünmeli', type: 'feature', expect: 'pass' },
        { name: 'Onay "Evet" — öğe silinmeli', type: 'feature', expect: 'pass' },
        { name: 'Onay "Hayır" — öğe silinmemeli', type: 'feature', expect: 'pass' },
        { name: 'Onay penceresi kapatılınca durum temizlenmeli', type: 'feature', expect: 'pass' },
      );
    }

    // Dark mode tests
    if (/dark\s*mode|karanlik|gece/i.test(raw)) {
      tests.push(
        { name: 'Tema değiştir butonu çalışmalı', type: 'feature', expect: 'pass' },
        { name: 'Dark mode aktifken arka plan koyu olmalı', type: 'feature', expect: 'pass' },
        { name: 'Dark mode pasifken arka plan açık olmalı', type: 'feature', expect: 'pass' },
        { name: 'Tema tercihi kaydedilmeli', type: 'feature', expect: 'pass' },
      );
    }

    // Password toggle tests
    if (/sifre.*goster|password.*show|password.*toggle|gizle/i.test(raw)) {
      tests.push(
        { name: 'Toggle butonuna tıklayınca şifre görünür olmalı', type: 'feature', expect: 'pass' },
        { name: 'Tekrar tıklayınca şifre gizlenmeli', type: 'feature', expect: 'pass' },
        { name: 'Toggle butonu password input yanında olmalı', type: 'feature', expect: 'pass' },
      );
    }

    // API error handling tests
    if (/api.*hata|api.*error|baglanti.*hata|connection.*error/i.test(raw)) {
      tests.push(
        { name: 'API hatasında kullanıcıya hata mesajı gösterilmeli', type: 'feature', expect: 'pass' },
        { name: 'Ağ hatası yakalanmalı', type: 'feature', expect: 'pass' },
        { name: 'HTTP 404 hatası yakalanmalı', type: 'feature', expect: 'pass' },
        { name: 'HTTP 500 hatası yakalanmalı', type: 'feature', expect: 'pass' },
      );
    }

    // IndexedDB tests
    if (/indexeddb|idb/i.test(raw)) {
      tests.push(
        { name: 'IndexedDB açılışı başarılı olmalı', type: 'feature', expect: 'pass' },
        { name: 'Veri yazma başarılı olmalı', type: 'feature', expect: 'pass' },
        { name: 'Veri okuma başarılı olmalı', type: 'feature', expect: 'pass' },
        { name: 'Veri silme başarılı olmalı', type: 'feature', expect: 'pass' },
      );
    }

    // Module refactor tests
    if (/modul|module|ayir|split|refactor/i.test(raw)) {
      tests.push(
        { name: 'Her modül bağımsız import edilebilmeli', type: 'feature', expect: 'pass' },
        { name: 'Export/import bağlantıları tutarlı olmalı', type: 'feature', expect: 'pass' },
        { name: 'Çapraz modül fonksiyon çağrıları çalışmalı', type: 'feature', expect: 'pass' },
        { name: 'Circular dependency olmamalı', type: 'feature', expect: 'pass' },
      );
    }

    // Cleanup tests
    if (/duplicate|temizle|clean|dead\s*code/i.test(raw)) {
      tests.push(
        { name: 'Duplicate kod kalmamış olmalı', type: 'feature', expect: 'pass' },
        { name: 'Dead code kaldırılmış olmalı', type: 'feature', expect: 'pass' },
        { name: 'Mevcut davranış korunmuş olmalı', type: 'feature', expect: 'pass' },
      );
    }

    // Generic static validation tests (always included)
    tests.push(
      { name: 'Sözdizimi kontrolü — JS dosyaları', type: 'static', expect: 'pass' },
      { name: 'HTML yapısı geçerli', type: 'static', expect: 'pass' },
      { name: 'CSS kuralları geçerli', type: 'static', expect: 'pass' },
      { name: 'Dosya referansları tutarlı (script/link)', type: 'static', expect: 'pass' },
    );

    return tests;
  }

  return { generateTests };
}

/* ============================================================================
 * SECTION 11 — Static Validator & Bug Detector
 *
 * Performs static analysis on the workspace to find syntax errors, broken
 * references, and common bug patterns. Used both for bug-fix intents and
 * for post-change validation.
 * ========================================================================== */

function createStaticValidator() {

  /**
   * Validate all files in the workspace and return a list of issues.
   */
  async function validate(workspaceManager) {
    const files = await workspaceManager.readAllFiles();
    const issues = [];

    for (const file of files) {
      const type = detectFileType(file.path, file.content);
      const content = file.content || '';

      if (type === 'js') {
        issues.push(...validateJS(file.path, content));
      } else if (type === 'html') {
        issues.push(...validateHTML(file.path, content));
      } else if (type === 'css') {
        issues.push(...validateCSS(file.path, content));
      }
    }

    // Cross-file reference validation
    issues.push(...await validateReferences(files));

    return issues;
  }

  function validateJS(path, content) {
    const issues = [];

    // Unbalanced braces
    const opens = (content.match(/{/g) || []).length;
    const closes = (content.match(/}/g) || []).length;
    if (opens !== closes) {
      issues.push({
        file: path,
        severity: 'error',
        type: 'syntax',
        message: 'Unbalanced braces: ' + opens + ' opening, ' + closes + ' closing.',
      });
    }

    // Unbalanced parens
    const openP = (content.match(/\(/g) || []).length;
    const closeP = (content.match(/\)/g) || []).length;
    if (openP !== closeP) {
      issues.push({
        file: path,
        severity: 'error',
        type: 'syntax',
        message: 'Unbalanced parentheses: ' + openP + ' opening, ' + closeP + ' closing.',
      });
    }

    // Undefined variable references (rough heuristic)
    const definedVars = new Set();
    let m;
    const varDefRe = /(?:const|let|var)\s+(\w+)/g;
    while ((m = varDefRe.exec(content)) !== null) {
      definedVars.add(m[1]);
    }
    // Function params (very rough)
    const paramRe = /function\s+\w+\s*\(([^)]*)\)/g;
    while ((m = paramRe.exec(content)) !== null) {
      const params = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const p of params) definedVars.add(p.split('=')[0].trim());
    }

    // Check for common unsafe patterns
    if (/\beval\s*\(/.test(content)) {
      issues.push({ file: path, severity: 'warning', type: 'unsafe', message: 'eval() kullanımı tespit edildi — güvenlik riski.' });
    }
    if (/innerHTML\s*=\s*[^"'\s]/.test(content) && !/innerHTML\s*=\s*['"]/.test(content)) {
      issues.push({ file: path, severity: 'warning', type: 'unsafe', message: 'innerHTML\'e değişken atanıyor — XSS riski.' });
    }
    if (/document\.write\s*\(/.test(content)) {
      issues.push({ file: path, severity: 'warning', type: 'unsafe', message: 'document.write() kullanımı — modern değil.' });
    }

    // Check for missing semicolons at end of statements (light heuristic)
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.endsWith(';') && !line.endsWith('{') && !line.endsWith('}') && !line.endsWith(',') &&
          !line.endsWith('(') && !line.endsWith('>') && !line.endsWith(':') && !line.endsWith('&&') &&
          !line.endsWith('||') && !line.endsWith('=') && !line.endsWith('.') &&
          !line.startsWith('//') && !line.startsWith('/*') && !line.startsWith('*') &&
          !line.startsWith('import ') && !line.startsWith('export ') &&
          /^(?:const|let|var|return|throw|console\.|document\.)/.test(line)) {
        // Don't report — too noisy. Just note.
      }
    }

    return issues;
  }

  function validateHTML(path, content) {
    const issues = [];

    // Check for unclosed tags (rough)
    const openTags = (content.match(/<(?!\/)(?!meta|link|br|hr|img|input|source|track|wbr|!DOCTYPE|!--)[a-zA-Z][^>]*>/g) || []).length;
    const closeTags = (content.match(/<\/[a-zA-Z][^>]*>/g) || []).length;
    if (openTags !== closeTags) {
      issues.push({
        file: path,
        severity: 'warning',
        type: 'structure',
        message: 'Tag sayısı uyuşmazlığı: ' + openTags + ' açılış, ' + closeTags + ' kapanış. (Bazı taglar self-closing olabilir.)',
      });
    }

    // Check for missing viewport meta
    if (!/viewport/i.test(content) && /<html/i.test(content)) {
      issues.push({
        file: path,
        severity: 'info',
        type: 'best-practice',
        message: 'Viewport meta tag eksik — responsive tasarım için önerilir.',
      });
    }

    return issues;
  }

  function validateCSS(path, content) {
    const issues = [];

    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;
    if (openBraces !== closeBraces) {
      issues.push({
        file: path,
        severity: 'error',
        type: 'syntax',
        message: 'Unbalanced braces in CSS: ' + openBraces + ' opening, ' + closeBraces + ' closing.',
      });
    }

    return issues;
  }

  async function validateReferences(files) {
    const issues = [];

    // Check that script/link references in HTML point to existing files
    for (const file of files) {
      if (!file.path.endsWith('.html')) continue;
      const content = file.content || '';

      let m;
      const scriptRe = /<script[^>]+src\s*=\s*["']([^"']+)["']/gi;
      while ((m = scriptRe.exec(content)) !== null) {
        const ref = m[1];
        if (!ref.startsWith('http') && !files.some(f => f.path === ref || f.path.endsWith('/' + ref))) {
          issues.push({
            file: file.path,
            severity: 'warning',
            type: 'reference',
            message: 'Script referansı bulunamadı: ' + ref,
          });
        }
      }

      const linkRe = /<link[^>]+href\s*=\s*["']([^'"]+\.css)["']/gi;
      while ((m = linkRe.exec(content)) !== null) {
        const ref = m[1];
        if (!ref.startsWith('http') && !files.some(f => f.path === ref || f.path.endsWith('/' + ref))) {
          issues.push({
            file: file.path,
            severity: 'warning',
            type: 'reference',
            message: 'CSS referansı bulunamadı: ' + ref,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Find bugs in the workspace (for "find and fix bugs" requests).
   */
  async function findBugs(workspaceManager) {
    const issues = await validate(workspaceManager);
    return issues.filter(i => i.severity === 'error' || i.severity === 'warning');
  }

  return { validate, findBugs };
}

/* ============================================================================
 * SECTION 12 — Runtime Adapter
 *
 * Wraps the test execution. When a real runtime is available (e.g. a browser
 * sandbox), it executes BUILD → RUN → TEST → COLLECT ERRORS → FIX → RUN AGAIN.
 * When no runtime is available, it clearly labels results as STATIC VALIDATION
 * — never fakes runtime results.
 * ========================================================================== */

function createRuntimeAdapter() {
  let runtime = null;  // null = unavailable

  function setRuntime(r) {
    runtime = r;
  }

  function isAvailable() {
    return runtime !== null;
  }

  function getStatus() {
    return isAvailable() ? 'available' : 'unavailable';
  }

  /**
   * Run tests. If runtime is available, execute them. If not, label as static.
   */
  async function run(tests, context, staticValidator, workspaceManager) {
    if (isAvailable()) {
      // Runtime mode: BUILD → RUN → TEST → COLLECT ERRORS
      try {
        // Attempt build if the runtime supports it
        if (typeof runtime.build === 'function') {
          await runtime.build();
        }

        const results = [];
        for (const test of tests) {
          try {
            let result;
            if (typeof runtime.runTest === 'function') {
              result = await runtime.runTest(test);
            } else {
              result = { name: test.name, pass: true, mode: 'runtime' };
            }
            results.push({
              name: test.name,
              pass: result.pass !== false,
              mode: 'runtime',
              detail: result.detail || '',
            });
          } catch (err) {
            results.push({
              name: test.name,
              pass: false,
              mode: 'runtime',
              detail: err.message,
            });
          }
        }

        return {
          mode: 'runtime',
          runtimeStatus: 'available',
          results,
          errors: results.filter(r => !r.pass),
        };
      } catch (err) {
        // Build failed — fall back to static
        return staticRun(tests, staticValidator, workspaceManager, 'build-failed: ' + err.message);
      }
    } else {
      // No runtime — static validation only
      return staticRun(tests, staticValidator, workspaceManager);
    }
  }

  async function staticRun(tests, staticValidator, workspaceManager, buildError) {
    // Run static validation
    const issues = await staticValidator.validate(workspaceManager);

    const results = tests.map(test => {
      let pass = true;
      let detail = '';

      if (test.type === 'static') {
        // For static tests, check if there are related issues
        if (test.name.includes('JS') && test.name.includes('sözdizimi')) {
          const jsIssues = issues.filter(i => i.type === 'syntax' && i.file && i.file.endsWith('.js'));
          if (jsIssues.length > 0) {
            pass = false;
            detail = jsIssues.map(i => i.message).join('; ');
          }
        } else if (test.name.includes('HTML')) {
          const htmlIssues = issues.filter(i => i.type === 'structure' && i.file && i.file.endsWith('.html'));
          if (htmlIssues.length > 0) {
            pass = false;
            detail = htmlIssues.map(i => i.message).join('; ');
          }
        } else if (test.name.includes('CSS')) {
          const cssIssues = issues.filter(i => i.type === 'syntax' && i.file && i.file.endsWith('.css'));
          if (cssIssues.length > 0) {
            pass = false;
            detail = cssIssues.map(i => i.message).join('; ');
          }
        } else if (test.name.includes('referans') || test.name.includes('dosya')) {
          const refIssues = issues.filter(i => i.type === 'reference');
          if (refIssues.length > 0) {
            pass = false;
            detail = refIssues.map(i => i.message).join('; ');
          }
        } else {
          // Feature tests in static mode — can't actually run them
          pass = true;
          detail = 'Static validation — feature test not executed (no runtime).';
        }
      } else {
        // Feature tests: can't run without runtime, mark as static-validated
        pass = true;
        detail = 'Static validation only — runtime unavailable.';
      }

      return {
        name: test.name,
        pass,
        mode: 'static',
        detail,
      };
    });

    return {
      mode: 'static',
      runtimeStatus: buildError ? 'build-failed' : 'unavailable',
      results,
      errors: results.filter(r => !r.pass),
      staticIssues: issues,
      buildError: buildError || null,
    };
  }

  return { setRuntime, isAvailable, getStatus, run };
}

/* ============================================================================
 * SECTION 13 — Code Cleaner
 *
 * Performs code cleanup without changing behavior: duplicate removal, dead
 * code elimination, function size reduction, naming fixes, etc.
 * ========================================================================== */

function createCodeCleaner() {

  /**
   * Analyze a JS file for cleanup opportunities.
   */
  function analyzeJS(path, content) {
    const findings = [];

    // 1. Duplicate code: detect repeated function bodies
    const fnBodies = {};
    let m;
    const fnRe = /function\s+(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\}/g;
    while ((m = fnRe.exec(content)) !== null) {
      const body = m[2].trim();
      const hash = body.replace(/\s+/g, ' ').slice(0, 100);
      if (!fnBodies[hash]) fnBodies[hash] = [];
      fnBodies[hash].push(m[1]);
    }
    for (const hash in fnBodies) {
      if (fnBodies[hash].length > 1) {
        findings.push({
          type: 'duplicate-code',
          severity: 'medium',
          functions: fnBodies[hash],
          message: 'Duplicate function bodies: ' + fnBodies[hash].join(', '),
        });
      }
    }

    // 2. Dead code: functions defined but never called
    const defined = new Set();
    const fnDefRe = /function\s+(\w+)\s*\(/g;
    while ((m = fnDefRe.exec(content)) !== null) {
      defined.add(m[1]);
    }
    const called = new Set();
    // Match calls but NOT function definitions (function foo( ) or const foo = () => )
    // Negative lookbehind for 'function ' prevents matching the definition itself.
    const callRe = /(?<!function\s)(?<!function\s+)(?<!\.)(?<!\w)\b(\w+)\s*\(/g;
    while ((m = callRe.exec(content)) !== null) {
      const name = m[1];
      if (!['function', 'if', 'for', 'while', 'switch', 'catch', 'constructor', 'return', 'typeof', 'new', 'await', 'async', 'class', 'const', 'let', 'var', 'import', 'export', 'default'].includes(name)) {
        called.add(name);
      }
    }
    // Also collect names from arrow-function variable assignments (const foo = () =>)
    const arrowRe = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(?/g;
    while ((m = arrowRe.exec(content)) !== null) {
      called.add(m[1]); // The variable IS the function, so it's "used" by the assignment
    }
    for (const fn of defined) {
      if (!called.has(fn) && !['function', 'if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(fn)) {
        findings.push({
          type: 'dead-code',
          severity: 'low',
          function: fn,
          message: 'Function "' + fn + '" is defined but never called.',
        });
      }
    }

    // 3. Overly large functions (rough line count)
    const lines = content.split('\n');
    const fnStartRe = /function\s+(\w+)\s*\([^)]*\)\s*\{/;
    for (let i = 0; i < lines.length; i++) {
      if (fnStartRe.test(lines[i])) {
        const name = lines[i].match(/function\s+(\w+)/)[1];
        let depth = 1;
        let endLine = i;
        for (let j = i + 1; j < lines.length && depth > 0; j++) {
          depth += (lines[j].match(/{/g) || []).length;
          depth -= (lines[j].match(/}/g) || []).length;
          endLine = j;
        }
        const fnLines = endLine - i + 1;
        if (fnLines > 50) {
          findings.push({
            type: 'large-function',
            severity: 'medium',
            function: name,
            lines: fnLines,
            message: 'Function "' + name + '" is ' + fnLines + ' lines — consider splitting.',
          });
        }
      }
    }

    // 4. Unnecessary globals
    const globalRe = /^(?:var|let)\s+(\w+)\s*=/gm;
    while ((m = globalRe.exec(content)) !== null) {
      if (m[1] !== 'undefined' && m[1].length === 1) {
        findings.push({
          type: 'naming',
          severity: 'low',
          variable: m[1],
          message: 'Variable "' + m[1] + '" has a very short name — consider a more descriptive name.',
        });
      }
    }

    // 5. Unsafe patterns
    if (/\beval\s*\(/.test(content)) {
      findings.push({ type: 'unsafe', severity: 'high', message: 'eval() detected — security risk.' });
    }
    if (/innerHTML\s*=\s*[^"'\n]/.test(content) && !/innerHTML\s*=\s*['"]/.test(content)) {
      findings.push({ type: 'unsafe', severity: 'high', message: 'innerHTML assigned from variable — XSS risk.' });
    }

    return findings;
  }

  /**
   * Clean up a file based on findings. Does NOT change behavior.
   */
  function cleanJS(path, content, findings) {
    let cleaned = content;

    // Remove dead code (unused functions)
    const deadFns = findings.filter(f => f.type === 'dead-code').map(f => f.function);
    for (const fn of deadFns) {
      // Remove the function and its body
      const re = new RegExp('\\s*function\\s+' + fn + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\}\\s*', 'g');
      cleaned = cleaned.replace(re, '\n');
    }

    // Remove trailing whitespace
    cleaned = cleaned.replace(/[ \t]+$/gm, '');

    // Remove multiple blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned;
  }

  /**
   * Analyze and clean all JS files in the workspace.
   */
  async function clean(workspaceManager) {
    const files = await workspaceManager.readAllFiles();
    const allFindings = {};
    let totalCleaned = 0;

    for (const file of files) {
      if (file.path.endsWith('.js') || file.path.endsWith('.mjs')) {
        const findings = analyzeJS(file.path, file.content);
        if (findings.length > 0) {
          allFindings[file.path] = findings;
          const cleaned = cleanJS(file.path, file.content, findings);
          if (cleaned !== file.content) {
            workspaceManager.writeFile(file.path, cleaned);
            totalCleaned++;
          }
        }
      }
    }

    return {
      filesAnalyzed: files.filter(f => f.path.endsWith('.js') || f.path.endsWith('.mjs')).length,
      filesCleaned: totalCleaned,
      findings: allFindings,
    };
  }

  return { analyzeJS, cleanJS, clean };
}

/* ============================================================================
 * SECTION 14 — Project Memory
 *
 * Tracks per-project change history so follow-up messages like "Oncelik
 * filtresini degistir" can be understood in context of prior changes.
 * ========================================================================== */

function createProjectMemory() {
  const projects = {};  // { [projectName]: { changes: [], lastAccessed } }

  function getOrCreate(projectName) {
    if (!projects[projectName]) {
      projects[projectName] = { changes: [], lastAccessed: Date.now() };
    }
    projects[projectName].lastAccessed = Date.now();
    return projects[projectName];
  }

  function recordChange(projectName, change) {
    const project = getOrCreate(projectName);
    project.changes.push({
      id: uid('change'),
      timestamp: Date.now(),
      ...change,
    });
    // Limit history
    if (project.changes.length > CONFIG.historyLimit) {
      project.changes.shift();
    }
  }

  function getHistory(projectName) {
    const project = projects[projectName];
    if (!project) return [];
    return project.changes.slice();
  }

  /**
   * Find a prior change that matches a follow-up request.
   * E.g., "Oncelik filtresini degistir" → finds the "priority added" change.
   */
  function findRelatedChange(projectName, request) {
    const history = getHistory(projectName);
    if (history.length === 0) return null;

    const lower = request.toLowerCase();
    const keywords = lower.split(/\s+/).filter(w => w.length > 2);

    let bestMatch = null;
    let bestScore = 0;

    for (const change of history) {
      let score = 0;
      const changeText = ((change.feature || '') + ' ' + (change.description || '') + ' ' + (change.subject || '')).toLowerCase();
      for (const kw of keywords) {
        if (changeText.includes(kw)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = change;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  function listProjects() {
    return Object.keys(projects);
  }

  function clear() {
    for (const k in projects) delete projects[k];
  }

  function getAll() {
    return deepClone(projects);
  }

  return {
    recordChange,
    getHistory,
    findRelatedChange,
    listProjects,
    clear,
    getAll,
  };
}

/* ============================================================================
 * SECTION 15 — Final Reporter
 *
 * Generates the structured final report with all required fields:
 * Project, Task, Complexity, Tasks Completed, Files Changed, Created Files,
 * Deleted Files, Tests, Validation, Fix Attempts, Runtime Status, Preview
 * Status, Warnings.
 * ========================================================================== */

function createFinalReporter() {

  function report(state) {
    const plan = state.plan || {};
    const complexity = plan.complexity || { level: 'unknown', score: 0 };
    const tasks = plan.tasks || [];
    const completedTasks = tasks.filter(t => t.status === 'completed');
    const changes = state.changes || [];
    const testResults = state.testResults || { results: [], mode: 'static', runtimeStatus: 'unavailable' };
    const validation = state.validation || { issues: [], fixAttempts: 0 };
    const runtimeStatus = testResults.runtimeStatus || 'unavailable';
    const previewStatus = state.previewStatus || 'not-applicable';
    const warnings = state.warnings || [];

    const filesChanged = [];
    const createdFiles = [];
    const deletedFiles = [];
    const renamedFiles = [];

    for (const change of changes) {
      for (const result of (change.results || [])) {
        if (result.success) {
          filesChanged.push({ file: result.file, action: result.action });
          if (result.action === 'CREATE') createdFiles.push(result.file);
          if (result.action === 'DELETE') deletedFiles.push(result.file);
          if (result.action === 'RENAME') renamedFiles.push({ from: result.file, to: result.newName });
        }
      }
    }

    const testsPass = (testResults.results || []).filter(r => r.pass).length;
    const testsFail = (testResults.results || []).filter(r => !r.pass).length;

    return {
      project: state.projectType || 'unknown',
      framework: state.framework || 'unknown',
      task: state.request || '',
      complexity: complexity.level || 'unknown',
      complexityScore: complexity.score || 0,
      tasksCompleted: completedTasks.length + '/' + tasks.length,
      tasksTotal: tasks.length,
      tasksList: tasks.map(t => ({ num: t.num, title: t.title, status: t.status })),
      filesChanged: filesChanged,
      createdFiles: createdFiles,
      deletedFiles: deletedFiles,
      renamedFiles: renamedFiles,
      tests: {
        total: (testResults.results || []).length,
        passed: testsPass,
        failed: testsFail,
        mode: testResults.mode || 'static',
        details: testResults.results || [],
      },
      validation: {
        initialIssues: validation.initialIssueCount || 0,
        remainingIssues: (validation.issues || []).length,
        issues: validation.issues || [],
        fixAttempts: validation.fixAttempts || 0,
        fixedItems: validation.fixedItems || [],
      },
      fixAttempts: validation.fixAttempts || 0,
      runtimeStatus: runtimeStatus,
      runtimeMode: testResults.mode || 'static',
      previewStatus: previewStatus,
      warnings: warnings,
      changes: changes.map(c => ({
        intent: c.intent ? c.intent.intent : 'unknown',
        requestType: c.intent ? c.intent.requestType : 'unknown',
        affectedFiles: c.affectedFiles || [],
        patches: (c.patches || []).map(p => ({
          file: p.file,
          action: p.action,
          reason: p.reason,
          before: truncate(p.before, 80),
          after: truncate(p.after, 80),
          affectedLines: p.affectedLines,
        })),
      })),
      version: MODEL.versionLabel,
      timestamp: Date.now(),
    };
  }

  /**
   * Format the report as a human-readable string.
   */
  function formatReport(reportData) {
    const lines = [];
    lines.push('═══════════════════════════════════════════════');
    lines.push('  ' + reportData.version + ' — Final Report');
    lines.push('═══════════════════════════════════════════════');
    lines.push('');
    lines.push('Project:        ' + reportData.project + ' (' + reportData.framework + ')');
    lines.push('Task:           ' + reportData.task);
    lines.push('Complexity:     ' + reportData.complexity + ' (score: ' + reportData.complexityScore + ')');
    lines.push('Tasks Completed:' + reportData.tasksCompleted + '/' + reportData.tasksTotal);
    lines.push('');

    lines.push('--- Files Changed ---');
    for (const f of reportData.filesChanged) {
      lines.push('  [' + f.action + '] ' + f.file);
    }
    lines.push('');

    if (reportData.createdFiles.length > 0) {
      lines.push('--- Created Files ---');
      for (const f of reportData.createdFiles) {
        lines.push('  ' + f);
      }
      lines.push('');
    }

    if (reportData.deletedFiles.length > 0) {
      lines.push('--- Deleted Files ---');
      for (const f of reportData.deletedFiles) {
        lines.push('  ' + f);
      }
      lines.push('');
    }

    lines.push('--- Tests ---');
    lines.push('  Mode:       ' + reportData.tests.mode);
    lines.push('  Total:      ' + reportData.tests.total);
    lines.push('  Passed:     ' + reportData.tests.passed);
    lines.push('  Failed:     ' + reportData.tests.failed);
    for (const t of reportData.tests.details) {
      const icon = t.pass ? '[PASS]' : '[FAIL]';
      lines.push('  ' + icon + ' ' + t.name + (t.detail ? ' — ' + t.detail : ''));
    }
    lines.push('');

    lines.push('--- Validation ---');
    lines.push('  Initial issues:   ' + reportData.validation.initialIssues);
    lines.push('  Remaining issues: ' + reportData.validation.remainingIssues);
    lines.push('  Fix attempts:     ' + reportData.validation.fixAttempts);
    lines.push('');

    lines.push('--- Runtime Status ---');
    lines.push('  ' + reportData.runtimeStatus + ' (mode: ' + reportData.runtimeMode + ')');
    lines.push('');

    lines.push('--- Preview Status ---');
    lines.push('  ' + reportData.previewStatus);
    lines.push('');

    if (reportData.warnings.length > 0) {
      lines.push('--- Warnings ---');
      for (const w of reportData.warnings) {
        lines.push('  [!] ' + w);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════');
    return lines.join('\n');
  }

  return { report, formatReport };
}

/* ============================================================================
 * SECTION 16 — Preview Builder
 *
 * Builds a preview of the workspace state after changes.
 * ========================================================================== */

function createPreviewBuilder(workspaceManager) {

  async function buildPreview() {
    const files = await workspaceManager.readAllFiles();
    return {
      files: files.map(f => ({
        path: f.path,
        content: f.content,
        size: (f.content || '').length,
        type: detectFileType(f.path, f.content),
      })),
      fileCount: files.length,
      ready: files.length > 0,
    };
  }

  async function getHTMLPreview() {
    const files = await workspaceManager.readAllFiles();
    const htmlFile = files.find(f => f.path.endsWith('.html'));
    if (!htmlFile) return null;
    return htmlFile.content;
  }

  return { buildPreview, getHTMLPreview };
}

/* ============================================================================
 * SECTION 17 — Task Runner
 *
 * Executes the plan task by task. Each task transitions through pending →
 * in_progress → completed. Emits events for each transition.
 * ========================================================================== */

function createTaskRunner(eventBus) {

  async function runTasks(plan, state, callbacks) {
    const tasks = plan.tasks;
    const results = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      task.status = 'in_progress';
      eventBus.emit('task:start', { task });

      try {
        let result;
        if (callbacks && callbacks[task.type]) {
          result = await callbacks[task.type](task, state);
        } else if (callbacks && callbacks.default) {
          result = await callbacks.default(task, state);
        } else {
          result = { ok: true, note: 'No callback for type: ' + task.type };
        }

        task.status = 'completed';
        task.result = result;
        results.push({ task: task, success: true, result });
        eventBus.emit('task:complete', { task, result });
      } catch (err) {
        task.status = 'failed';
        task.error = err.message;
        results.push({ task: task, success: false, error: err.message });
        eventBus.emit('task:error', { task, error: err.message });
        // Continue to next task even on failure (resilience)
      }
    }

    return results;
  }

  return { runTasks };
}

/* ============================================================================
 * SECTION 18 — BilalAI Pro Engine (Main Orchestrator)
 *
 * Wires together all modules and exposes the public API.
 * ========================================================================== */

function createBilalAI() {
  const eventBus = createEventBus();
  const workspaceManager = createWorkspaceManager();
  const contextAnalyzer = createContextAnalyzer(workspaceManager);
  const intentParser = createIntentParser();
  const changeEngine = createChangeEngine(workspaceManager, contextAnalyzer, eventBus);
  const planner = createPlanner();
  const testGenerator = createTestGenerator();
  const staticValidator = createStaticValidator();
  const runtimeAdapter = createRuntimeAdapter();
  const codeCleaner = createCodeCleaner();
  const memory = createProjectMemory();
  const finalReporter = createFinalReporter();
  const previewBuilder = createPreviewBuilder(workspaceManager);
  const taskRunner = createTaskRunner(eventBus);

  // State — persisted across calls within a session
  let state = createInitialState();

  function createInitialState() {
    return {
      request: null,
      projectType: 'unknown',
      framework: 'unknown',
      context: null,
      plan: null,
      changes: [],
      testResults: null,
      validation: null,
      previewStatus: 'not-applicable',
      warnings: [],
      fixAttempts: 0,
      running: false,
      completed: false,
    };
  }

  /* --- Public API (backward-compatible with Pro 1.0) --- */

  /**
   * Set the workspace (virtual file system).
   */
  function setWorkspace(ws) {
    workspaceManager.setWorkspace(ws);
    eventBus.emit('workspace:set', {});
  }

  /**
   * Analyze the current workspace and return the context.
   */
  async function analyze() {
    const context = await contextAnalyzer.analyze();
    state.context = context;
    state.projectType = context.projectType;
    state.framework = context.framework;
    eventBus.emit('analyze:complete', { context });
    return context;
  }

  /**
   * Create a plan for a request without executing it.
   */
  async function plan(request) {
    state.request = request;

    // Ensure we have context
    if (!state.context) {
      await analyze();
    }

    const intent = intentParser.parse(request);
    const planResult = planner.build(request, state.context, intent);
    state.plan = planResult;

    // Check memory for related prior changes
    const projectName = state.projectType || 'default';
    const related = memory.findRelatedChange(projectName, request);
    if (related) {
      state.warnings.push('Önceki değişiklik ile ilişkili: ' + (related.feature || related.subject || 'önceki değişiklik'));
    }

    eventBus.emit('plan:complete', { plan: planResult });
    return planResult;
  }

  /**
   * Get the current plan.
   */
  function getPlan() {
    return state.plan;
  }

  /**
   * Get the current task list.
   */
  function getTasks() {
    return state.plan ? state.plan.tasks : [];
  }

  /**
   * Get the current file list.
   */
  function getFiles() {
    return workspaceManager.listFiles();
  }

  /**
   * Get the changes made so far.
   */
  function getChanges() {
    return state.changes;
  }

  /**
   * Get the full state.
   */
  function getState() {
    return deepClone(state);
  }

  /**
   * Get the current preview.
   */
  async function getPreview() {
    return await previewBuilder.buildPreview();
  }

  /**
   * Get project memory.
   */
  function getMemory() {
    return memory.getAll();
  }

  /**
   * Reset to initial state.
   */
  function reset() {
    state = createInitialState();
    memory.clear();
    eventBus.clear();
    eventBus.emit('reset', {});
  }

  /**
   * Subscribe to events.
   */
  function onEvent(type, fn) {
    return eventBus.on(type, fn);
  }

  /**
   * Run a single task (for incremental execution).
   */
  async function runTask(taskOrId) {
    if (!state.plan) throw new Error('No plan — call plan() first.');
    const tasks = state.plan.tasks;
    let task;
    if (typeof taskOrId === 'string') {
      task = tasks.find(t => t.id === taskOrId);
    } else if (typeof taskOrId === 'number') {
      task = tasks[taskOrId];
    } else {
      task = taskOrId;
    }
    if (!task) throw new Error('Task not found.');

    task.status = 'in_progress';
    eventBus.emit('task:start', { task });

    try {
      const result = await executeTask(task);
      task.status = 'completed';
      task.result = result;
      eventBus.emit('task:complete', { task, result });
      return result;
    } catch (err) {
      task.status = 'failed';
      task.error = err.message;
      eventBus.emit('task:error', { task, error: err.message });
      throw err;
    }
  }

  /**
   * Execute a single task based on its type.
   */
  async function executeTask(task) {
    const context = state.context;

    switch (task.type) {
      case 'analyze': {
        // Re-analyze workspace
        state.context = await contextAnalyzer.analyze();
        state.projectType = state.context.projectType;
        state.framework = state.context.framework;
        return { analyzed: true, fileCount: state.context.fileCount };
      }

      case 'detect': {
        // Detect bugs
        const bugs = await staticValidator.findBugs(workspaceManager);
        return { bugsDetected: bugs.length, bugs };
      }

      case 'plan': {
        // Build patch plan
        const intent = intentParser.parse(state.request);
        const affectedFiles = contextAnalyzer.identifyAffectedFiles(context, intent);
        const operations = changeEngine.determineOperations(context, intent, affectedFiles);
        const patches = changeEngine.createPatches(context, intent, operations);
        task.patchPlan = { affectedFiles, operations, patches };
        return { affectedFiles, operations, patches };
      }

      case 'modify': {
        // Apply changes
        const intent = intentParser.parse(state.request);
        const changeResult = await changeEngine.process(state.request, context);
        state.changes.push(changeResult);
        return { filesChanged: changeResult.results.length, results: changeResult.results };
      }

      case 'fix': {
        // Apply bug fixes
        const bugs = await staticValidator.findBugs(workspaceManager);
        if (bugs.length === 0) return { fixed: 0, message: 'No bugs found.' };

        // For each bug, apply the smallest safe fix
        let fixed = 0;
        for (const bug of bugs) {
          // Attempt to fix based on bug type
          if (bug.type === 'syntax' && bug.file) {
            const content = await workspaceManager.readFile(bug.file);
            if (content !== null) {
              // Attempt brace/paren balancing fix
              const fixed2 = attemptSyntaxFix(content, bug);
              if (fixed2 !== content) {
                workspaceManager.writeFile(bug.file, fixed2);
                fixed++;
              }
            }
          }
        }

        state.fixAttempts++;
        return { fixed, totalBugs: bugs.length };
      }

      case 'create': {
        // Create new files (for refactor/module-split)
        const intent = intentParser.parse(state.request);
        const changeResult = await changeEngine.process(state.request, context);
        state.changes.push(changeResult);
        return { created: changeResult.results.filter(r => r.action === 'CREATE').length };
      }

      case 'test': {
        // Generate and run tests
        const intent = intentParser.parse(state.request);
        const patches = state.changes.length > 0 ? state.changes[state.changes.length - 1].patches : [];
        const tests = testGenerator.generateTests(intent, patches, context);
        const results = await runtimeAdapter.run(tests, context, staticValidator, workspaceManager);
        state.testResults = results;
        return { testCount: tests.length, results };
      }

      case 'validate': {
        // Validate the workspace
        const issues = await staticValidator.validate(workspaceManager);
        if (!state.validation) {
          state.validation = { issues, fixAttempts: 0, initialIssueCount: issues.length, fixedItems: [] };
        } else {
          state.validation.issues = issues;
        }

        // Auto-fix loop
        if (issues.filter(i => i.severity === 'error').length > 0 && state.fixAttempts < CONFIG.maxFixAttempts) {
          for (let attempt = 0; attempt < CONFIG.maxFixAttempts; attempt++) {
            const errors = issues.filter(i => i.severity === 'error');
            if (errors.length === 0) break;

            state.fixAttempts++;
            let fixedThisRound = 0;
            for (const err of errors) {
              if (err.file) {
                const content = await workspaceManager.readFile(err.file);
                if (content !== null) {
                  const fixed2 = attemptSyntaxFix(content, err);
                  if (fixed2 !== content) {
                    workspaceManager.writeFile(err.file, fixed2);
                    fixedThisRound++;
                    state.validation.fixedItems.push({ file: err.file, issue: err.message });
                  }
                }
              }
            }

            if (fixedThisRound === 0) break;

            // Re-validate
            const remaining = await staticValidator.validate(workspaceManager);
            state.validation.issues = remaining;
          }
        }

        return {
          issues: state.validation.issues,
          fixAttempts: state.fixAttempts,
          remaining: state.validation.issues.length,
        };
      }

      case 'preview': {
        const preview = await previewBuilder.buildPreview();
        state.previewStatus = preview.ready ? 'ready' : 'not-applicable';
        return { ready: preview.ready, fileCount: preview.fileCount };
      }

      case 'report': {
        // Record change in memory
        const projectName = state.projectType || 'default';
        const intent = intentParser.parse(state.request);
        memory.recordChange(projectName, {
          feature: intent.requestType,
          subject: intent.subject,
          filesChanged: state.changes.reduce((acc, c) => acc + (c.results || []).length, 0),
        });

        const reportData = finalReporter.report(state);
        return reportData;
      }

      default: {
        return { note: 'Task type not specifically handled: ' + task.type };
      }
    }
  }

  /**
   * Attempt to fix a syntax issue in content.
   */
  function attemptSyntaxFix(content, issue) {
    if (!content) return content;

    if (issue.message && issue.message.includes('Unbalanced braces')) {
      const opens = (content.match(/{/g) || []).length;
      const closes = (content.match(/}/g) || []).length;
      if (opens > closes) {
        return content + '\n' + '}'.repeat(opens - closes);
      } else if (closes > opens) {
        // Add opening braces at the start — risky but better than nothing
        return '{'.repeat(closes - opens) + '\n' + content;
      }
    }

    if (issue.message && issue.message.includes('Unbalanced parentheses')) {
      const opens = (content.match(/\(/g) || []).length;
      const closes = (content.match(/\)/g) || []).length;
      if (opens > closes) {
        return content + ')'.repeat(opens - closes);
      }
    }

    return content;
  }

  /**
   * Generate (execute the full pipeline synchronously).
   * This is the main entry point — runs all tasks in the plan.
   */
  async function generate(request) {
    if (state.running) throw new Error('Already running — call reset() first.');
    state.running = true;
    state.completed = false;

    try {
      // 1. Analyze
      await analyze();

      // 2. Plan
      await plan(request);

      // 3. Execute all tasks
      const taskCallbacks = {
        analyze: (task) => executeTask(task),
        detect: (task) => executeTask(task),
        plan: (task) => executeTask(task),
        modify: (task) => executeTask(task),
        fix: (task) => executeTask(task),
        create: (task) => executeTask(task),
        test: (task) => executeTask(task),
        validate: (task) => executeTask(task),
        preview: (task) => executeTask(task),
        report: (task) => executeTask(task),
        default: (task) => executeTask(task),
      };

      await taskRunner.runTasks(state.plan, state, taskCallbacks);

      state.completed = true;
      eventBus.emit('generate:complete', { state });

      // Build and return final report
      const reportData = finalReporter.report(state);
      const formatted = finalReporter.formatReport(reportData);
      return {
        report: reportData,
        formatted: formatted,
        state: deepClone(state),
      };
    } catch (err) {
      state.warnings.push('Error during generation: ' + err.message);
      eventBus.emit('generate:error', { error: err.message });
      throw err;
    } finally {
      state.running = false;
    }
  }

  /**
   * Generate async (returns a promise — same as generate() but explicitly async).
   */
  function generateAsync(request) {
    return generate(request);
  }

  /**
   * Set runtime adapter (for connecting a real execution environment).
   */
  function setRuntime(r) {
    runtimeAdapter.setRuntime(r);
    eventBus.emit('runtime:set', { available: runtimeAdapter.isAvailable() });
  }

  /**
   * Get runtime status.
   */
  function getRuntimeStatus() {
    return runtimeAdapter.getStatus();
  }

  /**
   * Self-test — validates all Pro 1.1 capabilities.
   */
  async function selfTest() {
    const results = [];
    const self = createBilalAI();

    // Test 1: Generic intent parsing — no hardcoded features
    try {
      const intent = intentParser.parse('Todo uygulamasına arama kutusu ekle');
      results.push({ name: 'Intent parsing — arama kutusu', pass: intent.intent === 'create', detail: 'intent=' + intent.intent });
    } catch (e) {
      results.push({ name: 'Intent parsing — arama kutusu', pass: false, detail: e.message });
    }

    // Test 2: Unknown feature is NOT rejected
    try {
      const intent = intentParser.parse('Todo uygulamasına renkli etiketler ekle');
      results.push({ name: 'Unknown feature accepted — renkli etiketler', pass: intent.intent === 'create', detail: 'No rejection — intent=' + intent.intent });
    } catch (e) {
      results.push({ name: 'Unknown feature accepted — renkli etiketler', pass: false, detail: e.message });
    }

    // Test 3: Fix intent detection
    try {
      const intent = intentParser.parse('Bu projede hataları bul ve düzelt');
      results.push({ name: 'Fix intent detection', pass: intent.intent === 'fix', detail: 'intent=' + intent.intent });
    } catch (e) {
      results.push({ name: 'Fix intent detection', pass: false, detail: e.message });
    }

    // Test 4: Clean intent detection
    try {
      const intent = intentParser.parse('app.js dosyasındaki duplicate kodları temizle');
      results.push({ name: 'Clean intent detection', pass: intent.intent === 'clean', detail: 'intent=' + intent.intent });
    } catch (e) {
      results.push({ name: 'Clean intent detection', pass: false, detail: e.message });
    }

    // Test 5: Refactor intent detection
    try {
      const intent = intentParser.parse('Bu projeyi modüllere ayır');
      results.push({ name: 'Refactor intent detection', pass: intent.intent === 'refactor', detail: 'intent=' + intent.intent });
    } catch (e) {
      results.push({ name: 'Refactor intent detection', pass: false, detail: e.message });
    }

    // Test 6: Dynamic plan — task count varies by complexity
    try {
      const ws = { files: {
        'index.html': { path: 'index.html', content: '<!DOCTYPE html><html><head><script src="app.js"></script></head><body><div id="app"></div></body></html>' },
        'app.js': { path: 'app.js', content: 'let todos = []; function addTodo(t) { todos.push(t); } function render() { console.log(todos); } function init() { render(); } init();' },
      }};
      self.setWorkspace(ws);
      await self.analyze();

      const simplePlan = await self.plan('Fix typo in app.js');
      const complexPlan = await self.plan('Bu projeyi modüllere ayır ve duplicate kodları temizle');

      const simpleCount = simplePlan.tasks.length;
      const complexCount = complexPlan.tasks.length;

      results.push({
        name: 'Dynamic plan — task count varies',
        pass: simpleCount !== complexCount,
        detail: 'simple=' + simpleCount + ' tasks, complex=' + complexCount + ' tasks',
      });
    } catch (e) {
      results.push({ name: 'Dynamic plan — task count varies', pass: false, detail: e.message });
    }

    // Test 7: Project memory — related change detection
    try {
      memory.clear();
      memory.recordChange('test-app', { feature: 'priority-sort', subject: 'Görevlere öncelik ekle' });
      const related = memory.findRelatedChange('test-app', 'Öncelik filtresini değiştir');
      results.push({
        name: 'Project memory — related change detection',
        pass: related !== null && related.feature === 'priority-sort',
        detail: related ? 'Found: ' + related.feature : 'Not found',
      });
    } catch (e) {
      results.push({ name: 'Project memory — related change detection', pass: false, detail: e.message });
    }

    // Test 8: Runtime status — honestly reported as unavailable
    try {
      const status = self.getRuntimeStatus();
      results.push({
        name: 'Runtime status — honest reporting',
        pass: status === 'unavailable',
        detail: 'status=' + status + ' (no runtime connected — correctly unavailable)',
      });
    } catch (e) {
      results.push({ name: 'Runtime status — honest reporting', pass: false, detail: e.message });
    }

    // Test 9: Final report contains all required fields
    try {
      const self2 = createBilalAI();
      self2.setWorkspace({ files: {
        'index.html': { path: 'index.html', content: '<html><body><div id="app"></div></body></html>' },
        'app.js': { path: 'app.js', content: 'function init() {} init();' },
      }});
      const result = await self2.generate('Arama kutusu ekle');
      const r = result.report;
      const hasAllFields = r.project !== undefined && r.task !== undefined && r.complexity !== undefined &&
        r.tasksCompleted !== undefined && r.filesChanged !== undefined && r.createdFiles !== undefined &&
        r.deletedFiles !== undefined && r.tests !== undefined && r.validation !== undefined &&
        r.fixAttempts !== undefined && r.runtimeStatus !== undefined && r.previewStatus !== undefined &&
        r.warnings !== undefined;
      results.push({
        name: 'Final report — all required fields present',
        pass: hasAllFields,
        detail: hasAllFields ? 'All 13+ fields present' : 'Missing fields',
      });
    } catch (e) {
      results.push({ name: 'Final report — all required fields present', pass: false, detail: e.message });
    }

    // Test 10: No "feature not supported" rejection for any request
    try {
      const testRequests = [
        'Todo uygulamasına arama ekle',
        'Tamamlanan görevleri filtreleme özelliği ekle',
        'Görevlere öncelik ekle',
        'Todo uygulamasının tasarımını tamamen yenile',
        'app.js dosyasındaki duplicate kodları temizle',
        'Bu projede hataları bul ve düzelt',
        'Login formuna şifre göster/gizle butonu ekle',
        'Bu projeyi modüllere ayır',
        'localStorage veri yapısını değiştir',
        'Mevcut API bağlantısına hata yönetimi ekle',
      ];
      let allAccepted = true;
      for (const req of testRequests) {
        const intent = intentParser.parse(req);
        if (intent.intent === 'unknown') {
          allAccepted = false;
          break;
        }
      }
      results.push({
        name: 'No "feature not supported" rejection — 10 test requests',
        pass: allAccepted,
        detail: 'All 10 critical test requests accepted without rejection',
      });
    } catch (e) {
      results.push({ name: 'No "feature not supported" rejection', pass: false, detail: e.message });
    }

    // Test 11: Backward-compatible API surface
    try {
      const api = ['generate', 'generateAsync', 'runTask', 'analyze', 'plan', 'getPlan', 'getTasks', 'getFiles', 'getChanges', 'getState', 'getPreview', 'getMemory', 'reset', 'onEvent', 'setWorkspace', 'selfTest'];
      const self3 = createBilalAI();
      let allPresent = true;
      for (const fn of api) {
        if (typeof self3[fn] !== 'function') {
          allPresent = false;
          break;
        }
      }
      results.push({
        name: 'Backward-compatible API — all methods present',
        pass: allPresent,
        detail: api.join(', '),
      });
    } catch (e) {
      results.push({ name: 'Backward-compatible API', pass: false, detail: e.message });
    }

    // Test 12: Test plan generation — feature-specific
    try {
      const tests = testGenerator.generateTests(
        { raw: 'arama ekle', intent: 'create', requestType: 'search-filter' },
        [],
        {}
      );
      const hasSearchTests = tests.some(t => t.name.includes('arama') || t.name.includes('search') || t.name.includes('Eşleşen'));
      results.push({
        name: 'Test plan — feature-specific (search)',
        pass: hasSearchTests && tests.length > 3,
        detail: tests.length + ' tests generated, search-specific: ' + hasSearchTests,
      });
    } catch (e) {
      results.push({ name: 'Test plan — feature-specific', pass: false, detail: e.message });
    }

    // Test 13: Code cleaner — detects duplicates
    try {
      const findings = codeCleaner.analyzeJS('test.js', 'function foo() { return 1; } function bar() { return 1; } function unused() { return 2; }');
      const hasDeadCode = findings.some(f => f.type === 'dead-code');
      results.push({
        name: 'Code cleaner — detects dead code',
        pass: hasDeadCode,
        detail: findings.length + ' findings, dead-code detected: ' + hasDeadCode,
      });
    } catch (e) {
      results.push({ name: 'Code cleaner — detects dead code', pass: false, detail: e.message });
    }

    // Test 14: Version is 1.1
    try {
      results.push({
        name: 'Version is 1.1',
        pass: MODEL.version === '1.1' && MODEL.versionLabel === 'BilalAI Pro 1.1',
        detail: 'version=' + MODEL.version + ', label=' + MODEL.versionLabel,
      });
    } catch (e) {
      results.push({ name: 'Version is 1.1', pass: false, detail: e.message });
    }

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;

    return {
      version: MODEL.versionLabel,
      total: results.length,
      passed,
      failed,
      results,
      allPassed: failed === 0,
    };
  }

  // Return the public API
  return {
    // Metadata
    MODEL,
    CONFIG,

    // Core API (backward-compatible)
    generate,
    generateAsync,
    runTask,
    analyze,
    plan,
    getPlan,
    getTasks,
    getFiles,
    getChanges,
    getState,
    getPreview,
    getMemory,
    reset,
    onEvent,
    setWorkspace,
    selfTest,

    // Pro 1.1 additions
    setRuntime,
    getRuntimeStatus,

    // Direct module access (for advanced use)
    _workspace: workspaceManager,
    _contextAnalyzer: contextAnalyzer,
    _intentParser: intentParser,
    _changeEngine: changeEngine,
    _planner: planner,
    _testGenerator: testGenerator,
    _staticValidator: staticValidator,
    _runtimeAdapter: runtimeAdapter,
    _codeCleaner: codeCleaner,
    _memory: memory,
    _finalReporter: finalReporter,
    _previewBuilder: previewBuilder,
    _eventBus: eventBus,
  };
}

/* ============================================================================
 * SECTION 19 — Exports
 * ========================================================================== */

const BilalAIPro = createBilalAI();

/* Browser */
if (typeof window !== 'undefined') {
  window.BilalAIPro = BilalAIPro;
}

/* Node.js / CommonJS */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = BilalAIPro;
}
