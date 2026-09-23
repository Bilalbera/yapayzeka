/* ==========================================================
model.js | BilalAI 1.2 - Flash Yanıt Motoru (r6)

Kullanım:
BilalAIResponseEngine.generate(userMsg, contextArray)
BilalAIResponseEngine.generateAsync(userMsg, contextArray)

contextArray:
[{ role: 'user'|'assistant', content: string }]

Bu dosya tarayıcıda window.BilalAIResponseEngine, Node.js'te
module.exports üzerinden kullanılabilir.
========================================================== */

(function () {
'use strict';

const MODEL_NAME = 'BilalAI - Flash 1.2';
const MODEL_ICON = '⚡';
const BUILD_VERSION = '2026-09-22-r6';

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

/* Türkçe karakter kümesi — \b kelime sınırı Türkçe harfleri
   tanımadığı için kendi kelime sınırımızı kullanıyoruz. */
const TR_LETTERS = 'a-zçğıöşü';
const TR_SUFFIX_CHAR = `[${TR_LETTERS}0-9]`; // ek başlangıcı olabilecek karakter
const LANG_LABELS = Object.freeze({
  python: 'Python',
  javascript: 'JavaScript',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  htmlcss: 'HTML/CSS',
  react: 'React',
  sql: 'SQL',
  git: 'Git',
  flutter: 'Flutter'
});

function rand(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function textOf(value) {
  return typeof value === 'string' ? value : String(value || '');
}

function norm(value) {
  return textOf(value)
    .toLocaleLowerCase('tr-TR')
    .replace(/[.,;:!?'"""''[\]{}]/g, ' ')
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

/* Türkçe kök eşleme: verilen kök, Türkçe eklerle çekimlenmiş
   biçimlerde de eşleşsin (değişken, değişkenler, değişkeni, değişkenleri). */
function hasTurkishRoot(value, root) {
  const source = norm(value);
  const r = norm(root);
  if (!r) return false;
  return new RegExp(
    `(?:^|\\s)${escapeRegExp(r)}${TR_SUFFIX_CHAR}*(?=\\s|$)`, 'u'
  ).test(source);
}

function hasTurkishRootAny(value, roots) {
  return roots.some((root) => hasTurkishRoot(value, root));
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
    'ne oluyor', 'ne olduğunu', 'ne yapıyor', 'ne yapar',
    'neleri kapsar', 'hakkında bilgi'
  ])) return INTENTS.WHAT;

  // Soru işareti tek başına WHAT değildir.
  return null;
}

/*
 * Kod dili geçiyor diye her mesaj kod isteği değildir.
 * "Python nedir?", "React nedir?" ve "Python nasıl kullanılır?"
 * bilgi akışında kalır; üretim fiili/şablonu açıkça varsa kod akışına girer.
 */
const NO_CODE_SIGNALS = Object.freeze([
  'kod yazma', 'kod verme', 'kod istemiyorum', 'kod olmadan anlat',
  'kod yazmadan', 'kod vermeden',
  'henüz kod yazma', 'sadece anlat', 'mantığını anlat',
  'kod göstermeden anlat', 'önce açıklama yap'
]);

function hasNoCodeConstraint(text) {
  return hasAny(text, NO_CODE_SIGNALS);
}

function isExplanationRequest(text) {
  return hasAny(text, [
    'anlat', 'açıkla', 'açıklama', 'mantığını',
    'öğret', 'öğretmek', 'öğrenmek istiyorum',
    'nasıl çalışıyor', 'nasıl çalışır', 'nasıl çalıştığını',
    'ne olduğunu', 'hangi adımları', 'önce açıklama'
  ]) || hasNoCodeConstraint(text);
}

/* ===== HATA 5: Türkçe fiil çekimleri ve kelime sınırları ===== */

// Yalın/emir biçimindeki üretim fiilleri. \b Türkçe harfleri tanımadığı
// için bu fiilleri hasTurkishRoot benzeri mantıkla, eksiz biçimde
// arıyoruz: "yap" eşleşir, "yapıyorum"/"yaptım"/"yapacak" eşleşmez.
const PRODUCTION_VERBS = Object.freeze([
  'yap', 'oluştur', 'geliştir', 'yaz', 'kur', 'hazırla'
]);

// Çekimli (progressive/geçmiş/gelecek/istek) biçimler — kod üretimi
// olarak kabul edilmemeli.
const NON_IMPERATIVE_VERBS = Object.freeze([
  'yapıyorum', 'yapıyoruz', 'yaptım', 'yaptık', 'yapacağım', 'yapacağız',
  'yapacak', 'yapacaksın', 'yapıyorsun',
  'oluşturuyorum', 'oluşturduk', 'oluşturacağım', 'oluşturacağız',
  'geliştiriyorum', 'geliştirdim', 'geliştireceğim', 'geliştireceğiz',
  'yazıyorum', 'yazdım', 'yazacağım', 'yazıyoruz',
  'kuruyorum', 'kurdum', 'kuracağım', 'kuruyoruz',
  'yapmak istiyorum', 'oluşturmak istiyorum', 'geliştirmek istiyorum',
  'yazmak istiyorum', 'kurmak istiyorum',
  'yapmak istiyoruz', 'oluşturmak istiyoruz', 'geliştirmek istiyoruz'
]);

function hasStandaloneProductionVerb(text) {
  const source = norm(text);
  return PRODUCTION_VERBS.some((verb) => {
    const v = norm(verb);
    // Fiil kökü, ardından Türkçe ek karakteri GELMEDİĞİ durumda eşleşir.
    return new RegExp(
      `(?:^|\\s)${escapeRegExp(v)}(?!${TR_SUFFIX_CHAR})`, 'u'
    ).test(source);
  });
}

function isNonImperativeVerb(text) {
  return hasAny(text, NON_IMPERATIVE_VERBS);
}

function isCodeGenerationRequest(text) {
  const t = norm(text);
  if (!t) return false;
  if (hasNoCodeConstraint(t)) return false;

  const informationOnly = hasAny(t, [
    'nedir', 'ne demek', 'ne anlama gelir', 'nasıl kullanılır',
    'hakkında bilgi', 'ne işe yarar'
  ]);
  const explicitCode = hasAny(t, [
    'kod yaz', 'kodu yaz', 'kodunu yaz', 'kod ver', 'kodu ver',
    'örnek kod', 'kod örneği', 'script yaz',
    'fonksiyon yaz', 'program yaz', 'bana kod', 'algoritma yaz',
    'uygulama oluştur', 'proje oluştur', 'component oluştur',
    'bileşen oluştur', 'sorgu yaz', 'sayfa oluştur', 'giriş ekranı yap'
  ]);

  const nonImperative = isNonImperativeVerb(t);
  const standaloneVerb = hasStandaloneProductionVerb(t);
  const hasConnector = hasAny(t, ['ile', 'kullanarak', 'üzerinde']);

  // buildPattern: bağlaç + yalın fiil, ama çekimli fiil değil.
  const buildPattern = hasConnector && standaloneVerb && !nonImperative;
  const directBuild = hasAny(t, [
    'uygulama yap', 'proje yap', 'oyun yap', 'bot yap',
    'hesap makinesi yap', 'giriş sayfası yap', 'login sayfası yap',
    'login ekranı yap', 'todo listesi yap', 'kodla'
  ]);

  if (isExplanationRequest(t) && !explicitCode) return false;
  // Çekimli fiil varsa ve açık kod isteği yoksa kod üretme.
  if (nonImperative && !explicitCode && !directBuild) return false;
  if (explicitCode || directBuild || buildPattern) return true;
  return !informationOnly && hasAny(t, ['kod', 'script', 'fonksiyon', 'algoritma']);
}

/* ============== GÜVENLİ MATEMATİK PARSERİ (HATA 8) ============== */

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

/* HATA 8: Yapılandırılmış hata dönüşü.
   Başarı: { ok: true, value: number }
   Hata:   { ok: false, error: 'DIVISION_BY_ZERO' | 'PARSE_ERROR' }
   Matematik değil: null */
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
      if (right === null) return null;
      if (operator === '/' && right === 0) {
        // Yapılandırılmış hata: sıfıra bölme
        return { _divByZero: true };
      }
      value = operator === '*' ? value * right : value / right;
      if (!Number.isFinite(value)) return null;
    }
    return value;
  }

  function addition() {
    let value = multiplication();
    if (value === null) return null;
    if (typeof value === 'object' && value._divByZero) return value;
    while (peek()?.type === '+' || peek()?.type === '-') {
      const operator = peek().type;
      position += 1;
      const right = multiplication();
      if (right === null) return null;
      if (typeof right === 'object' && right._divByZero) return right;
      value = operator === '+' ? value + right : value - right;
      if (!Number.isFinite(value)) return null;
    }
    return value;
  }

  const result = addition();
  if (typeof result === 'object' && result._divByZero) {
    return { ok: false, error: 'DIVISION_BY_ZERO' };
  }
  if (result === null) return null;
  return position === tokens.length && Number.isFinite(result)
    ? { ok: true, value: result }
    : null;
}

function extractMathExpression(text) {
  const source = textOf(text).replace(/,/g, '.');
  const candidates = source.match(/[0-9.\s()+\-*x×÷/]+/gi) || [];

  for (const candidate of candidates) {
    const compact = candidate.replace(/\s+/g, '').trim();
    if (!compact || !/[+\-*x×÷/]/i.test(compact)) continue;
    if (!/\d/.test(compact)) continue;
    const parsed = parseMathExpression(compact);
    // Sıfıra bölme bile matematik ifadesi olarak tanınmalı.
    if (parsed !== null) return compact;
  }
  return null;
}

function tryCalculate(text) {
  const expression = extractMathExpression(text);
  if (!expression) return null;
  const result = parseMathExpression(expression);
  if (result === null) return null;
  if (!result.ok) {
    if (result.error === 'DIVISION_BY_ZERO') {
      return 'Sıfıra bölme yapılamaz. 🧮';
    }
    return null;
  }

  const value = result.value;
  const prettyExpression = expression
    .replace(/\*/g, ' × ')
    .replace(/\//g, ' ÷ ')
    .replace(/\+/g, ' + ')
    .replace(/-/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim();

  return `İşlem sonucu:\n**${prettyExpression} = ${Number(value.toFixed(10))}** 🧮`;
}

/* ============== BAĞLAM (HATA 3) ============== */

// Follow-up aksiyon ve format istekleri — bunlar topic değildir.
const FOLLOW_UP_ACTIONS = Object.freeze({
  simplify: ['daha basit', 'daha basit anlat', 'daha sade', 'daha kolay',
    'basit anlat', 'sadeleştir', 'kısaca anlat'],
  elaborate: ['daha detaylı', 'daha uzun', 'açıklamayı genişlet',
    'daha kapsamlı'],
  continue: ['devam', 'devam et', 'devam etmisin', 'başka ne var',
    'sıradaki', 'sonra ne'],
  clarify: ['anlamadım', 'açıklar mısın', 'tekrarlar mısın', 'daha açık',
    'net değil'],
  run: ['nasıl çalıştır', 'çalıştıracağım', 'çalıştırmak', 'nasıl çalışır',
    'nasıl başlat', 'başlatacağım', 'çalıştırır mısın'],
  commands: ['komutlar nasıl', 'komutlar nasıl çalışıyor', 'komutlar nasıl çalışır',
    'komut nedir', 'komutlar nedir']
});

const FORMAT_REQUESTS = Object.freeze({
  daily_life_example: ['günlük hayattan', 'günlük hayattan örnek', 'günlük örnek',
    'günlük yaşamdan', 'önce günlük', 'günlük hayattan bir örnek',
    'günlük hayattan bir örnekle'],
  analogy: ['benzer bir örnekle', 'analoji', 'metaforla', 'kıyasla'],
  real_example: ['gerçek bir örnek', 'gerçek örnek', 'gerçek hayattan']
});

function detectFollowUpAction(text) {
  const t = norm(text);
  for (const [action, keywords] of Object.entries(FOLLOW_UP_ACTIONS)) {
    if (hasAny(t, keywords)) return action;
  }
  return null;
}

function detectFormatRequest(text) {
  const t = norm(text);
  for (const [format, keywords] of Object.entries(FORMAT_REQUESTS)) {
    if (hasAny(t, keywords)) return format;
  }
  return null;
}

// Fiil/eylem ifadeleri otomatik subtopic yapılmasın.
const VERB_PATTERNS = Object.freeze([
  'çalıştıracağım', 'çalıştırmak', 'çalıştır', 'yapacağım', 'yapmalıyım',
  'anlat', 'açıkla', 'devam', 'daha basit', 'günlük', 'komutlar',
  'nasıl çalışıyor', 'nasıl çalıştır', 'başka bir örnek',
  'günlük hayattan', 'daha sade', 'daha kolay'
]);

function isVerbOrFollowUpPhrase(text) {
  const t = norm(text);
  return VERB_PATTERNS.some((p) => hasPhrase(t, p));
}

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
    'devam et', 'nasıl', 'neden', 'kısaca', 'özetle',
    'daha basit', 'daha basit anlat', 'günlük hayattan',
    'günlük hayattan örnek ver', 'günlük örnek ver',
    'başka bir örnek ver', 'başka örnek ver'
  ].includes(t);
}

