# BilalAI Pro modeli

BilalAI Pro, istemci tarafındaki mevcut yanıt motorunu daha geniş bağlam ve daha ayrıntılı kalite kontrolüyle çalıştırır.

- Düşünme süresi: **5.0–7.5 saniye**
- Bağlam: son **12** mesaj
- Teknik, planlama ve karar istekleri için ek kalite kontrolü
- Ağ bağlantısı veya harici API gerektirmez

`pro-model.js`, `model.js` ve `flashlitemodel.js` ile birlikte yüklenmelidir. Uygulama entegrasyonunda model kaydı şu özelliklerle eklenmelidir:

```js
pro: {
  name: 'BilalAI - Pro 1.0',
  shortName: 'Pro',
  icon: '🧠',
  color: '#8B5CF6',
  thinkingMs: [5000, 7500],
  style: 'derin, kontrollü ve kapsamlı',
  engine: 'BilalAIPro'
}
```
