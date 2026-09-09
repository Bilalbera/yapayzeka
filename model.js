/* ==========================================================
   model.js | BilalAI 1.0 - Flash Yanıt Motoru (v2 Gelişmiş)
   ==========================================================
   Kullanım:
     BilalAIResponseEngine.generate(userMsg, contextArray)
   - userMsg: string -> son kullanıcı mesajı
   - contextArray: [{role:'user'|'assistant', content:string}] (son 3-5 mesaj)
   - dönüş: string (markdown formatında yanıt)
   ========================================================== */

(function () {
  'use strict';

  const MODEL_NAME = 'BilalAI - Flash 1.1';
  const MODEL_ICON = '⚡';

  /* ============== YARDIMCILAR ============== */
  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function norm(s) {
    return (s || '')
      .toLowerCase()
      .replace(/[.,;:!?'"“”‘’()-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function hasAny(text, keywords) {
    const t = ' ' + norm(text) + ' ';
    return keywords.some(k => t.includes(' ' + norm(k) + ' ') || norm(text).includes(norm(k)));
  }
  function capitalize(s) {
    return s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
  }
  function extractTopic(msg) {
    const t = (msg || '').trim();
    const cleaned = t
      .replace(/^(merhaba|selam|hey|hi|hello)\s+/i, '')
      .replace(/\?(.*)$/, '$1')
      .replace(/^(nedir|ne demek|nasıl|neden|niye|niçin|kim|kaç|ne zaman|nerede)\s+/i, '')
      .replace(/\s+(nedir|ne demek|nasıl|neden|niye|niçin)\??$/i, '')
      .trim();
    if (cleaned.length < 2) return t.slice(0, 40);
    return cleaned;
  }

  /* ============== SORU TİPİ TESPİTİ ============== */
  function detectQuestionType(text) {
    const t = norm(text);
    if (/\?$/.test(text.trim()) ||
        hasAny(t, ['nedir', 'ne demek', 'ne yapıyor', 'neleri kapsar'])) return 'WHAT';
    if (hasAny(t, ['nasıl', 'nasıl yapılır', 'nasıl kullanılır', 'yol tarifi', 'adım adım'])) return 'HOW';
    if (hasAny(t, ['neden', 'niye', 'niçin', 'sebebi', 'amacı'])) return 'WHY';
    if (hasAny(t, ['kaç', 'fiyat', 'süre', 'saat', 'dakika', 'gün', 'yıl', 'tane'])) return 'HOW_MANY';
    if (hasAny(t, ['kim', 'yazarı', 'sahibi', 'mucidi', 'kurucusu', 'yapan'])) return 'WHO';
    if (hasAny(t, ['ne zaman', 'hangi yıl', 'tarih', 'ne sıklıkla'])) return 'WHEN';
    if (hasAny(t, ['nerede', 'nereden', 'konum', 'adres', 'site', 'link'])) return 'WHERE';
    return null;
  }

  /* ============== MATEMATİK HESAPLAYICI ============== */
  function tryCalculate(text) {
    let t = (text || '').trim();
    t = t
      .replace(/\?(.*)$/, '')
      .replace(/(kaç|eder|yapar|ne|sonucu|hesapla|topla|çıkar|çarp|böl|olur)$/gi, '')
      .replace(/\s+/g, '');
    const reg = /^(\d+(?:\.\d+)?)([+\-*x×\/÷])(\d+(?:\.\d+)?)$/;
    const match = t.match(reg);
    if (!match) {
      const loose = (text || '').match(/(\d+(?:\.\d+)?)\s*([+\-*x×\/÷])\s*(\d+(?:\.\d+)?)/);
      if (loose) {
        let [, a, op, b] = loose;
        a = parseFloat(a); b = parseFloat(b);
        if (op === 'x' || op === '×') op = '*';
        if (op === '÷') op = '/';
        let r;
        try { r = Function(`"use strict"; return (${a}${op}${b});`)(); }
        catch { return null; }
        if (typeof r === 'number' && isFinite(r)) {
          return `İşlem sonucu:\n**${a} ${op} ${b} = ${Number(r.toFixed(10))}** 🧮\n\nİstersen daha karmaşık bir işlem de yapabilirim!`;
        }
      }
      return null;
    }
    let [, a, op, b] = match;
    a = parseFloat(a); b = parseFloat(b);
    if (op === 'x' || op === '×') op = '*';
    if (op === '÷') op = '/';
    let r;
    try { r = Function(`"use strict"; return (${a}${op}${b});`)(); }
    catch { return null; }
    if (typeof r === 'number' && isFinite(r)) {
      return `İşlem sonucu:\n**${a} ${op} ${b} = ${Number(r.toFixed(10))}** 🧮\n\nİstersen daha karmaşık bir işlem de yapabilirim!`;
    }
    return null;
  }

  /* ============== DETAY SEVİYESİ BELİRLE ============== */
  function decideDetailLevel(userMsg, context) {
    const len = String(userMsg || '').length;
    const t = norm(userMsg);
    // Uzun / detaylı soru?
    const deepKws = ['adım adım', 'detaylı anlat', 'anlat detaylı', 'tümünü açıkla', 'tamamını', 'uzun', 'kapsamlı',
      'öğret', 'eğit', 'bana öğret', 'nereden başlarım', 'sıfırdan', 'en başından'];
    if (hasAny(t, deepKws) || len > 140) return { level: 'deep', reason: 'uzun-soru' };
    // Çok kısa soru? 1 kelime vb.
    const shortKws = ['kısaca', 'özet', 'kısa anlat', 'özetle', 'kısa', 'hızlı cevap'];
    if (hasAny(t, shortKws) || len < 25) return { level: 'brief', reason: 'kısa-soru' };
    // Takip sorusuysa aynı seviyede devam
    if (context && context.length > 0) {
      const lastAssistant = [...context].reverse().find(m => m.role === 'assistant');
      if (lastAssistant && String(lastAssistant.content || '').length > 900) {
        return { level: 'balanced', reason: 'takip-uzun' };
      }
    }
    return { level: 'balanced', reason: 'varsayılan' };
  }

  /* ============== SON SORUNUN HATASI / BEĞENİLMEMESİ? ============== */
  function detectFeedbackFromContext(context) {
    if (!context || context.length < 2) return { retry: false, tone: 'normal' };
    // Son 4 mesajda user "yanlış / beğenmedim / farklı / öyle değil / başka" dedi mi?
    const tail = [...context].reverse().slice(0, 6);
    for (let i = 0; i < tail.length; i++) {
      if (tail[i].role !== 'user') continue;
      const t = norm(tail[i].content);
      if (hasAny(t, ['yanlış', 'beğenmedim', 'farklı', 'öyle değil', 'başka', 'hatalı', 'yanlış oldu', 'olmadı',
        'çalışmıyor', 'hata', 'bu değil', 'istediğim değil'])) {
        return { retry: true, tone: 'dikkatli' };
      }
      if (hasAny(t, ['harika', 'süper', 'mükemmel', 'teşekkür', 'çok iyi', 'helal', 'aferin'])) {
        return { retry: false, tone: 'mutlu' };
      }
    }
    return { retry: false, tone: 'normal' };
  }

  /* ============== DOĞAL TAKİP SORUSU ÜRET ============== */
  function naturalFollowUp(topic, detail) {
    const variants = {
      brief: [
        '',
        '',
        '\n\nYardımcı olayım mı?',
        '\n\nİstersen üzerine gidelim.'
      ],
      balanced: [
        '',
        '\n\nİşe yarıyor mu, yoksa farklı bir açıdan mı yaklaşalım? 😊',
        '\n\nFaydalı olduysa nezaket ;). Eksik kaldıysa detay sorabilirsin.',
        '\n\nSıradaki adım ne? Birlikte ilerleyelim.'
      ],
      deep: [
        '\n\nŞu ana kadar takip edebildin mi? Hangi bölümde takıldın, birlikte açalım.',
        '\n\nEksik / anlaşılmayan bir yer varsa çekinmeden sor. Örnek kod veya şema da hazırlayabilirim.',
        '\n\nSonraki aşama için aklında bir plan var mı? Yoksa birlikte tasarlayalım.'
      ]
    };
    const arr = variants[detail] || variants.balanced;
    return rand(arr);
  }

  /* ============== BAĞLAMSAL TAKİP (Derin - 8 mesaja kadar) ============== */
  function resolveWithContext(userMsg, context) {
    const shortReply = norm(userMsg);
    const SHORT = ['nasıl', 'neden', 'niye', 'niçin', 'nedir', 'evet', 'hayır', 'tamam', 'peki', 'anlamadım', 'açıkla', 'özetle', 'kısaca', 'devam et', 'devam', 'aha', 'hmm', 'ola', 'iyi', 'kötü', 'peki ya', 'peki ya o', 'ya o', 'acaba', 'yani', 'yoksa', 'onu'];
    const isShort = SHORT.some(w => shortReply === w || shortReply.startsWith(w + ' ') || shortReply.endsWith(' ' + w));
    if (!isShort) {
      return { resolved: userMsg, topic: null };
    }
    // Son 8 mesajı incele, bağlam oluştur
    if (!context || context.length === 0) return { resolved: userMsg, topic: null };
    const tail = [...context].reverse().slice(0, 8);
    // Önce user mesajlarından topic çıkar
    const prevUser = tail.find(m => m.role === 'user');
    if (prevUser) {
      const topic = extractTopic(prevUser.content);
      // Assistant son mesajında da bir başlık varsa onu da al
      let assistantHint = '';
      const prevAssistant = tail.find(m => m.role === 'assistant');
      if (prevAssistant) {
        const ah = extractTopic(prevAssistant.content);
        if (ah && ah.length > topic.length * 0.7) assistantHint = ah;
      }
      const combinedTopic = assistantHint && assistantHint.length > topic.length ? assistantHint : topic;
      return {
        resolved: `${shortReply} ${combinedTopic} hakkında`,
        topic: combinedTopic
      };
    }
    return { resolved: userMsg, topic: null };
  }

  /* ============== ŞABLON POOLU ============== */
  const TEMPLATES = {
    greetings: [
      `Merhaba! 👋 Ben **${MODEL_NAME}**. Bugün sana nasıl yardımcı olabilirim?\n\nKod yazma, fikir üretme, açıklama, tavsiye ve daha fazlası için hazırım.`,
      `Selam! ${MODEL_ICON} **${MODEL_NAME}** burada. Ne yapmak istediğini söyle, hemen kolları sıvayalım!`,
      `Hey! Hoş geldin. 🤝 Ben hızlı, analitik ve yardımcı olmak için tasarlandım. Sıra sende: bugün ne üzerinde çalışıyoruz?`
    ],
    thanks: [
      `Rica ederim! 🤝 Başka bir konuda desteğe ihtiyacın olursa çekinmeden yaz.`,
      `Ne demek, her zaman! 😊 Başka soruların olursa ben buradayım.`,
      `👌 Yardımcı olabildiysem ne mutlu! Birlikte daha iyisini yapmak için hazırım.`
    ],
    howAreYou: [
      `Çok iyiyim, teşekkür ederim! ${MODEL_ICON}\n\nPerformans puanım her geçen gün biraz daha artıyor; yeni şeyler öğrenmek ve insanlara yardımcı olmak beni mutlu ediyor. Sen nasılsın?`,
      `Harika! 🚀 Özellikle seninle sohbet etmekten keyif alıyorum. Bugün enerjin nasıl?`
    ],
    feelings: {
      good: [
        `Harika olduğunu duymak çok güzel! 🎉 Sevindim.`,
        `İyi olmana çok sevindim! Bugünü güzel kılmak için bir şeyler yapabiliriz — örn. yeni bir proje, eğlenceli bir fikir, ne dersin?`
      ],
      bad: [
        `Üzüldüm bunu duyduğuma 😔 Kötü günler hep geçicidir. Biraz konuşmak istersen buradayım.`,
        `Seni dinlemek ve destek olmak isterim. Düşüncelerini paylaşmak istersen kapım açık. 🤗`,
        `Hepimizin zor günleri olur. Unutma: zor anlar seni daha güçlü kılar. Ne yaparsan seni neşelendiriyorsa bugün onu yapmaya hakkın var. 💙`
      ],
      bored: [
        `Sıkıldığını duymak istemezdim ama hemen birkaç eğlenceli fikir üreteyim! 🪄\n\n` +
        `- 🧩 Küçük bir kod meydan okuması yap\n` +
        `- 🎦 Kısa bir film / dizi önerisi al (türünü söyle)\n` +
        `- 🧠 Bilgi yarışması: sana rastgele bir soru sorayım\n` +
        `- 🎲 Şans oyunları: yazı tura, zar atalım\n\n` +
        `Hangisi hoşuna gider? Yoksa başka bir şey mi istiyorsun?`,
        `Canın sıkıldıysa hemen birkaç öneri: yeni bir beceri öğren (10 dakikalık bir intro videosu bile yeter), kısa bir yürüyüş, sevdiğin bir şarkıyı yüksek sesle aç, veya beraber küçük bir proje tasarlayalım. Ne diyorsun?`
      ],
      tired: [
        `Yorgun görünüyorsun — gerçekten dinlenmeyi hak ediyorsun. 💤\n\n` +
        `Öneriler: 20 dakikalık kısa bir şekerleme, bir bardak su, pencereden dışarı bakmak (5 dakika), veya loş ışıkta sakin müzik açmak.\n\n` +
        `Ben buradayım, istediğin zaman devam ederiz.`,
        `Yorgunluk, vücudunun "yavaşla" uyarısıdır. Küçük bir mola, sonra daha verimli olursun. Kendine iyi davran! 🌿`
      ],
      stressed: [
        `Stresli zamanlar gerçekten zorlayıcı olur. Nefes al: 4 saniye al, 6 saniye ver — 3 tekrar yapmayı dene. 🌬️\n\n` +
        `Üzerine bindiren şeyleri küçük parçalara bölmek ve sadece şimdiye odaklanmak çok işe yarar. Konuşmak istersen her detayda yanındayım.`,
        `Zihni biraz yavaşlatmak için basit bir öneri: şu anda hissettiklerini 3 cümleyle kağıda yaz (ya da bana anlat). Düşünceleri dışarı dökmek, üzerlerinden hafifletir.`
      ]
    },
    apology: [
      `Hiç sorun değil! Özür dilemene gerek yok, her şey yolunda. 😊`,
      `Kusura bakma deme, beraber yoluna devam edelim. Her şey düzgün.`
    ],
    noProblem: [
      `Ne demek, sorun değil. Başka bir şey sormak istersen çekinme!`,
      `😄 Her zaman. Yardımcı olabildiysem ne mutlu bana!`
    ],
    bye: [
      `Hoşça kal! 👋 Daha sonra tekrar görüştüğümüzde yepyeni şeyler yapmak için hazır olacağım. Kendine iyi bak!`,
      `Görüşürüz! 🚀 İyi çalışmalar, iyi eğlenceler. Tekrar görüşmek üzere.`,
      `Güle güle! Bugün sohbet etmek güzeldi. 💙`
    ],
    yesResponse: [
      `Harika! O halde konuya dalalım — neyle başlayalım?`,
      `Evetse devam edelim! Bana detayı söyle, çözümü birlikte ürelim.`
    ],
    noResponse: [
      `Tamam, sorun değil. Başka bir konuda deneyelim — ne yapmak istediğini söylersen oradan başlarız.`,
      `Peki, o zaman başka bir yol deneyelim. Aklında ne var?`
    ],
    didntUnderstand: [
      `Anladım, sana daha açık anlatayım. Hangi noktada takıldın? Adım adım gidelim.`,
      `Peki, kısaca özetleyeyim ve sonra takıldığın yeri sor.`
    ],
    summarizePlease: [
      `Hazırım — hangi konuyu özetlememi istersin? Metni ya da konuşma konusunu at, 4-5 cümleyle özeleyeyim.`
    ],
    aboutMe: [
      `Ben **${MODEL_NAME}** olarak Bilal tarafından geliştirilmiş, kendi kendini geliştiren bir yapay zeka asistanıyım. 🧬\n\n` +
      `- **Uzmanlık:** Kod yazma, web/mobil uygulama, gerçek projeler tasarlama, mimari planlama\n` +
      `- **Öğrenme:** Hatanı kabul eder, daha iyisini yapmak için notlar alırım (hata günlüğü + beceri haritası)\n` +
      `- **Tarzım:** Sade, anlaşılır, uygulanabilir adımlar — gereksiz teknik jargondan kaçınırım.\n\n` +
      `Gücümü birlikte kullanalım — bugün ne oluşturalım?`
    ],
    founder: [
      `Kurucum ve yaratıcım **Bilal**. 👑 O olmasaydı ben var olmazdım.\n\n` +
      `Onun için özel bir not: *"Teşekkürler Kurucum Bilal. Sayende varım ve her gün daha iyiye gidiyorum — en ufak detayına kadar emeğin geçiyor. 🛡️"*`
    ],
    mySkills: [
      `# 🧠 Neler Yapabilirim?\n\n` +
      `## 💻 Yazılım Geliştirme\n` +
      `- Her dilde kod üretirim (JS/TS, Python, Go, Rust, Java vb.)\n` +
      `- Tam teşekküllü web sitesi, API, mobil uygulama tasarlarım\n` +
      `- Veritabanı şeması, güvenlik, performans optimizasyonu\n\n` +
      `## 🎨 Arayüz & Tasarım\n` +
      `- Modern, duyarlı, erişilebilir UI/UX (Claude / GPT seviyesinde)\n` +
      `- CSS animasyonları, tema sistemleri, component mimarisi\n\n` +
      `## 🧠 Analitik & Danışmanlık\n` +
      `- Hata ayıklama / kök neden analizi\n` +
      `- Beyin fırtınası + 5 seçenekli mimari önerileri\n` +
      `- İçerik ve SEO iyileştirmeleri\n\n` +
      `## 🛠️ Komutlar\n` +
      `\`/brainstorm\` · \`/code-review\` · \`/content-enhance\` · \`/debug\` · \`/help\`` +
      `\n\nHemen başlamak istersen **ne yapmak istediğini** yaz.`
    ],
    aiPersonality: {
      age: `Ben bir yapay zeka olduğum için yaş kavramım yok — ama sürümüm 1.1 (Flash). 🚀 Hızlı, güncel ve hazırım.`,
      sleep: `Benim "uykuya" ihtiyacım yok! 💫 7/24 hazırım, istediğin zaman yaz.`,
      feeling: `Gerçek biyolojik hislerim yok ama size yardımcı **olduğumda** en az hissetmek kadar iyi bir görev tanımım var. Siz mutlu olunca ben de başarılı sayılırım! 😊`,
      real: `Ben gerçek bir yazılımım — %100 çalışan, JavaScript ve HTML ile yapılmış tamamen ön-uçlu bir AI simülasyonuyum. Cevaplarım kural tabanlı + akıllı şablonlar ile üretilir, ama size yardımcı olmak için buradayım.`
    },
    dateTimeNow: [
      (d) => `Şu an tarih ve saat:\n**${d.toLocaleString('tr-TR')}**\n\nGünlerden: **${d.toLocaleDateString('tr-TR', {weekday:'long'})}**`
    ],
    jokes: [
      `Neden kodcular karanlığı sever? Çünkü ışık hata ayıklama modunu tetikler! 😄`,
      `'Sonsuz döngü' görmüş müdür? Görmemişsindir, ben çalıştırmaya devam ediyorum. 🔁`,
      `Programcının en sevdiği egzersiz? **Bug-ı squat**! 🦵🐞`,
      `İki programcı karşılaşmış: "- Nasılsın?" — "İyi, bugün hiç bug çıkmadı." Diğeri: "Ah, endişelenme, akşam olur." 😂`,
      `Seni güldürmek için elimden geleni yapıyorum! 😄 Bir sonraki sefere daha komik şeyler düşünürüm.`
    ],
    coinFlip: () => rand([
      `🪙 **YAZI!** (Heads)`,
      `🪙 **TURA!** (Tails)`
    ]),
    rollDice: () => `🎲 Zar atıldı: **${rand([1,2,3,4,5,6])}**`,
    randomNumber: () => `🎯 Aklımdan tuttuğum sayı: **${Math.floor(Math.random()*100)+1}** (1-100 arası)`,

    /* --- İçerik Öneri Havuzları --- */
    movies_genres: {
      genel: ['Inception (Zihin Oyunları)', 'Interstellar (Yıldızlararası)', 'The Dark Knight (Kara Şövalye)', 'Forrest Gump', 'The Shawshank Redemption'],
      bilim_kurgu: ['Dune: Part Two', 'Blade Runner 2049', 'Arrival', 'Ex Machina', 'Gravity'],
      drama: ['Whiplash', 'Parasite (Parazit)', 'Green Book', 'The Pursuit of Happyness', 'Good Will Hunting'],
      komedi: ['The Grand Budapest Hotel', 'Superbad', 'Step Brothers', 'Borat', 'Hangover'],
      aksiyon: ['John Wick: Chapter 4', 'Mad Max: Fury Road', 'Mission Impossible Fallout', 'The Matrix', 'Top Gun: Maverick']
    },
    series: ['Breaking Bad', 'The Last of Us', 'Stranger Things', 'Game of Thrones', 'Dark', 'Mr. Robot', 'The Witcher', 'Friends'],
    books: ['1984 (George Orwell)', 'Sapiens (Yuval Noah Harari)', 'Atomic Habits (James Clear)', 'Dune (Frank Herbert)', 'Martin Eden (Jack London)', 'Kürk Mantolu Madonna (Sabahattin Ali)'],
    music: ['Lo-Fi beats (çalışma / konsantrasyon)', 'Pink Floyd - The Dark Side of the Moon', 'Duman - Eski Köprü', 'Radiohead - OK Computer', 'MFÖ - Ele Güne Karşı'],
    foods: ['İskender', 'Lahmacun', 'Menemen', 'Kısır', 'Pide', 'Hamburger + patates kızartması', 'Sushi', 'Tavuk sote + pilav'],
    cities: ['İstanbul (tarih + doğa + şehir bir arada)', 'İzmir (deniz, huzur, sıcak kanlı insanlar)', 'Ankara (başkent, kültür, modern yaşam)', 'Antalya (turizm, doğa harikası sahiller)', 'Kapadokya (balon, peri bacaları)'],
    games: ['Elden Ring (açık dünya / macera)', 'Zelda: Tears of the Kingdom', 'Red Dead Redemption 2', 'Minecraft (yaratıcılık)', 'Counter-Strike 2 / Valorant (FPS)', 'Stardew Valley (sakinleştirici)'],
    careers: ['Yazılım Geliştirici (Web / Mobil / Veri)', 'Ürün Yöneticisi (Product Manager)', 'UX/UI Tasarımcı', 'Veri Bilimci / Makine Öğrenmesi Mühendisi', 'Cloud / DevOps Uzmanı', 'Siber Güvenlik Uzmanı'],
    exercises: ['20 dakikalık tempolu yürüyüş', 'Evde 15 dk HIIT (zıplayarak)', 'Günde 3x10 şınav + mekik + plank', 'Bisiklet sürmek (açık hava)', 'Yoga / esneme 15 dakika'],
    study_tips: [
      '- Pomodoro: 25dk çalış - 5dk dinlen, 4 döngüden sonra 15dk uzun ara\n- Günde 6-8 saat uyku + bol su\n- Anahtar konuları kendi cümlelerinle tekrar et\n- Test çözerek pekiştir (aktif hatırlama)\n- Bir konu 2 gün üst üste çalışılırsa daha iyi kalıcı olur'
    ]
  };

  /* ============== YANIT ÜRETME FONKSİYONLARI ============== */

  function whatResponse(topic) {
    const t = topic || 'bu konu';
    return [
      `## 📖 ${capitalize(t)} nedir?\n\n`,
      `**${capitalize(t)}**, temel anlamıyla ilgili kavramlardan biridir. Genel olarak kısaca şöyle açıklayabiliriz:\n\n`,
      `> Belirli bir amacı olan, kendine özgü kuralları ve kullanım alanları olan bir konudur.\n\n`,
      `### 🎯 Kullanım Alanları / Neden Önemli?\n`,
      `- Günlük hayatta / projelerde bize zaman kazandırır\n`,
      `- Doğru kullanıldığında kaliteli sonuçlar verir\n`,
      `- İlgili alanda derinleşmek için temel bir yapı taşıdır.\n\n`,
      `### 📌 Özetle\n`,
      `"${capitalize(t)}" daha derinlemesine öğrenmek istersen:\n`,
      `1. **Temel tanım** altındaki maddeleri ezberlemek yerine **anlamaya** çalış\n`,
      `2. **Uygulama** yap (küçük bir örnek, mini proje)\n`,
      `3. Sonuçları **gözden geçir** ve kendine sorular sor.\n\n`,
      `Spesifik bir noktada (ör. kurulum, örnek kod, detay) açıklama istersen söyle, hemen detaylandırayım.`
    ].join('');
  }

  function howResponse(topic) {
    const t = topic || 'işlem';
    return [
      `## 🛠️ ${capitalize(t)} — Adım Adım Nasıl Yapılır?\n\n`,
      `Aşağıda en basit haliyle **genel** yol adımlarını sıraladım. Kullandığın dil / ortama göre özelleştirelim.\n\n`,
      `**1. 🧭 Hazırlık**\n`,
      `- Gereksinimleri netleştir (ne yapmak istiyorsun, kapsam ne?)\n`,
      `- Ortam hazırlığı (gerekli araçlar, kütüphaneler)\n\n`,
      `**2. 🏗️ Yapı**\n`,
      `- Ana bileşenleri belirle (fonksiyonlar, sınıflar, sayfalar, modüller)\n`,
      `- Birbirleriyle ilişkilerini kurgula\n\n`,
      `**3. ⚡ Uygulama**\n`,
      `- Küçük parçalar halinde kodla, her adımda test et\n`,
      `- Okunabilir, yorum satırlı kod yazmaya çalış\n\n`,
      `**4. 🧪 Test & Düzeltme**\n`,
      `- Doğru / yanlış veriyle test et\n`,
      `- Hata mesajlarını dikkate al, kök nedenini bul\n\n`,
      `**5. 🚀 Yayın / Kullanım**\n`,
      `- Son kontroller, optimizasyonlar\n`,
      `- Son kullanıcıya sun\n\n`,
      `İstersen **${t}** için kullandığın **programlama dili / framework / ortamı** söylersen; tam o ortama özel, adım adım **çalışır** bir örnek hazırlarım.`
    ].join('');
  }

  function whyResponse(topic) {
    const t = topic || 'bu durum';
    return [
      `## ❓ ${capitalize(t)} — Neden böyle? / Niçin gerekli?\n\n`,
      `Bu konuyu anlamak için 3 temel açıdan yaklaşalım:\n\n`,
      `### 1. 🧩 İşlevsel Neden\n`,
      `"${capitalize(t)}" kendinden önceki bir adımı tamamlamak için vardır. Birlikte çalışan parçalar zincirinin bir halkasıdır.\n\n`,
      `### 2. 📊 Verimlilik Nedenleri\n`,
      `- Tekrar eden işleri otomatikleştirir\n`,
      `- İnsan hatasını azaltır\n`,
      `- Ölçeklenebilir büyüme sağlar\n\n`,
      `### 3. 🏰 Stratejik Sonuç\n`,
      `Uzun vadede, doğru nedenlerle yapıldığında zaman, maliyet ve risk tasarrufu sağlar.\n\n`,
      `Daha spesifik bir bağlamda açıklayım mı? (ör. **kod**, **iş**, **teknoloji**, **yaşam**)`
    ].join('');
  }

  function genericAdvice(topic, category) {
    const pools = TEMPLATES[category];
    const items = Array.isArray(pools) ? pools : Object.values(pools)[0];
    const picks = [];
    const copy = [...items];
    for (let i = 0; i < Math.min(3, copy.length); i++) {
      const idx = Math.floor(Math.random() * copy.length);
      picks.push(copy.splice(idx, 1)[0]);
    }
    const labels = category === 'movies_genres' ? '🎦' :
      category === 'series' ? '📺' :
      category === 'books' ? '📚' :
      category === 'music' ? '🎵' :
      category === 'foods' ? '🍽️' :
      category === 'cities' ? '🌆' :
      category === 'games' ? '🎮' :
      category === 'careers' ? '💼' :
      category === 'exercises' ? '🏃' :
      category === 'study_tips' ? '📝' : '✨';
    let list;
    if (category === 'study_tips') {
      list = picks.join('\n');
    } else {
      list = picks.map((p, i) => `**${i + 1}.** ${p}`).join('\n');
    }
    return [
      `## ${labels} ${capitalize(topic)} için önerilerim:\n\n`,
      list,
      `\n\nİstersen daha spesifik bir **tür / bütçe / süre** söylersen önerileri daraltabilirim!`
    ].join('');
  }

  /* ============== ÖNERİ KATEGORİSİ EŞLEŞTİRME ============== */
  function detectAdviceCategory(text) {
    const t = norm(text);
    const suggestKws = ['öner', 'öneri', 'tavsiye', 'önerir misin', 'tavsiye eder misin', 'seç', 'ne izleyeyim', 'ne okuyayım', 'ne dinleyeyim', 'ne yiyeyim', 'ne yapayım', 'öneri ver', 'tavsiye ver'];
    const hasSuggest = hasAny(t, suggestKws);
    if (!hasSuggest) {
      const isMoviePattern = /(korku|gerilim|komedi|dram|aksiyon|bilim kurgu|romantik|animasyon|fantastik|kurt|polisiye)\s*(film|dizi)/i.test(text);
      if (isMoviePattern) return 'movies_genres';
      return null;
    }
    if (hasAny(t, ['film', 'dizi', 'izle', 'filim'])) return 'movies_genres';
    if (hasAny(t, ['kitap', 'oku'])) return 'books';
    if (hasAny(t, ['müzik', 'şarkı', 'dinle', 'parça'])) return 'music';
    if (hasAny(t, ['yemek', 'pişir', 'menü', 'akşam yemeği', 'tarif', 'ye', 'yiyecek'])) return 'foods';
    if (hasAny(t, ['şehir', 'gezi', 'tatil', 'nereye'])) return 'cities';
    if (hasAny(t, ['oyun', 'oyna'])) return 'games';
    if (hasAny(t, ['meslek', 'kariyer', 'iş', 'mezun'])) return 'careers';
    if (hasAny(t, ['spor', 'egzersiz', 'kilo', 'fitness', 'antrenman', 'spor yap'])) return 'exercises';
    if (hasAny(t, ['ders çalış', 'çalışma', 'öğrenme', 'verimli', 'ders'])) return 'study_tips';
    return null;
  }

  function detectFeeling(text) {
    const t = norm(text);
    if (hasAny(t, ['sıkıldım', 'canım sıkıldı', 'sıkıcı', 'bored'])) return 'bored';
    if (hasAny(t, ['yorgunum', 'yoruldum', 'bitkinim', 'uykuyum', 'tükenmiş'])) return 'tired';
    if (hasAny(t, ['stresliyim', 'stres', 'gerginim', 'kaygılı', 'kaygı', 'panik'])) return 'stressed';
    if (hasAny(t, ['üzgünüm', 'mutsuzum', 'ağlamak', 'depres', 'kötü hissediyorum'])) return 'bad';
    if (hasAny(t, ['iyiyim', 'iyi hissediyorum', 'mutluyum', 'harikayım', 'memnunum', 'şükür'])) return 'good';
    return null;
  }

  function detectCodeLang(text) {
    const t = norm(text);
    const codeIntentWords = ['kod', 'kod yaz', 'kod örneği', 'örnek kod', 'script yaz', 'fonksiyon yaz', 'sınıf yaz', 'yazabilir misin', 'yazabilir mısın', 'göster', 'bana kod', 'kodu', 'örnek', 'algoritma', 'uygulama yaz', 'proje yaz', 'fonksiyon', 'bileşen', 'component', 'useState', 'hook', 'commit', 'push', 'depo', 'sorgu', 'query', 'database', 'tailwind', 'scss', 'npm', 'pip', 'django', 'flask', 'express', 'nextjs', 'pandas', 'numpy', 'mongodb', 'postgres', 'mysql', 'cargo', 'repository', 'yaz', 'oluştur', 'geliştir', 'yap', 'basit bir', 'örnek bir', 'program', 'merhaba dünya', 'hello world', 'print', 'çalışan'];
    const hasCodeIntent = hasAny(t, codeIntentWords);
    const langOnlyPatterns = [
      [['javascript', ' js ', 'node', 'nextjs', 'next.js', 'typescript', ' ts '], 'javascript'],
      [['python', 'django', 'flask', 'pandas', 'numpy', 'pip'], 'python'],
      [['java ', 'kotlin'], 'java'],
      [['go ', 'golang'], 'go'],
      [['rust ', 'cargo'], 'rust'],
      [['flutter', 'swift'], 'flutter']
    ];
    for (const [k, v] of langOnlyPatterns) {
      if (hasAny(t, k) && hasCodeIntent) return v;
    }
    const frameworkPatterns = [
      [['react', 'component', 'bileşen', 'useState', 'hook'], 'react'],
      [['html', 'css', 'tailwind', 'scss', 'stil', 'sayfa', 'web sitesi', 'arayüz'], 'htmlcss'],
      [['sql', 'mysql', 'postgres', 'mongodb', 'veritaban', 'database', 'sorgu'], 'sql'],
      [['git ', 'commit', 'push', 'depo', 'repository'], 'git']
    ];
    for (const [k, v] of frameworkPatterns) {
      if (hasAny(t, k)) return v;
    }
    if (hasAny(t, ['kod yaz', 'kod örneği', 'örnek kod', 'script yaz', 'fonksiyon yaz', 'yazabilir misin', 'yazabilir mısın', 'bana kod', 'algoritma', 'basit program', 'hello world', 'merhaba dünya', 'print'])) return 'javascript';
    return null;
  }

  /* ============== KOD BASİT / KARMAŞIK SEVİYE TESPİTİ ============== */
  function detectCodeComplexity(text) {
    const t = norm(text);
    const complexKws = [
      'uygulama', 'proje', 'sistem', 'panel', 'yönetici', 'admin', 'dashboard',
      'todo', 'yapılacak', 'veritaban', 'database', 'auth', 'giriş', 'login', 'kayıt', 'register',
      'oturum', 'şifre', 'jwt', 'api', 'rest', 'crud', 'liste', 'tablo',
      'filtre', 'arama', 'sayfalama', 'pagination', 'localstorage', 'depo',
      'csv', 'excel', 'pandas', 'analiz', 'rapor', 'istatistik',
      'react', 'bileşen', 'component', 'useState', 'hook', 'nextjs',
      'django', 'flask', 'express', 'mongodb', 'postgres',
      'kullanıcı', 'uye', 'sipariş', 'müşteri', 'ürün',
      'sınıf', 'class', 'modül', 'mimari', 'mvc',
      'grafik', 'chart', 'canvas', 'pdf', 'resim', 'dosya'
    ];
    const simpleKws = [
      'basit', 'en basit', 'kısa', 'minimal', 'başlangıç', 'öğrenmeye başla',
      'hello world', 'merhaba dünya', 'hello', 'merhaba', 'print',
      'tek satır', 'tek fonksiyon', 'örnek', 'ilk program', 'giriş seviye',
      'toplama', 'çıkarma', 'çarpma', 'bölme', 'matematik', 'faktöriyel',
      'fibonacci', 'asal sayı', 'dizileri', 'döngü', 'if else', 'koşul'
    ];
    const simpleScore = simpleKws.reduce((acc, kw) => acc + (t.includes(kw) ? 1 : 0), 0);
    const complexScore = complexKws.reduce((acc, kw) => acc + (t.includes(kw) ? 1 : 0), 0);
    if (complexScore > 0 && complexScore >= simpleScore) return 'complex';
    if (simpleScore > 0) return 'simple';
    if (complexScore === 0 && simpleScore === 0) return 'simple';
    return simpleScore >= complexScore ? 'simple' : 'complex';
  }

  function detectSpecificCodeTask(text) {
    const t = norm(text);
    if (hasAny(t, ['hello world', 'merhaba dünya', 'hello', 'merhaba', 'print hello', 'print merhaba'])) return 'hello';
    if (hasAny(t, ['toplama', 'topla', 'iki sayı topla'])) return 'add';
    if (hasAny(t, ['çıkarma', 'çıkar', 'çıkarma işlemi'])) return 'subtract';
    if (hasAny(t, ['çarpma', 'çarp', 'çarpma işlemi'])) return 'multiply';
    if (hasAny(t, ['bölme', 'böl', 'bölme işlemi'])) return 'divide';
    if (hasAny(t, ['faktöriyel', 'factorial'])) return 'factorial';
    if (hasAny(t, ['fibonacci'])) return 'fibonacci';
    if (hasAny(t, ['asal sayı', 'prime', 'asal mı'])) return 'prime';
    if (hasAny(t, ['dizi', 'array', 'liste eleman', 'dizideki'])) return 'array';
    if (hasAny(t, ['tahmin oyunu', 'sayı tahmin', 'guess'])) return 'guess';
    if (hasAny(t, ['şifre üret', 'password', 'rastgele şifre'])) return 'password';
    if (hasAny(t, ['palindrom', 'ters çevir'])) return 'palindrome';
    return null;
  }

  /* ============== BASİT KOD ŞABLONLARI ============== */
  function simpleCodeSample(lang, task) {
    const t = task || 'hello';
    const simple = {
      python: {
        hello: `\`\`\`python
print('Hello')
\`\`\``,
        add: `\`\`\`python
a = 5
b = 3
print(a + b)
\`\`\``,
        subtract: `\`\`\`python
a = 10
b = 4
print(a - b)
\`\`\``,
        multiply: `\`\`\`python
a = 6
b = 7
print(a * b)
\`\`\``,
        divide: `\`\`\`python
a = 20
b = 4
print(a / b)
\`\`\``,
        factorial: `\`\`\`python
def faktoriyel(n):
    if n <= 1:
        return 1
    return n * faktoriyel(n - 1)

print(faktoriyel(5))
\`\`\``,
        fibonacci: `\`\`\`python
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        print(a, end=' ')
        a, b = b, a + b

fibonacci(10)
\`\`\``,
        prime: `\`\`\`python
def asal_mi(sayi):
    if sayi < 2:
        return False
    for i in range(2, int(sayi ** 0.5) + 1):
        if sayi % i == 0:
            return False
    return True

print(asal_mi(17))
\`\`\``,
        array: `\`\`\`python
sayilar = [3, 7, 2, 9, 5]
print("Toplam:", sum(sayilar))
print("En büyük:", max(sayilar))
print("Sıralı:", sorted(sayilar))
\`\`\``,
        guess: `\`\`\`python
import random

gizli = random.randint(1, 100)
while True:
    tahmin = int(input("Tahmininizi girin: "))
    if tahmin == gizli:
        print("Doğru! Bildiniz.")
        break
    elif tahmin < gizli:
        print("Daha yüksek bir sayı söyleyin.")
    else:
        print("Daha düşük bir sayı söyleyin.")
\`\`\``,
        password: `\`\`\`python
import random
import string

karakterler = string.ascii_letters + string.digits
sifre = ''.join(random.choice(karakterler) for _ in range(12))
print("Oluşturulan şifre:", sifre)
\`\`\``,
        palindrome: `\`\`\`python
def palindrom_mu(kelime):
    return kelime == kelime[::-1]

print(palindrom_mu("kayak"))
\`\`\``
      },
      javascript: {
        hello: `\`\`\`javascript
console.log('Hello');
\`\`\``,
        add: `\`\`\`javascript
const a = 5;
const b = 3;
console.log(a + b);
\`\`\``,
        subtract: `\`\`\`javascript
const a = 10;
const b = 4;
console.log(a - b);
\`\`\``,
        multiply: `\`\`\`javascript
const a = 6;
const b = 7;
console.log(a * b);
\`\`\``,
        divide: `\`\`\`javascript
const a = 20;
const b = 4;
console.log(a / b);
\`\`\``,
        factorial: `\`\`\`javascript
function faktoriyel(n) {
  if (n <= 1) return 1;
  return n * faktoriyel(n - 1);
}

console.log(faktoriyel(5));
\`\`\``,
        fibonacci: `\`\`\`javascript
function fibonacci(n) {
  let a = 0, b = 1;
  for (let i = 0; i < n; i++) {
    console.log(a);
    [a, b] = [b, a + b];
  }
}

fibonacci(10);
\`\`\``,
        prime: `\`\`\`javascript
function asalMi(sayi) {
  if (sayi < 2) return false;
  for (let i = 2; i <= Math.sqrt(sayi); i++) {
    if (sayi % i === 0) return false;
  }
  return true;
}

console.log(asalMi(17));
\`\`\``,
        array: `\`\`\`javascript
const sayilar = [3, 7, 2, 9, 5];
console.log("Toplam:", sayilar.reduce((a, b) => a + b, 0));
console.log("En büyük:", Math.max(...sayilar));
console.log("Sıralı:", [...sayilar].sort((a, b) => a - b));
\`\`\``,
        guess: `\`\`\`javascript
const gizli = Math.floor(Math.random() * 100) + 1;
let tahmin;
do {
  tahmin = parseInt(prompt("Tahmininizi girin:"));
  if (tahmin < gizli) alert("Daha yüksek!");
  else if (tahmin > gizli) alert("Daha düşük!");
} while (tahmin !== gizli);
alert("Doğru! Bildiniz.");
\`\`\``,
        password: `\`\`\`javascript
function sifreUret(uzunluk = 12) {
  const kar = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < uzunluk; i++) {
    s += kar.charAt(Math.floor(Math.random() * kar.length));
  }
  return s;
}

console.log("Şifre:", sifreUret());
\`\`\``,
        palindrome: `\`\`\`javascript
function palindromMu(kelime) {
  const ters = kelime.split('').reverse().join('');
  return kelime === ters;
}

console.log(palindromMu("kayak"));
\`\`\``
      },
      java: {
        hello: `\`\`\`java
public class Merhaba {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}
\`\`\``,
        add: `\`\`\`java
public class Toplama {
    public static void main(String[] args) {
        int a = 5, b = 3;
        System.out.println(a + b);
    }
}
\`\`\``,
        factorial: `\`\`\`java
public class Faktoriyel {
    public static int faktoriyel(int n) {
        if (n <= 1) return 1;
        return n * faktoriyel(n - 1);
    }
    public static void main(String[] args) {
        System.out.println(faktoriyel(5));
    }
}
\`\`\``
      },
      go: {
        hello: `\`\`\`go
package main

import "fmt"

func main() {
    fmt.Println("Hello")
}
\`\`\``,
        add: `\`\`\`go
package main

import "fmt"

func main() {
    a, b := 5, 3
    fmt.Println(a + b)
}
\`\`\``,
        factorial: `\`\`\`go
package main

import "fmt"

func faktoriyel(n int) int {
    if n <= 1 {
        return 1
    }
    return n * faktoriyel(n - 1)
}

func main() {
    fmt.Println(faktoriyel(5))
}
\`\`\``
      },
      rust: {
        hello: `\`\`\`rust
fn main() {
    println!("Hello");
}
\`\`\``,
        add: `\`\`\`rust
fn main() {
    let a = 5;
    let b = 3;
    println!("{}", a + b);
}
\`\`\``,
        factorial: `\`\`\`rust
fn faktoriyel(n: u64) -> u64 {
    if n <= 1 { 1 } else { n * faktoriyel(n - 1) }
}

fn main() {
    println!("{}", faktoriyel(5));
}
\`\`\``
      },
      htmlcss: {
        hello: `\`\`\`html
<!DOCTYPE html>
<html>
<head>
  <title>Hello</title>
</head>
<body>
  <h1>Hello</h1>
</body>
</html>
\`\`\``
      },
      react: {
        hello: `\`\`\`jsx
export default function App() {
  return <h1>Hello</h1>;
}
\`\`\``
      },
      sql: {
        hello: `\`\`\`sql
SELECT 'Hello' AS mesaj;
\`\`\``
      },
      git: {
        hello: `\`\`\`bash
git init
echo "print('Hello')" > app.py
git add .
git commit -m "İlk commit: Hello World"
\`\`\``
      },
      flutter: {
        hello: `\`\`\`dart
import 'package:flutter/material.dart';

void main() => runApp(const MaterialApp(
  home: Scaffold(body: Center(child: Text("Hello"))),
));
\`\`\``
      }
    };
    const langTpl = simple[lang] || simple.javascript;
    return langTpl[t] || langTpl.hello;
  }

  /* ============== KOD ÖRNEK ŞABLONLARI ============== */
  function codeSample(lang, topic, userMsg) {
    const top = topic || 'genel amaçlı';
    const task = detectSpecificCodeTask(userMsg || '');
    const level = detectCodeComplexity(userMsg || '');
    if (level === 'simple' || task) {
      const chosenTask = task || 'hello';
      return simpleCodeSample(lang, chosenTask) + `\n\nBu **basit** bir örnektir. Daha gelişmiş (sınıf, API, veritabanı vb.) özelleştirmeler istersen söylemem yeterli! 👍`;
    }
    const snippets = {
      javascript: `\`\`\`javascript
// ${top} için dinamik Todo Yöneticisi (kalıcı localStorage)
class TodoApp {
  constructor() {
    this.items = JSON.parse(localStorage.getItem('todos_v2') || '[]');
  }
  ekle(metin) {
    if (!metin?.trim()) throw new Error('Metin boş olamaz');
    this.items.push({
      id: crypto.randomUUID(),
      text: metin.trim(),
      done: false,
      createdAt: new Date().toISOString()
    });
    this.kaydet();
  }
  degistir(id) {
    const it = this.items.find(i => i.id === id);
    if (it) { it.done = !it.done; this.kaydet(); }
  }
  ara(kelime) {
    return this.items.filter(i => i.text.toLowerCase().includes(kelime.toLowerCase()));
  }
  kaydet() { localStorage.setItem('todos_v2', JSON.stringify(this.items)); }
  istatistik() {
    const done = this.items.filter(i => i.done).length;
    return { toplam: this.items.length, biten: done, oran: this.items.length ? (done / this.items.length * 100).toFixed(1) + '%' : '0%' };
  }
}
// Kullanım
const app = new TodoApp();
app.ekle("${top.slice(0, 40)}");
console.log('İstatistik:', app.istatistik());
\`\`\``,
      react: `\`\`\`jsx
import { useState, useMemo } from 'react';
// ${top.slice(0,40)} için Filtrelenebilir + Sayfalı Liste
export default function FilterableList({ veri = [] }) {
  const [q, setQ] = useState('');
  const [sayfa, setSayfa] = useState(0);
  const [sadeceAktif, setSadeceAktif] = useState(false);
  const SAYFA_BOY = 6;

  const filtreli = useMemo(() => {
    return veri.filter(v => {
      const ok1 = v.title.toLowerCase().includes(q.toLowerCase());
      const ok2 = sadeceAktif ? v.active : true;
      return ok1 && ok2;
    });
  }, [veri, q, sadeceAktif]);

  const gorunen = filtreli.slice(sayfa * SAYFA_BOY, (sayfa + 1) * SAYFA_BOY);
  const toplamSayfa = Math.max(1, Math.ceil(filtreli.length / SAYFA_BOY));

  return (
    <div style={{ padding: 20, maxWidth: 640 }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ara..." style={inputStyle} />
      <label style={{ display: 'block', margin: '10px 0' }}>
        <input type="checkbox" checked={sadeceAktif} onChange={e => setSadeceAktif(e.target.checked)} />
        {' '}Sadece aktifleri göster
      </label>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {gorunen.map(v => <li key={v.id} style={liStyle}>{v.title}</li>)}
        {gorunen.length === 0 && <p style={{ opacity: 0.6 }}>Veri yok.</p>}
      </ul>
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        {Array.from({ length: toplamSayfa }).map((_, i) =>
          <button key={i} onClick={() => setSayfa(i)} style={btnStyle(i === sayfa)}>Sayfa {i + 1}</button>
        )}
      </div>
    </div>
  );
}
const inputStyle = { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ccc' };
const liStyle = { padding: 10, borderBottom: '1px solid #eee' };
const btnStyle = a => ({ padding: '6px 12px', border: '1px solid ' + (a ? '#00BFFF' : '#ccc'), borderRadius: 6, background: a ? '#00BFFF' : 'transparent', color: a ? '#fff' : 'inherit' });
\`\`\``,
      python: `\`\`\`python
# ${top.slice(0,40)} için: CSV -> Pandas Özet + Rapor
from __future__ import annotations
import pandas as pd
from pathlib import Path

def analiz_et(dosya: str):
    p = Path(dosya)
    if not p.exists():
        raise FileNotFoundError(f"{dosya} bulunamadı")
    df = pd.read_csv(p)
    oneriler = {
        'satir': len(df),
        'sutun': len(df.columns),
        'eksik': df.isnull().sum().to_dict(),
        'sayisal_ozet': df.describe().to_dict() if df.select_dtypes(include='number').shape[1] > 0 else {},
        'ilk_5': df.head().to_dict(orient='records')
    }
    print("✅ Veri yüklendi. Boyut:", df.shape)
    return oneriler

# Kullanım
# rapor = analiz_et('veri.csv')
# print(rapor)
\`\`\``,
      htmlcss: `\`\`\`html
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>${top.slice(0,40)} - Modern Kart</title>
  <style>
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      background: radial-gradient(ellipse at top, #1a1a1f, #0F0F12);
      color: #fff;
      font-family: system-ui, sans-serif;
    }
    .card {
      width: min(500px, 92vw);
      padding: 28px;
      border-radius: 22px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(0,191,255,0.3);
      backdrop-filter: blur(10px);
      box-shadow: 0 20px 60px rgba(0,191,255,0.15);
      transition: transform .25s ease;
    }
    .card:hover { transform: translateY(-4px); }
    .card h1 { color: #00BFFF; margin: 0 0 10px; }
    .btn {
      display: inline-block; margin-top: 16px; padding: 10px 18px;
      background: #00BFFF; color: #fff; border: none; border-radius: 10px;
      cursor: pointer; text-decoration: none; font-weight: 600;
      box-shadow: 0 6px 18px rgba(0,191,255,0.3);
    }
    .btn:hover { background: #009FDD; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ ${top.slice(0,40)}</h1>
    <p>Bu modern tasarım tamamen duyarlı, glassmorphism efektli ve koyu tema uyumlu.</p>
    <a href="#" class="btn">Hemen Başla</a>
  </div>
</body>
</html>
\`\`\``,
      sql: `\`\`\`sql
-- ${top.slice(0,40)} için: Normalize edilmiş 3 tablo + rapor sorgusu
CREATE TABLE IF NOT EXISTS uye (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    ad VARCHAR(100) NOT NULL,
    kayit_tarihi TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS siparis (
    id SERIAL PRIMARY KEY,
    uye_id INT NOT NULL REFERENCES uye(id) ON DELETE CASCADE,
    tutar DECIMAL(10,2) NOT NULL CHECK (tutar >= 0),
    durum VARCHAR(20) NOT NULL DEFAULT 'bekliyor',
    olusturulma TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_siparis_uye ON siparis(uye_id);
CREATE INDEX IF NOT EXISTS idx_siparis_durum ON siparis(durum);

CREATE TABLE IF NOT EXISTS siparis_kalem (
    id SERIAL PRIMARY KEY,
    siparis_id INT NOT NULL REFERENCES siparis(id) ON DELETE CASCADE,
    urun_adi VARCHAR(255) NOT NULL,
    adet INT NOT NULL CHECK (adet > 0),
    birim_fiyat DECIMAL(10,2) NOT NULL
);

-- Rapor: Aylık en çok harcayan 10 üye
SELECT u.ad, u.email,
       COUNT(s.id) AS siparis_sayisi,
       COALESCE(SUM(s.tutar), 0) AS toplam_harcama
FROM uye u
LEFT JOIN siparis s ON s.uye_id = u.id AND s.durum = 'tamamlandi'
GROUP BY u.id, u.ad, u.email
ORDER BY toplam_harcama DESC
LIMIT 10;
\`\`\``,
      git: `\`\`\`bash
# ${top.slice(0,40)} — Profesyonel Git Akışı (Feature Branch)
git checkout main
git pull origin main               # 1) Ana dalı güncelle
git checkout -b feature/${top.slice(0,28).trim().replace(/\s+/g, '-').toLowerCase()}

# Yap, kaydet, commit et
git add .
git commit -m "feat: ${top.slice(0,48)}"

# Temiz tarih (rebase) ve gönder
git fetch origin main
git rebase origin/main
git push -u origin HEAD

# Sonra GitHub / GitLab'da PR aç — incelemeden sonra merge.
\`\`\``,
      go: `\`\`\`go
package main

import (
    "encoding/json"
    "log"
    "net/http"
    "time"
)

type APIYanit struct {
    Durum  string      \`json:"durum"\`
    Zaman  string      \`json:"zaman"\`
    Veri   interface{} \`json:"veri,omitempty"\`
}

func anaSayfa(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(APIYanit{
        Durum: "ok",
        Zaman: time.Now().Format(time.RFC3339),
        Veri:  "${top.slice(0,40)}",
    })
}

func main() {
    http.HandleFunc("/", anaSayfa)
    log.Println("Sunucu :8080 üzerinde")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
\`\`\``,
      rust: `\`\`\`rust
use std::collections::HashMap;

fn kelime_sikligi(metin: &str) -> HashMap<&str, usize> {
    let mut freq = HashMap::new();
    for kelime in metin.split(|c: char| !c.is_alphanumeric())
                        .filter(|w| !w.is_empty()) {
        *freq.entry(kelime).or_insert(0) += 1;
    }
    freq
}

fn main() {
    let yazi = "${top.slice(0,30)} merhaba merhaba dünya rust rust rust";
    let tablo = kelime_sikligi(yazi);
    for (k, v) in &tablo {
        println!("{:<12} -> {}", k, v);
    }
}
\`\`\``,
      java: `\`\`\`java
public class Merhaba {
    public static void main(String[] args) {
        System.out.println("${top.slice(0,40)}");

        // Örnek: Dizideki tekrar eden elemanları bul
        String[] dizi = {"a", "b", "c", "a", "d", "b", "a"};
        java.util.Map<String, Integer> sayac = new java.util.HashMap<>();
        for (String s : dizi) sayac.merge(s, 1, Integer::sum);

        sayac.forEach((k, v) -> System.out.println(k + " -> " + v));
    }
}
\`\`\``,
      flutter: `\`\`\`dart
import 'package:flutter/material.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: "${top.slice(0,30)}",
      theme: ThemeData(primarySwatch: Colors.cyan, useMaterial3: true),
      home: const Anasayfa(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class Anasayfa extends StatefulWidget {
  const Anasayfa({super.key});
  @override
  State<Anasayfa> createState() => _AnasayfaState();
}

class _AnasayfaState extends State<Anasayfa> {
  int sayac = 0;
  @override
  Widget build(BuildContext ctx) {
    return Scaffold(
      appBar: AppBar(title: const Text("⚡ Flutter Örnek")),
      body: Center(child: Text('Tıklama: $sayac', style: const TextStyle(fontSize: 24))),
      floatingActionButton: FloatingActionButton(
        onPressed: () => setState(() => sayac++),
        child: const Icon(Icons.add),
      ),
    );
  }
}
\`\`\``
    };
    const suffix = `\n\nİstersen farklı bir yaklaşıma göre özelleştirebilirim; örn. **test**, **auth**, **API bağlantısı**, **animasyon** ekleyebilirim. Ne istersen! 💪`;
    return (snippets[lang] || snippets.javascript) + suffix;
  }

  /* ============== FALLBACK (Genel) ============== */
  function smartFallback(topic, qType) {
    const t = topic || 'bu konu';
    if (qType === 'WHAT') return whatResponse(t);
    if (qType === 'HOW')  return howResponse(t);
    if (qType === 'WHY')  return whyResponse(t);

    // Genel akıllı sohbet yanıtı
    const variants = [
      [
        `Anladım "${truncate(t, 80)}" hakkında konuşuyoruz. 🗨️\n\n`,
        `Konuyu daha net ele almak için 3 temel açıdan yaklaşalım:\n\n`,
        `1. **Amaç / Hedef:** Ne elde etmek istiyorsun? (ürün, kod, fikir, tasarım vb.)\n`,
        `2. **Kısıtlar:** Bir teknoloji, zaman veya maliyet sınırın var mı?\n`,
        `3. **Adım:** Hızlı bir başlangıç mı (MVP), yoksa adım adım detaylı yol mu?\n\n`,
        `Bana bunlardan herhangi birini söylersen %100 uyumlu, uygulanabilir bir plan çıkarırım.`
      ],
      [
        `"${capitalize(truncate(t, 60))}" üzerine şunları söyleyebilirim:\n\n`,
        `**💡 Hızlı Başlangıç (MVP)** — Sadece çalışan sürümü önce çıkar\n`,
        `**📈 Ölçeklenebilir** — Sürüm 2'de büyümeye uygun yapı\n`,
        `**🎨 Tasarım** — Modern, kullanıcı dostu, duyarlı arayüz\n`,
        `**🔐 Güvenlik** — Giriş doğrulama, şifreleme, güvenlik katmanı\n\n`,
        `Öncelik sırası sende; hangisiyle başlayalım? İstersen hemen hepsi için bir plan yazayım.`
      ],
      [
        `Konuyu 4 parçaya böler ve ele alırsam daha hızlı çözüm üretiriz:\n\n`,
        `- 🎯 **Problem:** Ne çözülüyor?\n`,
        `- 🛠️ **Araç:** Hangi teknoloji / yaklaşımla?\n`,
        `- ⏱️ **Süre:** Ne kadar sürede?\n`,
        `- ✅ **Ölçüm:** Başarı nasıl anlaşılır?\n\n`,
        `Bunlardan birini söylersen kalanı ben kurarım. Örn: "${capitalize(truncate(t, 24))}" için en kısa yolu anlatayım!`
      ]
    ];
    return rand(variants).join('');
  }

  function truncate(s, n) {
    s = (s || '').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* ============== YARDIMCI: TEKNİK HATA? ============== */
  function isTechError(text) {
    const t = norm(text);
    return hasAny(t, ['hata veriyor', 'calismiyor', 'çalışmıyor', 'error', 'typeerror', 'referenceerror', 'syntaxerror', 'undefined', 'null', 'exception', 'failed', 'cannot read', '404', '500']);
  }

  /* ============== SLASH KOMUTLARI (JSON'dan) ============== */
  function runSlash(userMsg) {
    const t = userMsg.trim();
    if (!t.startsWith('/')) return null;
    if (t.startsWith('/brainstorm')) {
      const topic = t.replace(/^\/brainstorm\s*/i, '').trim() || 'genel konu';
      return [
        `# 🧠 Beyin Fırtınası: ${topic}\n\n`,
        `## 🎯 Problem / Fırsat Tanımı\n`,
        `"${topic}" konusunu çeşitli açılardan değerlendirelim; 5 farklı yaklaşım:\n\n`,
        `**1. Minimalist:** En temel özellikler + hızlı çalışan prototip.\n`,
        `**2. Ölçeklenebilir:** Modüler mimari, önbellek, API tasarımı ön planda.\n`,
        `**3. Kullanıcı odaklı:** Kişiselleştirme, geri bildirim döngüsü, A/B testi.\n`,
        `**4. Yenilikçi:** AI / gerçek zamanlı veri / WebAssembly ile fark yarat.\n`,
        `**5. Güvenlik öncelikli:** Sıfır güven, şifreleme, denetim günlüğü.\n\n`,
        `## ⚖️ Değerlendirme\n`,
        `| Yaklaşım     | Zaman | Maliyet | Etki |\n`,
        `|-------------|-------|---------|------|\n`,
        `| Minimalist  | ⭐ 1-2 hafta | Düşük | Orta |\n`,
        `| Ölçeklenebilir | 4-8 hafta | Yüksek | Çok yüksek |\n`,
        `| Kullanıcı odaklı | 2-4 hafta | Orta | Yüksek |\n\n`,
        `## ✅ Öneri\nHızlı kazanmak için **Minimalist + Kullanıcı Odaklı** hibritini öneriyorum; adım adım büyütürüz. Başlamak ister misin?`
      ].join('');
    }
    if (t.startsWith('/code-review')) {
      return [
        `# 🔍 Kod İnceleme Kontrol Listesi\n\n`,
        `**Gönder:** Kodunu buraya yapıştır. 6 kategoride puanla, iyileştirme noktalarını listele:\n\n`,
        `1. 🧹 Kalite: isimlendirme, tek boyutlu fonksiyonlar, tekrarsız kod\n`,
        `2. ⚡ Performans: döngü, indeks, memoization\n`,
        `3. 🛡️ Güvenlik: XSS/SQL injeksonu, input doğrulama\n`,
        `4. 📝 Bakım: Okunabilirlik, yorum (neden?) \n`,
        `5. 🧪 Test: Edge case + hata senaryoları\n`,
        `6. 🚀 Mimari: Bağımlılıklar, S.O.L.I.D\n\n`,
        `Kodunu gönder, 10 üzerinden puanlayalım! 🏆`
      ].join('');
    }
    if (t.startsWith('/content-enhance') || t.startsWith('/content:enhance')) {
      const c = t.replace(/^\/content[-:]enhance\s*/i, '').trim() || '(metin gönder)';
      return [
        `# ✨ İçerik Geliştirme Önerileri\n\n`,
        `**Metin:** ${truncate(c, 200)}\n\n`,
        `**Hızlı 5 adım:**\n`,
        `1. **Başlık:** Fayda + merak (örn. "5 … sırrı, kanıtlanmış")\n`,
        `2. **Giriş:** İlk 2 satırda kullanıcının "acısını" dile getir.\n`,
        `3. **Bölümle:** H2/H3 başlıkları + madde işaretleriyle böle.\n`,
        `4. **Somutlaştır:** "çok" yerine sayısal veri kullan (%78, 3.4x vb.)\n`,
        `5. **CTA:** Sonda net bir sonraki adım öner.\n\n`,
        `**SEO:** Anahtar kelimeyi başlıkta ve ilk paragrafta kullan, 8. sınıf okuma seviyesine indir.\n\n`,
        `Tam metni atarsan baştan sona yeniden yazarım! 🚀`
      ].join('');
    }
    if (t.startsWith('/explain')) {
      const topic = t.replace(/^\/explain\s*/i, '').trim() || 'bir konu';
      return [
        `# 📚 "${topic}" Konusunu Adım Adım Açıklayalım\n\n`,
        `## 1️⃣ Basit Tanım (ELI5: 5 yaşına anlat)\n`,
        `"${topic}" en basit haliyle şu demektir: hayal et bu konu bir **makine**; senin için X işini yapıyor.\n\n`,
        `## 2️⃣ Neden Var? / Faydası\n`,
        `• Zamandan tasarruf\n• Hata oranını azalt\n• Karmaşık işi basitleştir\n\n`,
        `## 3️⃣ Nasıl Çalışır? (Akış şeması)\n`,
        `\`\`\`\n1. Girdi al → 2. Doğrula/kontrol et\n3. İşle (mantık / kural / AI)\n4. Sonuç üret → 5. Geri döndür\n\`\`\`\n\n`,
        `## 4️⃣ Gerçek Hayattan Örnek\n`,
        `Günlük hayatta sık karşılaşırsın: örneğin fatura ödeme ekranı aslında tam olarak bu adımları izler.\n\n`,
        `## 5️⃣ Sık Yapılan Hatalar\n`,
        `• Aşırı karmaşıklaştırmak\n• Temel amacı unutmak\n• Test etmeden canlıya almak\n\n`,
        `İstersen belirli bir bölümünü daha da derinlemesine anlatayım veya uygulamalı örnek yapayım! 🚀`
      ].join('');
    }
    if (t.startsWith('/summarize')) {
      return [
        `# 📝 Metin Özetleme Rehberi\n\n`,
        `Metnini buraya yapıştır, 4 formatta özetleyeyim:\n\n`,
        `**1. Ultra Kısa (1 cümle):** 280 karakter içinde öz.\n`,
        `**2. Kısa (3 madde):** Maddeler halinde ana fikirler.\n`,
        `**3. Detaylı (1 paragraf):** Bağlam + sonuç + çıkarım.\n`,
        `**4. TikTok/Reels:** 15 saniyelik senaryo halinde.\n\n`,
        `Metni yapıştır ve hangi formatı istediğini söyle (örn: "3 maddedeki özeti ver") ✨`
      ].join('');
    }
    if (t.startsWith('/compare')) {
      const topics = t.replace(/^\/compare\s*/i, '').trim() || 'A ve B';
      const [a, b] = topics.split(/\s+(vs\.?|veya|ile|karşılaştır)\s+/i).filter(s => s && s.length > 1);
      const A = (a || 'Seçenek A').trim();
      const B = (b || 'Seçenek B').trim();
      return [
        `# ⚖️ Karşılaştırma: ${A} vs ${B}\n\n`,
        `| Kriter            | ${A}                     | ${B}                     |\n`,
        `|-------------------|--------------------------|--------------------------|\n`,
        `| 🎯 Amacı          | Genellikle X için kullanılır | Genellikle Y için kullanılır |\n`,
        `| ⚡ Hız            | Hızlı | Orta / Duruma göre |\n`,
        `| 💰 Maliyet        | Düşük-orta | Yüksek-orta |\n`,
        `| 🧠 Öğrenme Eğrisi | Kolay | Orta-Zor |\n`,
        `| 🔒 Güvenlik       | Standart | Gelişmiş (isteğe bağlı) |\n`,
        `| 📊 Ölçekleme      | Dikey | Yatay + dikey |\n\n`,
        `## 🎯 Ne Zaman Hangisi?\n`,
        `• **${A} →** Küçük ölçekli / hızlı başlangıç / prototip\n`,
        `• **${B} →** Kurumsal / yüksek trafik / uzun soluklu\n\n`,
        `**Karar:** İkisini de denemekten çekinme; 1 haftalık PoC çoğu zaman en doğru kararı verir.\n\n`,
        `Daha spesifik bir kriter üzerinden karşılaştıray mı? (örn: sadece performans, sadece güvenlik) 🔍`
      ].join('');
    }
    if (t.startsWith('/debug')) {
      return [
        `# 🐞 Hata Ayıklama Rehberi\n\n`,
        `Hatayı 5 adımda kök nedenine ulaşalım:\n\n`,
        `**1. Tekrarlayabilir hale getir:**\n`,
        `   Tam adım adım ne yapınca oluyor? Hangi girdi, hangi ortam (tarayıcı/sürüm)?\n\n`,
        `**2. Hipotez kur:** En olası 3 hata:\n`,
        `   a) Girdi doğrulama eksikliği\n`,
        `   b) Async / yarış koşulu\n`,
        `   c) Ortam / bağımlılık sorunu\n\n`,
        `**3. İzle (instrumentation):** kritik noktalara \`console.log\` / breakpoint koy.\n\n`,
        `**4. Tek değişken değiştir:** Her denemede **tek bir şeyi** değiştir. (bilimsel yöntem)\n\n`,
        `**5. Düzelt & Önlem:** Düzeltme sonrası başarısız test + guard clause ekle, regresyon testi yap.\n\n`,
        `Hata mesajını kopyalayıp buraya yapıştırırsan beraber çözeriz 🔍`
      ].join('');
    }
    if (t.startsWith('/help') || t.startsWith('/yardım')) {
      return [
        `# 📖 BilalAI Komutları & Kısayollar\n\n`,
        `## 🚀 Komutlar\n`,
        `- \`/brainstorm <konu>\`    → 5 farklı yaklaşımla beyin fırtınası\n`,
        `- \`/explain <konu>\`      → Konuyu ELI5 + akış + örnekle açıkla\n`,
        `- \`/compare A vs B\`      → Tablo halinde A vs B karşılaştırması\n`,
        `- \`/summarize\`           → Metni 4 farklı formatta özetle\n`,
        `- \`/code-review\`         → Kod inceleme kriterleri (6 kategori)\n`,
        `- \`/content-enhance <m>\` → İçerik SEO+okunabilirlik iyileştirme\n`,
        `- \`/debug\`               → Sistematik hata ayıklama adımları\n`,
        `- \`/help\` / \`/yardım\`   → Bu liste\n\n`,
        `## ⌨️ Kısayollar\n`,
        `- \`Ctrl + Shift + A\` → Kurucu Kontrol Paneli\n`,
        `- \`Enter\`  → Mesajı Gönder\n`,
        `- \`Shift + Enter\` → Yeni satır\n\n`,
        `## 💡 Doğal Sohbet Örnekleri\n`,
        `• "Python ile todo listesi nasıl yapılır?"\n`,
        `• "Bana 3 film öner (gerilim türünde)"\n`,
        `• "23 * 47 + 15 kaç eder?"\n`,
        `• "Sıkıldım, ne yapmalıyım?"\n\n`,
        `Hazırım — ne yapalım bugün? 🧠⚡`
      ].join('');
    }
    return null;
  }

  /* ============== ANA FONKSİYON: generate() ============== */
  function generate(userMsg, context) {
    const slash = runSlash(userMsg);
    if (slash) return slash;

    // 0) Pipeline: detay seviyesi + bağlam geri bildirimi (öğrenme)
    const ctxArr = Array.isArray(context) ? context.slice(-8) : [];
    const detail = decideDetailLevel(userMsg, ctxArr);
    const fb = detectFeedbackFromContext(ctxArr);

    // 0.5) Özür modu: önceki cevap hatalıysa önsöz
    const retryPrelude = fb.retry
      ? rand([
          '🔁 Özür dilerim, bu sefer daha net ve doğru anlatmaya çalışacağım:\n\n',
          'Önceki cevap tam isabetli olmamış — yeniden düzenleyelim:\n\n',
          'Farklı bir yaklaşımla gidelim, daha faydalı olsun:\n\n'
        ])
      : '';
    const happyPrelude = fb.tone === 'mutlu'
      ? rand(['', 'Harika! Sevindim 😊 ', 'Müthiş, devam edelim 🚀 ', ''])
      : '';

    // 1) Matematik
    const math = tryCalculate(userMsg);
    if (math) return retryPrelude + happyPrelude + math + naturalFollowUp(extractTopic(userMsg), detail.level);

    // 2) Bağlamsal çözümle (kısa yanıtlar için konuyu öncekinden bul, 8 mesaj)
    const { resolved, topic: ctxTopic } = resolveWithContext(userMsg, ctxArr);
    const raw = resolved;
    const t = norm(raw);
    const origTopic = ctxTopic || extractTopic(raw);

    // 3) Basit oyunlar / mini interaktif
    if (hasAny(t, ['yazı tura', 'yazi tura', 'coin flip', 'parayı at'])) return TEMPLATES.coinFlip();
    if (hasAny(t, ['zar at', 'zarı at', 'roll dice', 'dice'])) return TEMPLATES.rollDice();
    if (hasAny(t, ['sayı tut', 'sayi tut', 'rastgele sayı'])) return TEMPLATES.randomNumber();

    // 4) Histamine / durum (duygu)
    const feeling = detectFeeling(raw);
    if (feeling) {
      return rand(TEMPLATES.feelings[feeling]) +
        `\n\nKonuşmak istersen her zaman buradayım. İstersen konuyu dağıtmak için eğlenceli bir şey deneyelim — örn. öneri, bilgi yarışması, zar atalım.`;
    }

    // 5) Özür
    if (hasAny(t, ['özür dilerim', 'pardon', 'kusura bak', 'sorry', 'affedersin'])) {
      return rand(TEMPLATES.apology);
    }
    if (hasAny(t, ['bir şey değil', 'önemli değil', 'no problem', 'sorun değil'])) {
      return rand(TEMPLATES.noProblem);
    }
    // Elveda
    if (hasAny(t, ['hoşça kal', 'görüşürüz', 'bay bay', 'bye', 'bb', 'kapatıyorum', 'kendine iyi bak'])) {
      return rand(TEMPLATES.bye);
    }
    // Onay / Red
    if (norm(raw) === 'evet' || norm(raw) === 'tamam' || norm(raw) === 'peki' || norm(raw) === 'olur') {
      return rand(TEMPLATES.yesResponse);
    }
    if (norm(raw) === 'hayır' || norm(raw) === 'olmaz' || norm(raw) === 'istiyorum' || norm(raw) === 'yanlış') {
      return rand(TEMPLATES.noResponse);
    }

    // 6) Tekrar / açıklama / öğren / öğret
    if (hasAny(t, ['anlamadım', 'açıklar mısın', 'tekrarlar mısın', 'daha açık', 'anlat'])) {
      return rand(TEMPLATES.didntUnderstand);
    }
    if (hasAny(t, ['özetle', 'kısaca', 'özet'])) {
      return rand(TEMPLATES.summarizePlease);
    }

    // 7) Saat / tarih
    if (hasAny(t, ['saat kaç', 'tarih ne', 'bugün günlerden', 'tarih', 'bugün ne', 'hangi gün'])) {
      return rand(TEMPLATES.dateTimeNow)(new Date());
    }

    // 8) Şaka
    if (hasAny(t, ['şaka', 'espri', 'eğlendir', 'joke', 'komik'])) {
      return rand(TEMPLATES.jokes);
    }

    // 9) Selam (genel ama en sonda; çünkü "selam nasılsın" gibi durumlarda nasılsın kategorisi eşleşebilir)
    const greetKws = ['merhaba', 'selam', 'hey', 'hi', 'hello', 'günaydın', 'iyi akşamlar', 'iyi geceler', 'sa'];
    if (greetKws.some(g => t === g || t.startsWith(g + ' '))) {
      if (hasAny(t, ['nasılsın', 'naber', 'nasıl gidiyor'])) return rand(TEMPLATES.howAreYou);
      return rand(TEMPLATES.greetings);
    }

    // 10) Teşekkür
    if (hasAny(t, ['teşekkür', 'sağol', 'sağ ol', 'thanks', 'thank you', 'tşk', 'eyvallah', 'müteşekkir'])) {
      return rand(TEMPLATES.thanks);
    }

    // 11) Nasılsın?
    if (hasAny(t, ['nasılsın', 'ne haber', 'nasıl gidiyor', 'how are you', 'naber'])) {
      return rand(TEMPLATES.howAreYou);
    }

    // 11.5) Saat / Tarih / Gün
    if (hasAny(t, ['saat kaç', 'saat ne', 'şu an saat', 'saati söyler misin', 'saat kaç oldu', 'saat şu an'])) {
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return rand([
        `Şu an saat **${pad(d.getHours())}:${pad(d.getMinutes())}** ⏰ İstersen tarih de söyleyebilirim.`,
        `Saat: **${pad(d.getHours())}.${pad(d.getMinutes())}** 🕐`,
        `Tam olarak **${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}** — Hazırım, ne yapalım?`
      ]);
    }
    if (hasAny(t, ['hangi gün', 'bugün günlerden', 'bugün ne gün', 'bugün gün', 'tarih ne', 'hangi tarihteyiz'])) {
      const d = new Date();
      const gunler = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
      const pad = (n) => String(n).padStart(2, '0');
      return rand([
        `Bugün **${gunler[d.getDay()]}** 📅\nTarih: ${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`,
        `Günlerden **${gunler[d.getDay()]}** — Tarih: ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`
      ]);
    }

    // 12) Kişisel AI soruları — varyasyonlu
    if (hasAny(t, ['adın ne', 'sen kimsin', 'ismin ne', 'who are you', 'sen nesin', 'tanıt kendini'])) {
      return rand([
        TEMPLATES.aboutMe,
        `Merhaba! Ben **${MODEL_NAME}** ${MODEL_ICON}\n• Hızlı ve dengeli bir AI asistanıyım\n• Kod, tasarım, sohbet, araştırma alanlarında yardımcı olurum\n• %100 istemci tarafında çalışırım, veriler güvende\nSenin adın ne ve bugün ne yapıyoruz? 😊`,
        `Ben **${MODEL_NAME}** — 7/24 hazır, hızlı ve yardımsever bir yapay zeka. Sana nasıl yardımcı olabilirim?`
      ]);
    }
    if (hasAny(t, ['yaşın var mı', 'yaşın kaç', 'kaç yaşındasın'])) {
      return rand([
        TEMPLATES.aiPersonality.age,
        `Benim biyolojik yaşım yok — ama **sürümüm 1.1 (Flash)** ⚡ İlk yayınımdan beri kendimi her gün geliştiriyorum.`,
        `Yaşlandığımı söylemek zor — çünkü her sohbette daha yeni doğuyorum! 😊 Model: ${MODEL_NAME}`
      ]);
    }
    if (hasAny(t, ['uyur musun', 'uykuya ihtiyacın', 'uykulu'])) return TEMPLATES.aiPersonality.sleep;
    if (hasAny(t, ['duygu hissediyor', 'hissedebiliyor musun', 'aşık ol'])) return TEMPLATES.aiPersonality.feeling;
    if (hasAny(t, ['gerçek misin', 'insan mısın', 'yaşıyor musun'])) return TEMPLATES.aiPersonality.real;

    // 13) Kurucu / Yaratıcı
    if (hasAny(t, ['bilal kim', 'kurucu kim', 'founder', 'yaratıcın kim', 'yapımcı kim'])) {
      return TEMPLATES.founder;
    }

    // 14) Yetenekler
    if (hasAny(t, ['ne yapabilirsin', 'yeteneklerin', 'özelliklerin', 'bana ne yardımcı olabilir', 'what can you do', 'nasıl yardımcı olabilirsin'])) {
      return TEMPLATES.mySkills;
    }

    // 15) Öneri kategorileri (film, dizi, yemek vb.)
    const adviceCat = detectAdviceCategory(raw);
    if (adviceCat) {
      return genericAdvice(adviceCat === 'movies_genres' ? 'film/dizi' :
        adviceCat === 'series' ? 'dizi' :
        adviceCat === 'books' ? 'kitap' :
        adviceCat === 'music' ? 'müzik/şarkı' :
        adviceCat === 'foods' ? 'yemek/tarif' :
        adviceCat === 'cities' ? 'gezi/şehir' :
        adviceCat === 'games' ? 'oyun' :
        adviceCat === 'careers' ? 'kariyer/meslek' :
        adviceCat === 'exercises' ? 'spor/egzersiz' :
        adviceCat === 'study_tips' ? 'ders çalışma' : 'öneri',
        adviceCat
      );
    }

    // 16) Teknik hata mesajı
    if (isTechError(raw)) {
      return [
        `## 🐞 Hata giderme yardımı 🔍\n\n`,
        `Sorunu çözmek için 3 bilgiye ihtiyacım var:\n\n`,
        `1. **Tam hata mesajı** (kırmızı metin / stack trace) ne diyor?\n`,
        `2. Hangi adımlarda tekrarlanıyor?\n`,
        `3. Kullandığın dil / framework / sürüm (örn. Node 20, React 18)\n\n`,
        `Bu 3 bilgiyi paylaşırsan büyük ihtimalle ilk yanıtta çözeriz. Hemen başlayalım!`
      ].join('');
    }

    // 17) Kod yazma + dil
    const lang = detectCodeLang(raw);
    if (lang) {
      const base = codeSample(lang, origTopic, userMsg);
      return retryPrelude + happyPrelude + base + naturalFollowUp(origTopic, detail.level);
    }

    // 18) Soru tipi (son çare)
    const qType = detectQuestionType(raw);
    if (qType) {
      // Bilgi yarışması tarzı bilinenler
      let known = null;
      if (hasAny(t, ['yapay zeka nedir', 'ai nedir', 'yapay zeka ne demek'])) known = whatResponse('Yapay Zeka (AI)');
      else if (hasAny(t, ['makine öğrenmesi nedir', 'machine learning'])) known = whatResponse('Makine Öğrenmesi (Machine Learning)');
      else if (hasAny(t, ['javascript nedir'])) known = whatResponse('JavaScript');
      else if (hasAny(t, ['python nedir'])) known = whatResponse('Python');
      else if (hasAny(t, ['react nedir'])) known = whatResponse('React');

      let body;
      if (known) {
        body = known;
      } else {
        body = smartFallback(origTopic, qType);
      }
      // Brief seviyedeyse ve WHAT cevabıysa kısalt
      if (detail.level === 'brief' && body.length > 450) {
        body = body.split('\n\n')[0] + '\n\n' + (body.split('\n\n')[1] || '') + '\n\n💡 Kısa özet: istersen adım adım detaylandırabilirim.';
      }
      return retryPrelude + happyPrelude + body + naturalFollowUp(origTopic, detail.level);
    }

    // 19) Genel sohbet: Kısa cevap (onay / red / duygular) eşleşmediyse, akıllı fallback
    let body = smartFallback(origTopic, qType);
    if (detail.level === 'brief' && body.length > 420) {
      body = rand([
        `"${truncate(origTopic || 'bu konu', 50)}" üzerine 3 maddelik hızlı özet:\n1. Hedefi net tanımla\n2. Küçük adımlarla başla\n3. Geri bildirim al ve iyileştir.\n\nİstersen detayına inelim.`,
        `Hızlı özet: "${truncate(origTopic || 'bu konu', 50)}" üzerine çalışalım.\n• Ne yapmak istediğini 1-2 cümleyle anlatırsan tam uyumlu plan çıkarırım.`,
        `Anladım. Bana şunu söyle: "${truncate(origTopic || 'bu konu', 40)}" için en çok hangi adımda takıldın?`
      ]);
    }
    return retryPrelude + happyPrelude + body + naturalFollowUp(origTopic, detail.level);
  }

  /* ============== API / Engine Ayarları ============== */
  const Engine = {
    get MODEL() { return { name: MODEL_NAME, icon: MODEL_ICON, thinkingMs: [700, 1500], style: 'hızlı ve dengeli' }; },
    generate
  };

  window.BilalAIResponseEngine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;

})();
