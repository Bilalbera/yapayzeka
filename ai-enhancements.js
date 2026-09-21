/* BilalAI Pro çalışma zamanı entegrasyonu.
   script.js içindeki kapalı MODELS nesnesine dokunmadan Pro'yu bağlar. */
(function (global) {
  'use strict';
  const SETTINGS_KEY = 'bilalai_settings';
  const PRO_KEY = 'pro';
  const PRO_DELAY_MIN = 5000;
  const PRO_DELAY_MAX = 7500;
  const originalSetTimeout = global.setTimeout.bind(global);

  function getSettings() {
    try { return JSON.parse(global.localStorage.getItem(SETTINGS_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function isPro() { return getSettings().currentModel === PRO_KEY; }
  function saveProSelection() {
    const settings = getSettings();
    settings.currentModel = PRO_KEY;
    try { global.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) {}
    const name = document.getElementById('headerModelName');
    const icon = document.getElementById('headerModelIcon');
    if (name) name.textContent = 'BilalAI - Pro 1.1';
    if (icon) icon.textContent = '🧠';
    document.querySelectorAll('.model-card').forEach(card => card.classList.toggle('active', card.dataset.model === PRO_KEY));
  }

  // script.js modeli tanımadığı için model kartına basıldığında seçim ayarını sonradan sabitler.
  document.addEventListener('click', event => {
    if (event.target.closest('.model-card[data-model="pro"]')) saveProSelection();
  });

  // Pro seçiliyken mesaj yanıtının gecikmesini 5.0–7.5 saniyeye taşır.
  global.setTimeout = function (callback, delay, ...args) {
    if (isPro() && typeof callback === 'function' && Number(delay) >= 500 && Number(delay) <= 2000) {
      delay = Math.floor(Math.random() * (PRO_DELAY_MAX - PRO_DELAY_MIN + 1)) + PRO_DELAY_MIN;
    }
    return originalSetTimeout(callback, delay, ...args);
  };

  function addCard() {
    const list = document.querySelector('.model-list');
    if (!list || list.querySelector('[data-model="pro"]')) return;
    const card = document.createElement('div');
    card.className = 'model-card';
    card.dataset.model = PRO_KEY;
    card.innerHTML = `
      <div class="model-card-icon-wrap" style="background:linear-gradient(135deg,rgba(139,92,246,.28),rgba(109,40,217,.12));">
        <span class="model-card-icon" style="color:#A78BFA;">🧠</span>
      </div>
      <div class="model-card-info">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <div class="model-card-name">BilalAI - Pro 1.1</div>
          <span class="model-recommended-badge">🧠 Derin Analiz</span>
        </div>
        <div class="model-card-desc">Karmaşık kod, hata analizi, proje planlama ve karar desteği için kontrollü yanıtlar. Son 12 mesajı bağlam olarak kullanır. Düşünme süresi: <strong>5.0 - 7.5 sn</strong></div>
        <div class="model-card-tags"><span class="model-tag tag-creative">Derin Analiz</span><span class="model-tag tag-code">Kod</span><span class="model-tag tag-chat">Bağlam</span></div>
      </div>
      <div class="model-card-check">✓</div>`;
    list.appendChild(card);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addCard);
  else addCard();
})(typeof window !== 'undefined' ? window : globalThis);
