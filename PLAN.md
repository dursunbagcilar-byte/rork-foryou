# Müşteri sürüş başlatma ve şoför uygunluk uyarılarını netleştir

## Özellikler
- [x] Müşteri haritadan varış noktasını seçip **Sürüş Başlat**’a bastığında ekran yeniden **Şoför aranıyor** durumuna geçecek.
- [x] Müşterinin bulunduğu ilçede kayıtlı şoför yoksa açık bir uyarı gösterilecek: **Şu an ilçenizde kayıtlı şoför yok**.
- [x] Müşterinin bulunduğu il ve ilçede aktif şoför varsa ama hepsi başka yolculuktaysa şu uyarı gösterilecek: **Bölgenizde aktif şoförlerimiz var, başka bir yolculuk yapıyor**.
- [x] Bu durumda uyarının içinde şoförün tahmini ne kadar süre sonra müsait olacağı dakika cinsinden gösterilecek.
- [x] Tahmini süre önce şoförün mevcut yolculuğunun kalan süresine göre hesaplanacak.
- [x] Kalan süre net değilse yaklaşık bir yedek hesaplama ile yine müşteriye tahmini dakika bilgisi gösterilecek.
- [x] Aktif ama meşgul şoför durumunda müşteriye ayrıca **sıraya alınmak isteyip istemediği** sorulacak.
- [x] Müşteri kabul ederse talebi sıraya alınacak, kabul etmezse rota korunup tekrar deneme imkanı kalacak.

## Tasarım
- [x] Uyarılar kısa, net ve güven veren bir dille gösterilecek.
- [x] **Şoför aranıyor** ekranı kararsız görünmeyecek; tek bir sabit durum akışıyla daha profesyonel hissettirecek.
- [x] İlçede uygun şoför bulunamadığında uyarı ayrı bir alert yerine yeşil arama panelinin içinde gösterilecek.
- [x] Tahmini bekleme süresi uyarının içinde öne çıkarılarak müşterinin hemen anlaması sağlanacak.
- [x] Sıra teklifi tek ekranda, kolay anlaşılır iki seçimle sunulacak.

## Ekranlar
- [x] **Müşteri rota ekranı:** Haritadan hedef seçildikten sonra sürüş başlatma akışı daha net çalışacak.
- [x] **Şoför aranıyor durumu:** Arama, uyarı ve bekleme bilgisi tek mantıklı akışta gösterilecek.
- [x] **Meşgul şoför uyarısı:** Tahmini müsaitlik süresi ve sıraya alınma seçimi burada sunulacak.
