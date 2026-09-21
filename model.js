/* ==========================================================
   model.js | BilalAI 1.0 - Flash Yanıt Motoru

   Kullanım:
     BilalAIResponseEngine.generate(userMsg, contextArray)

   contextArray:
     [{ role: 'user'|'assistant', content: string }]

   Bu dosya tarayıcıda window.BilalAIResponseEngine, Node.js'te
   module.exports üzerinden kullanılabilir.
   ========================================================== */

(function () {
  'use strict';

  const MODEL_NAME = 'BilalAI - Flash 1.1';
  const MODEL_ICON = '⚡';
  const BUILD_VERSION = '2026-09-21-r2';

  const INTENTS = Object.freeze({
    WHAT: 'WHAT',
    HOW: 'HOW',
    WHY: 'WHY',
    WHO: 'WHO',
    WHEN: 'WHEN',
    WHERE: 'WHERE',
    HOW_MANY: 'HOW_MANY'
  });

  const CODE_LANGUAGES = Object.freeze([
    'python', 'javascript', 'java', 'go', 'rust',
    'htmlcss', 'react', 'sql', 'git', 'flutter'
  ]);

  function rand(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function textOf(value) {
    return typeof value === 'string' ? value : String(value || '');
  }

  function norm(value) {
    return textOf(value)
      .toLocaleLowerCase('tr-TR')
      .replace(/[.,;:!?'"“”‘’[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeForMatch(value) {
    return norm(value)
      .replace(/ı/g, 'i')
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c');
  }

  function escapeRegExp(value) {
    return textOf(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function hasAny(value, keywords) {
    const source = norm(value);
    return keywords.some((keyword) => {
      const k = norm(keyword);
      if (!k) return false;
      return new RegExp(`(?:^|\\s)${escapeRegExp(k)}(?=\\s|$)`, 'u').test(source);
    });
  }

  function hasPhrase(value, phrase) {
    return hasAny(value, [phrase]);
  }

  function capitalize(value) {
    const s = textOf(value).trim();
    return s ? s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1) : s;
  }

  function truncate(value, length) {
    const s = textOf(value).trim();
    return s.length > length ? `${s.slice(0, length)}…` : s;
  }

  function escapeInline(value) {
    return textOf(value).replace(/[`\\]/g, '\\$&');
  }

  /*
   * Soru işareti tek başına intent belirlemez. Önce daha anlamlı
   * kalıplar değerlendirilir; WHAT yalnızca en son soru türüdür.
   */
  function detectQuestionType(text) {
    const t = norm(text);

    if (hasAny(t, [
      'kim', 'kimdir', 'kim yaptı', 'kim geliştirdi', 'kim yazdı',
      'kimin', 'yazarı', 'sahibi', 'mucidi', 'kurucusu', 'üreten kişi'
    ])) return INTENTS.WHO;

    if (hasAny(t, [
      'ne zaman', 'hangi tarihte', 'hangi yıl', 'kaç yılında',
      'tarihi nedir', 'doğum tarihi', 'ne sıklıkla'
    ])) return INTENTS.WHEN;

    if (hasAny(t, [
      'nerede', 'nereden', 'nereye', 'hangi yerde', 'konumu',
      'konum', 'adres', 'hangi sitede', 'linki'
    ])) return INTENTS.WHERE;

    if (hasAny(t, [
      'kaç', 'kaç tane', 'kaç adet', 'ne kadar', 'kaç kişi',
      'kaç yaşında', 'kaç sayıdır', 'kaç sayi'
    ])) return INTENTS.HOW_MANY;

    if (hasAny(t, [
      'neden', 'niye', 'niçin', 'sebebi', 'sebep ne',
      'amacı ne', 'niye çalışmıyor', 'neden çalışmıyor'
    ])) return INTENTS.WHY;

    if (hasAny(t, [
      'nasıl', 'nasıl yapılır', 'nasıl kullanılır', 'nasıl çalışır',
      'ne yapmalıyım', 'hangi adımlarla', 'adım adım', 'yol tarifi'
    ])) return INTENTS.HOW;

    if (hasAny(t, [
      'nedir', 'ne demek', 'ne anlama gelir', 'ne işe yarar',
      'ne oluyor', 'neleri kapsar', 'hakkında bilgi'
    ])) return INTENTS.WHAT;

    // Soru işareti tek başına WHAT değildir.
    return null;
  }

  /*
   * Kod dili geçiyor diye her mesaj kod isteği değildir.
   * "Python nedir?", "React nedir?" ve "Python nasıl kullanılır?"
   * bilgi akışında kalır; üretim fiili/şablonu açıkça varsa kod akışına girer.
   */
  function isCodeGenerationRequest(text) {
    const t = norm(text);
    if (!t) return false;

    const informationOnly = hasAny(t, [
      'nedir', 'ne demek', 'ne anlama gelir', 'nasıl kullanılır',
      'hakkında bilgi', 'ne işe yarar'
    ]);
    const explicitCode = hasAny(t, [
      'kod yaz', 'kodunu yaz', 'örnek kod', 'kod örneği', 'script yaz',
      'fonksiyon yaz', 'program yaz', 'bana kod', 'algoritma yaz',
      'uygulama oluştur', 'proje oluştur', 'component oluştur',
      'bileşen oluştur', 'sorgu yaz', 'sayfa oluştur', 'giriş ekranı yap'
    ]);
    const buildPattern = /\b(ile|kullanarak|üzerinde)\b.*\b(yap|yapmak|oluştur|oluşturmak|geliştir|geliştirmek|yaz|yazmak|kur|kurmak)\b/u.test(t);
    const directBuild = hasAny(t, [
      'uygulama yap', 'proje yap', 'oyun yap', 'bot yap',
      'hesap makinesi yap', 'giriş sayfası yap', 'login sayfası yap',
      'login ekranı yap', 'todo listesi yap', 'kodla'
    ]);

    if (explicitCode || directBuild || buildPattern) return true;
    return !informationOnly && hasAny(t, ['kod', 'script', 'fonksiyon', 'algoritma']);
  }

  /* ============== GÜVENLİ MATEMATİK PARSERİ ============== */

  function tokenizeMath(expression) {
    const source = textOf(expression)
      .replace(/,/g, '.')
      .replace(/[x×]/gi, '*')
      .replace(/÷/g, '/')
      .replace(/\s+/g, '');

    const tokens = [];
    let i = 0;
    while (i < source.length) {
      const char = source[i];
      if (/[0-9.]/.test(char)) {
        const start = i;
        let dots = 0;
        while (i < source.length && /[0-9.]/.test(source[i])) {
          if (source[i] === '.') dots += 1;
          i += 1;
        }
        const raw = source.slice(start, i);
        if (dots > 1 || raw === '.') return null;
        tokens.push({ type: 'number', value: Number(raw) });
        continue;
      }
      if ('+-*/()'.includes(char)) {
        tokens.push({ type: char, value: char });
        i += 1;
        continue;
      }
      return null;
    }
    return tokens.length ? tokens : null;
  }

  function parseMathExpression(expression) {
    const tokens = tokenizeMath(expression);
    if (!tokens) return null;
    let position = 0;

    function peek() {
      return tokens[position];
    }

    function consume(type) {
      if (peek() && peek().type === type) {
        position += 1;
        return true;
      }
      return false;
    }

    function primary() {
      if (consume('+')) return primary();
      if (consume('-')) {
        const value = primary();
        return value === null ? null : -value;
      }
      if (consume('(')) {
        const value = addition();
        if (value === null || !consume(')')) return null;
        return value;
      }
      if (peek()?.type === 'number') {
        const value = peek().value;
        position += 1;
        return value;
      }
      return null;
    }

    function multiplication() {
      let value = primary();
      if (value === null) return null;
      while (peek()?.type === '*' || peek()?.type === '/') {
        const operator = peek().type;
        position += 1;
        const right = primary();
        if (right === null || (operator === '/' && right === 0)) return null;
        value = operator === '*' ? value * right : value / right;
        if (!Number.isFinite(value)) return null;
      }
      return value;
    }

    function addition() {
      let value = multiplication();
      if (value === null) return null;
      while (peek()?.type === '+' || peek()?.type === '-') {
        const operator = peek().type;
        position += 1;
        const right = multiplication();
        if (right === null) return null;
        value = operator === '+' ? value + right : value - right;
        if (!Number.isFinite(value)) return null;
      }
      return value;
    }

    const result = addition();
    return position === tokens.length && Number.isFinite(result) ? result : null;
  }

  function extractMathExpression(text) {
    const source = textOf(text).replace(/,/g, '.');
    const candidates = source.match(/[0-9.\s()+\-*x×÷/]+/gi) || [];

    for (const candidate of candidates) {
      const compact = candidate.replace(/\s+/g, '').trim();
      if (!compact || !/[+\-*x×÷/]/i.test(compact)) continue;
      if (!/\d/.test(compact)) continue;
      if (parseMathExpression(compact) !== null) return compact;
    }
    return null;
  }

  function tryCalculate(text) {
    const expression = extractMathExpression(text);
    if (!expression) return null;
    const result = parseMathExpression(expression);
    if (result === null) return null;

    const prettyExpression = expression
      .replace(/\*/g, ' × ')
      .replace(/\//g, ' ÷ ')
      .replace(/\+/g, ' + ')
      .replace(/-/g, ' - ')
      .replace(/\s+/g, ' ')
      .trim();

    return `İşlem sonucu:\n**${prettyExpression} = ${Number(result.toFixed(10))}** 🧮`;
  }

  /* ============== BAĞLAM ============== */

  function extractTopic(message) {
    let value = textOf(message).trim();
    value = value
      .replace(/^(merhaba|selam|hey|hi|hello)\s+/i, '')
      .replace(/\?+\s*$/g, '')
      .replace(/^(nedir|ne demek|nasıl|neden|niye|niçin|kim|kaç|ne zaman|nerede)\s+/i, '')
      .replace(/\s+(nedir|ne demek|nasıl|neden|niye|niçin)\s*$/i, '')
      .trim();
    return value.length >= 2 ? truncate(value, 180) : '';
  }

  function isSubstantiveUserMessage(message) {
    const t = norm(message);
    if (!t || t.length < 4) return false;
    if (isBinaryReply(t) || isAlternativeRequest(t) || isNegativeFeedback(t)) return false;
    return ![
      'peki', 'tamam', 'evet', 'hayır', 'anlamadım', 'devam',
      'devam et', 'nasıl', 'neden', 'kısaca', 'özetle'
    ].includes(t);
  }

  function isContextualFollowUp(message) {
    const t = norm(message);
    return t === 'nasıl' ||
      t === 'neden' ||
      t === 'peki' ||
      t === 'anlamadım' ||
      t === 'devam' ||
      t === 'devam et' ||
      t === 'kısaca' ||
      t === 'özetle' ||
      /^(peki\s+)?(bunu|bunu nasıl|bu|şu|o)\b/.test(t) ||
      /^(başka|farklı)\s+(bir\s+)?(örnek|yöntem|açıklama)/.test(t) ||
      /^(evet|hayır)\b/.test(t);
  }

  function resolveWithContext(userMsg, context) {
    const original = textOf(userMsg).trim();
    if (!isContextualFollowUp(original) || !Array.isArray(context)) {
      return { resolved: original, topic: null, followUp: false };
    }

    const recent = context.slice(-12).reverse();
    const previousUser = recent.find((item) =>
      item && item.role === 'user' && isSubstantiveUserMessage(item.content)
    );
    if (!previousUser) {
      return { resolved: original, topic: null, followUp: true };
    }

    const topic = extractTopic(previousUser.content);
    if (!topic) return { resolved: original, topic: null, followUp: true };
    const analysis = analyzeCodeRequest(previousUser.content);
    const state = {
      topic,
      language: analysis.language,
      technology: analysis.technology,
      task: analysis.task,
      complexity: analysis.complexity
    };

    return {
      resolved: `${original} (${topic} bağlamında)`,
      topic,
      state,
      followUp: true
    };
  }

  function detectFeedbackFromContext(context) {
    if (!Array.isArray(context) || context.length < 2) {
      return { retry: false, tone: 'normal', alternative: false };
    }

    // Yalnızca son kullanıcı mesajı önceki yanıtla ilgili feedback olabilir.
    // Daha eski bir "yanlış" mesajı yeni, bağımsız bir soruya taşınmaz.
    const lastUser = [...context].reverse().find((item) => item && item.role === 'user');
    if (!lastUser) return { retry: false, tone: 'normal', alternative: false };

    const message = norm(lastUser.content);
    if (isAlternativeRequest(message)) {
      return { retry: false, tone: 'normal', alternative: true };
    }
    if (isNegativeFeedback(message)) {
      return { retry: true, tone: 'careful', alternative: false };
    }
    if (hasAny(message, ['harika', 'süper', 'mükemmel', 'teşekkür', 'çok iyi', 'helal'])) {
      return { retry: false, tone: 'happy', alternative: false };
    }
    return { retry: false, tone: 'normal', alternative: false };
  }

  function isAlternativeRequest(message) {
    const t = norm(message);
    return hasAny(t, [
      'başka bir örnek', 'başka örnek', 'bir tane daha',
      'farklı bir yöntem', 'farklı yöntem', 'alternatif',
      'başka türlü', 'başka seçenek'
    ]);
  }

  function isNegativeFeedback(message) {
    const t = norm(message);
    return hasAny(t, [
      'yanlış cevap verdin', 'yanlış oldu', 'cevap yanlış',
      'beğenmedim', 'öyle değil', 'bu değil', 'istediğim değil',
      'hatalı', 'hiç yardımcı olmadı', 'cevabın yanlış'
    ]);
  }

  function isBinaryReply(message) {
    const t = norm(message);
    return /^(evet|hayır|hayir|tamam|olur|olmaz|istemiyorum|istiyorum)(\s*[.!])?$/.test(t) ||
      /^(evet|hayır|hayir)\s*,?\s*(istiyorum|istemiyorum)\s*[.!]?$/.test(t);
  }

  function classifyBinaryReply(message) {
    const t = norm(message);
    // "Evet, istemiyorum." gibi çelişkili cümlelerde güçlü olumsuzluk kazanır.
    if (hasAny(t, ['istemiyorum', 'hayır', 'hayir', 'olmaz'])) return 'negative';
    if (/^(evet|tamam|olur|istiyorum)/.test(t)) return 'positive';
    return null;
  }

  function decideDetailLevel(userMsg, context) {
    const text = textOf(userMsg);
    const t = norm(text);
    if (hasAny(t, [
      'adım adım', 'detaylı anlat', 'tümünü açıkla', 'kapsamlı',
      'öğret', 'sıfırdan', 'en başından'
    ]) || text.length > 140) {
      return { level: 'deep', reason: 'uzun-soru' };
    }
    if (hasAny(t, ['kısaca', 'özet', 'kısa anlat', 'hızlı cevap']) || text.length < 25) {
      return { level: 'brief', reason: 'kısa-soru' };
    }
    if (Array.isArray(context) && context.some((item) =>
      item.role === 'assistant' && textOf(item.content).length > 900
    )) {
      return { level: 'balanced', reason: 'takip-uzun' };
    }
    return { level: 'balanced', reason: 'varsayılan' };
  }

  function naturalFollowUp(detailLevel) {
    const variants = {
      brief: ['', '\n\nİstersen bir sonraki adımı da gösterebilirim.'],
      balanced: ['', '\n\nİstersen bunu bir örnekle somutlaştırabilirim.'],
      deep: ['\n\nTakıldığın bölümü söylersen onu ayrıca açabilirim.', '']
    };
    return rand(variants[detailLevel] || variants.balanced);
  }

  /* ============== KOD İSTEĞİ ANALİZİ ============== */

  function detectCodeLang(text) {
    const t = norm(text);
    if (!isCodeGenerationRequest(t)) return null;

    if (/\b(python|django|flask|pandas|numpy|pip)\b/i.test(t)) return 'python';
    if (/\b(typescript|javascript|node|nodejs|nextjs|next\.js|npm)\b/i.test(t)) return 'javascript';
    if (/\b(java|kotlin)\b/i.test(t)) return 'java';
    if (/\b(go|golang)\b/i.test(t)) return 'go';
    if (/\b(rust|cargo)\b/i.test(t)) return 'rust';
    if (/\b(flutter|dart)\b/i.test(t)) return 'flutter';

    if (hasAny(t, ['react', 'use state', 'hook', 'jsx', 'bileşen'])) return 'react';
    if (hasAny(t, ['html', 'css', 'tailwind', 'scss', 'giriş ekranı', 'login ui'])) return 'htmlcss';
    if (hasAny(t, ['sql', 'mysql', 'postgres', 'mongodb', 'veritabanı', 'database', 'sorgu'])) return 'sql';
    if (hasAny(t, ['git', 'commit', 'push', 'depo', 'repository'])) return 'git';

    if (hasAny(t, [
      'kod yaz', 'kod örneği', 'örnek kod', 'script yaz',
      'fonksiyon yaz', 'bana kod', 'algoritma', 'program'
    ])) return 'javascript';
    return null;
  }

  function detectCodeComplexity(text) {
    const t = norm(text);
    const complexScore = [
      'uygulama', 'proje', 'sistem', 'panel', 'admin', 'dashboard',
      'veritabanı', 'database', 'auth', 'giriş', 'login', 'kayıt',
      'api', 'crud', 'filtre', 'arama', 'sayfalama', 'localstorage',
      'csv', 'excel', 'analiz', 'rapor', 'react', 'django', 'flask',
      'express', 'mongodb', 'postgres', 'mimari', 'grafik', 'dosya'
    ].reduce((score, keyword) => score + (t.includes(keyword) ? 1 : 0), 0);
    const simpleScore = [
      'basit', 'en basit', 'kısa', 'minimal', 'başlangıç',
      'hello world', 'merhaba dünya', 'tek satır', 'tek fonksiyon',
      'ilk program', 'toplama', 'çıkarma', 'çarpma', 'bölme',
      'faktöriyel', 'fibonacci', 'asal sayı'
    ].reduce((score, keyword) => score + (t.includes(keyword) ? 1 : 0), 0);

    if (complexScore > simpleScore && complexScore > 0) return 'complex';
    if (simpleScore > 0) return 'simple';
    return 'medium';
  }

  function detectSpecificCodeTask(text) {
    const t = norm(text);
    if (hasAny(t, ['discord bot', 'discord botu', 'discord.js', 'discord py'])) return 'discord_bot';
    if (hasAny(t, ['hesap makinesi', 'calculator', 'hesapla'])) return 'calculator';
    if (hasAny(t, ['giriş sayfası', 'giriş ekranı', 'login sayfası', 'login ui'])) return 'login_ui';
    if (hasAny(t, ['sayı tahmin oyunu', 'tahmin oyunu', 'guess game'])) return 'guess_game';
    if (hasAny(t, ['todo', 'yapılacaklar listesi', 'to do list'])) return 'todo';
    if (hasAny(t, ['şifre üret', 'rastgele şifre', 'password generator'])) return 'password';
    if (hasAny(t, ['palindrom', 'palindrome', 'ters çevir'])) return 'palindrome';
    if (hasAny(t, ['fibonacci'])) return 'fibonacci';
    if (hasAny(t, ['faktöriyel', 'factorial'])) return 'factorial';
    if (hasAny(t, ['asal sayı', 'prime'])) return 'prime';
    if (hasAny(t, ['toplama', 'iki sayı topla'])) return 'add';
    if (hasAny(t, ['çıkarma'])) return 'subtract';
    if (hasAny(t, ['çarpma'])) return 'multiply';
    if (hasAny(t, ['bölme'])) return 'divide';
    if (hasAny(t, ['sayı oyunu', 'oyun yap', 'oyunu nasıl', 'oyunu yapmak', 'oyun yapmak', 'basit bir oyun']) ||
      (hasAny(t, ['minecraft', 'korku', 'oyun']) && hasAny(t, ['yap', 'başla', 'nereden']))) return 'game';
    if (hasAny(t, ['hello world', 'merhaba dünya'])) return 'hello';
    return null;
  }

  function analyzeCodeRequest(text) {
    const language = detectCodeLang(text);
    const task = detectSpecificCodeTask(text);
    const normalized = norm(text);
    let technology = null;

    if (task === 'discord_bot') {
      technology = hasAny(normalized, ['discord.js']) ? 'discord.js' : 'discord.py';
    } else if (hasAny(normalized, ['react', 'jsx'])) {
      technology = 'react';
    } else if (hasAny(normalized, ['html', 'css', 'tailwind'])) {
      technology = 'html/css';
    } else if (hasAny(normalized, ['django'])) {
      technology = 'django';
    } else if (hasAny(normalized, ['flask'])) {
      technology = 'flask';
    } else if (hasAny(normalized, ['node', 'express'])) {
      technology = 'node.js';
    } else if (hasAny(normalized, ['sql', 'postgres', 'mysql'])) {
      technology = 'sql';
    }

    return {
      language,
      technology,
      intent: language ? 'code_generation' : null,
      task,
      complexity: language ? detectCodeComplexity(text) : null
    };
  }

  function codeFence(language, code) {
    return `\`\`\`${language}\n${code.trim()}\n\`\`\``;
  }

  function simpleCodeSample(language, task) {
    const samples = {
      python: {
        hello: "print('Hello')",
        add: 'a = 5\nb = 3\nprint(a + b)',
        subtract: 'a = 10\nb = 4\nprint(a - b)',
        multiply: 'a = 6\nb = 7\nprint(a * b)',
        divide: 'a = 20\nb = 4\nprint(a / b)',
        factorial: 'def faktoriyel(n):\n    return 1 if n <= 1 else n * faktoriyel(n - 1)\n\nprint(faktoriyel(5))',
        fibonacci: 'a, b = 0, 1\nfor _ in range(10):\n    print(a, end=" ")\n    a, b = b, a + b',
        prime: 'def asal_mi(sayi):\n    if sayi < 2:\n        return False\n    return all(sayi % i for i in range(2, int(sayi ** 0.5) + 1))\n\nprint(asal_mi(17))',
        guess_game: 'import random\n\ngizli = random.randint(1, 100)\nwhile True:\n    tahmin = int(input("Tahminin: "))\n    if tahmin == gizli:\n        print("Bildin!")\n        break\n    print("Daha yüksek." if tahmin < gizli else "Daha düşük.")',
        game: 'import random\n\ngizli = random.randint(1, 10)\ntahmin = int(input("1-10 arasında tahmin: "))\nprint("Bildin!" if tahmin == gizli else f"Olmadı, sayı {gizli} idi.")'
      },
      javascript: {
        hello: "console.log('Hello');",
        add: 'const a = 5;\nconst b = 3;\nconsole.log(a + b);',
        subtract: 'const a = 10;\nconst b = 4;\nconsole.log(a - b);',
        multiply: 'const a = 6;\nconst b = 7;\nconsole.log(a * b);',
        divide: 'const a = 20;\nconst b = 4;\nconsole.log(a / b);',
        calculator: 'function hesapla(a, operator, b) {\n  if (operator === "+") return a + b;\n  if (operator === "-") return a - b;\n  if (operator === "*") return a * b;\n  if (operator === "/") {\n    if (b === 0) throw new Error("Sıfıra bölme yapılamaz");\n    return a / b;\n  }\n  throw new Error("Geçersiz işlem");\n}\n\nconsole.log(hesapla(23, "*", 47));',
        factorial: 'function faktoriyel(n) {\n  return n <= 1 ? 1 : n * faktoriyel(n - 1);\n}\n\nconsole.log(faktoriyel(5));',
        fibonacci: 'let a = 0;\nlet b = 1;\nfor (let i = 0; i < 10; i += 1) {\n  console.log(a);\n  [a, b] = [b, a + b];\n}',
        prime: 'function asalMi(sayi) {\n  if (sayi < 2) return false;\n  for (let i = 2; i <= Math.sqrt(sayi); i += 1) {\n    if (sayi % i === 0) return false;\n  }\n  return true;\n}\n\nconsole.log(asalMi(17));'
      }
    };
    const languageSamples = samples[language] || {};
    const code = languageSamples[task];
    if (!code) return null;
    const fenceLanguage = language === 'htmlcss' ? 'html' : language;
    return codeFence(fenceLanguage, code);
  }

  function generatedCode(language, task, requestText) {
    const safeTopic = escapeInline(truncate(extractTopic(requestText), 48) || 'istek');
    const js = language === 'javascript' || language === 'react';

    if (task === 'discord_bot') {
      if (language === 'python') {
        return codeFence('python', `# Kurulum: pip install -U discord.py
import os
import discord
from discord.ext import commands

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f"{bot.user} olarak giriş yapıldı.")

@bot.command()
async def merhaba(ctx):
    await ctx.send(f"Merhaba {ctx.author.mention}!")

token = os.getenv("DISCORD_TOKEN")
if not token:
    raise RuntimeError("DISCORD_TOKEN ortam değişkeni tanımlı değil.")

bot.run(token)`);
      }
      return codeFence('javascript', `// Kurulum: npm install discord.js
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent]
});

client.once("ready", () => console.log(\`\${client.user.tag} hazır.\`));
client.on("messageCreate", (message) => {
  if (message.author.bot) return;
  if (message.content === "!merhaba") message.reply(\`Merhaba \${message.author}!\`);
});

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN eksik.");
client.login(process.env.DISCORD_TOKEN);`);
    }

    if (task === 'calculator') {
      if (js) {
        return codeFence('javascript', `function hesapla(a, operator, b) {
  const islemler = {
    "+": () => a + b,
    "-": () => a - b,
    "*": () => a * b,
    "/": () => {
      if (b === 0) throw new Error("Sıfıra bölme yapılamaz");
      return a / b;
    }
  };
  if (!islemler[operator]) throw new Error("Geçersiz operatör");
  return islemler[operator]();
}

console.log(hesapla(23, "*", 47));`);
      }
      return codeFence('python', `def hesapla(a, operator, b):
    if operator == "+":
        return a + b
    if operator == "-":
        return a - b
    if operator == "*":
        return a * b
    if operator == "/":
        if b == 0:
            raise ValueError("Sıfıra bölme yapılamaz")
        return a / b
    raise ValueError("Geçersiz operatör")

print(hesapla(23, "*", 47))`);
    }

    if (task === 'login_ui' || language === 'htmlcss') {
      return codeFence('html', `<!doctype html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTopic}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; }
    form { width: min(380px, 92vw); padding: 2rem; border-radius: 16px;
      background: #1e293b; box-shadow: 0 16px 50px #0005; }
    label { display: block; margin: 1rem 0 .35rem; }
    input { width: 100%; padding: .75rem; border: 1px solid #475569;
      border-radius: 8px; background: #0f172a; color: inherit; }
    button { width: 100%; margin-top: 1.25rem; padding: .8rem;
      border: 0; border-radius: 8px; background: #38bdf8; cursor: pointer; }
  </style>
</head>
<body>
  <form id="loginForm">
    <h1>Giriş yap</h1>
    <label for="email">E-posta</label>
    <input id="email" type="email" required>
    <label for="password">Şifre</label>
    <input id="password" type="password" minlength="6" required>
    <button type="submit">Devam et</button>
  </form>
  <script>
    document.querySelector("#loginForm").addEventListener("submit", (event) => {
      event.preventDefault();
      alert("Form doğrulandı. Gerçek uygulamada API'ye istek gönder.");
    });
  </script>
</body>
</html>`);
    }

    if (task === 'guess_game' || task === 'game') {
      const simple = simpleCodeSample(language === 'python' ? 'python' : 'javascript', 'guess_game') ||
        simpleCodeSample(language === 'python' ? 'python' : 'javascript', 'game');
      if (simple) return simple;
    }

    if (task === 'todo' && language === 'python') {
      return codeFence('python', `gorevler = []

def ekle(metin):
    if not metin.strip():
        raise ValueError("Görev boş olamaz")
    gorevler.append({"metin": metin.strip(), "tamamlandi": False})

def listele():
    for sira, gorev in enumerate(gorevler, start=1):
        durum = "✓" if gorev["tamamlandi"] else " "
        print(f"{sira}. [{durum}] {gorev['metin']}")

ekle("${safeTopic}")
listele()`);
    }

    if (task === 'todo' && js) {
      return codeFence('javascript', `const gorevler = [];

function ekle(metin) {
  if (!metin.trim()) throw new Error("Görev boş olamaz");
  gorevler.push({ metin: metin.trim(), tamamlandi: false });
}

ekle("${safeTopic}");
console.table(gorevler);`);
    }

    if (task === 'password') {
      if (language === 'python') {
        return codeFence('python', `import secrets
import string

def sifre_uret(uzunluk=16):
    karakterler = string.ascii_letters + string.digits + "!@#$%^&*"
    return "".join(secrets.choice(karakterler) for _ in range(uzunluk))

print(sifre_uret())`);
      }
      return codeFence('javascript', `function sifreUret(uzunluk = 16) {
  const karakterler = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  return Array.from({ length: uzunluk },
    () => karakterler[Math.floor(Math.random() * karakterler.length)]).join("");
}

console.log(sifreUret());`);
    }

    // Bilinmeyen görevlerde Hello örneğine düşmek yerine isteğin konusuna
    // uygun, açıkça genişletilebilir bir başlangıç iskeleti üret.
    if (language === 'python') {
      return codeFence('python', `def main():
    # İstek: ${safeTopic}
    # Bu fonksiyona görevin ana adımlarını ekleyebilirsin.
    print("İş akışı başlatıldı.")

if __name__ == "__main__":
    main()`);
    }
    if (language === 'htmlcss') {
      return codeFence('html', `<!doctype html>
<html lang="tr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTopic}</title></head>
<body>
  <main>
    <h1>${safeTopic}</h1>
    <p>Bu başlangıç yapısını istediğin özelliklerle genişletebilirsin.</p>
  </main>
</body>
</html>`);
    }
    return codeFence('javascript', `function main() {
  // İstek: ${safeTopic}
  // Buraya görevin iş kurallarını ekle.
  console.log("İş akışı başlatıldı.");
}

main();`);
  }

  function codeSample(analysis, requestText) {
    const { language, task, complexity } = analysis;
    const sample = complexity === 'simple' || task === 'hello'
      ? simpleCodeSample(language, task)
      : null;
    const code = sample || generatedCode(language, task, requestText);
    const title = task === 'discord_bot'
      ? 'Discord botu için başlangıç'
      : task === 'calculator'
        ? 'Hesap makinesi için başlangıç'
        : task === 'login_ui'
          ? 'Giriş ekranı için başlangıç'
          : task === 'guess_game'
            ? 'Sayı tahmin oyunu'
            : 'İsteğine uygun başlangıç';

    return `## 💻 ${title}\n\n${code}\n\n` +
      `Bu örnekte **${analysis.language}**${analysis.technology ? ` / **${analysis.technology}**` : ''} ` +
      `kullanıldı. Gerçek token, şifre veya API anahtarını koda gömmemelisin; ortam değişkeni kullan.`;
  }

  /* ============== YANIT VE BİLGİ KAYNAĞI ============== */

  const TEMPLATES = {
    greetings: [
      `Merhaba! 👋 Ben **${MODEL_NAME}**. Bugün ne üzerinde çalışıyoruz?`,
      `Selam! ${MODEL_ICON} İsteğini yaz, birlikte net bir çözüm çıkaralım.`
    ],
    thanks: [
      'Rica ederim! 🤝',
      'Ne demek, yardımcı olabildiysem ne mutlu!'
    ],
    howAreYou: [
      `İyiyim, teşekkür ederim! ${MODEL_ICON} Hazırım; neye bakalım?`,
      'Hazırım ve çalışıyorum. Bugün hangi işi çözelim?'
    ],
    feelings: {
      good: ['İyi olmana sevindim! 🎉'],
      bad: ['Bunu duyduğuma üzüldüm. İstersen ne olduğunu anlatabilirsin. 💙'],
      bored: ['Sıkıldıysan küçük bir kod fikri, oyun veya film önerisi deneyebiliriz. 🎲'],
      tired: ['Yorgunsan kısa bir mola iyi gelebilir. İstersen daha sonra devam ederiz. 💤'],
      stressed: ['Stresli bir anda işi küçük adımlara bölmek yardımcı olabilir. İstersen birlikte sadeleştirelim. 🌿']
    },
    apology: ['Sorun değil; birlikte devam edelim. 😊'],
    noProblem: ['Ne demek, sorun değil.'],
    bye: ['Hoşça kal! 👋 Kendine iyi bak.'],
    yes: ['Harika, devam edelim. Ayrıntıyı yaz; uygun çözümü hazırlayayım.'],
    no: ['Tamam, sorun değil. Başka bir yoldan ilerleyebiliriz.'],
    didntUnderstand: ['Hangi noktada takıldığını söylersen daha sade ve adım adım anlatayım.'],
    joke: ['Neden kodcu karanlığı sever? Çünkü ışık hata ayıklama modunu açar! 😄'],
    aboutMe: `Ben **${MODEL_NAME}** ${MODEL_ICON}. Kural tabanlı bir yanıt motoruyum; kod, basit sohbet, matematik ve yönlendirme konularında yardımcı olurum. Bilgi kaynağım olmayan konularda uydurma cevap vermem.`,
    founder: 'Beni Bilal geliştirdi. 👋',
    skills: 'Kod örnekleri, güvenli matematik hesaplama, temel teknik yönlendirme, basit öneriler ve bağlamlı takip yanıtları sağlayabilirim.'
  };

  const KNOWN_KNOWLEDGE = {
    'yapay zeka': '**Yapay zekâ**, bilgisayarların öğrenme, sınıflandırma, tahmin ve dil işleme gibi görevleri veriden yararlanarak yapmasını sağlayan yöntemler bütünüdür.',
    'ai': '**Yapay zekâ**, bilgisayarların verilerden örüntü öğrenerek bazı görevleri yerine getirmesini sağlayan yöntemler alanıdır.',
    'javascript': '**JavaScript**, özellikle web sayfalarında etkileşim ve uygulama mantığı oluşturmak için kullanılan bir programlama dilidir.',
    'python': '**Python**, okunabilir sözdizimiyle bilinen; web, veri analizi, otomasyon ve yapay zekâ gibi alanlarda kullanılan genel amaçlı bir programlama dilidir.',
    'react': '**React**, kullanıcı arayüzlerini bileşenler halinde oluşturmak için kullanılan bir JavaScript kütüphanesidir.',
    'makine öğrenmesi': '**Makine öğrenmesi**, bilgisayarların açıkça her kural tek tek yazılmadan verilerdeki örüntülerden model oluşturmasını sağlayan yapay zekâ alt alanıdır.'
  };

  /*
   * Bilgi katmanı için genişletilebilir kanca.
   * Varsayılan sağlayıcı dış API çağırmaz ve sahte cevap üretmez.
   * Gelecekte answer() bir bilgi kaynağına bağlanabilir; generate()
   * senkron API'yi koruduğu için burada yalnızca senkron string sonuçları
   * kabul edilir.
   */
  let knowledgeProvider = {
    answer: () => null
  };

  const KnowledgeProvider = {
    answer(payload) {
      try {
        const result = knowledgeProvider.answer(payload);
        return typeof result === 'string' && result.trim() ? result.trim() : null;
      } catch (_) {
        return null;
      }
    }
  };

  function setKnowledgeProvider(provider) {
    knowledgeProvider = provider && typeof provider.answer === 'function'
      ? provider
      : { answer: () => null };
  }

  function knownKnowledgeResponse(text, type) {
    for (const [key, answer] of Object.entries(KNOWN_KNOWLEDGE)) {
      if (hasAny(text, [key])) {
        if (type === INTENTS.HOW && key === 'python') {
          return '**Python kullanmaya başlamak için:** Python’u kur, bir `.py` dosyası oluştur, `print("Merhaba")` gibi küçük bir kod çalıştır ve ardından değişken, koşul, döngü ve fonksiyonlarla ilerle.';
        }
        if (type === INTENTS.WHAT || type === INTENTS.HOW) return answer;
      }
    }
    return null;
  }

  function unknownKnowledgeResponse(topic, type) {
    const label = topic ? `“${truncate(topic, 90)}”` : 'bu konu';
    const wording = type === INTENTS.HOW
      ? `${label} için konuya özel doğrulanmış bir bilgi kaynağım yok.`
      : `${label} hakkında elimde yeterli doğrulanmış bilgi yok.`;
    return `${wording} Elindeki metni, kaynağı veya kullandığın ortamı gönderirsen onun üzerinden yardımcı olabilirim.`;
  }

  function questionResponse(text, topic, type, context) {
    const known = knownKnowledgeResponse(text, type);
    if (known) return known;
    return unknownKnowledgeResponse(topic, type);
  }

  function responseForQuestion(text, topic, type, context) {
    const providerAnswer = KnowledgeProvider.answer({
      userMsg: text,
      context: Array.isArray(context) ? context : [],
      intent: type,
      topic
    });
    if (providerAnswer) return providerAnswer;
    if (type === INTENTS.WHO) {
      return unknownKnowledgeResponse(topic, type);
    }
    if (type === INTENTS.WHEN || type === INTENTS.WHERE || type === INTENTS.HOW_MANY) {
      return unknownKnowledgeResponse(topic, type);
    }
    return questionResponse(text, topic, type, context);
  }

  function detectFeeling(text) {
    const t = norm(text);
    if (hasAny(t, ['sıkıldım', 'canım sıkıldı', 'sıkıcı', 'bored'])) return 'bored';
    if (hasAny(t, ['yorgunum', 'yoruldum', 'bitkinim', 'uykum var', 'tükenmiş'])) return 'tired';
    if (hasAny(t, ['stresliyim', 'stres', 'gerginim', 'kaygılı', 'kaygı', 'panik'])) return 'stressed';
    if (hasAny(t, ['üzgünüm', 'mutsuzum', 'ağlamak', 'depresif', 'kötü hissediyorum'])) return 'bad';
    if (hasAny(t, ['iyiyim', 'iyi hissediyorum', 'mutluyum', 'harikayım', 'memnunum'])) return 'good';
    return null;
  }

  /* ============== ÖNERİLER ============== */

  const MOVIES_BY_GENRE = {
    genel: ['Inception', 'Interstellar', 'The Dark Knight', 'Forrest Gump'],
    bilim_kurgu: ['Dune: Part Two', 'Blade Runner 2049', 'Arrival', 'Ex Machina'],
    drama: ['Whiplash', 'Parasite', 'Green Book', 'Good Will Hunting'],
    komedi: ['The Grand Budapest Hotel', 'Superbad', 'Step Brothers', 'Borat'],
    aksiyon: ['John Wick: Chapter 4', 'Mad Max: Fury Road', 'The Matrix', 'Top Gun: Maverick']
  };

  function detectMovieGenre(text) {
    const t = norm(text);
    const genres = [
      ['bilim_kurgu', ['bilim kurgu', 'sci fi', 'science fiction']],
      ['drama', ['drama', 'dram']],
      ['komedi', ['komedi']],
      ['aksiyon', ['aksiyon']],
      ['korku', ['korku', 'horror']],
      ['gerilim', ['gerilim', 'thriller']],
      ['romantik', ['romantik']],
      ['animasyon', ['animasyon']],
      ['fantastik', ['fantastik']]
    ];
    return genres.find(([, words]) => hasAny(t, words))?.[0] || null;
  }

  function detectRecommendation(text) {
    const t = norm(text);
    const request = hasAny(t, [
      'öner', 'öneri', 'tavsiye', 'ne izleyeyim', 'ne okuyayım',
      'ne dinleyeyim', 'ne yiyeyim', 'seç'
    ]);
    if (!request) return null;

    let category = null;
    if (hasAny(t, ['film', 'filim', 'dizi', 'izle'])) category = 'movie';
    else if (hasAny(t, ['kitap', 'oku'])) category = 'book';
    else if (hasAny(t, ['müzik', 'şarkı', 'dinle', 'parça'])) category = 'music';
    else if (hasAny(t, ['yemek', 'pişir', 'menü', 'tarif', 'yiyecek'])) category = 'food';
    else if (hasAny(t, ['şehir', 'gezi', 'tatil', 'nereye'])) category = 'city';
    else if (hasAny(t, ['oyun', 'oyna'])) category = 'game';

    const yearMatch = textOf(text).match(/\b(19|20)\d{2}\b/);
    return {
      category,
      genre: category === 'movie' ? detectMovieGenre(text) : null,
      year: yearMatch ? Number(yearMatch[0]) : null
    };
  }

  function recommendationResponse(request) {
    if (!request.category) {
      return 'Ne için öneri istediğini belirtirsen daha isabetli seçim yapabilirim: film, kitap, müzik, yemek veya oyun.';
    }

    if (request.category === 'movie') {
      if (request.year || request.genre) {
        const genre = request.genre || 'genel';
        const list = MOVIES_BY_GENRE[genre];
        if (!list) {
          return `${request.year ? `${request.year} yılına ait ` : ''}${request.genre} türü ` +
            'için elimde doğrulanmış bir film veri kaynağı yok. Alakasız filmleri bu isteğe uygunmuş gibi sıralamayacağım.';
        }
        if (request.year) {
          return `${request.year} yılı ve ${request.genre || 'film'} filtresi için güncel/doğrulanmış veri kaynağına erişimim yok. ` +
            'Bu yüzden genel listedeki filmleri o yıla aitmiş gibi önermiyorum.';
        }
        return `**${request.genre}** türünde, elimdeki sınırlı listeden:\n\n${list.map((item, i) => `**${i + 1}.** ${item}`).join('\n')}`;
      }
      const list = MOVIES_BY_GENRE.genel;
      return `Genel film önerileri:\n\n${list.map((item, i) => `**${i + 1}.** ${item}`).join('\n')}`;
    }

    const pools = {
      book: ['1984 — George Orwell', 'Sapiens — Yuval Noah Harari', 'Dune — Frank Herbert'],
      music: ['Pink Floyd — The Dark Side of the Moon', 'Radiohead — OK Computer', 'MFÖ — Ele Güne Karşı'],
      food: ['İskender', 'Menemen', 'Pide'],
      city: ['İstanbul', 'İzmir', 'Antalya'],
      game: ['Minecraft', 'Stardew Valley', 'Elden Ring']
    };
    const labels = { book: 'kitap', music: 'müzik', food: 'yemek', city: 'şehir', game: 'oyun' };
    const list = pools[request.category] || [];
    return `${labels[request.category] || 'öneri'} önerileri:\n\n` +
      list.map((item, i) => `**${i + 1}.** ${item}`).join('\n');
  }

  /* ============== SLASH KOMUTLARI ============== */

  function runSlash(userMsg) {
    const input = textOf(userMsg).trim();
    if (!input.startsWith('/')) return null;
    const [command, ...rest] = input.split(/\s+/);
    const argument = rest.join(' ').trim();

    if (command === '/help' || command === '/yardım') {
      return `# 📖 BilalAI Komutları

- \`/brainstorm <konu>\` → fikir üret
- \`/explain <konu>\` → konuyu açıkla
- \`/compare A vs B\` → karşılaştır
- \`/summarize\` → metin özetle
- \`/code-review\` → kod inceleme kontrol listesi
- \`/debug\` → hata ayıklama rehberi`;
    }
    if (command === '/brainstorm') {
      const topic = argument || 'genel konu';
      return `# 🧠 Beyin Fırtınası: ${topic}

1. **Minimalist:** En küçük çalışan sürüm
2. **Kullanıcı odaklı:** Kullanıcı akışı ve geri bildirim
3. **Ölçeklenebilir:** Modüler mimari ve veri katmanı
4. **Otomasyon:** Tekrarlanan işi azaltma
5. **Güvenlik:** Girdi doğrulama ve yetkilendirme`;
    }
    if (command === '/explain') {
      const topic = argument || 'belirtilen konu';
      return `# 📚 ${topic}

Bu komut konuya özel doğrulanmış bir kaynak almadığı için genel şablonla uydurma bilgi üretmiyorum. Konuya ait metni veya kodu gönderirsen onu somut biçimde açıklayabilirim.`;
    }
    if (command === '/summarize') {
      return argument
        ? `**Kısa özet:** ${truncate(argument, 280)}`
        : 'Özetlemem için metni `/summarize <metin>` biçiminde gönder.';
    }
    if (command === '/compare') {
      const parts = argument.split(/\s+(?:vs\.?|ve|ile)\s+/i);
      const a = parts[0] || 'Seçenek A';
      const b = parts[1] || 'Seçenek B';
      return `| Kriter | ${a} | ${b} |
|---|---|---|
| Amaç | Bağlama göre değişir | Bağlama göre değişir |
| Öğrenme eğrisi | İhtiyaca bağlı | İhtiyaca bağlı |

Kullanım senaryonu yazarsan bu tabloyu gerçek ölçütlerle doldurabilirim.`;
    }
    if (command === '/code-review') {
      return 'Kodunu gönderirsen kalite, güvenlik, hata yönetimi, performans ve test başlıklarında inceleyebilirim.';
    }
    if (command === '/debug') {
      return 'Hata mesajını, ilgili kodu ve beklenen/gerçekleşen davranışı gönder. Kök nedeni adım adım ayırabiliriz.';
    }
    if (command === '/content-enhance' || command === '/content:enhance') {
      return argument
        ? `Metni şu başlıklarda iyileştirebilirim: yapı, açıklık, ton, başlık ve çağrı. Metin: **${truncate(argument, 300)}**`
        : 'İyileştirmem için metni `/content-enhance <metin>` biçiminde gönder.';
    }
    return null;
  }

  function isTechnicalError(text) {
    return hasAny(text, [
      'hata veriyor', 'çalışmıyor', 'çalışmadı', 'error', 'typeerror',
      'referenceerror', 'syntaxerror', 'undefined', 'exception',
      'cannot read', 'failed', '404', '500'
    ]);
  }

  function technicalErrorResponse() {
    return `## 🐞 Hata ayıklama

Sorunu doğru teşhis etmek için şunları paylaş:
1. Tam hata mesajı veya stack trace
2. Hatanın oluştuğu kod parçası
3. Beklenen ve gerçekleşen davranış
4. Dil, framework ve sürüm

Bu bilgiler olmadan rastgele bir düzeltme önermeyeceğim.`;
  }

  function whyDebugResponse() {
    return `## 🔍 Sorun neden oluşuyor olabilir?

“Çalışmıyor” ifadesi tek başına kök nedeni göstermiyor. En sık nedenler yanlış token/ayar, eksik izin, yanlış sürüm veya hata yönetimi eksikliğidir.

Tam hata mesajını, ilgili kodu ve kullandığın dil/framework sürümünü gönderirsen nedeni ayırıp doğrudan düzeltme önerebilirim.`;
  }

  function generalFallback(topic) {
    if (topic) {
      return `“${truncate(topic, 100)}” isteğini tam olarak sınıflandıramadım. ` +
        'Ne üretmemi, açıklamamı veya düzeltmemi istediğini bir cümle daha açarsan konuya uygun ilerleyebilirim.';
    }
    return 'Tam olarak ne yapmak istediğini biraz daha açarsan yardımcı olabilirim. İstersen hedefini ve kullandığın dili/ortamı yaz.';
  }

  function gameHowResponse(text) {
    const topic = hasAny(text, ['minecraft']) ? 'Minecraft korku oyunu' : 'oyun';
    return `## 🎮 ${capitalize(topic)} için başlangıç planı

1. **Platformu seç:** Minecraft Java mı, Bedrock mı? Mod, datapack veya addon yaklaşımı buna göre değişir.
2. **Küçük bir korku prototipi kur:** Tek bir alan, kısa bir hedef ve bir gerilim olayıyla başla.
3. **Atmosferi tasarla:** Görüş mesafesi, ışık, ses ve oyuncunun ne zaman bilgi alacağına karar ver.
4. **Olay akışını yaz:** Oyuncu ne yapacak, hangi koşulda olay tetiklenecek, nasıl bitecek?
5. **Tekrar tekrar test et:** Oyuncunun kaybolmadığını ve korku unsurunun rastgele değil, kontrollü çalıştığını kontrol et.

Tam kurulum ve örnek dosya hazırlamam için Java/Bedrock sürümünü ve mod mu, datapack mi istediğini belirtmen gerekir.`;
  }

  /* ============== ANA API ============== */

  function generate(userMsg, context) {
    const original = textOf(userMsg).trim();
    if (!original) return 'Bir mesaj yazarsan yardımcı olabilirim.';

    const slash = runSlash(original);
    if (slash) return slash;

    const ctx = Array.isArray(context) ? context.slice(-12) : [];
    const detail = decideDetailLevel(original, ctx);
    const feedback = detectFeedbackFromContext(ctx);
    const retryPrelude = feedback.retry
      ? 'Önceki yanıt beklentini karşılamamış; bu kez daha dikkatli ve doğrudan ilerliyorum.\n\n'
      : '';

    // "Evet, istiyorum." ve "Hayır, istemiyorum." bağlam çözümünden önce ele alınır.
    const binary = classifyBinaryReply(original);
    if (binary === 'positive') return rand(TEMPLATES.yes);
    if (binary === 'negative') return rand(TEMPLATES.no);

    const calculation = tryCalculate(original);
    if (calculation) return retryPrelude + calculation;

    const resolvedContext = resolveWithContext(original, ctx);
    const raw = resolvedContext.resolved;
    const t = norm(raw);
    const topic = resolvedContext.topic ||
      (resolvedContext.followUp || isAlternativeRequest(original) ? null : extractTopic(original));

    if (hasAny(t, ['yazı tura', 'yazi tura', 'coin flip', 'parayı at'])) {
      return '🪙 ' + rand(['**YAZI!**', '**TURA!**']);
    }
    if (hasAny(t, ['zar at', 'zarı at', 'roll dice', 'dice'])) {
      return `🎲 Zar atıldı: **${Math.floor(Math.random() * 6) + 1}**`;
    }
    if (hasAny(t, ['sayı tut', 'sayi tut', 'rastgele sayı'])) {
      return `🎯 Aklımdan tuttuğum sayı: **${Math.floor(Math.random() * 100) + 1}**`;
    }

    const feeling = detectFeeling(raw);
    if (feeling) return rand(TEMPLATES.feelings[feeling]);

    if (hasAny(t, ['özür dilerim', 'pardon', 'kusura bak', 'sorry'])) {
      return rand(TEMPLATES.apology);
    }
    if (hasAny(t, ['bir şey değil', 'önemli değil', 'no problem', 'sorun değil'])) {
      return rand(TEMPLATES.noProblem);
    }
    if (hasAny(t, ['hoşça kal', 'görüşürüz', 'bay bay', 'bye', 'kapatıyorum'])) {
      return rand(TEMPLATES.bye);
    }
    if (hasAny(t, ['teşekkür', 'sağol', 'sağ ol', 'thanks', 'eyvallah'])) {
      return rand(TEMPLATES.thanks);
    }
    if (hasAny(t, ['şaka', 'espri', 'joke', 'komik'])) {
      return rand(TEMPLATES.joke);
    }
    if (hasAny(t, ['adın ne', 'sen kimsin', 'ismin ne', 'sen nesin', 'tanıt kendini'])) {
      return TEMPLATES.aboutMe;
    }
    if (hasAny(t, ['bilal kim', 'kurucu kim', 'founder', 'yaratıcın kim'])) {
      return TEMPLATES.founder;
    }
    if (hasAny(t, [
      'ne yapabilirsin', 'yeteneklerin', 'özelliklerin',
      'nasıl yardımcı olabilirsin'
    ])) {
      return TEMPLATES.skills;
    }

    const firstToken = t.split(' ')[0];
    const greeting = ['merhaba', 'selam', 'hey', 'hi', 'hello', 'günaydın', 'sa']
      .includes(firstToken);
    if (greeting) {
      return hasAny(t, ['nasılsın', 'naber', 'nasıl gidiyor'])
        ? rand(TEMPLATES.howAreYou)
        : rand(TEMPLATES.greetings);
    }
    if (hasAny(t, ['nasılsın', 'ne haber', 'nasıl gidiyor', 'how are you', 'naber'])) {
      return rand(TEMPLATES.howAreYou);
    }

    if (hasAny(t, ['saat kaç', 'saat ne', 'şu an saat', 'hangi gün', 'bugün günlerden', 'tarih ne'])) {
      const date = new Date();
      return `Şu an: **${date.toLocaleString('tr-TR')}**`;
    }

    if (hasAny(t, ['anlamadım', 'açıklar mısın', 'tekrarlar mısın', 'daha açık'])) {
      return rand(TEMPLATES.didntUnderstand);
    }

    const recommendation = detectRecommendation(raw);
    if (recommendation) {
      return retryPrelude + recommendationResponse(recommendation);
    }

    const analysis = analyzeCodeRequest(raw);
    if (!analysis.language && analysis.task === 'game') {
      return retryPrelude + gameHowResponse(raw);
    }
    if (analysis.language) {
      return retryPrelude + codeSample(analysis, original) + naturalFollowUp(detail.level);
    }

    const questionType = detectQuestionType(raw);
    if (questionType === INTENTS.WHY &&
      hasAny(raw, ['çalışmıyor', 'çalışmadı', 'hata veriyor', 'neden bozuldu'])) {
      return retryPrelude + whyDebugResponse();
    }
    if (isTechnicalError(raw)) return retryPrelude + technicalErrorResponse();

    if (isNegativeFeedback(original)) {
      return 'Haklı olabilirsin; hangi bölümün yanlış olduğunu söylersen onu doğrudan düzelteyim.';
    }

    if (questionType) {
      const answer = responseForQuestion(raw, topic, questionType, ctx);
      return retryPrelude + answer + naturalFollowUp(detail.level);
    }

    if (resolvedContext.followUp && topic) {
      return `Önceki konu olan **${truncate(topic, 100)}** üzerinden devam edebiliriz. ` +
        'Hangi adımı açıklamamı veya değiştirmemi istediğini belirtirsen doğrudan oraya geçerim.';
    }

    if (hasAny(t, ['başka ne yapabiliriz'])) {
      return 'Kod, fikir geliştirme, açıklama, hata ayıklama veya küçük bir oyun deneyebiliriz. Ne üzerinde ilerlemek istediğini yaz.';
    }
    if (isAlternativeRequest(original)) {
      return 'Tabii, farklı bir örnek veya yöntem hazırlayabilirim. Hangi konuyu alternatif biçimde ele alalım?';
    }

    return retryPrelude + generalFallback(topic);
  }

  function runSelfTests() {
    const checks = [
      ['Kimya is not WHO', detectQuestionType('Kimya nedir?') === INTENTS.WHAT],
      ['Kuantum WHAT', detectQuestionType('Kuantum dolanıklığı nedir?') === INTENTS.WHAT],
      ['Python HOW', detectQuestionType('Python nasıl kullanılır?') === INTENTS.HOW],
      ['Discord WHY', detectQuestionType('Discord botu neden çalışmıyor?') === INTENTS.WHY],
      ['Minecraft WHERE', detectQuestionType('Minecraft nerede oynanır?') === INTENTS.WHERE],
      ['Atatürk WHEN', detectQuestionType('Atatürk ne zaman doğdu?') === INTENTS.WHEN],
      ['Python WHO', detectQuestionType("Python'u kim geliştirdi?") === INTENTS.WHO],
      ['Range HOW_MANY', detectQuestionType('10 ile 20 arasında kaç sayı var?') === INTENTS.HOW_MANY],
      ['sa greeting', /^(Merhaba|Selam)/.test(generate('sa', []))],
      ['saat is not greeting', !/^(Merhaba|Selam)/.test(generate('saat kaç?', []))],
      ['Python information is not code', detectCodeLang('Python nedir?') === null],
      ['React information is not code', detectCodeLang('React nedir?') === null],
      ['Discord code task', analyzeCodeRequest('Python ile Discord botu yap').task === 'discord_bot'],
      ['Discord code language', analyzeCodeRequest('Python ile Discord botu yap').language === 'python'],
      ['Math precedence', tryCalculate('2 + 3 * 4')?.includes('14') === true],
      ['Math parentheses', tryCalculate('(2 + 3) * 4')?.includes('20') === true],
      ['Math decimal', tryCalculate('5.5 + 2.3')?.includes('7.8') === true],
      ['No unrelated current movie list', !generate("2026'da çıkan korku filmlerinden öner", []).includes('Interstellar')],
      ['Minecraft plan', generate("Minecraft'ta korku oyunu yapmak istiyorum, nereden başlamalıyım?", []).includes('Platformu seç')],
      ['No Hello Discord fallback', !generate('Python ile Discord botu yap', []).includes("print('Hello')")]
    ];
    const results = checks.map(([name, passed]) => ({ name, passed }));
    return {
      version: BUILD_VERSION,
      passed: results.filter((item) => item.passed).length,
      failed: results.filter((item) => !item.passed).length,
      results
    };
  }

  const Engine = {
    get MODEL() {
      return {
        name: MODEL_NAME,
        icon: MODEL_ICON,
        version: BUILD_VERSION,
        thinkingMs: [700, 1500],
        style: 'hızlı ve dengeli'
      };
    },
    generate,
    runSelfTests,
    // Test ve mevcut entegrasyonlar için yardımcı API'ler korunur.
    detectQuestionType,
    isCodeGenerationRequest,
    detectCodeLang,
    detectCodeComplexity,
    detectSpecificCodeTask,
    analyzeCodeRequest,
    tryCalculate,
    resolveWithContext,
    KnowledgeProvider,
    setKnowledgeProvider,
    detectAdviceCategory: (text) => {
      const recommendation = detectRecommendation(text);
      const legacyNames = {
        movie: 'movies_genres',
        book: 'books',
        music: 'music',
        food: 'foods',
        city: 'cities',
        game: 'games'
      };
      return legacyNames[recommendation?.category] || null;
    }
  };

  if (typeof window !== 'undefined') window.BilalAIResponseEngine = Engine;
  if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
})();
