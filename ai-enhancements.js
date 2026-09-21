/* =========================================================
   ai-enhancements.js | BilalAI modelleri için kalite katmanı
   Bu dosya model.js ve flashlitemodel.js sonrasında yüklenmelidir.
   ========================================================= */
(function (global) {
  'use strict';

  const SETTINGS_KEY = 'bilalai_settings';
  const PRO_KEY = 'pro';
  const PRO_DELAY = [5000, 7500];
  const ORIGINAL_ENGINE = global.BilalAIResponseEngine;
  const PRO_ENGINE = global.BilalAIPro;

  function settings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function isPro() { return settings().currentModel === PRO_KEY; }

  function normalizeContext(context) {
    return Array.isArray(context) ? context.slice(-12) : [];
  }

  // Flash motorunun genel ve tekrarlı cevaplarını daha uygulanabilir hale getirir.
  function improveFlashAnswer(answer, prompt) {
    const text = String(answer || '').trim();
    if (!text) return 'İsteğini anlayamadım. Hedefini ve beklediğin çıktı biçimini yazar mısın?';
    if (text.includes('```') || /^#{1,3}\s/m.test(text)) return text;

    const q = String(prompt || '').toLocaleLowerCase('tr-TR');
    const technical = /(kod|hata|javascript|typescript|python|react|sql|api|uygulama|proje)/i.test(q);
    if (!technical || text.length > 260) return text;

    return `${text}\n\n**Daha iyi sonuç için:** Beklenen çıktı, kullandığın teknoloji ve varsa hata mesajını belirtirsen çözümü doğrudan uygulanabilir şekilde netleştirebilirim.`;
  }

  if (ORIGINAL_ENGINE && typeof ORIGINAL_ENGINE.generate === 'function') {
    const originalGenerate = ORIGINAL_ENGINE.generate.bind(ORIGINAL_ENGINE);
    const wrapped = {
      MODEL: ORIGINAL_ENGINE.MODEL,
      generate(prompt, context) {
        if (isPro() && PRO_ENGINE && typeof PRO_ENGINE.generate === 'function') {
          return PRO_ENGINE.generate(prompt, normalizeContext(context));
        }
        return improveFlashAnswer(originalGenerate(prompt, normalizeContext(context)), prompt);
      }
    };
    global.BilalAIResponseEngine = wrapped;
  }

  // Mevcut script.js modeli tanımıyor olsa bile Pro seçimini mümkün kılmak için
  // model seçiciye kart ekler ve ayarı doğrudan kaydeder.
  function installProCard() {
    const list = document.querySelector('.model-list');
    if (!list || list.querySelector('[data-model="pro"]')) return;
    const card = document.createElement('div');
    card.className = 'model-card';
    card.dataset.model = PRO_KEY;
    card.innerHTML = `
      <div class="model-card-icon-wrap" style="background:linear-gradient(135deg,rgba(139,92,246,.25),rgba(109,40,217,.12));">
        <span class="model-card-icon" style="color:#A78BFA">🧠</span>
      </div>
      <div class="model-card-info">
        <div class="model-card-name">BilalAI - Pro 1.0</div>
        <div class="model-card-desc">Karmaşık kod, planlama, hata analizi ve karar desteği için daha kontrollü yanıtlar. Düşünme süresi: <strong>5.0 - 7.5 sn</strong></div>
        <div class="model-card-tags"><span class="model-tag tag-creative">Derin Analiz</span><span class="model-tag tag-code">Kod</span><span class="model-tag tag-chat">Bağlam</span></div>
      </div>
      <div class="model-card-check">✓</div>`;
    list.appendChild(card);
  }

  function bindProSelection() {
    document.addEventListener('click', event => {
      const card = event.target.closest('.model-card[data-model="pro"]');
      if (!card) return;
      const value = settings();
      value.currentModel = PRO_KEY;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch (_) {}
      document.querySelectorAll('.model-card').forEach(item => item.classList.toggle('active', item === card));
      const name = document.querySelector('#headerModelName');
      const icon = document.querySelector('#headerModelIcon');
      if (name) name.textContent = 'BilalAI - Pro 1.0';
      if (icon) icon.textContent = '🧠';
    });
  }

  function boot() {
    installProCard();
    bindProSelection();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
