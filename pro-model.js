/* =========================================================
   pro-model.js | BilalAI Pro 1.1
   Yerel, bağlam-duyarlı ve kontrollü yanıt motoru.
   ========================================================= */
(function (global) {
  'use strict';

  const THINKING_MS = [5000, 7500];
  const MODEL_NAME = 'BilalAI - Pro 1.1';
  const MODEL_ICON = '🧠';
  const MAX_CONTEXT = 12;
  const MAX_MESSAGE_LENGTH = 6000;

  function clean(value) { return String(value || '').trim(); }
  function normalize(value) {
    return clean(value).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  }

  function contextWindow(context) {
    if (!Array.isArray(context)) return [];
    return context
      .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
      .slice(-MAX_CONTEXT)
      .map(item => ({
        role: item.role,
        content: clean(item.content).slice(0, MAX_MESSAGE_LENGTH)
      }));
  }

  function classify(prompt) {
    const text = normalize(prompt);
    if (/(kod|javascript|typescript|python|react|vue|sql|api|hata|debug|stack trace|bug)/i.test(text)) return 'technical';
    if (/(karşılaştır|karsilastir|seçenek|alternatif|mimari|hangisi|artı|eksi)/i.test(text)) return 'decision';
    if (/(plan|proje|uygulama|sistem|yol haritası|adım adım|mvp)/i.test(text)) return 'planning';
    if (/(özet|kısaca|kısa anlat)/i.test(text)) return 'summary';
    return 'general';
  }

  function hasStructuredOutput(answer) {
    return /^#{1,3}\s/m.test(answer) || /```[\s\S]*```/.test(answer) || /^\s*(?:[-*]|\d+\.)\s/m.test(answer);
  }

  function removeRepeatedClosing(text) {
    const lines = text.split('\n');
    const result = [];
    for (const line of lines) {
      const normalized = normalize(line);
      if (normalized && result.some(previous => normalize(previous) === normalized)) continue;
      result.push(line);
    }
    return result.join('\n').trim();
  }

  function qualityFrame(answer, type) {
    let result = removeRepeatedClosing(clean(answer));
    if (!result) return 'İsteğini anlayamadım. Hedefini ve beklediğin çıktı biçimini belirtir misin?';
    if (hasStructuredOutput(result)) return result;

    const endings = {
      technical: '\n\n**Pro kontrolü:** Varsayımları, hata durumlarını ve en az bir test senaryosunu doğrula.',
      decision: '\n\n**Pro kontrolü:** Kararı; amaç, maliyet, bakım ve ölçeklenebilirlik açısından karşılaştır.',
      planning: '\n\n**Pro kontrolü:** Önce küçük bir MVP ve ölçülebilir başarı kriterleri belirle.',
      summary: '',
      general: ''
    };
    return result + (endings[type] || '');
  }

  function generate(userMsg, context) {
    const base = global.BilalAIResponseEngine;
    if (!base || typeof base.generate !== 'function') {
      return 'Pro modeli başlatılamadı: temel yanıt motoru yüklenmemiş.';
    }
    const prompt = clean(userMsg);
    const answer = base.generate(prompt, contextWindow(context));
    return qualityFrame(answer, classify(prompt));
  }

  global.BilalAIPro = { MODEL_NAME, MODEL_ICON, THINKING_MS, generate };
  if (typeof module !== 'undefined') module.exports = global.BilalAIPro;
})(typeof window !== 'undefined' ? window : globalThis);
