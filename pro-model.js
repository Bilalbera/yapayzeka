/* =========================================================
   pro-model.js | BilalAI Pro 1.0
   Gelişmiş yerel yanıt motoru yardımcı katmanı.

   Bu motor ağ bağlantısı veya sahte bir model eğitimi iddiası kullanmaz.
   Mevcut BilalAIResponseEngine'i daha geniş bağlam, yapılandırılmış
   yanıt ve kalite kontrolü ile çalıştırır.
   ========================================================= */
(function (global) {
  'use strict';

  const THINKING_MS = [5000, 7500];
  const MODEL_NAME = 'BilalAI - Pro 1.0';
  const MODEL_ICON = '🧠';

  function clean(value) {
    return String(value || '').trim();
  }

  function contextWindow(context) {
    return Array.isArray(context)
      ? context.filter(item => item && (item.role === 'user' || item.role === 'assistant'))
        .slice(-12)
        .map(item => ({ role: item.role, content: clean(item.content).slice(0, 6000) }))
      : [];
  }

  function inferRequestType(text) {
    const value = clean(text).toLocaleLowerCase('tr-TR');
    if (/(kod|javascript|typescript|python|react|sql|api|hata|debug)/i.test(value)) return 'technical';
    if (/(karşılaştır|karsilastir|seçenek|alternatif|mimari)/i.test(value)) return 'decision';
    if (/(plan|proje|uygulama|sistem|adım adım)/i.test(value)) return 'planning';
    return 'general';
  }

  function addQualityFrame(answer, requestType) {
    const result = clean(answer);
    if (!result) return 'İsteğini anlayamadım. Lütfen hedefi ve beklediğin çıktıyı biraz daha açık yaz.';

    // Motor zaten yapılandırılmış bir yanıt ürettiyse gereksiz başlık ekleme.
    if (/^#{1,3}\s/m.test(result) || result.includes('```')) return result;

    const reminders = {
      technical: '\n\n**Pro kontrolü:** Varsayımlarını, hata durumlarını ve test adımını ayrıca doğrulamak iyi olur.',
      decision: '\n\n**Pro kontrolü:** Seçim yapmadan önce maliyet, bakım ve ölçeklenebilirlik etkilerini karşılaştır.',
      planning: '\n\n**Pro kontrolü:** Önce küçük bir MVP çıkarıp ölçülebilir başarı kriterleri belirle.',
      general: ''
    };
    return result + (reminders[requestType] || '');
  }

  function generate(userMsg, context) {
    const base = global.BilalAIResponseEngine;
    if (!base || typeof base.generate !== 'function') {
      return 'Pro modeli başlatılamadı: temel yanıt motoru yüklenmemiş.';
    }

    const prompt = clean(userMsg);
    const enrichedContext = contextWindow(context);
    const answer = base.generate(prompt, enrichedContext);
    return addQualityFrame(answer, inferRequestType(prompt));
  }

  global.BilalAIPro = {
    MODEL_NAME,
    MODEL_ICON,
    THINKING_MS,
    generate
  };
})(typeof window !== 'undefined' ? window : globalThis);
