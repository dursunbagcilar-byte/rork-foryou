import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

export type Language = 'TR' | 'EN';

const LANG_KEY = 'app_language';

const translations = {
  TR: {
    greeting_morning: 'Günaydın,',
    greeting_afternoon: 'İyi günler,',
    greeting_evening: 'İyi akşamlar,',
    greeting_night: 'İyi geceler,',
    user_fallback: 'Kullanıcı',
    my_account: 'Hesabım',
    preferences: 'Tercihlerim',
    past_rides: 'Geçmiş yolculuklarım',
    scheduled_ride: 'Zamanlanmış yolculuk',
    payment_methods: 'Ödeme yöntemlerim',
    campaigns: 'Kampanyalar',
    cancel_policy: 'İptal politikası',
    help: 'Yardım',
    privacy_policy: 'Gizlilik Politikası',
    terms_of_service: 'Kullanım Şartları',
    ai_photo_editor: 'AI Fotoğraf Editörü',
    kvkk_data_management: 'KVKK / Veri Yönetimi',
    support_subtitle: 'Destek ol',
    support_title: 'Uygulamamıza\ndestek olmak\nister misiniz?',
    earn_points_subtitle: 'Yolculuklarında',
    earn_points_title: 'Puan kazan\npuan nakite',
    earn_points_desc: 'dönüşsün',
    earn_points_link: 'Detaya git',
    support_link: 'Detaya git',
    invite_friends_subtitle: 'Arkadaşını davet et',
    invite_friends_title: 'Davet et\n2 ücretsiz',
    invite_friends_desc: 'sürüş kazanın',
    invite_friends_link: 'Davet ekranını aç',
    theme: 'Tema',
    dark_mode: 'Karanlık Mod',
    light_mode: 'Aydınlık Mod',
    language_select: 'Dil seçimi',
    logout: 'Çıkış Yap',
  },
  EN: {
    greeting_morning: 'Good morning,',
    greeting_afternoon: 'Good afternoon,',
    greeting_evening: 'Good evening,',
    greeting_night: 'Good night,',
    user_fallback: 'User',
    my_account: 'My Account',
    preferences: 'Preferences',
    past_rides: 'Past Rides',
    scheduled_ride: 'Scheduled Ride',
    payment_methods: 'Payment Methods',
    campaigns: 'Campaigns',
    cancel_policy: 'Cancellation Policy',
    help: 'Help',
    privacy_policy: 'Privacy Policy',
    terms_of_service: 'Terms of Service',
    ai_photo_editor: 'AI Photo Editor',
    kvkk_data_management: 'KVKK / Data Management',
    support_subtitle: 'Support us',
    support_title: 'Would you like\nto support\nour app?',
    earn_points_subtitle: 'On your rides',
    earn_points_title: 'Earn points\nconvert to cash',
    earn_points_desc: 'start earning',
    earn_points_link: 'Details',
    support_link: 'Details',
    invite_friends_subtitle: 'Invite your friends',
    invite_friends_title: 'Invite & earn\n2 free rides',
    invite_friends_desc: 'for both of you',
    invite_friends_link: 'Open invite screen',
    theme: 'Theme',
    dark_mode: 'Dark Mode',
    light_mode: 'Light Mode',
    language_select: 'Language',
    logout: 'Log Out',
  },
} as const;

export type TranslationKey = keyof typeof translations.TR;

export const [LanguageProvider, useLanguage] = createContextHook(() => {
  const [language, setLanguageState] = useState<Language>('TR');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY)
      .then((stored) => {
        if (stored === 'TR' || stored === 'EN') {
          setLanguageState(stored);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    await AsyncStorage.setItem(LANG_KEY, lang);
    console.log('[Language] Switched to:', lang);
  }, []);

  const t = useCallback((key: TranslationKey): string => {
    return translations[language][key] ?? key;
  }, [language]);

  return useMemo(() => ({
    language,
    setLanguage,
    t,
    isLoading,
  }), [isLoading, language, setLanguage, t]);
});
