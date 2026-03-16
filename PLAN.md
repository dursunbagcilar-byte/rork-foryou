# React DOM removeChild hatası düzeltmesi

## Sorun
"Failed to execute 'removeChild' on 'Node'" hatası - React sanal DOM ile gerçek DOM arasında uyumsuzluk.

## Olası Nedenler
1. **Hydration mismatch**: Sunucu ve istemci farklı HTML render ediyor
2. **Köşe durumlarındaki conditional render**: Web açılışında tutarsız başlangıç ağacı
3. **Overlay component'leri**: `DriverApprovalWaiting` ve `ApprovalSuccessOverlay` absolute position elementleri
4. **React.Fragment kullanımı**: Koşullu render edilen fragment'lerde DOM ağacı stabil kalmıyor

## Düzeltme Planı

- [x] `app/_layout.tsx` içinde web için tutarlı ilk render sağlayan hydration shell ekle
- [x] `app/(driver-tabs)/_layout.tsx` içinde overlay host yapısını stabilize et ve overlay key'lerini ekle
- [x] `app/(customer-tabs)/profile/security.tsx` içinde fragment tabanlı conditional render bloklarını `View` ile değiştir
- [x] `app/(driver-tabs)/profile/security.tsx` içinde fragment tabanlı conditional render bloklarını `View` ile değiştir
- [x] `app/(driver-tabs)/profile/vehicle.tsx` içinde map fragment yapısını stabilize et
- [x] `app/ai-photo-editor.tsx` içinde ScrollView altındaki fragment wrapper'ını stabilize et
- [x] Web uyumluluğu için ilgili effect dependency dizilerini netleştir
- [x] `utils/webDomPatch.ts` içinde DOM patch başlatmasını korumalı hale getir ve `replaceChild` güvenliğini ekle
- [x] Lint uyarılarına neden olan kullanılmayan state/import ve tip tanımlarını temizle

## Doğrulama
- [x] TypeScript typecheck çalıştır
- [x] Lint çalıştır
- [x] Web bundle export doğrulaması çalıştır
- [ ] Web platformunda sayfalar arası geçiş testi
- [ ] Login/logout sonrası render kontrolü
- [ ] Driver approval overlay açıp kapatma testi
- [ ] Customer security sayfası şifre formu açıp kapatma
