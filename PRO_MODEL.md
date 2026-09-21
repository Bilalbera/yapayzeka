# BilalAI Pro entegrasyonu

`pro-model.js` Pro yanıt motorunu, `ai-enhancements.js` ise mevcut uygulamadaki modelleri bağlayan kalite katmanını içerir.

`index.html` içindeki script sırası şu şekilde olmalıdır:

```html
<script src="model.js"></script>
<script src="flashlitemodel.js"></script>
<script src="pro-model.js"></script>
<script src="script.js"></script>
<script src="ai-enhancements.js"></script>
```

Pro model profili: **5000–7500 ms**. Flash ve FlashLite kısa/genel isteklerde daha net hedef, teknoloji ve hata bağlamı isteyen cevaplar verir; Pro son 12 mesaja kadar bağlamla çalışır.
