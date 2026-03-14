# Android Uyumluluğu İyileştirmeleri

Uygulamanın Android cihazlarda iOS ile aynı kalitede görünmesi için aşağıdaki iyileştirmeler yapılacak:

**Gölge & Derinlik Düzeltmeleri**
- [x] Tüm ekranlarda eksik `elevation` değerleri eklenerek Android'de gölgelerin düzgün görünmesi sağlanacak
- [x] Kartlar, butonlar ve panellerde tutarlı derinlik efektleri

**Yazı Tipi & Metin İyileştirmeleri**
- [x] Android'de satır yüksekliği (lineHeight) farklılıkları düzeltilecek
- [x] Font ağırlığı (bold, semibold vb.) Android'e uygun şekilde ayarlanacak
- [x] `includeFontPadding: false` eklenerek Android'deki fazladan metin boşlukları giderilecek

**Buton & Dokunma Efektleri**
- [x] Buton basma animasyonları her iki platformda tutarlı olacak (`components/ScalePressable.tsx` ile ortaklaştırıldı)
- [x] Ortak basılabilir bileşende erişilebilirlik, hitSlop ve Android ripple davranışı profesyonel şekilde güçlendirildi

**Durum Çubuğu (Status Bar)**
- [x] Android'de durum çubuğu rengi ve stili uygulama temasına uygun ayarlanacak
- [x] Koyu/açık tema geçişlerinde durum çubuğu otomatik güncellenecek
- [x] Sistem arka planı tema ile senkronize edilerek Android geçişleri daha temiz hale getirildi

**Genel Platform Uyumu**
- [x] `KeyboardAvoidingView` davranışı Android için optimize edilecek
- [x] Harita bileşenlerinde Android'e özel sağlayıcı (Google Maps) kullanımı kontrol edilecek
- [x] Tab bar Android için elevation ve label style iyileştirmeleri yapıldı
- [x] Cross-platform shadow utility oluşturuldu (`utils/platform.ts`)

# Müşteri Şoför Bulunamadı Akışı

- [x] Seçilen araç tipine göre müşteri tarafındaki müsait şoför sorgusu hizalanacak
- [x] Müşteri rota seçim ekranında boşta şoför yokken açıklayıcı boş durum kartı gösterilecek
- [x] Şoför yok ön kontrolü talebi gereksiz yere bloklamayacak, kullanıcı yine de müsaitlik ve sıra durumunu kontrol edebilecek
- [x] Boş durum kartı canlı durum etiketleri, net istatistikler ve güçlü aksiyonlarla profesyonelleştirildi
- [x] Yeniden atama başarısız olduğunda kullanıcıya tekrar tarama ve planlı yolculuk seçenekleri sunuldu
- [x] Yeniden atama başarısızlığında rota korunarak ekran içi kurtarma paneli gösterildi
