# Gerçek müşteri sürüş oluşturma ve eşleştirme akışı

**Features**
- [x] Müşteri sürüş talebi yalnızca canlı ve müsait şoför varsa oluşturulur.
- [x] Seçilen araç tipine göre uygun şoför kategorisi filtrelenir.
- [x] Sürüş talebi en uygun canlı şoförlere bildirim olarak gönderilir.
- [x] Müşteri ekranı kaç şoföre istek gönderildiğini gösterir.
- [x] Aynı ilçede aktif ama meşgul şoför varsa müşteriye sıraya alınma teklifi sunulur.
- [x] Müşteri sırayı kabul ederse talep hedef şoföre bildirim olarak gider.
- [x] Şoför mevcut yolculuğunu tamamlayınca sıradaki müşteri ilk yeni talep gibi görünür.

**Backend**
- [x] `rides.create` gerçek canlı şoför uygunluğunu kontrol eder.
- [x] `rides.getPendingByCity` şoföre yalnızca kendi kategorisine uygun talepleri döndürür.
- [x] `rides.findBestDriver` araç kategorisine göre gerçek adayları filtreler.
- [x] Sürüş kaydında istenen şoför kategorisi saklanır.
- [x] İl ve ilçe eşleşmeleri boşluk/büyük-küçük harf/Türkçe karakter farklarına dayanıklı hale getirildi.
- [x] `rides.create` aynı ilçedeki meşgul şoförü bulursa sıra teklifi döndürür.
- [x] `rides.createQueued` hedef şoförlü sıradaki yolculuk kaydı oluşturur ve şoföre bildirim yollar.
- [x] `rides.getPendingByCity` hedef şoföre ait sıradaki talepleri öncelikli döndürür.

**Pages / Screens**
- [x] Müşteri dashboard: sürüş oluştururken istenen araç tipi backend'e gönderilir.
- [x] Müşteri dashboard: "Şoför aranıyor" metni canlı eşleştirme durumunu yansıtır.
- [x] Müşteri dashboard: nakit ödeme seçiliyken sürüş başlat alanı yeşil tema kullanır.
- [x] Müşteri dashboard: sistemde şoför yoksa sürüş başlat alanı spinner ile "Şoför aranıyor" durumunu gösterir.
- [x] Müşteri dashboard: meşgul aynı ilçe şoförü için sıra onayı uyarısı gösterir ve kabul sonrası durum metnini günceller.
- [x] Şoför haritası: yolculuk tamamlanınca aktif/sıradaki talepleri yenileyip hedef müşteriyi ilk yeni talep gibi gösterir.

**Stability / Load**
- [x] Müşteri dashboard: arka planda ve odak dışındayken gereksiz polling durduruldu.
- [x] Müşteri dashboard: kurye ve işletme sorguları yalnızca ilgili panel açıkken çalışır hale getirildi.
- [x] Şoför haritası: bekleyen/aktif yolculuk polling sıklığı düşürüldü ve focus bazlı hale getirildi.
- [x] Şoför haritası: konum senkronizasyonu seyrekleştirildi ve eşzamanlı istek yığılması engellendi.