function isContextualFollowUp(message) {
  const t = norm(message);
  if (t === 'nasıl' ||
    t === 'neden' ||
    t === 'peki' ||
    t === 'anlamadım' ||
    t === 'devam' ||
    t === 'devam et' ||
    t === 'kısaca' ||
    t === 'özetle' ||
    t === 'daha basit' ||
    t === 'daha basit anlat' ||
    t === 'günlük hayattan örnek ver' ||
    t === 'günlük örnek ver' ||
    t === 'başka bir örnek ver')
    return true;
  if (/^(peki\s+)?(bunu|bunu nasıl|bu|şu|o)\b/.test(t)) return true;
  if (/^(peki|ama|şimdi|ve)\b/.test(t)) return true;
  if (/^ya\s+(bu|şu|o)\b/.test(t)) return true;
  if (/^(başka|farklı)\s+(bir\s+)?(örnek|yöntem|açıklama)/.test(t)) return true;
  if (/^(evet|hayır)\b/.test(t)) return true;
  if (detectFollowUpAction(t)) return true;
  if (detectFormatRequest(t)) return true;
  if (detectProgrammingSubtopic(t) && (detectTeachingIntent(t) ||
      hasAny(t, ['anlat', 'açıkla', 'daha basit', 'günlük'])))
    return true;
  if (detectProgrammingSubtopic(t) && hasAny(t, ['nedir', 'ne demek']))
    return true;
  if (hasAny(t, ['günlük hayattan', 'günlük örnek', 'günlük']) &&
    t.length < 60)
    return true;
  return false;
}

function detectUserLevel(text) {
  const t = norm(text);
  if (hasAny(t, [
    'yeni başladım', 'başlangıç seviyesindeyim', 'hiç bilmiyorum',
    '12 yaşındaki birine anlat', 'basit anlat', 'sıfırdan anlat',
    'başlangıç seviyesi', 'çok basit şekilde öğret', 'basit şekilde öğret'
  ])) return 'beginner';
  if (hasAny(t, ['ileri seviye', 'uzmanım', 'profesyonelce', 'detaylı teknik'])) {
    return 'advanced';
  }
  return null;
}

function detectDomain(text, analysis) {
  const t = norm(text);
  if (analysis?.task === 'discord_bot' || hasAny(t, [
    'python', 'javascript', 'react', 'html', 'css', 'sql', 'kod',
    'programlama', 'minecraft', 'mod', 'datapack'
  ])) return 'programlama';
  if (hasAny(t, ['film', 'dizi', 'kitap', 'müzik', 'şarkı'])) return 'eğlence';
  if (hasAny(t, ['yemek', 'tarif', 'menü'])) return 'günlük yaşam';
  return null;
}

function detectSubtopic(text) {
  const commandToken = extractCommandToken(text);
  if (commandToken) return commandToken;

  const value = textOf(text)
    .replace(/^(peki|ama|şimdi|ve)\s+/i, '')
    .replace(/\?+\s*$/g, '')
    .replace(/^(bunu|buna|bu|şu|o)\s+/i, '')
    .replace(/^(nasıl|neden|niçin|niye|ne zaman|nerede|hangi)\s+/i, '')
    .replace(/\s+(nasıl|neden|niçin|niye)\s+(çalışıyor|çalışır|yapılır|yapmalıyım)\s*$/i, '')
    .replace(/\s+(çalışıyor|çalışır|yapılır|yapmalıyım)\s*$/i, '')
    .trim();

  // Fiil/eylem ifadelerini subtopic yapma (HATA 3)
  if (isVerbOrFollowUpPhrase(value)) return '';

  return value.length >= 3 ? truncate(value, 100) : '';
}

function extractCommandToken(text) {
  return textOf(text).match(/![a-zçğıöşü0-9_-]+/iu)?.[0] || '';
}

/* HATA 3: resolveWithContext artık followUpAction ve formatRequest
   ayrıştırır; bu ifadeleri topic/subtopic olarak kaydetmez. */
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
  const previousIntent = detectQuestionType(previousUser.content);
  const followUpAction = detectFollowUpAction(original);
  const formatRequest = detectFormatRequest(original);
  const subtopic = followUpAction || formatRequest ? '' : detectSubtopic(original);
  const progSubtopic = detectProgrammingSubtopic(original) ||
    detectProgrammingSubtopic(previousUser.content);

  const state = {
    topic: progSubtopic || topic,
    subtopic: subtopic || null,
    domain: detectDomain(previousUser.content, analysis),
    language: analysis.language,
    technology: analysis.technology,
    task: analysis.task,
    intent: previousIntent || analysis.intent,
    previousIntent,
    userLevel: analysis.userLevel || detectUserLevel(original),
    wantsCode: analysis.wantsCode,
    wantsExplanation: analysis.wantsExplanation,
    constraints: analysis.constraints,
    complexity: analysis.complexity,
    followUpAction: followUpAction || null,
    formatRequest: formatRequest || null
  };

  return {
    resolved: `${original} (${topic}${subtopic ? ` / ${subtopic}` : ''} bağlamında)`,
    topic,
    state,
    followUp: true
  };
}

/* ============== FEEDBACK (HATA 9) ============== */

/* HATA 9: Feedback güncel kullanıcı mesajından okunur.
   detectFeedbackFromContext geriye dönük uyumluluk için korunur. */
