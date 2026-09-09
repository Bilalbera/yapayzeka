/* =========================================================
   BilalAI 1.0 - FlashLite  |  Hızlı & Öz Yanıt Motoru
   Düşünme süresi: 0.5 - 1.0 sn
   Özelliği:      Kısa cevaplar, basit kod, anlık sohbet
   ========================================================= */
(function (global) {
  'use strict';

  const MODEL_NAME  = 'BilalAI - FlashLite - 1.0';
  const THINKING_MS = [500, 1000];

  /* ===================== YARDIMCILAR ===================== */
  function norm(t) { return String(t || '').toLowerCase()
    .replace(/[.,!?;:"'()]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function hasAny(t, arr) {
    for (let i = 0; i < arr.length; i++) if (t.includes(arr[i])) return true;
    return false;
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function getCodeExt(lang) {
    switch (lang) {
      case 'python': return '.py';
      case 'javascript': case 'react': case 'jsx': return '.js';
      case 'html': case 'htmlcss': return '.html';
      case 'css': return '.css';
      case 'sql': return '.sql';
      case 'java': return '.java';
      case 'go': return '.go';
      case 'rust': return '.rs';
      case 'flutter': case 'dart': return '.dart';
      case 'bash': case 'git': case 'shell': return '.sh';
      default: return '.txt';
    }
  }
  function factorial(n) {
    if (n < 0) return null;
    if (n > 20) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }

  /* ================= MATEMATİK HESAPLAYICI ================= */
  function liteTryCalculate(text) {
    let t = String(text || '').trim();
    if (!t) return null;

    // Faktöriyel
    const fact = t.match(/(\d+)\s*!/);
    if (fact) {
      const n = parseInt(fact[1], 10);
      const r = factorial(n);
      if (r !== null && isFinite(r)) {
        return `**${n}! = ${r}** 🧮`;
      }
    }

    // Temizle
    let expr = t
      .replace(/\?(.*)$/, '')
      .replace(/(kaç|eder|yapar|ne|sonucu|hesapla|topla|çıkar|çarp|böl|olur)$/gi, '')
      .replace(/[x×]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/\s+/g, '');

    // Basit iki sayı + operatör
    const reg = /^(\d+(?:\.\d+)?)([+\-*\/])(\d+(?:\.\d+)?)$/;
    const match = expr.match(reg);
    if (match) {
      let [, a, op, b] = match;
      a = parseFloat(a); b = parseFloat(b);
      let r;
      try {
        if (op === '/') {
          if (b === 0) return '⚠️ Sıfıra bölme hatası!';
          r = a / b;
        } else if (op === '+') r = a + b;
        else if (op === '-') r = a - b;
        else if (op === '*') r = a * b;
        else return null;
        const shown = Number.isInteger(r) ? r : Number(r.toFixed(4));
        return `**${a} ${op} ${b} = ${shown}** 🧮`;
      } catch { return null; }
    }

    // Loose match: cümle içinde sayı op sayı
    const loose = String(t).match(/(\d+(?:\.\d+)?)\s*([+\-*x×\/÷])\s*(\d+(?:\.\d+)?)/);
    if (loose) {
      let [, a, op, b] = loose;
      a = parseFloat(a); b = parseFloat(b);
      if (op === 'x' || op === '×') op = '*';
      if (op === '÷') op = '/';
      let r;
      try {
        if (op === '/') {
          if (b === 0) return '⚠️ Sıfıra bölme hatası!';
          r = a / b;
        } else {
          r = Function(`"use strict"; return (${a}${op}${b});`)();
        }
        if (typeof r === 'number' && isFinite(r)) {
          const shown = Number.isInteger(r) ? r : Number(r.toFixed(4));
          return `İşlem sonucu: **${a} ${op} ${b} = ${shown}** 🧮`;
        }
      } catch { return null; }
    }
    return null;
  }

  /* ================= BAĞLAM TAKİBİ ================= */
  function resolveTopic(msg, context) {
    const t = norm(msg);
    const SHORTS = ['nasıl', 'neden', 'niye', 'niçin', 'nedir', 'evet', 'hayır', 'tamam', 'peki',
      'anlamadım', 'açıkla', 'özetle', 'kısaca', 'devam et', 'devam', 'ne', 'hangi', 'kaç', 'kim'];
    const isShort = SHORTS.some(w => t === w || t.startsWith(w + ' '));
    if (!isShort || !context || !context.length) return null;
    const prevUser = [...context].reverse().find(m => m.role === 'user');
    if (prevUser) return (prevUser.content || '').slice(0, 120);
    return null;
  }

  /* ================= BASİT KOD ŞABLONLARI ================= */
  function liteCodeSample(lang) {
    const tpl = {
      python:     "```python\n# Basit Python örneği\ndef selam(isim):\n    print(f'Merhaba, {isim}!')\n\nselam('Bilal')\n```",
      javascript: "```javascript\n// Basit JS örneği\nfunction selam(isim) {\n  console.log(`Merhaba, ${isim}!`);\n}\nselam('Bilal');\n```",
      htmlcss:    "```html\n<!DOCTYPE html>\n<html>\n<head><title>Merhaba</title></head>\n<body><h1>Merhaba Dünya! 👋</h1></body>\n</html>\n```",
      react:      "```jsx\nexport default function App(){\n  const [ad, setAd] = useState('Bilal');\n  return <h1>Merhaba, {ad}! 👋</h1>;\n}\n```",
      sql:        "```sql\nSELECT id, ad, email\nFROM kullanicilar\nWHERE durum = 'aktif'\nORDER BY created_at DESC\nLIMIT 10;\n```",
      java:       "```java\npublic class Main {\n  public static void main(String[] args) {\n    String ad = \"Bilal\";\n    System.out.println(\"Merhaba, \" + ad + \"!\");\n  }\n}\n```",
      go:         "```go\npackage main\n\nimport \"fmt\"\n\nfunc main() {\n    ad := \"Bilal\"\n    fmt.Printf(\"Merhaba, %s!\\n\", ad)\n}\n```",
      rust:       "```rust\nfn main() {\n    let ad = \"Bilal\";\n    println!(\"Merhaba, {}!\", ad);\n}\n```",
      flutter:    "```dart\nimport 'package:flutter/material.dart';\nvoid main() => runApp(MaterialApp(\n  home: Scaffold(body: Center(child: Text('Merhaba Bilal! 👋'))),\n));\n```",
      bash:       "```bash\n#!/bin/bash\nAD=\"Bilal\"\necho \"Merhaba, $AD!\"\n```"
    };
    return tpl[lang] || tpl.python;
  }

  /* ================= NİYET TESPİTİ ================= */
  function detectLang(raw) {
    const t = norm(raw);
    if (hasAny(t, ['python', 'pip', 'pandas', 'django', 'flask', 'numpy'])) return 'python';
    if (hasAny(t, ['javascript', ' js ', 'node', 'nextjs', 'typescript', ' ts ', 'npm'])) return 'javascript';
    if (hasAny(t, ['react', 'bileşen', 'usestate', 'hook', 'jsx'])) return 'react';
    if (hasAny(t, ['html', 'css', 'tailwind', 'stil', 'sayfa', 'web sitesi'])) return 'htmlcss';
    if (hasAny(t, ['sql', 'mysql', 'postgres', 'veritaban', 'sorgu'])) return 'sql';
    if (hasAny(t, ['java ', 'kotlin', 'spring'])) return 'java';
    if (hasAny(t, ['go ', 'golang'])) return 'go';
    if (hasAny(t, ['rust ', 'cargo'])) return 'rust';
    if (hasAny(t, ['flutter', 'swift', 'dart'])) return 'flutter';
    if (hasAny(t, ['git ', 'commit', 'push', 'bash', 'shell', 'terminal'])) return 'bash';
    if (hasAny(t, ['kod', 'kodu', 'kod yaz', 'script', 'fonksiyon', 'print', 'hello', 'merhaba dünya'])) return 'python';
    return null;
  }

  function pickIntent(raw, ctx) {
    const t = norm(raw);
    const c = norm(ctx || '');
    const combined = (t + ' ' + c).trim();

    // --- Hava durumu ---
    if (hasAny(combined, ['hava', 'hava durumu', 'yağmur', 'güneşli', 'bulutlu', 'sıcak', 'soğuk'])) return 'weather';
    // --- Oyun / video oyunu ---
    if (hasAny(combined, ['oyun öner', 'oyun tavsiye', 'oyun oyna', 'video oyunu', 'pc oyunu', 'mobil oyun'])) return 'games';
    // --- Eğitim / ders / öğrenme ---
    if (hasAny(combined, ['ders çalış', 'öğrenme', 'nasıl öğren', 'eğitim', 'öğüt', 'tavsiye', 'başarı', 'motivasyon', 'çalışma'])) return 'study';
    // --- İlham / söz / motive et ---
    if (hasAny(combined, ['ilham', 'söz', 'güzel söz', 'motive et', 'cesaret', 'umut', 'başarı söz'])) return 'quote';
    // --- Sağlık / spor / diyet ---
    if (hasAny(combined, ['spor', 'egzersiz', 'diyet', 'kilo', 'sağlık', 'fitness', 'antrenman', 'yemek', 'ne yemeliyim'])) return 'health';
    // --- Rastgele sayı / zar / yazı tura ---
    if (hasAny(combined, ['zar at', 'yazı tura', 'şans', 'rastgele', 'sayi tut', 'sayı tut'])) return 'luck';
    // --- Selamlaşma ---
    if (hasAny(t, ['selam', 'merhaba', 'hey', 'hi', 'hello', 'günaydın', 'iyi akşamlar', 'iyi geceler', 'sa'])) return 'greet';
    // --- Teşekkür ---
    if (hasAny(t, ['teşekkür', 'sağol', 'sağ ol', 'thanks', 'thank you', 'eyw'])) return 'thanks';
    // --- Veda ---
    if (hasAny(t, ['hoşça kal', 'görüşürüz', 'bye', 'iyi geceler', 'kendine iyi bak', 'bb'])) return 'bye';
    // --- Nasılsın ---
    if (hasAny(t, ['nasılsın', 'ne haber', 'naber', 'how are you', 'iyi misin', 'nasılsınz'])) return 'howareyou';
    // --- Kim / Ne / Hakkında ---
    if (hasAny(t, ['kimsin', 'sen kimsin', 'who are you', 'ne yapıyorsun', 'hakkında', 'özelliklerin'])) return 'about';
    // --- Kurucu ---
    if (hasAny(t, ['kurucu', 'yaratıcı', 'yazan', 'yapan', 'sahip', 'founder', 'bilal'])) return 'founder';
    // --- Saat / Tarih ---
    if (hasAny(t, ['saat kaç', 'saat ne', 'saatler', 'saat şu an', 'tarih', 'hangi gün', 'bugün günlerden', 'tarih ne'])) return 'datetime';
    // --- Yaş / doğum ---
    if (hasAny(t, ['yaşın kaç', 'yaşın', 'doğum günün', 'ne zaman doğdun'])) return 'age';
    // --- Şaka / espri ---
    if (hasAny(t, ['şaka', 'espri', 'fıkra', 'joke', 'gülmek', 'komik'])) return 'joke';
    // --- Film / dizi ---
    if (hasAny(t, ['film öner', 'dizi öner', 'film izle', 'öner film', 'hangi film', 'dizi izle'])) return 'movie';
    // --- Şarkı / müzik ---
    if (hasAny(t, ['şarkı öner', 'müzik öner', 'şarkı tavsiye', 'müzik tavsiye', 'parça öner'])) return 'music';
    // --- Kitap ---
    if (hasAny(t, ['kitap öner', 'kitap oku', 'kitap tavsiye', 'kitap okuma'])) return 'book';
    // --- Yemek ---
    if (hasAny(t, ['yemek yap', 'yemek öner', 'ne pişirsem', 'tarif', 'akşam yemeği', 'menü'])) return 'food';
    // --- Matematik / hesap (sayısal ifade içeriyorsa) ---
    const calcHit = hasAny(t, ['hesapla', 'kaç eder', 'toplama', 'çıkarma', 'çarpma', 'bölme', 'matematik', 'faktöriyel', 'işlem']);
    if (calcHit || /\d+\s*[+\-*x×\/÷!]/.test(raw)) return 'calc';
    // --- Basit kod ---
    const lang = detectLang(raw);
    if (lang) return 'code_simple';

    return 'default';
  }

  /* ================= KATEGORİ İÇERİKLERİ ================= */
  const CATEGORIES = {
    weather: [
      '🌤️ **Hava durumu tavsiyem:**\n• Dışarı çıkmadan önce bir göz at — şaşırtabilir!\n• Yanında şemsiye bulundurmak her zaman iyidir.\n• Günlük tahmin uygulaması kurmayı düşün.',
      '⛅ Hava durumu her an değişebilir; planlarını esnek tutmak en iyisi! 🌦️'
    ],
    games: [
      '🎮 3 oyun önerim:\n1. Minecraft ⛏️ (yaratıcılık)\n2. Stardew Valley 🌾 (sakinleştirici)\n3. Elden Ring ⚔️ (aksiyon)\nHangi tür ilgini çeker?',
      '🎮 Mobil için: Monument Valley, Alto\'s Odyssey, Among Us — hepsi akıcı ve zevkli!'
    ],
    study: [
      '📚 **Çalışma tüyolarım:**\n1. Pomodoro: 25dk çalış, 5dk dinlen\n2. Bol su + 7-8 saat uyku\n3. Tekrarlama yerine **aktif hatırlama** yap (kendine soru sor)\n4. Zor konuları günün en dinç saatinde çalış',
      '💡 Başarmak için: küçük ama **tutarlı** adımlar. Günde 20 dakika bile haftada 140 dakika eder.'
    ],
    quote: [
      '✨ "Başarı, her gün tekrarlanan küçük çabaların toplamıdır." — Robert Collier',
      '🌟 "Yarın yapacağım diye ertele, bugün bir adım at — o adım senden başlar."',
      '💫 "Kendine inan. Başarabileceklerini bil. Her şey mümkün."',
      '🔥 "Zorluklar, güçlü insanları ortaya çıkarır. Devam et!"'
    ],
    health: [
      '🏃 **Sağlık önerileri:**\n• Günde 20 dk yürüyüş\n• Bol su (2-2.5 L)\n• 7-8 saat uyku\n• Abur cubur yerine meyve/sebze\n• Gün içinde esneme molaları',
      '🥗 **Kısa diyet notu:** İşlenmiş gıdaları azalt, doğal ye. Vücudun sana teşekkür edecek 💙'
    ],
    luck: [
      '🎲 Zar atıldı: **' + Math.floor(Math.random()*6+1) + '**',
      '🪙 ' + (Math.random() < 0.5 ? '**YAZI!** (Heads)' : '**TURA!** (Tails)'),
      '🎯 Aklımdan tuttuğum sayı: **' + Math.floor(Math.random()*100+1) + '** (1-100 arası)'
    ]
  };

  /* ================= YANIT ÜRETİCİ ================= */
  function generate(userMsg, contextRaw) {
    // 1) Oncelikle hesap makinesini dene
    const calcResult = liteTryCalculate(userMsg);
    if (calcResult) return calcResult;

    // 2) Bağlamı çözümle
    const topic = resolveTopic(userMsg, contextRaw);
    const intent = pickIntent(userMsg, topic);
    const t = norm(userMsg);

    switch (intent) {
      case 'weather': return pick(CATEGORIES.weather);
      case 'games':   return pick(CATEGORIES.games);
      case 'study':   return pick(CATEGORIES.study);
      case 'quote':   return pick(CATEGORIES.quote);
      case 'health':  return pick(CATEGORIES.health);
      case 'luck':    return pick(CATEGORIES.luck);

      case 'greet': {
        const greet = [
          'Merhaba 👋 Nasıl yardımcı olayım?',
          'Selam! 😊 Ne yapmak istersin?',
          'Hey! 👋 Hoş geldin. Bugün neler yapıyoruz?',
          'Merhaba! Hızlı cevaplar için hazırım ⚡'
        ];
        return pick(greet);
      }
      case 'thanks': {
        return pick([
          'Rica ederim 👍',
          'Ne demek, her zaman. 😊',
          'Memnun oldum!',
          'Yardımcı olabildiysem ne mutlu bana.'
        ]);
      }
      case 'bye': {
        return pick([
          'Hoşça kal 👋',
          'Görüşürüz! 😊',
          'Kendine iyi bak.',
          'Bir daha bekleriz!'
        ]);
      }
      case 'howareyou': {
        return pick([
          'İyiyim, teşekkürler! Sen nasılsın? 😊',
          'Fena değil! Bugün hazırcım. Sen?',
          'Harika! Yardımcı olmak için buradayım.',
          'Çok güzelim! Seni dinlemekten keyif alıyorum 🚀'
        ]);
      }
      case 'about': {
        return 'Ben **' + MODEL_NAME + '** ⚡\n• Hızlı & öz yanıtlar\n• Basit kod örnekleri\n• Hesap makinesi + bağlam takibi\n%100 istemci tarafı. Sana nasıl yardımcı olabilirim?';
      }
      case 'founder': {
        return 'Kurucu: **Bilal** 👑\nBu sistem onun emeğiyle tasarlandı. Teşekkürler Bilal! 💙';
      }
      case 'age': {
        return 'Yaş kavramım yok — model sürümüm **1.0 (FlashLite)** ⚡';
      }
      case 'datetime': {
        const d = new Date();
        const gunler = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
        const pad = (n) => String(n).padStart(2, '0');
        if (hasAny(t, ['hangi gün', 'günlerden'])) {
          return 'Bugün: **' + gunler[d.getDay()] + "**\nTarih: " + pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear();
        }
        return 'Şu an saat: **' + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "**\nTarih: " + pad(d.getDate()) + "." + pad(d.getMonth()+1) + "." + d.getFullYear();
      }
      case 'joke': {
        const jokes = [
          'Neden JavaScript geliştiricileri doğayı sevmez?\nÇünkü doğada **undefined** bir şey yok. 😂',
          'Yazılımcıya "kaç + kaç = 4" diye sordular. Cevap: "tam olarak hangi dilde?" 🤓',
          'Debugging: bir evin önünde su birikintisi görüp akışını tersine izlemekle aynı şey. 🔍',
          'Sonsuz döngü var. Nasıl anladın? — Annesi bana söyledi, "o geliyor" dedi, hala gelmedi. 😄',
          'İki programcı karşılaşmış: "- Nasılsın?" — "İyi, bugün hiç bug çıkmadı." Diğeri: "Ah, endişelenme, akşam olur." 😂'
        ];
        return pick(jokes);
      }
      case 'movie': {
        return '3 film önerim:\n1. Interstellar 🚀\n2. The Matrix 💊\n3. Inception 🌀\nHangisini izlersin? Tür söylersen daha spesifik öneririm!';
      }
      case 'music': {
        return '3 şarkı öneri:\n1. Imagine Dragons - Believer 🎸\n2. Coldplay - Viva La Vida 🎹\n3. Daft Punk - Get Lucky 🎧\nKeyifli dinlemeler!';
      }
      case 'book': {
        return '3 kitap önerisi:\n1. 1984 — George Orwell 📘\n2. Sapiens — Yuval Noah Harari 📗\n3. Atomic Habits — James Clear 📕\nOkudukça insan gelişiyor 🧠';
      }
      case 'food': {
        return 'Basit 3 öneri:\n1. 🍝 Makarna (kolay)\n2. 🍳 Omlet (5 dk)\n3. 🥗 Salata (sağlıklı)\nİstersen ayrıntılı tarif de yazayım.';
      }
      case 'calc': {
        // Hesap makinesi yakaladıysa yukarıda döner, burası niyet "calc" ama regex yakalamadıysa
        return 'Basit 4 işlem + faktöriyel hesabı yapabilirim! 🧮\nÖrnek: `23 * 7 kaç eder` veya `5!` yazarak dene.';
      }
      case 'code_simple': {
        const lang = detectLang(userMsg) || 'python';
        if (hasAny(t, ['karmaşık', 'proje', 'uygulama', 'todo', 'sınıf', 'sistem', 'tam çalışan'])) {
          return liteCodeSample(lang) +
            '\n\nℹ️ **FlashLite** ile **basit** kodlar gelir. Daha detaylı/karmaşık projeler için ⚡ **Flash 1.1** modeline geçebilirsin.';
        }
        return liteCodeSample(lang);
      }
      default: {
        if (topic) {
          const topicShort = topic.length > 60 ? topic.slice(0, 60) + '...' : topic;
          const options = [
            'Anladım, **"' + topicShort + '"** hakkında konuşuyoruz. 📌\nHangi detayı öğrenmek istersin? (nedir / nasıl / neden)',
            'Tamam, **' + topicShort + '** konusuna odaklandım. Ne öğrenmek / yapmak istiyorsun? 👇',
            'Konu net: **' + topicShort + '**. Sorduğun detayı biraz daha açarsan daha iyi yardımcı olabilirim.'
          ];
          return pick(options);
        }
        const hasCodeHint = hasAny(t, ['nasıl', 'yaz', 'kod', 'örnek', 'fonksiyon', 'yapay zeka', 'ai', 'öğren']);
        if (hasCodeHint) {
          return 'Anladım! 📌 İstersen bir dil söyle (Python/JS/HTML vb.) ya da tam olarak ne yapmak istediğini yaz — en kısa şekilde kodunu hazırlayayım.';
        }
        const rawTrim = String(userMsg || '').trim();
        if (rawTrim.length <= 40) {
          const questionHint = rawTrim.includes('?') ? ' Bu soruyu biraz daha açabilir misin?' : '';
          return pick([
            'Anladım. ' + rawTrim + ' konusunu konuşuyoruz — ne tür bir cevap istiyorsun? (özet / detay / kod / öneri)' + questionHint,
            'Tamam, hızlı bir özetleyeyim mi yoksa detaylı mı anlatayım? Yoksa örnek mi istiyorsun?' + questionHint,
            '📌 ' + rawTrim + ' — 3 seçenek:\n1) Kısa cevap\n2) Detaylı açıklama\n3) Kod örneği\nHangisi?'
          ]);
        }
        const defs = [
          'Anladım. Konuyu biraz daha netleştirirsen (örn: "python ile todo yaz", "bana film öner") anında cevap veririm 👇',
          'Hızlı hazırım ⚡ — Kod, hesap, tavsiye, sohbet? Hangi başlık altında yardımcı olayım?',
          'FlashLite 🟡 kısa ve öz durur. Uzun, detaylı analizler için ⚡ Flash 1.1 geçebilirsin, daha çok seçenek verir!'
        ];
        return pick(defs);
      }
    }
  }

  global.BilalAIFlashLite = {
    MODEL_NAME,
    THINKING_MS,
    generate,
    getCodeExt
  };
})(typeof window !== 'undefined' ? window : globalThis);
