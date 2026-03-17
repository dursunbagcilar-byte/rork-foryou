# Sahte/Simülasyon Özellikleri Gerçek Sisteme Geçiş


## Özet
Uygulamadaki 5 sahte/simülasyon özelliği profesyonel ve gerçek çalışan sistemlere dönüştürülecek.

---

### 1. 💬 Müşteri-Şoför Sohbeti — Gerçek Zamanlı
**Şu an**: Sahte "Merhaba, yoldayım!" mesajıyla başlıyor, mesajlar 5 saniyede bir çekiliyor
**Yapılacak**:
- Sahte başlangıç mesajı kaldırılacak — sohbet backend'den gelen gerçek mesajlarla başlayacak
- Mesaj polling süresi **3 saniyeye** düşürülecek (gerçek zamanlıya yakın)
- Sohbet açıkken mesajlar otomatik "okundu" olarak işaretlenecek
- Yeni mesaj geldiğinde titreşim bildirimi eklenecek
- Sohbet açılır açılmaz son mesajlara otomatik kaydırma

---

### 2. 🚗 Şoför Yaklaşma Hareketi — Gerçek GPS
**Şu an**: Simüle edilmiş yol üzerinde sahte hareket (driverPathRef + setInterval)
**Yapılacak**:
- Tüm simülasyon kodları (driverPathRef, driverPathIndexRef, trackingIntervalRef) kaldırılacak
- Sadece backend'den gelen **gerçek şoför GPS konumu** kullanılacak
- GPS polling hızı artırılacak: şoför yaklaşırken **2 saniye**, normal durumda **3 saniye**
- Harita üzerinde şoförün gerçek konumu anlık gösterilecek
- Gerçek mesafeye göre ETA hesaplanacak

---

### 3. 🗺️ Yolculuk Sırasında Hareket — Gerçek GPS
**Şu an**: tripPathRef + tripIntervalRef ile simüle edilen yol hareketi
**Yapılacak**:
- Trip simülasyon kodları (tripPathRef, tripPathIndexRef, tripIntervalRef) kaldırılacak
- Yolculuk sırasında da **gerçek şoför GPS konumu** kullanılacak (zaten `driverLocationPollQuery` var)
- Trip sırasında polling **3 saniye** olacak
- Varış noktasına gerçek mesafe ve ETA gösterilecek
- Hedefe 50m yaklaşınca otomatik tamamlama tetiklenecek

---

### 4. 🚦 Trafik Bilgisi (AI Sohbet) — Google Directions API
**Şu an**: Rastgele "Hafif/Orta/Yoğun" döndürüyor
**Yapılacak**:
- Google Directions API kullanarak **gerçek trafik verisi** çekilecek
- Bölge adından koordinat bulunacak (Geocoding API)
- Trafik yoğunluğu: normal süre vs trafikli süre karşılaştırmasıyla belirlenecek
- Sonuç: "Taksim bölgesinde trafik: Yoğun (Normal: 15 dk, Şu an: 28 dk)" gibi detaylı bilgi

---

### 5. 💰 Fiyat Tahmini (AI Sohbet) — Gerçek Fiyat Formülü + Google API
**Şu an**: Sadece mesafe × 12.5 TL basit formül
**Yapılacak**:
- Google Directions API ile **gerçek yol mesafesi** hesaplanacak
- Uygulamanın kendi fiyat formülü kullanılacak (araç tipi bazlı: scooter 500₺, motorsiklet 700₺, otomobil 800₺ baz + km başı 50₺)
- 3 araç tipi için ayrı ayrı fiyat gösterilecek
- Tahmini süre de eklenecek
- Sonuç: "Taksim → Kadıköy (12.3 km, ~25 dk): 🛴 Scooter ₺615 | 🏍️ Motor ₺715 | 🚗 Otomobil ₺815"

---

### Uygulama İkonu
Bu güncelleme mevcut uygulamaya ekleme olduğu için ikon değişikliği yapılmayacak.