function detectFeedback(userMsg) {
  const message = norm(userMsg);
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

function detectFeedbackFromContext(context) {
  if (!Array.isArray(context) || context.length < 2) {
    return { retry: false, tone: 'normal', alternative: false };
  }
  const lastItem = context[context.length - 1];
  if (!lastItem || lastItem.role !== 'user') {
    return { retry: false, tone: 'normal', alternative: false };
  }
  return detectFeedback(lastItem.content);
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

function binaryResponse(binary, context) {
  const lastAssistant = Array.isArray(context)
    ? [...context].reverse().find((item) => item && item.role === 'assistant')
    : null;
  const previous = norm(lastAssistant?.content);

  if (binary === 'positive' && hasAny(previous, ['göstereyim mi', 'anlatayım mı', 'ister misin'])) {
    return 'Evet, devam edelim. İstediğin örneği bir sonraki adımda hazırlayabilirim.';
  }
  if (binary === 'negative' && hasAny(previous, ['deneyelim mi', 'ister misin', 'uygun mu'])) {
    return 'Tamam, bu seçeneği uygulamıyorum. Başka bir yoldan ilerleyebiliriz.';
  }
  return rand(binary === 'positive' ? TEMPLATES.yes : TEMPLATES.no);
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
  if (detailLevel !== 'deep') return '';
  return rand([
    '\n\nTakıldığın bölümü söylersen onu ayrıca açabilirim.',
    ''
  ]);
}

/* ============== KOD İSTEĞİ ANALİZİ ============== */

function detectLanguageHint(text) {
  const t = norm(text);

  if (/\b(python\w*|django|flask|pandas|numpy|pip)\b/iu.test(t)) return 'python';

  // HATA: JavaScript MUTLAKA Java'dan önce kontrol edilmeli.
  // "java script" (iki kelime) ve "js" → javascript, "java" → java.
  if (/\b(typescript|javascript|node|nodejs|nextjs|next\.js|npm)\b/i.test(t) ||
    hasAny(t, ['java script', 'js'])) {
    return 'javascript';
  }
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

function detectCodeLang(text) {
  const t = norm(text);
  if (!isCodeGenerationRequest(t)) return null;
  return detectLanguageHint(t);
}

// Dil normalizasyonu — "java script" → "javascript", "js" → "javascript"
function normalizeLang(lang) {
  if (!lang) return null;
  const l = norm(lang).replace(/\s+/g, '');
  if (l === 'javascript' || l === 'js') return 'javascript';
  if (l === 'go' || l === 'golang') return 'go';
  if (l === 'python') return 'python';
  if (l === 'java') return 'java';
  return l;
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
  if (hasAny(t, ['discord bot', 'discord botu', 'discord.js', 'discord py']) ||
    /\bdiscord\s+bot\w*/iu.test(t)) return 'discord_bot';
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
  if (hasAny(t, ['http isteği', 'http istek', 'http request', 'api isteği', 'get isteği'])) return 'http_request';
  return null;
}

function analyzeCodeRequest(text) {
  const normalized = norm(text);
  const wantsCode = isCodeGenerationRequest(normalized);
  const language = detectLanguageHint(normalized);
  const task = detectSpecificCodeTask(text);
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
    intent: wantsCode ? 'code_generation' : isExplanationRequest(text) ? 'explanation' : null,
    task,
    complexity: language ? detectCodeComplexity(text) : null,
    wantsCode,
    wantsExplanation: isExplanationRequest(text),
    userLevel: detectUserLevel(text),
    constraints: {
      noCode: hasNoCodeConstraint(text)
    }
  };
}

function codeFence(language, code) {
  return `\`\`\`${language}\n${code.trim()}\n\`\`\``;
}

/* ===== HATA 6: Görev başına desteklenen diller ===== */
const SUPPORTED_CODE_TASKS = Object.freeze({
  discord_bot: ['python', 'javascript', 'go'],
  calculator: ['python', 'javascript', 'java'],
  login_ui: ['htmlcss', 'react'],
  guess_game: ['python', 'javascript'],
  game: ['python', 'javascript'],
  todo: ['python', 'javascript'],
  password: ['python', 'javascript'],
  hello: ['python', 'javascript', 'java', 'go'],
  add: ['python', 'javascript', 'java'],
  subtract: ['python', 'javascript', 'java'],
  multiply: ['python', 'javascript', 'java'],
  divide: ['python', 'javascript', 'java'],
  factorial: ['python', 'javascript', 'java'],
  fibonacci: ['python', 'javascript', 'java'],
  prime: ['python', 'javascript', 'java'],
  palindrome: ['python', 'javascript', 'java'],
  http_request: ['go', 'python', 'javascript']
});

const TASK_LABELS = Object.freeze({
  discord_bot: 'Discord botu',
  calculator: 'hesap makinesi',
  login_ui: 'giriş ekranı',
  guess_game: 'sayı tahmin oyunu',
  game: 'oyun',
  todo: 'yapılacaklar listesi',
  password: 'şifre üreteci',
  hello: 'Hello World',
  add: 'toplama',
  subtract: 'çıkarma',
  multiply: 'çarpma',
  divide: 'bölme',
  factorial: 'faktöriyel',
  fibonacci: 'fibonacci',
  prime: 'asal sayı',
  palindrome: 'palindrom',
  http_request: 'HTTP isteği'
});

function isSupportedTask(task, language) {
  if (!task) return true; // null görev → generic generator ele eder
  const supported = SUPPORTED_CODE_TASKS[task];
  return supported ? supported.includes(language) : false;
}

function unsupportedLanguageResponse(task, language) {
  const taskLabel = TASK_LABELS[task] || 'bu görev';
  const langLabel = LANG_LABELS[language] || language;
  const supported = SUPPORTED_CODE_TASKS[task] || [];
  const supportedLabels = supported.map((l) => LANG_LABELS[l] || l).join(', ');
  return `**${langLabel}** için **${taskLabel}** görevinde hazır kod üreticim yok. ` +
    `Başka bir dilin kodunu ${langLabel} diye göstermeyeceğim.` +
    (supported.length ? ` Bu görev için desteklediğim diller: ${supportedLabels}.` : '');
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
      fibonacci: 'let a = 0;\nlet b = 1;\nfor (let i = 0; i < 10; i += 1) {\n  console.log(a);\n  [a, b] = [b, a + b];\n} ',
      prime: 'function asalMi(sayi) {\n  if (sayi < 2) return false;\n  for (let i = 2; i <= Math.sqrt(sayi); i += 1) {\n    if (sayi % i === 0) return false;\n  }\n  return true;\n}\n\nconsole.log(asalMi(17));',
      guess_game: 'const gizli = Math.floor(Math.random() * 100) + 1;\nconst { createInterface } = require("readline");\nconst rl = createInterface({ input: process.stdin, output: process.stdout });\n\nfunction soru() {\n  rl.question("Tahminin: ", (tahmin) => {\n    const t = Number(tahmin);\n    if (t === gizli) { console.log("Bildin!"); rl.close(); }\n    else { console.log(t < gizli ? "Daha yüksek." : "Daha düşük."); soru(); }\n  });\n}\nsoru();'
    },
    java: {
      hello: 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello");\n    }\n}',
      add: 'public class Main {\n    public static void main(String[] args) {\n        int a = 5, b = 3;\n        System.out.println(a + b);\n    }\n}',
      subtract: 'public class Main {\n    public static void main(String[] args) {\n        int a = 10, b = 4;\n        System.out.println(a - b);\n    }\n}',
      multiply: 'public class Main {\n    public static void main(String[] args) {\n        int a = 6, b = 7;\n        System.out.println(a * b);\n    }\n}',
      divide: 'public class Main {\n    public static void main(String[] args) {\n        int a = 20, b = 4;\n        System.out.println(a / b);\n    }\n}',
      factorial: 'public class Main {\n    static int faktoriyel(int n) {\n        return n <= 1 ? 1 : n * faktoriyel(n - 1);\n    }\n    public static void main(String[] args) {\n        System.out.println(faktoriyel(5));\n    }\n}',
      fibonacci: 'public class Main {\n    public static void main(String[] args) {\n        int a = 0, b = 1;\n        for (int i = 0; i < 10; i++) {\n            System.out.print(a + " ");\n            int t = a + b;\n            a = b;\n            b = t;\n        }\n    }\n}',
      prime: 'public class Main {\n    static boolean asalMi(int sayi) {\n        if (sayi < 2) return false;\n        for (int i = 2; i <= Math.sqrt(sayi); i++) {\n            if (sayi % i == 0) return false;\n        }\n        return true;\n    }\n    public static void main(String[] args) {\n        System.out.println(asalMi(17));\n    }\n}',
      palindrome: 'public class Main {\n    static boolean palindromMu(String s) {\n        return s.equals(new StringBuilder(s).reverse().toString());\n    }\n    public static void main(String[] args) {\n        System.out.println(palindromMu("kayak"));\n    }\n}'
    },
    go: {
      hello: 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello")\n}'
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

  /* HATA 6: Desteklenmeyen dil+görev kombinasyonunda dürüst fallback */
  if (task && !isSupportedTask(task, language)) {
    return unsupportedLanguageResponse(task, language);
  }

  if (task === 'discord_bot') {
    if (language === 'python') {
      return codeFence('python', `# Kurulum: pip install -U discord.py
bot.run(token)`);

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
        if (language === 'javascript') {
          return codeFence('javascript', `// Kurulum: npm install discord.js
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent]
});

client.once("ready", () => console.log(\`${client.user.tag} hazır.\`));
client.on("messageCreate", (message) => {
if (message.author.bot) return;
if (message.content === "!merhaba") message.reply(\`Merhaba ${message.author}!\`);
});

if (!process.env.DISCORD_TOKEN) throw new Error("DISCORD_TOKEN eksik.");
client.login(process.env.DISCORD_TOKEN);`);
        }
        if (language === 'go') {
          return codeFence('go', `// Kurulum: go get github.com/bwmarrin/discordgo
package main

import (
"fmt"
"log"
"os"

"github.com/bwmarrin/discordgo"

)

func main() {
token := os.Getenv("DISCORD_TOKEN")
if token == "" {
log.Fatal("DISCORD_TOKEN ortam değişkeni tanımlı değil.")
}

dg, err := discordgo.New("Bot " + token)
if err != nil {
    log.Fatal("Bot oluşturulamadı:", err)
}

dg.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
    if m.Author.Bot {
        return
    }
    if m.Content == "!merhaba" {
        s.ChannelMessageSend(m.ChannelID, "Merhaba!")
    }
})

dg.Identify.Intents = discordgo.IntentsGuilds | discordgo.IntentGuildMessages

if err := dg.Open(); err != nil {
    log.Fatal("Bağlantı açılamadı:", err)
}
defer dg.Close()

fmt.Println("Bot çalışıyor. Ctrl+C ile durdur.")
select {}

}`);
}
// Desteklenmeyen Discord bot dili
return unsupportedLanguageResponse('discord_bot', language);
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
        if (language === 'python') {
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
        if (language === 'java') {
          return codeFence('java', `public class HesapMakinesi {
public static double hesapla(double a, String operator, double b) {
switch (operator) {
case "+": return a + b;
case "-": return a - b;
case "*": return a * b;
case "/":
if (b == 0) throw new ArithmeticException("Sıfıra bölme yapılamaz");
return a / b;
default: throw new IllegalArgumentException("Geçersiz operatör");
}
}
public static void main(String[] args) {
System.out.println(hesapla(23, "*", 47));
}
}`);
}
return unsupportedLanguageResponse('calculator', language);
}

  /* HATA 7: React için gerçek JSX/React kodu üret */
  if (task === 'login_ui' && language === 'react') {
    return codeFence('jsx', `import React, { useState } from 'react';

function Login() {
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');

const handleSubmit = (e) => {
e.preventDefault();
// Gerçek uygulamada API'ye istek gönder
console.log('Giriş:', { email, password });
};

return (
<form onSubmit={handleSubmit} style={{ maxWidth: 380, margin: '2rem auto' }}>
<h1>Giriş yap</h1>
<div style={{ marginBottom: '1rem' }}>
<label>E-posta</label>
<input
type="email"
value={email}
onChange={(e) => setEmail(e.target.value)}
required
/>
</div>
<div style={{ marginBottom: '1rem' }}>
<label>Şifre</label>
<input
type="password"
value={password}
onChange={(e) => setPassword(e.target.value)}
required
/>
</div>
<button type="submit">Devam et</button>
</form>
);
}

export default Login;`);
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

  // HTTP isteği
  if (task === 'http_request') {
    if (language === 'go') {
      return codeFence('go', `package main

import (
"fmt"
"io"
"net/http"
)

func main() {
resp, err := http.Get("https://example.com")
if err != nil {
fmt.Println("İstek hatası:", err)
return
}
defer resp.Body.Close()

body, err := io.ReadAll(resp.Body)
if err != nil {
    fmt.Println("Okuma hatası:", err)
    return
}
fmt.Println(string(body))
}
`);
        }
        if (language === 'python') {
          return codeFence('python', `import requests

resp = requests.get("https://example.com")
print(resp.status_code)
print(resp.text)`);
        }
        if (language === 'javascript') {
          return codeFence('javascript', `fetch("https://example.com")
.then((res) => res.text())
.then((body) => console.log(body))
.catch((err) => console.error("Hata:", err));`);
}
return unsupportedLanguageResponse('http_request', language);
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
      if (language === 'react') {
        return codeFence('jsx', `import React from 'react';

function ${capitalize(safeTopic.replace(/[^a-zA-Zçğıöşü0-9]/g, '')) || 'Bilesen'}() {
return (
<div>
<h1>${safeTopic}</h1>
<p>Bu başlangıç bileşenini istediğin özelliklerle genişletebilirsin.</p>
</div>
);
}

export default ${capitalize(safeTopic.replace(/[^a-zA-Zçğıöşü0-9]/g, '')) || 'Bilesen'};
`);
      }
      // HATA: Java için generic Java iskeleti — asla JavaScript'e düşme
      if (language === 'java') {
        return codeFence('java', `public class Main {
public static void main(String[] args) {
// İstek: ${safeTopic}
// Buraya görevin iş kurallarını ekle.
System.out.println("İş akışı başlatıldı.");
}
}`);
      }
      // HATA: Go için generic Go iskeleti — asla JavaScript'e düşme
      if (language === 'go') {
        return codeFence('go', `package main

import "fmt"

func main() {
// İstek: ${safeTopic}
// Buraya görevin iş kurallarını ekle.
fmt.Println("İş akışı başlatıldı.")
}`);
      }
      // HATA: Rust için generic Rust iskeleti
      if (language === 'rust') {
        return codeFence('rust', `fn main() {
// İstek: ${safeTopic}
// Buraya görevin iş kurallarını ekle.
println!("İş akışı başlatıldı.");
}`);
      }
      // HATA: Flutter için generic Dart iskeleti
      if (language === 'flutter') {
        return codeFence('dart', `void main() {
// İstek: ${safeTopic}
// Buraya görevin iş kurallarını ekle.
print('İş akışı başlatıldı.');
}`);
      }
      // Güvenli dil gate'i: istenen dil ile üretilen dil uyuşmazsa dürüst fallback
      if (language && normalizeLang(language) !== 'javascript' &&
        normalizeLang(language) !== 'react' &&
        normalizeLang(language) !== 'htmlcss' &&
        normalizeLang(language) !== 'sql' &&
        normalizeLang(language) !== 'git') {
        return unsupportedLanguageResponse(null, language);
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

  // HATA 6: Desteklenmeyen dil kontrolü
  if (task && language && !isSupportedTask(task, language)) {
    return unsupportedLanguageResponse(task, language);
  }

  const sample = complexity === 'simple' || task === 'hello'
    ? simpleCodeSample(language, task)
    : null;
  const code = sample || generatedCode(language, task, requestText);
  const title = task === 'discord_bot'
    ? 'Discord botu için başlangıç'
    : task === 'calculator'
      ? 'Hesap makinesi için başlangıç'
      : task === 'login_ui'
        ? (language === 'react' ? 'Giriş ekranı için React bileşeni' : 'Giriş ekranı için başlangıç')
        : task === 'guess_game'
          ? 'Sayı tahmin oyunu'
          : 'İsteğine uygun başlangıç';

  const langLabel = LANG_LABELS[language] || language;
  const techLabel = analysis.technology;
  // Eğer desteklenmeyen dil mesajı döndüyse code değişkeni zaten metin
  if (code.startsWith('**') || code.includes('göstermeyeceğim')) {
    return code;
  }

  return `## 💻 ${title}\n\n${code}\n\n` +
    `Bu örnekte **${langLabel}**${techLabel ? ` / **${techLabel}**` : ''} ` +
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
    'Ne demek, yardımcı olabildiysem ne mutlu! '
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

/* ===== HATA 1 & 2: Türkçe kök eşleme + dil bağımsız topic ===== */

const PROGRAMMING_SUBTOPICS = {
  'değişkenler': {
    roots: ['değişken', 'degisken', 'variable'],
    title: 'Değişkenler',
    analogy: 'Bir kutunun içine bir eşya koyduğunu düşün. Kutunun üzerinde "Telefon" etiketi var. Bu kutu değişken gibidir: bir isim verirsin ve o isim altında bir değer tutarsın.',
    explanation: 'Programlamada değişken, bir değeri hafızada tutmak için verilen isimdir. Bir kutu gibi düşün: kutunun üstündeki etiket değişkenin adı, kutunun içindeki eşya ise değişkenin değeridir. Değeri istediğin zaman değiştirebilirsin.',
    summary: 'Değişken = isim + değer. İsimle değere ulaşır, istediğin zaman değiştirirsin.',
    languages: {
      python: 'Python\'da bir değişken oluşturmak için bir isim yazıp eşittir işareti koyar ve değerini verirsin. Örneğin: yas = 25 yazdığında "yas" değişkeninin değeri 25 olur. Daha sonra bu ismi kullandığında Python o değeri getirir. Değeri sonradan değiştirebilirsin: yas = 26 dediğinde artık değer 26 olur.',
      javascript: 'JavaScript\'te bir değişken oluşturmak için let veya const kullanırsın. Örneğin: let yas = 25 yazdığında "yas" değişkeninin değeri 25 olur. let ile sonradan değiştirebilirsin (yas = 26), const ise değiştirilemez. Değişkeni kullandığında JavaScript o değeri getirir.'
    }
  },
  'listeler': {
    roots: ['liste', 'list', 'array', 'dizi'],
    title: 'Listeler',
    analogy: 'Bir alışveriş listesi düşün: yumurta, ekmek, süt diye alt alta yazarsın. Bu liste tek bir kağıtta birden fazla öğeyi sırayla tutar.',
    explanation: 'Liste, birden fazla değeri tek bir isim altında sırayla tutmaktır. Listeye ekleme yapabilir, içindekileri sıra numarasıyla ulaşabilir, çıkarabilirsin.',
    summary: 'Liste = sıralı değer koleksiyonu. Sıra numarasıyla ulaşır, ekler çıkarırsın.',
    languages: {
      python: 'Python\'da liste köşeli parantezle oluşturulur. Örneğin: meyveler = ["elma", "armut", "muz"] yazdığında üç meyveyi bir arada tutarsın. İlk öğeye meyveler[0], ikinciye meyveler[1] ile ulaşırsın. Yeni öğe eklemek için .append() kullanırsın.',
      javascript: 'JavaScript\'te dizi köşeli parantezle oluşturulur. Örneğin: const meyveler = ["elma", "armut", "muz"] yazdığında üç meyveyi bir arada tutarsın. İlk öğeye meyveler[0] ile ulaşırsın. Yeni öğe eklemek için .push() kullanırsın.'
    }
  },
  'fonksiyonlar': {
    roots: ['fonksiyon', 'function', 'metod', 'metot'],
    title: 'Fonksiyonlar',
    analogy: 'Bir tarif düşün: "yumurtalı ekmek yap" dediğinde birisi yumurtayı çırpıp ekmeği ısırıp tavada kızartır. Tarifin adı fonksiyon, içeriği ise o işi yapma adımlarıdır.',
    explanation: 'Fonksiyon, belirli bir işi yapan ve yeniden kullanılabilen bir kod bloğudur. Bir kez tanımlarsın, sonra istediğin kadar çağırırsın. Girdi alabilir ve sonuç döndürebilir.',
    summary: 'Fonksiyon = adı + işi + girdi/çıktı. Bir kez yaz, birçok kez kullan.',
    languages: {
      python: 'Python\'da fonksiyon def kelimesiyle oluşturulur. Örneğin: def merhaba_de(ad): print("Merhaba " + ad) yazdığında bir fonksiyon tanımlamış olursun. merhaba_de("Ahmet") diye çağırdığında "Merhaba Ahmet" çıktısı alırsın.',
      javascript: 'JavaScript\'te fonksiyon function kelimesiyle oluşturulur. Örneğin: function merhabaDe(ad) { console.log("Merhaba " + ad); } yazdığında bir fonksiyon tanımlamış olursun. merhabaDe("Ahmet") diye çağırdığında "Merhaba Ahmet" çıktısı alırsın.'
    }
  },
  'döngüler': {
    roots: ['döngü', 'dongu', 'loop'],
    title: 'Döngüler',
    analogy: 'Bir koşucunun pistte tur atması gibi: her tur aynı adımları tekrarlar ama her tur bir öncekinden devam eder.',
    explanation: 'Döngü, aynı işlemi belirli bir koşul sağlanana veya listedeki her öğe bitene kadar tekrarlamaktır. Tekrarı elle yazmak yerine döngü kullanırsın.',
    summary: 'Döngü = tekrar mekanizması. for listeyle, while koşulla çalışır.',
    languages: {
      python: 'Python\'da for döngüsü bir listedeki her öğeyi sırayla gezer. Örneğin: for meyve in meyveler: print(meyve) yazdığında listedeki her meyveyi tek tek yazdırır. while döngüsü ise bir koşul doğru olduğu sürece devam eder.',
      javascript: 'JavaScript\'te for döngüsü bir dizideki her öğeyi gezer. Örneğin: for (const meyve of meyveler) { console.log(meyve); } yazdığında dizideki her meyveyi tek tek yazdırır. while döngüsü ise bir koşul doğru olduğu sürece devam eder.'
    }
  },
  'koşullar': {
    roots: ['koşul', 'kosul', 'if', 'else', 'şart'],
    title: 'Koşullar (if/else)',
    analogy: 'Bir kavşakta yol ayrımında "Eğer yağmur varsa şemsiye al, değilse gözlük al" demek gibi: duruma göre farklı şeyler yaparsın.',
    explanation: 'Koşul, programa "eğer şu durum varsa şunu yap, yoksa bunu yap" demektir. Bu sayede program farklı durumlarda farklı davranır.',
    summary: 'Koşul = duruma göre karar. if doğruysa, else değilse çalışır.',
    languages: {
      python: 'Python\'da if ile koşul yazarsın. Örneğin: if yas >= 18: print("Erişkin") else: print("Çocuk") yazdığında yaş 18\'den büyükse "Erişkin", değilse "Çocuk" yazdırır.',
      javascript: 'JavaScript\'te if ile koşul yazarsın. Örneğin: if (yas >= 18) { console.log("Erişkin"); } else { console.log("Çocuk"); } yazdığında yaş 18\'den büyükse "Erişkin", değilse "Çocuk" yazdırır.'
    }
  },
  'sınıflar': {
    roots: ['sınıf', 'sinif', 'class', 'nesne', 'object'],
    title: 'Sınıflar ve Nesneler',
    analogy: 'Bir ev planı düşün: plan kağıdı sınıftır, o plandan yapılmış ev ise nesnedir. Birden fazla ev yapabilirsin, hepsi aynı plana göre ama içleri farklıdır.',
    explanation: 'Sınıf, bir şablon gibidir; nesne o şablondan üretilmiş örnek. Sınıf özellikleri ve davranışları tanımlar, nesne ise onları somut değerlerle kullanır.',
    summary: 'Sınıf = şablon, nesne = o şablondan örnek.',
    languages: {
      python: 'Python\'da class kelimesiyle sınıf oluşturulur. Sınıf içine özellikler ve metotlar yazılır. Sınıftan nesne oluşturduğunda, o nesne sınıfın özelliklerini alır.',
      javascript: 'JavaScript\'te class kelimesiyle sınıf oluşturulur. Sınıf içine constructor ve metotlar yazılır. new anahtar kelimesiyle nesne oluşturduğunda, o nesne sınıfın özelliklerini alır.'
    }
  },
  'modüller': {
    roots: ['modül', 'modul', 'module', 'import'],
    title: 'Modüller',
    analogy: 'Bir alet çantası düşün: her çekmece farklı aletleri tutar. İhtiyacın olan aleti o çekmeceden alırsın. Modül de bu çekmece gibidir.',
    explanation: 'Modül, hazır işlevleri bir arada tutan bir pakettir. import diyerek o paketten istediğin işlevi kullanırsın.',
    summary: 'Modül = hazır paket. import ile yükler, içindekini kullanırsın.',
    languages: {
      python: 'Python\'da import ile modül yüklersin. Örneğin: import random yazdığında rastgele sayı üretme işlevini kullanabilirsin. from random import randint diyerek sadece istediğin parçayı da alabilirsin.',
      javascript: 'JavaScript\'te import (ES modülleri) veya require (CommonJS) ile modül yüklersin. Örneğin: import { randint } from "random" veya const fs = require("fs") yazdığında modülün işlevlerini kullanabilirsin.'
    }
  },
  'tipler': {
    roots: ['tip', 'veri tipi', 'veri tipleri', 'type'],
    title: 'Veri Tipleri',
    analogy: 'Farklı kutular düşün: biri kitap için, biri yiyecek için, biri para için. Her kutu farklı türde şey tutar. Veri tipleri de böyledir.',
    explanation: 'Veri tipi, bir değerin ne tür olduğunu belirtir: sayı, metin, ondalıklı sayı gibi. Python tipi otomatik anlar ama senin de bilmen gerekir.',
    summary: 'Veri tipi = değerin türü. Sayı, metin, ondalıklı, mantıksal.',
    languages: {
      python: 'Python\'da temel tipler: int (tam sayı), float (ondalıklı), str (metin), bool (doğru/yanlış). Örneğin 25 bir int, "Merhaba" bir str, 3.14 bir float\'tur.',
      javascript: 'JavaScript\'te temel tipler: number (sayı), string (metin), boolean (doğru/yanlış). Örneğin 25 bir number, "Merhaba" bir string, true bir boolean\'dır.'
    }
  },
  'stringler': {
    roots: ['string', 'metin', 'karakter'],
    title: 'Stringler (Metinler)',
    analogy: 'Bir kitap düşün: harfler yan yana gelerek kelimeleri, kelimeler cümleleri oluşturur. String de harflerin yan yana gelmesiyle oluşan metindir.',
    explanation: 'String, harflerin yan yana dizilmesiyle oluşan metin değeridir. Tırnak içinde yazılır ve metin işlemleri için kullanılır.',
    summary: 'String = tırnak içinde metin. Birleştir, parçala, ara.',
    languages: {
      python: 'Python\'da string tırnak işaretiyle oluşturulur. Örneğin: ad = "Ahmet" yazdığında ad değişkeni bir string olur. Stringleri birleştirebilir, parçalayabilir, içinde arama yapabilirsin.',
      javascript: 'JavaScript\'te string tırnak işaretiyle oluşturulur. Örneğin: const ad = "Ahmet" yazdığında ad değişkeni bir string olur. Template literal (\\`Merhaba ${ad}\\`) ile birleştirme yapabilirsin.'
    }
  }
};

const TEACHING_SIGNALS = Object.freeze([
  'öğret', 'öğretmek', 'öğrenmek istiyorum', 'öğreniyorum',
  'adım adım anlat', 'çok basit şekilde öğret', 'basit şekilde öğret',
  'yeni başladım', 'sıfırdan anlat', 'sıfırdan öğret',
  'bana öğret', 'önce öğret', 'anlat', 'öğretir misin',
  '12 yaşındaki birine anlat', '12 yaşındaki bir çocuğa anlat'
]);

function detectTeachingIntent(text) {
  return hasAny(text, TEACHING_SIGNALS);
}

/* HATA 1: Türkçe kök eşleme ile subtopic tespiti */
function detectProgrammingSubtopic(text) {
  const t = norm(text);
  for (const [key, info] of Object.entries(PROGRAMMING_SUBTOPICS)) {
    // Önce alias olarak eklenen tam eşleşmeleri dene
    if (info.aliases && hasAny(t, info.aliases)) return key;
    // Türkçe kök eşleme: değişken, değişkenler, değişkeni, değişkenleri
    if (info.roots && hasTurkishRootAny(t, info.roots)) return key;
  }
  return null;
}

/* Eski detectFormatRequest — geriye dönük uyumluluk için */
function detectFormatRequestSimple(text) {
  return hasAny(text, [
    'günlük hayattan', 'günlük hayattan örnek', 'günlük örnek',
    'günlük yaşamdan', 'önce günlük', 'günlük hayattan bir örnek'
  ]);
}

function detectFormatRequest(text) {
  return detectFormatRequestSimple(text);
}

/* HATA 2: Dil bağımsız topic + dil bağımlı anlatım */
function getLanguageExplanation(info, language) {
  if (!info.languages) return info.python || info.explanation;
  return info.languages[language] || info.languages.python || info.explanation;
}

function getLangLabel(language) {
  return LANG_LABELS[language] || 'Python';
}

function teachingResponse(subtopicKey, analysis, text, conversationState) {
  const info = PROGRAMMING_SUBTOPICS[subtopicKey];
  if (!info) return null;

  // HATA 2: Dili doğru seç
  const lang = analysis.language || conversationState?.language || 'python';
  const langLabel = getLangLabel(lang);
  const langExplanation = getLanguageExplanation(info, lang);

  const isBeginner = analysis.userLevel === 'beginner' ||
    hasAny(text, ['çok basit', 'basit', 'yeni başladım',
      '12 yaşındaki', '12 yaşında']);
  const wantsFormat = detectFormatRequest(text) ||
    (conversationState?.formatRequest === 'daily_life_example');
  const simpler = hasAny(text, ['daha basit', 'daha sade', 'daha kolay']) ||
    (conversationState?.followUpAction === 'simplify');

  const intro = simpler
    ? `## ${info.title} — daha basit anlatım`
    : isBeginner
      ? `## ${info.title} — başlangıç seviyesi`
      : `## ${info.title}`;

  if (wantsFormat) {
    return `${intro}

Günlük hayattan örnek

${info.analogy}

Bunun programlamadaki karşılığı

${info.explanation}

${langLabel}'da kavramsal olarak

${langExplanation}

Kısa özet

${info.summary}

Bu açıklamada kod üretmedim.`;
}

  if (isBeginner || simpler) {
    return `${intro}

${info.analogy}

${info.explanation}

${langLabel}'da: ${langExplanation}

Özet: ${info.summary}

Bu açıklamada kod üretmedim.`;
}

  return `${intro}

${info.explanation}

${langLabel}'da: ${langExplanation}

Özet: ${info.summary}

Bu açıklamada kod üretmedim.`;
}

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
  // Güncellik sinyali varsa yerel bilgi tabanı yetersizdir
  if (hasAny(norm(text), FRESHNESS_SIGNALS)) return null;
  for (const [key, answer] of Object.entries(KNOWN_KNOWLEDGE)) {
    const matchesKey = hasAny(text, [key]) ||
      (key === 'python' && /\bpython\w*\b/iu.test(norm(text)));
    if (matchesKey) {
      if (type === INTENTS.HOW && key === 'python') {
        return `**Python kullanmaya başlamak için:** Python'u kur, bir \`.py\` dosyası oluştur, \`print("Merhaba")\` gibi küçük bir kod çalıştır ve ardından değişken, koşul, döngü ve fonksiyonlarla ilerle.`;
      }
      if (type === INTENTS.WHAT || type === INTENTS.HOW) return answer;
    }
  }
  return null;
}

function unknownKnowledgeResponse(topic, type, conversationState) {
  const contextualLabel = conversationState?.topic && conversationState?.subtopic
    ? `${conversationState.topic} içindeki ${conversationState.subtopic}`
    : topic;
  const label = contextualLabel ? `"${truncate(contextualLabel, 120)}"` : 'bu konu';
  const wording = type === INTENTS.HOW
    ? `${label} için konuya özel doğrulanmış bir bilgi kaynağım yok.`
    : `${label} hakkında elimde yeterli doğrulanmış bilgi yok.`;
  return `${wording} Elindeki metni, kaynağı veya kullandığın ortamı gönderirsen onun üzerinden yardımcı olabilirim.`;
}

function questionResponse(text, topic, type, context, conversationState) {
  const progSubtopic = detectProgrammingSubtopic(text) ||
    (conversationState?.subtopic ? detectProgrammingSubtopic(conversationState.subtopic) : null);
  if (progSubtopic) {
    const lang = detectLanguageHint(text) || conversationState?.language || 'python';
    const teachingResult = teachingResponse(progSubtopic,
      { language: lang, userLevel: detectUserLevel(text), constraints: { noCode: hasNoCodeConstraint(text) } },
      text, conversationState);
    if (teachingResult) return teachingResult;
  }
  const known = knownKnowledgeResponse(text, type);
  if (known) return known;
  // Güncellik sinyali varsa web yönlendirmesi
  if (hasAny(norm(text), FRESHNESS_SIGNALS)) {
    return 'Bu soru güncel bilgi gerektiriyor. Web araştırması yaparak cevap verebilirim — `generateAsync` kullan.';
  }
  return unknownKnowledgeResponse(topic, type, conversationState);
}

function explanationResponse(text, analysis, topic, conversationState) {
  if (analysis.task === 'discord_bot' ||
    hasAny(text, ['discord bot', 'discord botu'])) {
    const commandToken = extractCommandToken(text) ||
      (typeof conversationState?.subtopic === 'string' && conversationState.subtopic.startsWith('!')
        ? conversationState.subtopic : '');
    if (commandToken && commandToken.startsWith('!')) {
      return `## ${commandToken} komutu nasıl çalışır?

${commandToken}, Discord botlarında belirli bir işlemi başlatan komut olarak ele alınır. Kullanıcı komutu gönderir; bot mesajı algılar, komut adını ve varsa parametreleri ayırır, yetki/izin kontrolü yapar ve ardından uygun yanıtı gönderir.

Basit akış: mesaj gelir → ${commandToken} tanınır → izinler kontrol edilir → komut işlemi çalışır → bot yanıt verir.

Bu açıklamada kod üretmedim.`;
        }
        const subtopic = typeof conversationState?.subtopic === 'string' &&
          !conversationState.subtopic.startsWith('!')
            ? conversationState.subtopic : '';
        if (subtopic) {
          return `## Discord botunda ${truncate(subtopic, 80)} nasıl çalışır?

Discord botlarında ${truncate(subtopic, 80)}, botun kullanıcılarla etkileşim kurmasını sağlayan yapıdır. Kullanıcı bir mesaj veya komut gönderdiğinde bot bunu algılar, içeriği değerlendirir ve ${truncate(subtopic, 80)} kapsamındaki işlemi yürütür.

Temel akış:

Kullanıcı, botun beklediği biçimde bir mesaj gönderir.

Bot mesajı algılar ve ${truncate(subtopic, 80)} ile ilgili kısmı ayrıştırır.

Gerekli izin ve koşul kontrolleri yapılır.

Bot, uygun işlemi çalıştırır ve sonucu kullanıcıya gönderir.

Bu açıklamada kod üretmedim.`;
        }
        const levelText = analysis.userLevel === 'beginner'
          ? 'Başlangıç seviyesinde düşünürsek: '
          : '';
        return `## Discord botu nasıl çalışır?

${levelText}Discord botu, Discord'un API'sine bağlanan ve sunucudaki olaylara tepki veren bir programdır. Kullanıcı mesaj gönderdiğinde, bir komut kullandığında veya bot hazır olduğunda Discord bir olay iletir; bot da bu olaya göre işlem yapar ve yanıt gönderir.

Temel akış:

Discord Developer Portal'da bir uygulama ve bot oluşturulur.

Bot, güvenli bir token ile Discord'a bağlanır.

Gerekli gateway intent ve sunucu izinleri açılır.

Gelen mesaj veya komutlar ayrıştırılır.

Bot, komuta uygun yanıtı veya işlemi üretir.

Başlangıç için sıra: Önce Python temellerini öğren, ardından Discord botlarının olay/komut mantığını kavra, küçük bir merhaba komutuyla dene ve sonra izinler ile hata yönetimine geç. Bu açıklamada özellikle kod üretmedim.`;
}

  const teachingSubtopic = detectProgrammingSubtopic(text) ||
    (conversationState?.subtopic ? detectProgrammingSubtopic(conversationState.subtopic) : null);
  const isTeaching = detectTeachingIntent(text) ||
    (conversationState?.subtopic && detectProgrammingSubtopic(conversationState.subtopic) &&
      hasAny(text, ['anlat', 'açıkla', 'daha basit']));
  if (teachingSubtopic && (isTeaching || detectFormatRequest(text) ||
      analysis.userLevel === 'beginner' || hasAny(text, ['daha basit'])) ||
      conversationState?.followUpAction === 'simplify' ||
      conversationState?.formatRequest === 'daily_life_example') {
    const teachingAnalysis = analysis.language
      ? analysis
      : { ...analysis, language: conversationState?.language || 'python' };
    const teachingResult = teachingResponse(teachingSubtopic, teachingAnalysis, text, conversationState);
    if (teachingResult) return teachingResult;
  }

  if (teachingSubtopic && (analysis.constraints.noCode ||
      hasAny(text, ['nedir', 'ne demek', 'ne olduğunu', 'nasıl']))) {
    const teachingAnalysis = analysis.language
      ? analysis
      : { ...analysis, language: conversationState?.language || 'python' };
    const teachingResult = teachingResponse(teachingSubtopic, teachingAnalysis, text, conversationState);
    if (teachingResult) return teachingResult;
  }

  const isPureGenericQuestion = !teachingSubtopic && (
    hasAny(text, ['nedir', 'ne demek', 'ne anlama gelir', 'hakkında bilgi']));

  if (isPureGenericQuestion) {
    const known = knownKnowledgeResponse(text, INTENTS.WHAT) ||
      knownKnowledgeResponse(text, INTENTS.HOW);
    if (known) return `${known}\n\nİstersen bunu kod göstermeden kavramsal adımlara da ayırabilirim.`;
  }

  const label = conversationState?.topic || topic;
  return label
    ? `**${truncate(label, 90)}** konusunu kod yazmadan açıklayabilirim; önce ne olduğunu, nasıl çalıştığını ve temel adımları sırayla ele alalım.`
    : 'Konuyu kod yazmadan açıklayabilirim; önce ne olduğunu, nasıl çalıştığını ve temel adımları sırayla ele alalım.';
}

/* ===== HATA 4: Geliştirilmiş contextual task guidance ===== */

function contextualTaskGuidance(text, conversationState) {
  const state = conversationState || {};

  // Discord botu komut açıklaması (önce kontrol et — 'nasıl' ortak)
  if ((state.task === 'discord_bot' || hasAny(text, ['discord bot', 'discord botu'])) &&
    hasAny(text, ['komutlar nasıl', 'komutlar nasıl çalışıyor', 'komutlar nasıl çalışır',
      'komut nedir', 'komutlar nedir'])) {
return `## Discord botunda komutlar nasıl çalışıyor?

Discord botlarında komutlar, botun belirli mesaj biçimlerine verdiği tepkilerdir. Kullanıcı \`!\` gibi bir ön ek ile başlayan bir mesaj gönderdiğinde bot bunu algılar.

Temel akış:

Kullanıcı bir mesaj gönderir (örn. \`!merhaba\`).

Bot mesajı alır ve komut ön ekini tanır.

Komut adı ve varsa parametreler ayrıştırılır.

İlgili komut fonksiyonu çalışır.

Bot, komuta uygun yanıtı kanala gönderir.

Bu açıklamada kod üretmedim.`;
}

  // Discord botu çalıştırma rehberi
  if ((state.task === 'discord_bot' || hasAny(text, ['discord bot', 'discord botu'])) &&
    hasAny(text, ['çalıştır', 'çalıştıracağım', 'çalıştırmak', 'nasıl çalıştır',
      'nasıl başlat', 'başlatacağım', 'çalıştırır mısın'])) {
    const lang = state.language || 'python';
    if (lang === 'python') {
      return `## Python Discord botunu çalıştırma adımları

discord.py kur: Terminalde \`pip install -U discord.py\` çalıştır.

Bot dosyasını kaydet: Kodu \`bot.py\` gibi bir dosyaya kaydet.

DISCORD_TOKEN ayarla: Ortam değişkeni olarak \`export DISCORD_TOKEN=token_metnin\` (Windows: \`set DISCORD_TOKEN=...\`).

Çalıştır: Terminalde ```python bot.py``` (bazı sistemlerde `python3 bot.py`).

Çevrimiçi kontrol et: Bot Discord'da çevrimiçi görünmelidir. Görünmüyorsa token ve intent ayarlarını kontrol et.`;
   }
   if (lang === 'javascript') {
     return `## JavaScript Discord botunu çalıştırma adımları

discord.js kur: Terminalde ```npm install discord.js``` çalıştır.

Bot dosyasını kaydet: Kodu ```bot.js``` gibi bir dosyaya kaydet.

DISCORD_TOKEN ayarla: Ortam değişkeni olarak `export DISCORD_TOKEN=token_metnin` (Windows: `set DISCORD_TOKEN=...`).

Çalıştır: Terminalde ```node bot.js```.

Çevrimiçi kontrol et: Bot Discord'da çevrimiçi görünmelidir. Görünmüyorsa token ve intent ayarlarını kontrol et.`;
}
}

// Sayı tahmin oyunu çalıştırma
if (state.task === 'guess_game' &&
hasAny(text, ['nasıl', 'çalıştır', 'çalıştıracağım'])) {
return `Python'daki sayı tahmin oyunu için çalıştırma adımları:

Kodu ```tahmin.py``` gibi bir dosyaya kaydet.

Terminali dosyanın bulunduğu klasörde aç.

```python tahmin.py``` komutunu çalıştır. Bazı sistemlerde `python3 tahmin.py` olabilir.

Programın istediği tahmini yazıp Enter'a bas.`;
}
return null;
}

/* ===== HATA 10: Gerçek alternatif üretimi ===== */

function alternativeResponse(text, conversationState) {
  const simpler = hasAny(text, ['daha basit', 'basit anlat', 'kısaca']);
  const state = conversationState || {};

  // Sayı tahmin oyunu için gerçek alternatif
  if (state.task === 'guess_game' && state.language === 'python' &&
    !state.constraints?.noCode) {
    const code = `gizli_sayi = 7

tahmin = int(input("Tahminin: "))

if tahmin == gizli_sayi:
print("Bildin!")
else:
print("Bu kez olmadı.");`
        return `## ${simpler ? 'Daha basit ' : ''}alternatif sayı tahmini\n\n` +
        `${codeFence('python', code)}\n\nBu sürüm tek tahmin alır; önceki döngülü örnekten daha kısa bir alternatiftir.`;
}

  // Hesap makinesi için alternatif
  if (state.task === 'calculator' && state.language === 'python' &&
    !state.constraints?.noCode) {
    const code = `islem = input("İşlem (örn. 5 + 3): ")

sayilar = islem.split()
a, op, b = int(sayilar[0]), sayilar[1], int(sayilar[2])

if op == "+": print(a + b)
elif op == "-": print(a - b)
elif op == "*": print(a * b)
elif op == "/": print(a / b if b else "Sıfıra bölme");`
        return `## ${simpler ? 'Daha basit ' : ''}alternatif hesap makinesi\n\n` +
        `${codeFence('python', code)}\n\nBu sürüm kullanıcıdan işlemi tek satırda alır; önceki fonksiyon tabanlı örnekten farklı bir yaklaşımdır.`;
}

  // Teaching konusu için kodsuz alternatif
  if (state.constraints?.noCode || !state.wantsCode) {
    const topic = state.topic || 'Bu konu';
    return `**${truncate(topic, 90)}** için kodsuz, daha basit bir açıklama verebilirim: önce amacı, sonra temel akışı ve en son uygulanacak adımları anlatacağım.`;
  }

  return `**${truncate(state.topic || 'Aynı konu', 90)}** için farklı bir örnek hazırlayabilirim. ` +
    (simpler ? 'Bu kez daha kısa ve başlangıç seviyesinde ilerleyeceğim.' : 'Önceki örneği tekrarlamak yerine farklı bir yaklaşım kullanacağım.');
}

function responseForQuestion(text, topic, type, context, conversationState) {
  const providerAnswer = KnowledgeProvider.answer({
    userMsg: text,
    context: Array.isArray(context) ? context : [],
    intent: type,
    topic,
    conversationState: conversationState || null
  });
  if (providerAnswer) return providerAnswer;
  if (type === INTENTS.WHO) {
    return unknownKnowledgeResponse(topic, type, conversationState);
  }
  if (type === INTENTS.WHEN || type === INTENTS.WHERE || type === INTENTS.HOW_MANY) {
    return unknownKnowledgeResponse(topic, type, conversationState);
  }
  return questionResponse(text, topic, type, context, conversationState);
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

function parseCount(text) {
  const t = norm(text);
  // "5 tane", "5 adet"
  const m = t.match(/(\d+)\s*(tane|adet)/);
  if (m) return Number(m[1]);
  // "beş tane", "beş adet"
  const wordNumbers = {
    'bir': 1, 'iki': 2, 'üç': 3, 'dört': 4, 'beş': 5,
    'altı': 6, 'yedi': 7, 'sekiz': 8, 'dokuz': 9, 'on': 10
  };
  for (const [word, num] of Object.entries(wordNumbers)) {
    if (new RegExp(`${word}\\s*(tane|adet)`, 'u').test(t)) return num;
  }
  return null;
}

function detectRecommendation(text) {
  const t = norm(text);
  const originalVerbs = hasAny(t, [
    'öner', 'öneri', 'tavsiye', 'ne izleyeyim', 'ne okuyayım',
    'ne dinleyeyim', 'ne yiyeyim', 'seç'
  ]);
  const broadVerbs = hasAny(t, [
    'söyle', 'göster', 'listele', 'say', 'ver', 'bul'
  ]);
  if (!originalVerbs && !broadVerbs) return null;

  let category = null;
  if (/\b(film|filim|dizi|izle)\w*/u.test(t)) category = 'movie';
  else if (/\b(kitap|oku)\w*/u.test(t)) category = 'book';
  else if (/\b(müzik|şarkı|dinle|parça)\w*/u.test(t)) category = 'music';
  else if (/\b(yemek|pişir|menü|tarif|yiyecek)\w*/u.test(t)) category = 'food';
  else if (/\b(şehir|gezi|tatil|nereye)\w*/u.test(t)) category = 'city';
  else if (/\b(oyun|oyna)\w*/u.test(t)) category = 'game';

  const yearMatch = textOf(text).match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const count = parseCount(t);

  // Geniş fiiller (söyle, göster, vb.) en az bir kategori/yıl/sayı
  // gerektirir; tek başına öneri tetiklemesin.
  if (!originalVerbs && broadVerbs && !category && !year && !count) {
    return null;
  }

  return {
    intent: 'recommendation',
    category,
    genre: category === 'movie' ? detectMovieGenre(text) : null,
    year,
    count
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

\`/brainstorm <konu>\` → fikir üret

\`/explain <konu>\` → konuyu açıkla

\`/compare A vs B\` → karşılaştır

\`/summarize\` → metin özetle

\`/code-review\` → kod inceleme kontrol listesi

\`/debug\` → hata ayıklama rehberi;
`;
  }
  if (command === '/brainstorm') {
    const topic = argument || 'genel konu';
return `# 🧠 Beyin Fırtınası: ${topic}

1. Amaç tanımla — ${topic} ile hangi sorunu çözüyorsun?
2. **Küçük parçalara böl** — Büyük hedefi alt görevlere ayır.
3. **Alternatif yaklaşımlar** — En az iki farklı yöntem düşün.
4. **Risk ve avantaj** — Her yöntemin artılarını ve eksilerini yaz.
5. **Önceliklendir** — En düşük riskle en yüksek değer veren yöntemi seç.

Hangi yönde derinleşmemi istersen yaz.`;
  }
  if (command === '/explain') {
return argument
  ? `${truncate(argument, 120)} konusunu adım adım açıklayabilirim. Önce ne olduğunu, sonra nasıl çalıştığını ve son olarak nerelerde kullanıldığını ele alırım.`
  : 'Açıklamamı istediğin konuyu /explain <konu> biçiminde yaz.';
  }
  if (command === '/compare') {
    const parts = argument.split(/\s+vs\s+/i);
    if (parts.length < 2) return 'Karşılaştırma için/compare A vs Bbiçimini kullan.';
    const [a, b] = parts;
    return `## ${a} vs ${b}\n\n| Özellik | ${a} | ${b} |\n|---|---|---|\n| Tip | Bağlama göre değişir | Bağlama göre değişir |\n| Kullanım | Bağlama göre değişir | Bağlama göre değişir |\n| Performans | Bağlama göre değişir | Bağlama göre değişir |\n| Öğrenme eğrisi | İhtiyaca bağlı | İhtiyaca bağlı |\n\nKullanım senaryonu yazarsan bu tabloyu gerçek ölçütlerle doldurabilirim.`;
  }
  if (command === '/summarize') {
return argument
  ? `${truncate(argument, 200)} metnini özetleyebilirim. Ancak gerçek özet için metnin tamamını göndermen gerekir.`
  : 'Özetlememi istediğin metni /summarize <metin> biçiminde gönder.';
  }
  if (command === '/code-review') {
    return 'Kodunu gönderirsen kalite, güvenlik, hata yönetimi, performans ve test başlıklarında inceleyebilirim.';
  }
  if (command === '/debug') {
    return 'Hata mesajını, ilgili kodu ve beklenen/gerçekleşen davranışı gönder. Kök nedeni adım adım ayırabiliriz.';
  }
  if (command === '/content-enhance' || command === '/content:enhance') {
return argument
  ? `Metni şu başlıklarda iyileştirebilirim: yapı, açıklık, ton, başlık ve çağrı. Metin: ${truncate(argument, 300)}`
  : 'İyileştirmem için metni /content-enhance <metin> biçiminde gönder.';
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

Tam hata mesajı veya stack trace

Hatanın oluştuğu kod parçası

Beklenen ve gerçekleşen davranış

Dil, framework ve sürüm

Bu bilgiler olmadan rastgele bir düzeltme önermeyeceğim.`;
}

function whyDebugResponse() {
  return `## 🔍 Sorun neden oluşuyor olabilir?

"Çalışmıyor" ifadesi tek başına kök nedeni göstermiyor. En sık nedenler yanlış token/ayar, eksik izin, yanlış sürüm veya hata yönetimi eksikliğidir.

Tam hata mesajını, ilgili kodu ve kullandığın dil/framework sürümünü gönderirsen nedeni ayırıp doğrudan düzeltme önerebilirim.`;
}

function generalFallback(topic) {
  if (topic) {
    return `"${truncate(topic, 100)}" isteğini tam olarak sınıflandıramadım. ` +
      'Ne üretmemi, açıklamamı veya düzeltmemi istediğini bir cümle daha açarsan konuya uygun ilerleyebilirim.';
  }
  return 'Tam olarak ne yapmak istediğini biraz daha açarsan yardımcı olabilirim. İstersen hedefini ve kullandığın dili/ortamı yaz.';
}

function gameHowResponse(text, conversationState) {
  const minecraftContext = hasAny(text, ['minecraft']) ||
    hasAny(conversationState?.topic, ['minecraft']);
  const topic = minecraftContext ? 'Minecraft korku oyunu' : 'oyun';
  return `## 🎮 ${capitalize(topic)} için başlangıç planı

Platformu seç: Minecraft Java mı, Bedrock mı? Mod, datapack veya addon yaklaşımı buna göre değişir.

Küçük bir korku prototipi kur: Tek bir alan, kısa bir hedef ve bir gerilim olayıyla başla.

Atmosferi tasarla: Görüş mesafesi, ışık, ses ve oyuncunun ne zaman bilgi alacağına karar ver.

Olay akışını yaz: Oyuncu ne yapacak, hangi koşulda olay tetiklenecek, nasıl bitecek?

Tekrar tekrar test et: Oyuncunun kaybolmadığını ve korku unsurunun rastgele değil, kontrollü çalıştığını kontrol et.

Tam kurulum ve örnek dosya hazırlamam için Java/Bedrock sürümünü ve mod mu, datapack mi istediğini belirtmen gerekir.`;
}

/* ===== HATA 12: "Python öğreniyorum" öğrenme modu ===== */

function isLearningModeRequest(text) {
  const t = norm(text);
  if (hasAny(t, ['öğreniyorum', 'öğrenmeye başladım', 'öğrenmeye yeni başladım',
    'öğrenmek istiyorum']) && !detectProgrammingSubtopic(t)) {
    // Programlama dili geçiyor ama subtopic yok → öğrenme modu
    const lang = detectLanguageHint(t);
    if (lang) return lang;
  }
  return null;
}

function learningModeResponse(language) {
  const langLabel = getLangLabel(language);
  return `Harika! **${langLabel}** öğreniyorsan şu konularla başlayabiliriz:

Değişkenler — verileri saklamanın temel yolu

Koşullar — programın karar vermesi (if/else)

Döngüler — tekrarlayan işleri otomatikleştirme

Fonksiyonlar — kodu yeniden kullanılabilir bloklara bölme

Hangisinden başlamak istersin? "Değişkenleri öğret" yazman yeterli.`;
}

/* ============== WEB ARAŞTIRMA KATMANI ============== */

let webProvider = {
  search: async () => []
};

const WebProvider = {
  async search(payload) {
    try {
      const results = await webProvider.search(payload);
      return Array.isArray(results) ? results : [];
    } catch (_) {
      return [];
    }
  }
};

function setWebProvider(provider) {
  webProvider = provider && typeof provider.search === 'function'
    ? provider
    : { search: async () => [] };
}

// İleride cache eklenebilecek genişletilebilir yapı
const webCache = {
  _store: new Map(),
  set(key, value) { this._store.set(key, value); },
  get(key) { return this._store.get(key) || null; },
  has(key) { return this._store.has(key); },
  clear() { this._store.clear(); }
};

// Açık güncellik/web sinyalleri — en yüksek öncelik
const FRESHNESS_SIGNALS = Object.freeze([
  'en son', 'son sürüm', 'en son sürüm', 'güncel sürüm', 'güncel',
  'en yeni', 'son duyuru', 'güncel duyuru',
  'bugün', 'bugünkü', 'şu an', 'şimdi',
  'son zamanlarda', 'yakın zamanda',
  'latest', 'newest', 'current', 'news', 'haber',
  'bugünkü haber', 'güncel haber', 'günün haber',
  'güncel hava', 'hava durumu', 'bugün hava',
  'şu anki fiyat', 'güncel fiyat', 'bugünkü fiyat',
  'bugün ne', 'bu hafta', 'bu ay'
]);

// Konu yerel bilgi tabanında var mı?
function isKnownLocalTopic(text) {
  const t = norm(text);
  for (const key of Object.keys(KNOWN_KNOWLEDGE)) {
    if (hasAny(t, [key])) return true;
  }
  if (detectProgrammingSubtopic(t)) return true;
  return false;
}

// Web GEREKMEYEN durumlar
function isLocalOnly(text, analysis) {
  const t = norm(text);
  // Matematik
  if (tryCalculate(text) !== null) return true;
  // Greeting
  const firstToken = t.split(' ')[0];
  if (['merhaba', 'selam', 'hey', 'hi', 'hello', 'günaydın', 'sa'].includes(firstToken)) return true;
  // Binary reply
  if (isBinaryReply(t)) return true;
  // Code generation
  if (analysis?.wantsCode) return true;
  // Teaching (subtopic var + öğretme niyeti)
  if (detectProgrammingSubtopic(t)) return true;
  // Known knowledge
  for (const key of Object.keys(KNOWN_KNOWLEDGE)) {
    if (hasAny(t, [key])) return true;
  }
  // Follow-up
  if (detectFollowUpAction(t) || detectFormatRequest(t)) return true;
  return false;
}

function needsWebSearch(text, analysis) {
  const t = norm(text);

  // A) Açık güncellik/web sinyalleri — en yüksek öncelik
  if (hasAny(t, FRESHNESS_SIGNALS)) return true;

  // Belirli gelecek/güncel yıl ifadeleri (2024-2039)
  if (/\b(202[4-9]|203[0-9])\b/.test(textOf(text))) return true;

  // B) Yıl + öneri/liste isteği
  const rec = detectRecommendation(text);
  if (rec && rec.year) return true;

  // C) Bilgi sorusu + konu yerel bilgi tabanında yoksa web
  const questionType = detectQuestionType(text);
  if (questionType && !isKnownLocalTopic(t)) return true;

  // D) Bunların hiçbiri yoksa local-only sonucu uygulanabilir
  if (isLocalOnly(text, analysis)) return false;

  return false;
}

function buildSearchQuery(text, analysis) {
  const t = norm(text);
  const rec = detectRecommendation(text);
  const parts = [];

  if (rec) {
    if (rec.category === 'movie') parts.push(rec.genre || 'movie');
    else if (rec.category) parts.push(rec.category);
    if (rec.year) parts.push(String(rec.year));
    if (hasAny(t, ['çıkan', 'yayınlanan'])) parts.push('releases');
    return parts.join(' ') || t;
  }

  // Dil/teknoloji
  if (analysis?.language) parts.push(LANG_LABELS[analysis.language] || analysis.language);
  if (analysis?.technology) parts.push(analysis.technology);

  // Yıl
  const yearMatch = textOf(text).match(/\b(19|20)\d{2}\b/);
  if (yearMatch) parts.push(yearMatch[0]);

  // Konu
  const topic = extractTopic(text);
  if (topic) parts.push(topic);

  return parts.join(' ') || t;
}

function normalizeWebResults(rawResults) {
  if (!Array.isArray(rawResults)) return [];
  return rawResults.map((r) => ({
    title: textOf(r.title || r.name || '').trim() || 'Sonuç',
    source: textOf(r.source || r.site || '').trim() || null,
    url: textOf(r.url || r.link || r.href || '').trim() || null,
    snippet: truncate(textOf(r.snippet || r.description || r.summary || r.content || ''), 300),
    date: textOf(r.date || r.publishedAt || r.published || '').trim() || null
  })).filter((r) => r.url || r.snippet);
}

function formatWebResults(results) {
  if (!results || !results.length) return null;
  const lines = results.slice(0, 5).map((r, i) =>
    `**${i + 1}.** ${r.title || 'Sonuç'}${r.url ? ` — [${r.url}](${r.url})` : ''}${r.snippet ? `\n   ${truncate(r.snippet, 200)}` : ''}`
  );
  return `Web araştırması sonucunda bulduklarım:\n\n${lines.join('\n\n')}`;
}

function synthesizeWebResponse(original, rawResults) {
  const normalized = normalizeWebResults(rawResults);
  if (!normalized.length) return null;
  const topResults = normalized.slice(0, 5);
  const lines = topResults.map((r, i) => {
    const parts = [`**${i + 1}.** ${r.title}`];
    if (r.snippet) parts.push(`   ${r.snippet}`);
    const meta = [];
    if (r.source) meta.push(r.source);
    if (r.date) meta.push(r.date);
    if (r.url) meta.push(`[link](${r.url})`);
    if (meta.length) parts.push(`   _${meta.join(' · ')}_`);
    return parts.join('\n');
  });
  return `Web araştırması sonucunda bulduklarım:\n\n${lines.join('\n\n')}\n\n` +
    `_Kaynaklar yukarıda belirtilmiştir. Bilgileri doğrulamak için kaynak linklerine bakabilirsin._`;
}

/* ============== ANA API ============== */

function generate(userMsg, context) {
  const original = textOf(userMsg).trim();
  if (!original) return 'Bir mesaj yazarsan yardımcı olabilirim.';

  // 1. Slash komutları
  const slash = runSlash(original);
  if (slash) return slash;

  const ctx = Array.isArray(context) ? context.slice(-12) : [];
  const detail = decideDetailLevel(original, ctx);

  // 2. Binary response (feedback'ten önce)
  const binary = classifyBinaryReply(original);
  if (binary) return binaryResponse(binary, ctx);

  // HATA 9: Feedback güncel mesajdan okunur, context'ten değil
  const feedback = detectFeedback(original);
  const retryPrelude = feedback.retry
    ? 'Önceki yanıt beklentini karşılamamış; bu kez daha dikkatli ve doğrudan ilerliyorum.\n\n'
    : '';

  // 3. Matematik
  const calculation = tryCalculate(original);
  if (calculation) return retryPrelude + calculation;

  const resolvedContext = resolveWithContext(original, ctx);
  const raw = resolvedContext.resolved;
  const t = norm(raw);
  const conversationState = resolvedContext.state || null;
  const topic = resolvedContext.topic ||
    (resolvedContext.followUp || isAlternativeRequest(original) ? null : extractTopic(original));

  // 4. Rastgele yardımcılar
  if (hasAny(t, ['yazı tura', 'yazi tura', 'coin flip', 'parayı at'])) {
    return '🪙 ' + rand(['**YAZI!**', '**TURA!**']);
  }
  if (hasAny(t, ['zar at', 'zarı at', 'roll dice', 'dice'])) {
    return `🎲 Zar atıldı: **${Math.floor(Math.random() * 6) + 1}**`;
  }
  if (hasAny(t, ['sayı tut', 'sayi tut', 'rastgele sayı'])) {
    return `🎯 Aklımdan tuttuğum sayı: **${Math.floor(Math.random() * 100) + 1}**`;
  }

  // 5. Basit sohbet
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

  // 6. Öneriler
  const recommendation = detectRecommendation(original);
  if (recommendation) {
    return retryPrelude + recommendationResponse(recommendation);
  }

  // HATA 12: "Python öğreniyorum" → öğrenme modu
  const learningLang = isLearningModeRequest(original);
  if (learningLang) {
    return learningModeResponse(learningLang);
  }

  // 7. Kod/açıklama intent analizi
  const analysisInput = resolvedContext.followUp ? original : raw;
  const baseAnalysis = analyzeCodeRequest(analysisInput);
  const currentNoCode = baseAnalysis.constraints?.noCode === true;
  const explicitCodeOverride = baseAnalysis.wantsCode && !currentNoCode;
  const inheritedNoCode = conversationState?.constraints?.noCode === true &&
    !explicitCodeOverride;
  const effectiveNoCode = currentNoCode || inheritedNoCode;
  const analysis = conversationState
    ? {
      ...baseAnalysis,
      language: baseAnalysis.language || conversationState.language,
      technology: baseAnalysis.technology || conversationState.technology,
      task: baseAnalysis.task || conversationState.task,
      userLevel: baseAnalysis.userLevel || conversationState.userLevel,
      complexity: baseAnalysis.complexity || conversationState.complexity,
      wantsCode: baseAnalysis.wantsCode && !effectiveNoCode,
      intent: baseAnalysis.wantsCode && !effectiveNoCode
        ? 'code_generation'
        : baseAnalysis.intent,
      constraints: {
        ...(conversationState.constraints || {}),
        ...(baseAnalysis.constraints || {}),
        noCode: effectiveNoCode
      }
    }
    : {
      ...baseAnalysis,
      wantsCode: baseAnalysis.wantsCode && !currentNoCode,
      intent: baseAnalysis.wantsCode && !currentNoCode
        ? 'code_generation'
        : baseAnalysis.intent,
      constraints: {
        ...(baseAnalysis.constraints || {}),
        noCode: currentNoCode
      }
    };

  // HATA 10: Alternatif istek (feedback'ten sonra, code öncesi)
  if (isAlternativeRequest(original) && conversationState) {
    return retryPrelude + alternativeResponse(original, conversationState);
  }

  // HATA 9: Negative feedback
  if (isNegativeFeedback(original)) {
    return 'Haklı olabilirsin; hangi bölümün yanlış olduğunu söylersen onu doğrudan düzelteyim.';
  }

  if (!analysis.wantsCode && analysis.task === 'game') {
    return retryPrelude + gameHowResponse(raw, conversationState);
  }

  // 8. Contextual task guidance
  const taskGuidance = contextualTaskGuidance(analysisInput, conversationState);
  if (!analysis.wantsCode && taskGuidance) {
    return retryPrelude + taskGuidance;
  }

  // 9. Explanation — followUp var ama state yoksa standalone gibi davran
  const isStandalone = !resolvedContext.followUp || !conversationState;
  const hasFollowUpState = conversationState?.followUpAction || conversationState?.formatRequest;
  const hasSubtopic = detectProgrammingSubtopic(raw) ||
    (conversationState?.topic && detectProgrammingSubtopic(conversationState.topic));
  if ((analysis.wantsExplanation || hasFollowUpState) && !analysis.wantsCode &&
    (analysis.constraints.noCode ||
      (resolvedContext.followUp && conversationState?.topic) ||
      (isStandalone && (analysis.task || analysis.language || hasSubtopic)) ||
      hasFollowUpState)) {
    return retryPrelude + explanationResponse(raw, analysis, topic, conversationState);
  }

  // 10. Code generation (HATA 6: destek kontrolü)
  if (analysis.wantsCode && analysis.language) {
    return retryPrelude + codeSample(analysis, original) + naturalFollowUp(detail.level);
  }

  // 11. Question intent
  const questionInput = resolvedContext.followUp ? original : raw;
  const questionType = detectQuestionType(questionInput);
  const commandQuestion = !questionType &&
    extractCommandToken(questionInput) &&
    (resolvedContext.followUp || isExplanationRequest(questionInput));
  if (questionType === INTENTS.WHY &&
    hasAny(questionInput, ['çalışmıyor', 'çalışmadı', 'hata veriyor', 'neden bozuldu'])) {
    return retryPrelude + whyDebugResponse();
  }
  if (isTechnicalError(questionInput)) return retryPrelude + technicalErrorResponse();

  if (questionType) {
    const answer = responseForQuestion(
      questionInput,
      topic,
      questionType,
      ctx,
      conversationState
    );
    return retryPrelude + answer + naturalFollowUp(detail.level);
  }
  if (commandQuestion) {
    const answer = responseForQuestion(
      questionInput,
      topic,
      INTENTS.WHAT,
      ctx,
      conversationState
    );
    return retryPrelude + answer;
  }

  // 12. Follow-up with topic
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

  // 13. Safe fallback
  return retryPrelude + generalFallback(topic);
}

/* ============== ASENKRON API (WEB ARAŞTIRMA) ============== */

async function generateAsync(userMsg, context) {
  const original = textOf(userMsg).trim();
  if (!original) return 'Bir mesaj yazarsan yardımcı olabilirim.';

  const analysis = analyzeCodeRequest(original);
  const needsWeb = needsWebSearch(original, analysis);

  // Web gerekmiyorsa mevcut senkron akışı kullan
  if (!needsWeb) {
    return generate(userMsg, context);
  }

  // Web araştırması yap
  const searchQuery = buildSearchQuery(original, analysis);

  // Cache kontrolü
  const cached = webCache.get(searchQuery);
  if (cached) {
    return synthesizeWebResponse(original, cached.results) ||
      'Güncel bilgi kaynağına şu anda erişemiyorum. Daha sonra tekrar deneyebilirsin.';
  }

  const results = await WebProvider.search({
    query: searchQuery,
    userMsg: original,
    context: Array.isArray(context) ? context : [],
    analysis
  });

  if (!results || !results.length) {
    return 'Güncel bilgi kaynağına şu anda erişemiyorum. ' +
      'Gerçek veriye ulaşamadığım için uydurma bilgi vermem. ' +
      'Daha sonra tekrar deneyebilir veya aradığın bilgiyi metin olarak paylaşırsan onun üzerinden yardımcı olabilirim.';
  }

  // Cache'e kaydet
  webCache.set(searchQuery, { results, timestamp: Date.now() });

  const synthesized = synthesizeWebResponse(original, results);
  return synthesized || 'Güncel bilgi kaynağına şu anda erişemiyorum.';
}

/* ============== SELF TESTLER (r6 genişletilmiş) ============== */

function runSelfTests() {
  const noCodePrompt = 'Bana Python öğret. Ama kod yazma.';
  const discordContext = [
    { role: 'user', content: 'Discord botu nedir?' },
    { role: 'assistant', content: 'Yeterli doğrulanmış bilgi yok.' }
  ];
  const gameContext = [
    { role: 'user', content: 'Python ile sayı tahmin oyunu yapıyorum.' },
    { role: 'assistant', content: 'Başlangıç örneği.' }
  ];
  const pythonLearningContext = [
    { role: 'user', content: 'Python öğreniyorum.' },
    { role: 'assistant', content: 'Harika, Python ile devam edelim.' }
  ];
  const variablesContext = [
    { role: 'user', content: 'Python\'da değişkenleri anlat.' },
    { role: 'assistant', content: 'Değişkenler bir değer tutan isimlerdir.' }
  ];
  const discordBotContext = [
    { role: 'user', content: 'Python ile Discord botu yapıyorum.' },
    { role: 'assistant', content: 'Harika, Discord botu projesi.' }
  ];
  const feedbackContext = [
    { role: 'user', content: 'Python nedir?' },
    { role: 'assistant', content: 'Python bir programlama dilidir.' },
    { role: 'user', content: 'Yanlış cevap verdin.' }
  ];

  const checks = [
    // === Soru türü tespiti ===
    ['Kimya WHAT', detectQuestionType('Kimya nedir?') === INTENTS.WHAT],
    ['Kuantum WHAT', detectQuestionType('Kuantum dolanıklığı nedir?') === INTENTS.WHAT],
    ['Python HOW', detectQuestionType('Python nasıl kullanılır?') === INTENTS.HOW],
    ['Discord WHY', detectQuestionType('Discord botu neden çalışmıyor?') === INTENTS.WHY],
    ['Atatürk WHEN', detectQuestionType('Atatürk ne zaman doğdu?') === INTENTS.WHEN],
    ['Minecraft WHERE', detectQuestionType('Minecraft nerede oynanır?') === INTENTS.WHERE],
    ['Python WHO', detectQuestionType("Python'u kim geliştirdi?") === INTENTS.WHO],
    ['Range HOW_MANY', detectQuestionType('10 ile 20 arasında kaç sayı var?') === INTENTS.HOW_MANY],

    // === Matematik ===
    ['23*47+15=1096', tryCalculate('23 * 47 + 15')?.includes('1096') === true],
    ['(2+3)*4=20', tryCalculate('(2 + 3) * 4')?.includes('20') === true],
    ['Math precedence 2+3*4=14', tryCalculate('2 + 3 * 4')?.includes('14') === true],
    ['Math decimal 5.5+2.3=7.8', tryCalculate('5.5 + 2.3')?.includes('7.8') === true],
    ['10/0 division by zero', tryCalculate('10 / 0')?.includes('Sıfıra bölme') === true],

    // === Bilgi/kod ayrımı ===
    ['Python info not code', detectCodeLang('Python nedir?') === null],
    ['React info not code', detectCodeLang('React nedir?') === null],
    ['Python nedir no code', !generate('Python nedir?', []).includes('```')],
    ['React nedir no code', !generate('React nedir?', []).includes('```')],

    // === Kod görevi tespiti ===
    ['Discord code task', analyzeCodeRequest('Python ile Discord botu yap').task === 'discord_bot'],
    ['Discord code language', analyzeCodeRequest('Python ile Discord botu yap').language === 'python'],
    ['JS calculator', analyzeCodeRequest('JavaScript ile hesap makinesi yap').language === 'javascript'],

    // === HATA 5: Fiil çekimleri ===
    ['yapıyorum NOT code gen', !isCodeGenerationRequest('Python ile Discord botu yapıyorum')],
    ['yaptım NOT code gen', !isCodeGenerationRequest('Python ile Discord botu yaptım')],
    ['yapacağım NOT code gen', !isCodeGenerationRequest('Python ile Discord botu yapacağım')],
    ['yapmak istiyorum NOT code gen', !isCodeGenerationRequest('JavaScript ile hesap makinesi yapmak istiyorum')],
    ['yap IS code gen', isCodeGenerationRequest('Python ile Discord botu yap')],
    ['hesap makinesi yap IS code gen', isCodeGenerationRequest('JavaScript ile hesap makinesi yap')],

    // === HATA 6: Yanlış dil ===
    ['Java calculator not Python', !generate('Java ile hesap makinesi yap', []).includes('def ')],
    ['Java calculator not JavaScript', !generate('Java ile hesap makinesi yap', []).includes('console.log')],
    ['Java calculator produces Java', generate('Java ile hesap makinesi yap', []).includes('public class')],

    // === HATA 7: React JSX ===
    ['React login is JSX', generate('React ile giriş ekranı yap', []).includes('jsx')],
    ['React login not HTML', !generate('React ile giriş ekranı yap', []).includes('<!doctype')],

    // === HATA 1: Programming subtopic tespiti ===
    ['değişkenleri öğret teaching', generate("Python'da değişkenleri öğret.", []).includes('Değişken')],
    ['değişkenleri öğret not fallback', !generate("Python'da değişkenleri öğret.", []).includes('sınıflandıramadım')],
    ['JS değişkenleri öğret', generate("JavaScript'te değişkenleri öğret.", []).includes('Değişken')],
    ['JS değişkenleri öğret JS', generate("JavaScript'te değişkenleri öğret.", []).includes('JavaScript')],
    ['listeleri öğret', generate("Python öğrenmeye yeni başladım. Bana listeleri öğret.", []).includes('Liste')],
    ['döngüleri öğret', generate("Döngüleri 12 yaşındaki bir çocuğa anlat.", []).includes('Döngü')],
    ['koşulları öğret', generate("Python'da koşulları günlük hayattan bir örnekle anlat.", []).includes('Koşul')],

    // === HATA 2: Dil bağımlı anlatım ===
    ['JS değişkenler not Python', !generate("JavaScript'te değişkenleri öğret.", []).includes("Python'da")],

    // === HATA 3: Follow-up topic korunumu ===
    ['Daha basit keeps variables', generate('Daha basit anlat.', variablesContext).includes('Değişken')],
    ['Günlük örnek keeps variables', generate('Günlük hayattan örnek ver.', variablesContext).includes('Değişken')],
    ['çalıştıracağım not topic', !generate('Peki bunu nasıl çalıştıracağım?', discordBotContext).includes('çalıştıracağım')],

    // === HATA 4: Discord context ===
    ['Discord run guidance', generate('Peki bunu nasıl çalıştıracağım?', discordBotContext).includes('discord.py')],
    ['Discord commands context', generate('Komutlar nasıl çalışıyor?', discordBotContext).includes('komut')],
    ['Discord commands no fallback', !generate('Komutlar nasıl çalışıyor?', discordBotContext).includes('sınıflandıramadım')],

    // === HATA 9: Feedback ===
    ['Yanlış cevap negative feedback', generate('Yanlış cevap verdin.', feedbackContext).includes('yanlış')],
    ['Old feedback not leak', !generate('JavaScript nedir?', [
      { role: 'user', content: 'Python nedir?' },
      { role: 'assistant', content: 'Python bir dildir.' },
      { role: 'user', content: 'Yanlış cevap verdin.' },
      { role: 'assistant', content: 'Haklı olabilirsin.' }
    ]).includes('dikkatli')],

    // === HATA 10: Alternatif ===
    ['Başka örnek alternative', generate('Başka bir örnek ver.', gameContext).includes('alternatif')],

    // === HATA 11: Teaching follow-up ===
    ['Context teaching inherits Python', generate('Değişkenleri öğret.', pythonLearningContext).includes('Değişken')],
    ['Context teaching not fallback', !generate('Değişkenleri öğret.', pythonLearningContext).includes('sınıflandıramadım')],

    // === HATA 12: Learning mode ===
    ['Python öğreniyorum learning mode', generate('Python öğreniyorum.', []).includes('Değişken')],

    // === HATA 13: Knowledge fallback ===
    ['Kuantum no fabrication', generate('Kuantum dolanıklığı nedir?', []).includes('doğrulanmış bilgi yok')],
    ['Kimya no fabrication', generate('Kimya nedir?', []).includes('doğrulanmış bilgi yok')],
    ['Minecraft no fabrication', generate('Minecraft nedir?', []).includes('doğrulanmış bilgi yok')],

    // === HATA 14: Güncel öneriler ===
    ['No unrelated 2026 horror', !generate("2026'da çıkan korku filmlerinden öner", []).includes('Interstellar')],

    // === Mevcut testler ===
    ['sa greeting', /^(Merhaba|Selam)/.test(generate('sa', []))],
    ['saat is not greeting', !/^(Merhaba|Selam)/.test(generate('saat kaç?', []))],
    ['No Hello Discord fallback', !generate('Python ile Discord botu yap', []).includes("print('Hello')")],
    ['No-code teaching has no fence', !generate(noCodePrompt, []).includes('```')],
    ['No-code Discord has no fence', !generate('Python ile Discord botu yap ama kod verme.', []).includes('```')],
    ['Discord botu nedir honest fallback', generate('Discord botu nedir?', []).includes('doğrulanmış bilgi yok')],
    ['!ping explanation no code', generate('Discord botu hakkında konuşuyoruz. !ping komutunu anlat. Kod yazma.', []).includes('!ping')],
    ['!ping explanation has no fence', !generate('Discord botu hakkında konuşuyoruz. !ping komutunu anlat. Kod yazma.', []).includes('```')],
    ['Python nedir gives general def', generate('Python nedir?', []).includes('genel amaçlı')],
    ['Variables nedir not Python general', !generate("Python'da değişken nedir?", []).includes('genel amaçlı')],
    ['Variables nedir teaches variables', generate("Python'da değişken nedir?", []).includes('Değişken')],
    ['Teach variables has teaching', generate('Bana Python\'da değişkenleri öğret.', []).includes('Değişken')],
    ['Beginner no-code variables no fence', !generate('Python öğrenmeye yeni başladım. Bana değişkenleri çok basit şekilde öğret. Kod yazma.', []).includes('```')],
    ['Beginner no-code variables teaches', generate('Python öğrenmeye yeni başladım. Bana değişkenleri çok basit şekilde öğret. Kod yazma.', []).includes('Değişken')],
    ['Multi-topic variables first', generate('Python öğreniyorum. Önce değişkenleri öğret, sonra listelere geçeriz.', []).includes('Değişken')],
    ['Minecraft plan', generate("Minecraft'ta korku oyunu yapmak istiyorum, nereden başlamalıyım?", []).includes('Platformu seç')],

    // === r6 DÜZELTMELER: Dil algılama ===
    ['java script → javascript', detectCodeLang('java script ile bir liste hazırla') === 'javascript'],
    ['javascript → javascript', detectCodeLang('javascript ile bir liste hazırla') === 'javascript'],
    ['java → java', detectCodeLang('java ile bir program yap') === 'java'],
    ['js → javascript', detectLanguageHint('js ile bir fonksiyon yaz') === 'javascript'],
    ['java script not java', detectLanguageHint('java script ile bir liste hazırla') !== 'java'],

    // === r6 DÜZELTMELER: Web yönlendirme ===
    ['Python son sürüm web adayı', needsWebSearch('Python\'un en son sürümü nedir?', analyzeCodeRequest('Python\'un en son sürümü nedir?')) === true],
    ['Kuantum web adayı', needsWebSearch('Kuantum dolanıklığı nedir?', analyzeCodeRequest('Kuantum dolanıklığı nedir?')) === true],
    ['Python nedir not web', needsWebSearch('Python nedir?', analyzeCodeRequest('Python nedir?')) === false],
    ['Python son sürüm not local def', !generate('Python\'un en son sürümü nedir?', []).includes('genel amaçlı')],
    ['Node son sürüm web adayı', needsWebSearch('Node.js\'in en son sürümü', analyzeCodeRequest('Node.js\'in en son sürümü')) === true],
    ['React güncel sürüm web adayı', needsWebSearch('React\'in güncel sürümü', analyzeCodeRequest('React\'in güncel sürümü')) === true],

    // === r6 DÜZELTMELER: Öneri/sayı/yıl algılama ===
    ['2026 korku year', detectRecommendation("2026'da çıkan korku filmlerinden 5 tane söyle.").year === 2026],
    ['2026 korku count', detectRecommendation("2026'da çıkan korku filmlerinden 5 tane söyle.").count === 5],
    ['2026 korku category', detectRecommendation("2026'da çıkan korku filmlerinden 5 tane söyle.").category === 'movie'],
    ['beş tane count', detectRecommendation('bana 5 tane komedi film söyle').count === 5],

    // === r6 DÜZELTMELER: Java/Go kod üretimi ===
    ['Java generic not JS', !generate('Java ile hava durumu uygulaması yap', []).includes('console.log')],
    ['Java generic produces Java', generate('Java ile hava durumu uygulaması yap', []).includes('public class')],
    ['Go generic not JS', !generate('Go ile basit liste hazırla', []).includes('console.log')],
    ['Go generic produces Go', generate('Go ile basit liste hazırla', []).includes('package main')],
    ['Go HTTP produces Go', generate('Go ile HTTP isteği yap', []).includes('package main')],
    ['Go HTTP not JS', !generate('Go ile HTTP isteği yap', []).includes('console.log')],
    ['Go Discord not JS', !generate('Go ile Discord botu yap', []).includes('console.log')],
    ['Go Discord produces Go', generate('Go ile Discord botu yap', []).includes('package main')],

    // === r6 DÜZELTMELER: MODEL metadata ===
    ['MODEL version', Engine.MODEL.version === BUILD_VERSION],
    ['MODEL name', Engine.MODEL.name === MODEL_NAME],
  ];
  const results = checks.map(([name, passed]) => ({ name, passed }));
  return {
    version: BUILD_VERSION,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results
  };
}

/* ============== ENGINE ============== */

const Engine = {
  MODEL: {
    name: MODEL_NAME,
    icon: MODEL_ICON,
    version: BUILD_VERSION,
    thinkingMs: [700, 1500],
    style: 'hızlı ve dengeli'
  },
  generate,
  generateAsync,
  runSelfTests,
  normalizeLang,
  detectQuestionType,
  isCodeGenerationRequest,
  detectCodeLang,
  detectCodeComplexity,
  detectSpecificCodeTask,
  analyzeCodeRequest,
  tryCalculate,
  resolveWithContext,
  detectRecommendation,
  detectMovieGenre,
  classifyBinaryReply,
  isTechnicalError,
  KnowledgeProvider,
  setKnowledgeProvider,
  WebProvider,
  setWebProvider,
  needsWebSearch,
  buildSearchQuery,
  normalizeWebResults,
  synthesizeWebResponse,
  webCache,
  isKnownLocalTopic,
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
if (typeof module !== 'undefined' && module.exports) module.exports = Engine
