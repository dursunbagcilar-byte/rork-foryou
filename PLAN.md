# Gerçek müşteri sürüş oluşturma ve eşleştirme akışı

**Features**
- [x] Müşteri sürüş talebi yalnızca canlı ve müsait şoför varsa oluşturulur.
- [x] Seçilen araç tipine göre uygun şoför kategorisi filtrelenir.
- [x] Sürüş talebi en uygun canlı şoförlere bildirim olarak gönderilir.
- [x] Müşteri ekranı kaç şoföre istek gönderildiğini gösterir.

**Backend**
- [x] `rides.create` gerçek canlı şoför uygunluğunu kontrol eder.
- [x] `rides.getPendingByCity` şoföre yalnızca kendi kategorisine uygun talepleri döndürür.
- [x] `rides.findBestDriver` araç kategorisine göre gerçek adayları filtreler.
- [x] Sürüş kaydında istenen şoför kategorisi saklanır.
- [x] İl ve ilçe eşleşmeleri boşluk/büyük-küçük harf/Türkçe karakter farklarına dayanıklı hale getirildi.

**Pages / Screens**
- [x] Müşteri dashboard: sürüş oluştururken istenen araç tipi backend'e gönderilir.
- [x] Müşteri dashboard: "Şoför aranıyor" metni canlı eşleştirme durumunu yansıtır.
