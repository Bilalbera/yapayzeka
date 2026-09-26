# BilalAI Güncelleme Notu (Sürüm: 0.02):
# - +18 mesajlar engellendi.
# - Matematik işlemleri yenilendi!
# -


# Bu kodu tamamen ben yaptım. Hataları AI yardımı ile yapıyorum ama kesinlikle bu kodu yazarken ai kullanmadım.
# Bu arada eğerlendirme yaparsanız sevinirim

import random

# BilalAI Ana Mesaj:
bilalai = "BilalAI: Merhaba! BilalAI'a hoşgeldin. Ne çözmek istersin?"

# Sohbet mesajları:
Merhaba = "BilalAI: Selam dostum! Nasılsın?"
Naber = "BilalAI: İyiyim dostum! Sen nasılsın bakalım keyifler yerindemi?"
Kapat = "BilalAI: Görüşmek üzere, bay bay!"

# Sansür Mesajları: [YENİ!]
sansurcevaplar = [
    "BilalAI: Üzgünüm, Bu konu hakkında konuşamam.",
    "BilalAI: Bu konu hakkında konuşmayacağım.",
    "BilalAI: Cinsel konular hakkında konuşamam.",
    "BilalAI: Üzgünüm, Bu konuda yardımcı olamam.",
    "BilalAI: Bu konu hakkında konuşmayacağım."
]

def mesaj_kontrolet(kullanıcımesajı):
    if kullanıcımesajı.lower() in ["porno", "sex", "seks", "sikiş", "purna", "amcık", "am"]:
        print(random.choice(sansurcevaplar))
        return True
    return False

# Matematik işlemleri: (1-15) [YENİLENDİ!]
import math

bir_sayı = ("BilalAI: 1 eder.")
iki_sayı = ("BilalAI: 2 eder.")
üç_sayı = ("BilalAI: 3 eder.")
dort_sayı = ("BilalAI: 4 eder.")
bes_sayı = ("BilalAI: 5 eder.")
altı_sayı = ("BilalAI: 6 eder.")
yedi_sayı = ("BilalAI: 7 eder.")
sekiz_sayı = ("BilalAI: 8 eder.")
dokuz_sayı = ("BilalAI: 9 eder.")
on_sayı = ("BilalAI: 10 eder.")
onbir_sayı = ("BilalAI: 11 eder.")
oniki_sayı = ("BilalAI: 12 eder.")
onüç_sayı = ("BilalAI: 13 eder.")
ondört_sayı = ("BilalAI: 14 eder.")
onbeş_sayı = ("BilalAI: 15 eder.")

# Diğer mesajlar:
kimyaptı = "BilalAI: Ben Bilalbera isimli yeni python öğrenen genç bir öğrenci tarafından yapıldım. Hergün aktif olarak geliştiriliyorum."
amacıney = "BilalAI: Bilal'in beni yapmasının temel nedeni; İleride beni geliştirip kendine gerçekten kaliteli bir ai modeli oluşturmak."
sürümnotu = "BilalAI: Sürümüm, 0.02"

# BilalAI'ın ilk mesajını direk olarak iletmesi için gereklidir:
print(bilalai)

while True:
    kullanıcımesajı = input("Sen: ").lower().strip()

# Sansürün kontrolü için:
    if mesaj_kontrolet(kullanıcımesajı):
        continue

# BilalAI Sohbetleri:
    if "selam" in kullanıcımesajı or "merhaba" in kullanıcımesajı:
        print(Merhaba)

    elif kullanıcımesajı in ["nasılsın", "naber"]:
        print(Naber)

    elif kullanıcımesajı in ["1+1", "1+1 kaç eder", "1+1 kaç eder?"]:
        print(iki_sayı)

    elif kullanıcımesajı in ["2+2", "2+2 kaç eder", "2+2 kaç eder?"]:
        print(dort_sayı)

    elif kullanıcımesajı in ["5+5", "5+5 kaç eder", "5+5 kaç eder?"]:
        print(on_sayı)

    elif kullanıcımesajı in ["seni kim yaptı", "seni kim yaptı?", "kim yaptı seni"]:
        print(kimyaptı)

    elif kullanıcımesajı in ["amaç ne?", "amacın ne?", "amaç"]:
        print(amacıney)

    elif kullanıcımesajı in ["sürüm", "sürüm kaç?", "sürüm kaç", "sürüm ne", "sürüm ne?"]:
        print(sürümnotu)

    elif kullanıcımesajı in ["çıkış", "kapat", "exit"]:
        print(Kapat)
        break

# BilalAI if ve elif'deki mesajların dışındaki (örn merhaba dışında asd felan) birşey denilirse rastgele böyle cevaplar verir:
    else:
        cevaplar = [
            "BilalAI: Üzgünüm, Bu konu hakkında elimde kesin bir bilgi yok.",
            "BilalAI: Bu konu hakkında bilgi sahibi değilim.",
            "BilalAI: Bu konuyu anlamadım.",
            "BilalAI: Üzgünüm, Dediğinizi anlayamadım."
        ]
        
        print(random.choice(cevaplar))

# Bilal Bera tarafından yapılmıştır. 

# Bütün özellikler test edilmiştir.
# Sürüm 0.02 (aktif olarak geliştiriliyor.)
