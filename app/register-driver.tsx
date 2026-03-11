import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ScrollView, Alert, Modal, FlatList, Image, useWindowDimensions,
  Keyboard, ActivityIndicator, Animated as RNAnimated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Car, Phone, Mail, Lock, User, Palette, Hash, Users, MapPin, ChevronDown, Search, X, CheckCircle, Camera, Bike, Package, Heart, UserPlus, AlertTriangle, ShieldCheck, Square, CheckSquare, FileText, Zap, HardHat, Store, Globe } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { TURKISH_CITIES, getCityByName } from '@/constants/cities';
import type { City } from '@/constants/cities';
import { usePrivacy } from '@/contexts/PrivacyContext';
import { buildApiUrl, getSessionToken } from '@/lib/trpc';
import { getGoogleMapsApiKey } from '@/utils/maps';
import { getDbHeaders } from '@/utils/db';
import { VerificationCodeModal } from '@/components/VerificationCodeModal';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';
import { sendRegistrationVerificationCode, type VerificationSmsProvider, verifyRegistrationVerificationCode } from '@/utils/authVerification';

type DriverCategory = 'driver' | 'scooter' | 'courier';
type RegistrationCategory = DriverCategory | 'business';

function extractDriverErrorMessage(e: unknown): string {
  const errObj = e as any;
  const msg = errObj?.message || errObj?.data?.message || errObj?.shape?.message || '';
  console.log('[RegisterDriver] Error details - message:', msg, 'name:', errObj?.name, 'code:', errObj?.data?.code, 'full:', JSON.stringify(errObj).substring(0, 500));

  if (errObj?.data?.code === 'TOO_MANY_REQUESTS') {
    return 'Çok fazla deneme yaptınız. Lütfen biraz bekleyin.';
  }

  if (typeof msg === 'string' && msg.length > 0) {
    const lower = msg.toLowerCase();
    if (lower.includes('unexpected') && (lower.includes('json') || lower.includes('token') || lower.includes('position'))) {
      return 'Sunucu geçici olarak yanıt veremiyor. Lütfen birkaç saniye bekleyip tekrar deneyin.';
    }
    if (lower.includes('syntaxerror') || lower.includes('not valid json')) {
      return 'Sunucu geçici olarak yanıt veremiyor. Lütfen birkaç saniye bekleyip tekrar deneyin.';
    }
    return msg;
  }
  return 'Kayıt oluşturulamadı. Lütfen tekrar deneyin.';
}

const DRIVER_CATEGORIES: { key: RegistrationCategory; label: string; icon: React.ReactNode; color: string; description: string }[] = [
  { key: 'driver', label: 'Şoför Ol', icon: <Car size={20} color="#FFF" />, color: Colors.dark.primary, description: 'Müşteri ve aracını konuma ulaştır' },
  { key: 'scooter', label: 'Scooterli Şoför', icon: <Bike size={20} color="#FFF" />, color: '#00BCD4', description: 'Müşteriye hızlı ulaşım' },
  { key: 'courier', label: 'Kurye Ol', icon: <Package size={20} color="#FFF" />, color: '#8BC34A', description: 'Paket ve kargo taşımacılığı' },
  { key: 'business', label: 'İşletme', icon: <Store size={20} color="#FFF" />, color: '#FF8A65', description: 'İşletmeni ve sipariş akışını ekle' },
];

const GOOGLE_API_KEY = getGoogleMapsApiKey();

interface RegisterBusinessPayload {
  name: string;
  website: string;
  image: string;
  description?: string;
  category: string;
  address: string;
  city: string;
  district: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  deliveryTime?: string;
  deliveryFee?: number;
  minOrder?: number;
}

interface RegisterBusinessResponse {
  success: boolean;
  error: string | null;
  business?: {
    id: string;
    name: string;
  } | null;
}

interface VerifiedContactSnapshot {
  email: string;
  phone: string;
}

async function registerBusinessAccount(payload: RegisterBusinessPayload): Promise<RegisterBusinessResponse> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    throw new Error('Oturum oluşturulamadı. Lütfen tekrar giriş yapın.');
  }

  const headers = getDbHeaders({
    authorization: `Bearer ${sessionToken}`,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const endpoint = buildApiUrl('/auth/register-business');
    console.log('[RegisterDriver] registerBusinessAccount start:', endpoint, payload.city, payload.district);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const rawText = await response.text();
    let data: RegisterBusinessResponse | null = null;

    try {
      data = rawText ? JSON.parse(rawText) as RegisterBusinessResponse : null;
    } catch (parseError) {
      console.log('[RegisterDriver] registerBusinessAccount parse error:', parseError, rawText.substring(0, 200));
      throw new Error('İşletme kaydı sırasında sunucu geçersiz yanıt verdi.');
    }

    if (!response.ok || !data?.success) {
      console.log('[RegisterDriver] registerBusinessAccount failed:', response.status, data?.error);
      throw new Error(data?.error ?? 'İşletme kaydı tamamlanamadı.');
    }

    console.log('[RegisterDriver] registerBusinessAccount success:', data.business?.id ?? 'unknown');
    return data;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('İşletme kaydı zaman aşımına uğradı. Lütfen tekrar deneyin.');
    }
    throw error instanceof Error ? error : new Error('İşletme kaydı tamamlanamadı.');
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function RegisterDriverScreen() {
  const router = useRouter();
  const { registerDriver, saveDriverDocuments } = useAuth();
  const { width } = useWindowDimensions();
  const isSmall = width < 360;
  const isTablet = width >= 600;
  const hPad = isSmall ? 18 : isTablet ? 40 : 24;
  const [registrationCategory, setRegistrationCategory] = useState<RegistrationCategory>('driver');
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [vehiclePlate, setVehiclePlate] = useState<string>('');
  const [vehicleModel, setVehicleModel] = useState<string>('');
  const [vehicleColor, setVehicleColor] = useState<string>('');
  const [partnerName, setPartnerName] = useState<string>('');
  const [selectedCity, setSelectedCity] = useState<string>('');
  const [selectedDistrict, setSelectedDistrict] = useState<string>('');
  const [showCityPicker, setShowCityPicker] = useState<boolean>(false);
  const [showDistrictPicker, setShowDistrictPicker] = useState<boolean>(false);
  const [citySearch, setCitySearch] = useState<string>('');
  const [districtSearch, setDistrictSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [showSuccessModal, setShowSuccessModal] = useState<boolean>(false);
  const successAnim = React.useRef(new RNAnimated.Value(0)).current;
  const successScale = React.useRef(new RNAnimated.Value(0.5)).current;
  const [verificationCode, setVerificationCode] = useState<string>('');
  const [showVerificationModal, setShowVerificationModal] = useState<boolean>(false);
  const [verificationBusy, setVerificationBusy] = useState<boolean>(false);
  const [verificationConfirming, setVerificationConfirming] = useState<boolean>(false);
  const [verificationMaskedPhone, setVerificationMaskedPhone] = useState<string | null>(null);
  const [verificationDeliveryNote, setVerificationDeliveryNote] = useState<string | null>(null);
  const [verificationProvider, setVerificationProvider] = useState<VerificationSmsProvider | null>(null);
  const [verifiedContactSnapshot, setVerifiedContactSnapshot] = useState<VerifiedContactSnapshot | null>(null);

  const [licenseFront, setLicenseFront] = useState<string>('');
  const [licenseBack, setLicenseBack] = useState<string>('');
  const [idCardFront, setIdCardFront] = useState<string>('');
  const [idCardBack, setIdCardBack] = useState<string>('');
  const [registrationFront, setRegistrationFront] = useState<string>('');
  const [registrationBack, setRegistrationBack] = useState<string>('');
  const [criminalRecord, setCriminalRecord] = useState<string>('');
  const [taxCertificate, setTaxCertificate] = useState<string>('');
  const [licenseDay, setLicenseDay] = useState<string>('');
  const [licenseMonth, setLicenseMonth] = useState<string>('');
  const [licenseYear, setLicenseYear] = useState<string>('');
  const [licenseDateError, setLicenseDateError] = useState<string>('');
  const [agreementAccepted, setAgreementAccepted] = useState<boolean>(false);
  const [showAgreementModal, setShowAgreementModal] = useState<boolean>(false);
  const [scooterSubType, setScooterSubType] = useState<'escooter' | 'motorcycle'>('escooter');
  const [helmetPhoto, setHelmetPhoto] = useState<string>('');
  const [kvkkAccepted, setKvkkAccepted] = useState<boolean>(false);
  const [enableBusinessRegistration, setEnableBusinessRegistration] = useState<boolean>(false);
  const [businessName, setBusinessName] = useState<string>('');
  const [businessWebsite, setBusinessWebsite] = useState<string>('');
  const [businessImage, setBusinessImage] = useState<string>('');
  const [businessDescription, setBusinessDescription] = useState<string>('');
  const [businessCategory, setBusinessCategory] = useState<string>('Yemek');
  const [businessAddress, setBusinessAddress] = useState<string>('');
  const driverCategory: DriverCategory = registrationCategory === 'business' ? 'courier' : registrationCategory;
  const isCourierLike = driverCategory === 'courier';
  const isBusinessCategorySelected = registrationCategory === 'business';
  const shouldShowBusinessFields = isBusinessCategorySelected || enableBusinessRegistration;
  const shouldShowCourierVehicleSection = isCourierLike && !isBusinessCategorySelected;
  const shouldShowHelmetDocument = driverCategory === 'scooter' || shouldShowCourierVehicleSection;
  const shouldShowCriminalRecordDocument = !isBusinessCategorySelected;
  const shouldShowTaxCertificateDocument = driverCategory !== 'courier' || isBusinessCategorySelected;
  const { acceptAllConsents } = usePrivacy();



  const filteredCities = useMemo(() => {
    if (!citySearch.trim()) return TURKISH_CITIES;
    const q = citySearch.toLowerCase();
    return TURKISH_CITIES.filter(c => c.name.toLowerCase().includes(q));
  }, [citySearch]);

  const cityObj = useMemo(() => getCityByName(selectedCity), [selectedCity]);

  const filteredDistricts = useMemo(() => {
    if (!cityObj) return [];
    if (!districtSearch.trim()) return cityObj.districts;
    const q = districtSearch.toLowerCase();
    return cityObj.districts.filter(d => d.toLowerCase().includes(q));
  }, [cityObj, districtSearch]);

  const handleSelectCity = (city: City) => {
    setSelectedCity(city.name);
    setSelectedDistrict('');
    setShowCityPicker(false);
    setCitySearch('');
    console.log('Selected city:', city.name);
  };

  const handleSelectDistrict = (district: string) => {
    setSelectedDistrict(district);
    setShowDistrictPicker(false);
    setDistrictSearch('');
    console.log('Selected district:', district);
  };

  const getImageDataUri = useCallback((asset: ImagePicker.ImagePickerAsset): string => {
    if (asset.base64) {
      const mimeType = asset.mimeType || 'image/jpeg';
      return `data:${mimeType};base64,${asset.base64}`;
    }
    return asset.uri;
  }, []);

  const pickImage = useCallback(async (setter: (uri: string) => void) => {
    if (Platform.OS === 'web') {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.5,
          allowsEditing: true,
          aspect: [16, 9],
          base64: true,
        });
        if (!result.canceled && result.assets && result.assets[0]) {
          const dataUri = getImageDataUri(result.assets[0]);
          setter(dataUri);
          console.log('Image selected (web), base64:', !!result.assets[0].base64, 'length:', dataUri.length);
        }
      } catch (e) {
        console.log('Image picker error (web):', e);
      }
      return;
    }

    Alert.alert(
      'Belge Yükle',
      'Nasıl yüklemek istersiniz?',
      [
        {
          text: 'Kamera',
          onPress: async () => {
            try {
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('İzin Gerekli', 'Kamera izni verilmedi');
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.5,
                allowsEditing: true,
                aspect: [16, 9],
                base64: true,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                const dataUri = getImageDataUri(result.assets[0]);
                setter(dataUri);
                console.log('Image captured, base64:', !!result.assets[0].base64, 'length:', dataUri.length);
              }
            } catch (e) {
              console.log('Camera error:', e);
            }
          },
        },
        {
          text: 'Galeri',
          onPress: async () => {
            try {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.5,
                allowsEditing: true,
                aspect: [16, 9],
                base64: true,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                const dataUri = getImageDataUri(result.assets[0]);
                setter(dataUri);
                console.log('Image selected, base64:', !!result.assets[0].base64, 'length:', dataUri.length);
              }
            } catch (e) {
              console.log('Gallery error:', e);
            }
          },
        },
        { text: 'İptal', style: 'cancel' },
      ]
    );
  }, [getImageDataUri]);

  const handlePickBusinessImage = useCallback(async () => {
    await pickImage(setBusinessImage);
  }, [pickImage]);

  const geocodeBusinessAddress = useCallback(async (address: string, city: string, district: string): Promise<{ latitude: number; longitude: number } | null> => {
    if (!GOOGLE_API_KEY) {
      console.log('[RegisterDriver] No Google Maps key for business geocoding');
      return null;
    }

    try {
      const query = encodeURIComponent(`${address}, ${district}, ${city}, Türkiye`);
      const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${query}&language=tr&key=${GOOGLE_API_KEY}`);
      const data = await response.json();
      const location = data?.results?.[0]?.geometry?.location;
      if (location?.lat && location?.lng) {
        console.log('[RegisterDriver] Business geocoded:', location.lat, location.lng);
        return { latitude: location.lat, longitude: location.lng };
      }
    } catch (error) {
      console.log('[RegisterDriver] Business geocode error:', error);
    }

    return null;
  }, []);

  const parsedLicenseDate = useMemo(() => {
    const d = parseInt(licenseDay, 10);
    const m = parseInt(licenseMonth, 10);
    const y = parseInt(licenseYear, 10);
    if (!d || !m || !y || d < 1 || d > 31 || m < 1 || m > 12 || y < 1950 || y > new Date().getFullYear()) {
      return null;
    }
    const date = new Date(y, m - 1, d);
    if (date.getDate() !== d || date.getMonth() !== m - 1 || date.getFullYear() !== y) {
      return null;
    }
    return date;
  }, [licenseDay, licenseMonth, licenseYear]);

  const licenseMonthsOwned = useMemo(() => {
    if (!parsedLicenseDate) return 0;
    const now = new Date();
    const diffMs = now.getTime() - parsedLicenseDate.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
    return Math.floor(diffMonths);
  }, [parsedLicenseDate]);

  const isLicenseValid = useMemo(() => {
    if (!parsedLicenseDate) return false;
    return licenseMonthsOwned >= 15;
  }, [parsedLicenseDate, licenseMonthsOwned]);

  const validateLicenseDate = useCallback(() => {
    if (!licenseDay && !licenseMonth && !licenseYear) {
      setLicenseDateError('');
      return false;
    }
    if (!parsedLicenseDate) {
      setLicenseDateError('Geçerli bir tarih girin');
      return false;
    }
    if (parsedLicenseDate > new Date()) {
      setLicenseDateError('Gelecek tarih girilemez');
      return false;
    }
    if (!isLicenseValid) {
      const remaining = 15 - licenseMonthsOwned;
      setLicenseDateError(`Ehliyetiniz en az 15 ay olmalıdır (${remaining} ay kaldı)`);
      return false;
    }
    setLicenseDateError('');
    return true;
  }, [licenseDay, licenseMonth, licenseYear, parsedLicenseDate, isLicenseValid, licenseMonthsOwned]);

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = normalizeTurkishPhone(phone);
  const isRegistrationVerified = !!verifiedContactSnapshot && verifiedContactSnapshot.email === normalizedEmail && verifiedContactSnapshot.phone === normalizedPhone;
  const isActionBusy = loading || verificationBusy || verificationConfirming;

  const clearVerificationState = () => {
    setVerificationCode('');
    setShowVerificationModal(false);
    setVerificationMaskedPhone(null);
    setVerificationDeliveryNote(null);
    setVerificationProvider(null);
    setVerifiedContactSnapshot(null);
  };

  const maybeResetVerificationState = (nextEmail: string, nextPhone: string) => {
    const nextNormalizedEmail = nextEmail.trim().toLowerCase();
    const nextNormalizedPhone = normalizeTurkishPhone(nextPhone);
    if (verifiedContactSnapshot && (verifiedContactSnapshot.email !== nextNormalizedEmail || verifiedContactSnapshot.phone !== nextNormalizedPhone)) {
      console.log('[RegisterDriver] Verification invalidated for changed contact fields');
      clearVerificationState();
    }
  };

  const handlePhoneChange = (value: string) => {
    const nextPhone = normalizeTurkishPhone(value);
    maybeResetVerificationState(email, nextPhone);
    setPhone(nextPhone);
  };

  const handleEmailChange = (value: string) => {
    maybeResetVerificationState(value, phone);
    setEmail(value);
  };

  const validateFormFields = (): boolean => {
    const isCourier = driverCategory === 'courier';
    const needsPlate = driverCategory !== 'scooter' || scooterSubType !== 'escooter';
    if (isCourier) {
      if (!name || !phone || !email || !password || (shouldShowCourierVehicleSection && (!vehicleModel || !vehicleColor))) {
        Alert.alert('Uyarı', 'Lütfen tüm alanları doldurun');
        return false;
      }
      if (!isValidEmail(email)) {
        Alert.alert('Uyarı', 'Lütfen geçerli bir e-posta adresi girin (örn: ornek@email.com)');
        return false;
      }
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        Alert.alert('Uyarı', 'Şifre en az 8 karakter olmalı ve büyük harf, küçük harf, rakam içermelidir');
        return false;
      }
      if (shouldShowCourierVehicleSection && !helmetPhoto) {
        Alert.alert('Uyarı', 'Lütfen kask fotoğrafınızı yükleyin');
        return false;
      }
      if (shouldShowBusinessFields && (!businessName || !businessWebsite || !businessImage || !businessAddress || !businessCategory)) {
        Alert.alert('Uyarı', 'İşletme kaydı için isim, website, görsel, kategori ve adres alanlarını doldurun');
        return false;
      }
    } else {
      if (!name || !phone || !email || !password || (needsPlate && !vehiclePlate) || !vehicleModel || !vehicleColor) {
        Alert.alert('Uyarı', 'Lütfen tüm alanları doldurun');
        return false;
      }
      if (!isValidEmail(email)) {
        Alert.alert('Uyarı', 'Lütfen geçerli bir e-posta adresi girin (örn: ornek@email.com)');
        return false;
      }
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        Alert.alert('Uyarı', 'Şifre en az 8 karakter olmalı ve büyük harf, küçük harf, rakam içermelidir');
        return false;
      }
      if (driverCategory === 'scooter' && !helmetPhoto) {
        Alert.alert('Uyarı', 'Lütfen kask fotoğrafınızı yükleyin');
        return false;
      }
    }
    const phoneValidationError = getTurkishPhoneValidationError(phone);
    if (phoneValidationError) {
      Alert.alert('Uyarı', phoneValidationError);
      return false;
    }
    if (!selectedCity || !selectedDistrict) {
      Alert.alert('Uyarı', 'Lütfen hizmet vereceğiniz il ve ilçeyi seçin');
      return false;
    }
    if (!isCourier) {
      if (!parsedLicenseDate) {
        Alert.alert('Uyarı', 'Lütfen ehliyet alım tarihinizi girin');
        return false;
      }
      if (!isLicenseValid) {
        Alert.alert('Uyarı', 'Ehliyetinizin en az 15 aylık olması gerekmektedir');
        return false;
      }
      if (!taxCertificate) {
        Alert.alert('Uyarı', 'Vergi levhası yüklemeden kayıt oluşturamazsınız. Lütfen vergi levhanızı yükleyin.');
        return false;
      }
      if (!licenseFront || !licenseBack || !idCardFront || !idCardBack || !registrationFront || !registrationBack || !criminalRecord) {
        Alert.alert('Uyarı', 'Lütfen tüm belgeleri yükleyin');
        return false;
      }
    } else {
      if (!idCardFront || !idCardBack) {
        Alert.alert('Uyarı', 'Lütfen kimlik kartı fotoğraflarını yükleyin');
        return false;
      }
      if (isBusinessCategorySelected) {
        if (!taxCertificate) {
          Alert.alert('Uyarı', 'Lütfen vergi levhasını görsel olarak yükleyin');
          return false;
        }
      } else if (!criminalRecord) {
        Alert.alert('Uyarı', 'Lütfen sabıka kaydınızı yükleyin');
        return false;
      }
    }
    if (!agreementAccepted) {
      Alert.alert('Uyarı', 'Devam etmek için sorumluluk reddi sözleşmesini kabul etmelisiniz');
      return false;
    }
    if (!kvkkAccepted) {
      Alert.alert('Uyarı', 'Devam etmek için KVKK aydınlatma metnini kabul etmelisiniz');
      return false;
    }
    return true;
  };

  const submitDriverRegistration = async (sanitizedPhone: string) => {
    setLoading(true);
    try {
      const isCourier = isCourierLike;
      const licenseIssueDateStr = isCourier ? undefined : (parsedLicenseDate ? parsedLicenseDate.toISOString() : undefined);
      const registrationVehicleModel = isBusinessCategorySelected ? 'İşletme hesabı' : vehicleModel;
      const registrationVehicleColor = isBusinessCategorySelected ? 'Belirtilmedi' : vehicleColor;
      await acceptAllConsents();
      await registerDriver(name, sanitizedPhone, normalizedEmail, password, isCourier ? '' : vehiclePlate, registrationVehicleModel, registrationVehicleColor, partnerName, selectedCity, selectedDistrict, licenseIssueDateStr, driverCategory);

      let businessRegistrationWarning: string | null = null;
      if (isCourier && shouldShowBusinessFields) {
        try {
          const businessCoordinates = await geocodeBusinessAddress(businessAddress, selectedCity, selectedDistrict);
          await registerBusinessAccount({
            name: businessName.trim(),
            website: businessWebsite.trim(),
            image: businessImage.trim(),
            description: businessDescription.trim(),
            category: businessCategory.trim(),
            address: businessAddress.trim(),
            city: selectedCity,
            district: selectedDistrict,
            latitude: businessCoordinates?.latitude,
            longitude: businessCoordinates?.longitude,
            phone: sanitizedPhone,
            deliveryTime: '25-35 dk',
            deliveryFee: 25,
            minOrder: 100,
          });
          console.log('[RegisterDriver] Business registration completed for courier account');
        } catch (businessError: unknown) {
          businessRegistrationWarning = extractDriverErrorMessage(businessError);
          console.log('[RegisterDriver] Business registration warning:', businessRegistrationWarning, businessError);
        }
      }

      console.log('[RegisterDriver] Registration successful, saving documents...');
      try {
        await saveDriverDocuments({
          licenseFront,
          licenseBack,
          idCardFront,
          idCardBack,
          registrationFront,
          registrationBack,
          criminalRecord: shouldShowCriminalRecordDocument ? criminalRecord : undefined,
          taxCertificate: shouldShowTaxCertificateDocument ? taxCertificate : undefined,
        });
        console.log('[RegisterDriver] Documents saved successfully');
      } catch (docErr) {
        console.log('[RegisterDriver] Document save error (non-critical):', docErr);
      }
      setShowSuccessModal(true);
      RNAnimated.parallel([
        RNAnimated.timing(successAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        RNAnimated.spring(successScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      ]).start();
      if (businessRegistrationWarning) {
        Alert.alert('Bilgi', `Şoför hesabınız açıldı ancak işletme profili tamamlanamadı: ${businessRegistrationWarning}`);
      }
    } catch (err: unknown) {
      console.log('[RegisterDriver] Registration error:', err);
      const errorMessage = extractDriverErrorMessage(err);
      Alert.alert('Hata', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const startPhoneVerification = async (sanitizedPhone: string) => {
    setVerificationBusy(true);
    try {
      const result = await sendRegistrationVerificationCode({
        name: name.trim(),
        email: normalizedEmail,
        phone: sanitizedPhone,
        deliveryMethod: 'sms',
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Doğrulama kodu gönderilemedi.');
      }

      setVerificationCode('');
      setVerificationMaskedPhone(result.maskedPhone ?? sanitizedPhone);
      setVerificationDeliveryNote(result.deliveryNote ?? null);
      setVerificationProvider(result.smsProvider ?? null);
      setShowVerificationModal(true);
      console.log('[RegisterDriver] Verification code sent for:', normalizedEmail, 'maskedPhone:', result.maskedPhone ?? 'none', 'provider:', result.smsProvider ?? 'unknown');
    } catch (error: unknown) {
      console.log('[RegisterDriver] Verification send error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Doğrulama kodu gönderilemedi. Lütfen tekrar deneyin.';
      Alert.alert('Hata', errorMessage);
    } finally {
      setVerificationBusy(false);
    }
  };

  const handleVerifyPhoneCode = async () => {
    if (verificationCode.trim().length !== 6) {
      Alert.alert('Uyarı', 'Lütfen 6 haneli SMS kodunu girin');
      return;
    }

    setVerificationConfirming(true);
    try {
      const result = await verifyRegistrationVerificationCode({
        email: normalizedEmail,
        code: verificationCode.trim(),
      });

      if (!result.success) {
        throw new Error(result.error ?? 'Doğrulama kodu hatalı.');
      }

      setVerifiedContactSnapshot({
        email: normalizedEmail,
        phone: normalizedPhone,
      });
      setShowVerificationModal(false);
      setVerificationCode('');
      console.log('[RegisterDriver] Phone verification completed for:', normalizedEmail);
      await submitDriverRegistration(normalizedPhone);
    } catch (error: unknown) {
      console.log('[RegisterDriver] Verification confirm error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Doğrulama kodu onaylanamadı. Lütfen tekrar deneyin.';
      Alert.alert('Hata', errorMessage);
    } finally {
      setVerificationConfirming(false);
    }
  };

  const handleRegister = async () => {
    if (!validateFormFields()) return;
    if (!isRegistrationVerified) {
      await startPhoneVerification(normalizedPhone);
      return;
    }

    await submitDriverRegistration(normalizedPhone);
  };

  const resetForm = () => {
    setName('');
    setPhone('');
    setEmail('');
    setPassword('');
    setVehiclePlate('');
    setVehicleModel('');
    setVehicleColor('');
    setPartnerName('');
    setSelectedCity('');
    setSelectedDistrict('');
    setLicenseFront('');
    setLicenseBack('');
    setIdCardFront('');
    setIdCardBack('');
    setRegistrationFront('');
    setRegistrationBack('');
    setCriminalRecord('');
    setTaxCertificate('');
    setRegistrationCategory('driver');
    setScooterSubType('escooter');
    setHelmetPhoto('');
    setLicenseDay('');
    setLicenseMonth('');
    setLicenseYear('');
    setLicenseDateError('');
    setAgreementAccepted(false);
    setKvkkAccepted(false);
    setEnableBusinessRegistration(false);
    setBusinessName('');
    setBusinessWebsite('');
    setBusinessImage('');
    setBusinessDescription('');
    setBusinessCategory('Yemek');
    setBusinessAddress('');
    clearVerificationState();
    successAnim.setValue(0);
    successScale.setValue(0.5);
    console.log('Form reset for new driver registration');
  };

  const handleRegisterAnother = () => {
    setShowSuccessModal(false);
    resetForm();
  };

  const handleGoToApp = () => {
    setShowSuccessModal(false);
    router.replace('/(driver-tabs)/map');
  };

  const handleCategoryChange = (category: RegistrationCategory) => {
    setRegistrationCategory(category);
    setEnableBusinessRegistration(category === 'business');
    console.log('Selected registration category:', category);
  };

  const badgeLabel = isBusinessCategorySelected
    ? 'İşletme Kaydı'
    : driverCategory === 'driver'
      ? 'Şoför Kaydı'
      : driverCategory === 'scooter'
        ? 'Scooter Şoför Kaydı'
        : 'Kurye Kaydı';

  const screenTitle = isBusinessCategorySelected
    ? 'İşletme Kaydı Oluştur'
    : driverCategory === 'driver'
      ? 'Şoför Ol'
      : driverCategory === 'scooter'
        ? 'Scooterli Şoför Ol'
        : 'Kurye Ol';

  const screenSubtitle = isBusinessCategorySelected
    ? 'İşletmenizi sisteme ekleyin ve teslimat akışınızı başlatın'
    : 'Ekibimize katılın ve kazanmaya başlayın';

  const registerButtonLabel = isBusinessCategorySelected
    ? 'İşletme Olarak Kayıt Ol'
    : driverCategory === 'driver'
      ? 'Şoför Olarak Kayıt Ol'
      : driverCategory === 'scooter'
        ? 'Scooter Şoför Olarak Kayıt Ol'
        : 'Kurye Olarak Kayıt Ol';

  const primaryActionLabel = isRegistrationVerified ? registerButtonLabel : 'SMS Kodu Gönder ve Devam Et';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
          <ScrollView contentContainerStyle={[styles.scrollContent, { paddingHorizontal: hPad, maxWidth: isTablet ? 520 : undefined, alignSelf: isTablet ? 'center' as const : undefined, width: isTablet ? '100%' as unknown as number : undefined }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                <ArrowLeft size={22} color={Colors.dark.text} />
              </TouchableOpacity>

            </View>
            <View style={styles.badge}>
              {registrationCategory === 'driver' && <Car size={16} color={Colors.dark.primary} />}
              {registrationCategory === 'scooter' && <Bike size={16} color="#00BCD4" />}
              {registrationCategory === 'courier' && <Package size={16} color="#8BC34A" />}
              {registrationCategory === 'business' && <Store size={16} color="#FF8A65" />}
              <Text style={styles.badgeText}>{badgeLabel}</Text>
            </View>
            <Text style={[styles.title, { fontSize: isSmall ? 26 : isTablet ? 34 : 30 }]}>{screenTitle}</Text>
            <Text style={[styles.subtitle, { fontSize: isSmall ? 13 : 15 }]}>{screenSubtitle}</Text>

            <View style={styles.categorySelector}>
              {DRIVER_CATEGORIES.map((cat) => {
                const isSelected = registrationCategory === cat.key;
                if (cat.key === 'scooter') {
                  return (
                    <TouchableOpacity
                      key={cat.key}
                      style={[
                        styles.categoryCard,
                        isSelected && { borderColor: cat.color, backgroundColor: `${cat.color}12` },
                      ]}
                      onPress={() => handleCategoryChange(cat.key)}
                      activeOpacity={0.7}
                      testID={`register-category-${cat.key}`}
                    >
                      <View style={styles.scooterCategoryImagesRow}>
                        <View style={styles.scooterCategoryImgWrap}>
                          <Image
                            source={{ uri: 'https://r2-pub.rork.com/generated-images/abedb22d-b164-4a9a-85fc-14251d02fefa.png' }}
                            style={styles.scooterCategoryImg}
                            resizeMode="contain"
                          />
                        </View>
                        <View style={styles.scooterCategoryImgWrap}>
                          <Image
                            source={{ uri: 'https://r2-pub.rork.com/generated-images/117626a1-6777-4afe-b26a-97d6669df356.png' }}
                            style={styles.scooterCategoryImg}
                            resizeMode="contain"
                          />
                        </View>
                      </View>
                      <Text style={[styles.categoryLabel, isSelected && { color: cat.color }]}>{cat.label}</Text>
                      <Text style={styles.categoryDesc}>{cat.description}</Text>
                      {isSelected && (
                        <View style={[styles.categoryCheck, { backgroundColor: cat.color }]}>
                          <CheckCircle size={12} color="#FFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      styles.categoryCard,
                      isSelected && { borderColor: cat.color, backgroundColor: `${cat.color}12` },
                    ]}
                    onPress={() => handleCategoryChange(cat.key)}
                    activeOpacity={0.7}
                    testID={`register-category-${cat.key}`}
                  >
                    <View style={[styles.categoryIconWrap, { backgroundColor: isSelected ? cat.color : Colors.dark.cardBorder }]}>
                      {cat.icon}
                    </View>
                    <Text style={[styles.categoryLabel, isSelected && { color: cat.color }]}>{cat.label}</Text>
                    <Text style={styles.categoryDesc}>{cat.description}</Text>
                    {isSelected && (
                      <View style={[styles.categoryCheck, { backgroundColor: cat.color }]}>
                        <CheckCircle size={12} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {driverCategory === 'scooter' && (
              <View style={styles.scooterSubTypeSelector}>
                <Text style={styles.scooterSubTypeTitle}>Araç Tipinizi Seçin</Text>
                <View style={styles.scooterSubTypeRow}>
                  <TouchableOpacity
                    style={[
                      styles.scooterSubTypeCard,
                      scooterSubType === 'escooter' && styles.scooterSubTypeCardActive,
                    ]}
                    onPress={() => {
                      setScooterSubType('escooter');
                      setVehiclePlate('');
                      console.log('Selected scooter sub-type: escooter');
                    }}
                    activeOpacity={0.7}
                  >
                    <Zap size={22} color={scooterSubType === 'escooter' ? '#00BCD4' : Colors.dark.textMuted} />
                    <Text style={[styles.scooterSubTypeLabel, scooterSubType === 'escooter' && { color: '#00BCD4' }]}>E-Scooter</Text>
                    <Text style={styles.scooterSubTypeDesc}>Elektrikli scooter</Text>
                    {scooterSubType === 'escooter' && (
                      <View style={[styles.categoryCheck, { backgroundColor: '#00BCD4' }]}>
                        <CheckCircle size={12} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.scooterSubTypeCard,
                      scooterSubType === 'motorcycle' && styles.scooterSubTypeCardActiveMoto,
                    ]}
                    onPress={() => {
                      setScooterSubType('motorcycle');
                      console.log('Selected scooter sub-type: motorcycle');
                    }}
                    activeOpacity={0.7}
                  >
                    <Bike size={22} color={scooterSubType === 'motorcycle' ? '#FF5722' : Colors.dark.textMuted} />
                    <Text style={[styles.scooterSubTypeLabel, scooterSubType === 'motorcycle' && { color: '#FF5722' }]}>125cc Motorsiklet</Text>
                    <Text style={styles.scooterSubTypeDesc}>Motorlu araç</Text>
                    {scooterSubType === 'motorcycle' && (
                      <View style={[styles.categoryCheck, { backgroundColor: '#FF5722' }]}>
                        <CheckCircle size={12} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {driverCategory === 'scooter' && (
              <View style={styles.scooterShowcase}>
                <Text style={styles.scooterShowcaseTitle}>Hangi araçla çalışabilirsiniz?</Text>
                <Text style={styles.scooterShowcaseSubtitle}>E-scooter veya 125cc motorsiklet ile şoförlük yapabilirsiniz</Text>
                <View style={styles.scooterImageRow}>
                  <View style={styles.scooterImageCard}>
                    <View style={styles.scooterImageWrap}>
                      <Image
                        source={{ uri: 'https://r2-pub.rork.com/generated-images/abedb22d-b164-4a9a-85fc-14251d02fefa.png' }}
                        style={styles.scooterImg}
                        resizeMode="contain"
                      />
                    </View>
                    <View style={styles.scooterLabelWrap}>
                      <Bike size={14} color="#00BCD4" />
                      <Text style={styles.scooterLabelText}>Martı / E-Scooter</Text>
                    </View>
                    <Text style={styles.scooterDescText}>Elektrikli scooter ile şehir içi hızlı ulaşım</Text>
                  </View>
                  <View style={styles.scooterDivider}>
                    <View style={styles.scooterDividerLine} />
                    <Text style={styles.scooterDividerText}>veya</Text>
                    <View style={styles.scooterDividerLine} />
                  </View>
                  <View style={styles.scooterImageCard}>
                    <View style={styles.scooterImageWrap}>
                      <Image
                        source={{ uri: 'https://r2-pub.rork.com/generated-images/117626a1-6777-4afe-b26a-97d6669df356.png' }}
                        style={styles.scooterImg}
                        resizeMode="contain"
                      />
                    </View>
                    <View style={styles.scooterLabelWrap}>
                      <Bike size={14} color="#FF5722" />
                      <Text style={[styles.scooterLabelText, { color: '#FF5722' }]}>125cc Motorsiklet</Text>
                    </View>
                    <Text style={styles.scooterDescText}>Motorsiklet ile hızlı ve pratik taşımacılık</Text>
                  </View>
                </View>
              </View>
            )}

            <Text style={styles.sectionTitle}>Kişisel Bilgiler</Text>
            <View style={styles.formSection}>
              <InputField renderIcon={() => <User size={18} color={Colors.dark.textMuted} />} label="Ad Soyad" placeholder="Adınızı girin" value={name} onChangeText={setName} />
              <InputField renderIcon={() => <Phone size={18} color={Colors.dark.textMuted} />} label="Telefon" placeholder="05XXXXXXXXX" value={phone} onChangeText={handlePhoneChange} keyboardType="phone-pad" helpText="Telefon numarası 11 haneli olmalı ve 0 ile başlamalı. Kayıt tamamlanmadan önce bu numaraya SMS doğrulama kodu gönderilir." />
              <InputField renderIcon={() => <Mail size={18} color={Colors.dark.textMuted} />} label="E-posta" placeholder="ornek@email.com" value={email} onChangeText={handleEmailChange} keyboardType="email-address" />
              <InputField renderIcon={() => <Lock size={18} color={Colors.dark.textMuted} />} label="Şifre" placeholder="En az 8 karakter, büyük/küçük harf, rakam" value={password} onChangeText={setPassword} secure />
            </View>

            <Text style={styles.sectionTitle}>Hizmet Bölgesi</Text>
            <Text style={styles.partnerNote}>Sadece seçtiğiniz ildeki müşterilerle eşleştirilirsiniz</Text>
            <View style={styles.formSection}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>İL</Text>
                <TouchableOpacity
                  style={styles.pickerButton}
                  onPress={() => { Keyboard.dismiss(); setTimeout(() => setShowCityPicker(true), 100); }}
                  activeOpacity={0.7}
                >
                  <MapPin size={18} color={selectedCity ? Colors.dark.primary : Colors.dark.textMuted} />
                  <Text style={[styles.pickerText, !selectedCity && styles.pickerPlaceholder]}>
                    {selectedCity || 'Hizmet vereceğiniz ili seçin'}
                  </Text>
                  <ChevronDown size={18} color={Colors.dark.textMuted} />
                </TouchableOpacity>
              </View>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>İLÇE</Text>
                <TouchableOpacity
                  style={[styles.pickerButton, !selectedCity && styles.pickerDisabled]}
                  onPress={() => {
                    Keyboard.dismiss();
                    if (selectedCity) setTimeout(() => setShowDistrictPicker(true), 100);
                    else Alert.alert('Uyarı', 'Önce il seçin');
                  }}
                  activeOpacity={0.7}
                >
                  <MapPin size={18} color={selectedDistrict ? Colors.dark.secondary : Colors.dark.textMuted} />
                  <Text style={[styles.pickerText, !selectedDistrict && styles.pickerPlaceholder]}>
                    {selectedDistrict || 'İlçe seçin'}
                  </Text>
                  <ChevronDown size={18} color={Colors.dark.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            {(!isBusinessCategorySelected || !isCourierLike) && (
              <>
                <Text style={styles.sectionTitle}>
                  {driverCategory === 'driver' ? 'Araç Bilgileri' : driverCategory === 'scooter' ? (scooterSubType === 'escooter' ? 'E-Scooter Bilgileri' : 'Motorsiklet Bilgileri') : 'Kurye Araç Bilgileri'}
                </Text>
                {driverCategory === 'courier' && (
                  <Text style={styles.partnerNote}>Teslimat için kullandığınız araç bilgilerini girin</Text>
                )}
                <View style={styles.formSection}>
                  {driverCategory === 'courier' ? (
                    <>
                      <InputField
                        renderIcon={() => <Bike size={18} color={Colors.dark.textMuted} />}
                        label="Araç Tipi / Modeli"
                        placeholder="Motorsiklet, bisiklet veya yaya"
                        value={vehicleModel}
                        onChangeText={setVehicleModel}
                      />
                      <InputField
                        renderIcon={() => <Palette size={18} color={Colors.dark.textMuted} />}
                        label="Araç Rengi"
                        placeholder="Siyah"
                        value={vehicleColor}
                        onChangeText={setVehicleColor}
                      />
                      <InputField
                        renderIcon={() => <Hash size={18} color={Colors.dark.textMuted} />}
                        label="Plaka (Varsa)"
                        placeholder="Motorsiklet plakası (opsiyonel)"
                        value={vehiclePlate}
                        onChangeText={(t) => setVehiclePlate(t.toUpperCase())}
                        autoCapitalize="characters"
                      />
                    </>
                  ) : (
                    <>
                      {(driverCategory !== 'scooter' || scooterSubType !== 'escooter') && (
                        <InputField
                          renderIcon={() => <Hash size={18} color={Colors.dark.textMuted} />}
                          label="Plaka"
                          placeholder={driverCategory === 'scooter' ? '34 AB 1234' : '34 ABC 123'}
                          value={vehiclePlate}
                          onChangeText={(t) => setVehiclePlate(t.toUpperCase())}
                          autoCapitalize="characters"
                        />
                      )}
                      <InputField
                        renderIcon={() => driverCategory === 'scooter' ? (scooterSubType === 'escooter' ? <Zap size={18} color={Colors.dark.textMuted} /> : <Bike size={18} color={Colors.dark.textMuted} />) : <Car size={18} color={Colors.dark.textMuted} />}
                        label={driverCategory === 'driver' ? 'Araç Modeli' : (scooterSubType === 'escooter' ? 'E-Scooter Modeli' : 'Motorsiklet Modeli')}
                        placeholder={driverCategory === 'driver' ? 'Toyota Corolla 2022' : (scooterSubType === 'escooter' ? 'Xiaomi Mi Pro 2' : 'Honda PCX 125')}
                        value={vehicleModel}
                        onChangeText={setVehicleModel}
                      />
                      <InputField
                        renderIcon={() => <Palette size={18} color={Colors.dark.textMuted} />}
                        label={driverCategory === 'driver' ? 'Araç Rengi' : 'Renk'}
                        placeholder="Beyaz"
                        value={vehicleColor}
                        onChangeText={setVehicleColor}
                      />
                    </>
                  )}
                </View>
              </>
            )}

            {isCourierLike && (
              <>
                <Text style={styles.sectionTitle}>{isBusinessCategorySelected ? 'İşletme Bilgileri' : 'İşletme Kaydı'}</Text>
                <Text style={styles.partnerNote}>
                  {isBusinessCategorySelected
                    ? 'İşletme bilgilerinizi ekleyin. Bu seçim işletme kartınızı müşteri ana sayfasında yayınlar.'
                    : 'Yemeksepeti veya Trendyol Go benzeri işletmeleri sisteme açmak için bilgileri ekleyin'}
                </Text>
                <View style={styles.formSection}>
                  {!isBusinessCategorySelected && (
                    <TouchableOpacity
                      style={[styles.businessToggleCard, enableBusinessRegistration && styles.businessToggleCardActive]}
                      onPress={() => setEnableBusinessRegistration((previous) => !previous)}
                      activeOpacity={0.85}
                      testID="toggle-business-registration"
                    >
                      <View style={styles.businessToggleRow}>
                        <View style={styles.businessToggleTextWrap}>
                          <Text style={styles.businessToggleTitle}>Bu hesap bir işletme de açsın</Text>
                          <Text style={styles.businessToggleSub}>İşletme adı, web sitesi, görsel ve adres bilgisi müşteri ana sayfasında gösterilir</Text>
                        </View>
                        {enableBusinessRegistration ? (
                          <CheckSquare size={22} color={Colors.dark.primary} />
                        ) : (
                          <Square size={22} color={Colors.dark.textMuted} />
                        )}
                      </View>
                    </TouchableOpacity>
                  )}

                  {shouldShowBusinessFields && (
                    <>
                      <InputField renderIcon={() => <Store size={18} color={Colors.dark.textMuted} />} label="İşletme Adı" placeholder="Örnek Burger House" value={businessName} onChangeText={setBusinessName} />
                      <InputField renderIcon={() => <Globe size={18} color={Colors.dark.textMuted} />} label="Web Sitesi" placeholder="www.isletmeniz.com" value={businessWebsite} onChangeText={setBusinessWebsite} />
                      <BusinessImageField value={businessImage} onPress={handlePickBusinessImage} onClear={() => setBusinessImage('')} />
                      <InputField renderIcon={() => <Package size={18} color={Colors.dark.textMuted} />} label="Kategori" placeholder="Yemek, market, tatlı" value={businessCategory} onChangeText={setBusinessCategory} />
                      <InputField renderIcon={() => <MapPin size={18} color={Colors.dark.textMuted} />} label="İşletme Adresi" placeholder="Mahalle, sokak, bina no" value={businessAddress} onChangeText={setBusinessAddress} helpText="Adres otomatik olarak harita konumuna çevrilmeye çalışılır" />
                      <InputField renderIcon={() => <FileText size={18} color={Colors.dark.textMuted} />} label="Kısa Açıklama" placeholder="Özel menüler ve hızlı teslimat" value={businessDescription} onChangeText={setBusinessDescription} />
                    </>
                  )}
                </View>
              </>
            )}

            {driverCategory !== 'courier' && (
              <>
            <Text style={styles.sectionTitle}>Ehliyet Süresi</Text>
            <Text style={styles.partnerNote}>Ehliyetiniz ne kadar süredir var? (Minimum 15 ay)</Text>
            <View style={styles.formSection}>
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>EHLİYET ALIM TARİHİ</Text>
                <View style={styles.licenseDateRow}>
                  <View style={styles.licenseDateField}>
                    <TextInput
                      style={styles.licenseDateInput}
                      placeholder="GG"
                      placeholderTextColor={Colors.dark.textMuted}
                      value={licenseDay}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, '').slice(0, 2);
                        setLicenseDay(cleaned);
                      }}
                      onBlur={validateLicenseDate}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    <Text style={styles.licenseDateLabel}>Gün</Text>
                  </View>
                  <Text style={styles.licenseDateSeparator}>/</Text>
                  <View style={styles.licenseDateField}>
                    <TextInput
                      style={styles.licenseDateInput}
                      placeholder="AA"
                      placeholderTextColor={Colors.dark.textMuted}
                      value={licenseMonth}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, '').slice(0, 2);
                        setLicenseMonth(cleaned);
                      }}
                      onBlur={validateLicenseDate}
                      keyboardType="number-pad"
                      maxLength={2}
                    />
                    <Text style={styles.licenseDateLabel}>Ay</Text>
                  </View>
                  <Text style={styles.licenseDateSeparator}>/</Text>
                  <View style={[styles.licenseDateField, { flex: 1.5 }]}>
                    <TextInput
                      style={styles.licenseDateInput}
                      placeholder="YYYY"
                      placeholderTextColor={Colors.dark.textMuted}
                      value={licenseYear}
                      onChangeText={(t) => {
                        const cleaned = t.replace(/[^0-9]/g, '').slice(0, 4);
                        setLicenseYear(cleaned);
                      }}
                      onBlur={validateLicenseDate}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    <Text style={styles.licenseDateLabel}>Yıl</Text>
                  </View>
                </View>

                {licenseDateError ? (
                  <View style={styles.licenseDateErrorRow}>
                    <AlertTriangle size={14} color="#EF4444" />
                    <Text style={styles.licenseDateErrorText}>{licenseDateError}</Text>
                  </View>
                ) : null}

                {parsedLicenseDate && isLicenseValid ? (
                  <View style={styles.licenseDateSuccessRow}>
                    <ShieldCheck size={14} color="#10B981" />
                    <Text style={styles.licenseDateSuccessText}>
                      Ehliyetiniz {licenseMonthsOwned} aydır ({Math.floor(licenseMonthsOwned / 12)} yıl {licenseMonthsOwned % 12} ay) geçerli
                    </Text>
                  </View>
                ) : null}

                {parsedLicenseDate && !isLicenseValid && !licenseDateError ? (
                  <View style={styles.licenseDateWarningRow}>
                    <AlertTriangle size={14} color="#F59E0B" />
                    <Text style={styles.licenseDateWarningText}>
                      Ehliyetiniz {licenseMonthsOwned} aylık. Minimum 15 ay gerekli.
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
              </>
            )}

            <Text style={styles.sectionTitle}>Belgeler</Text>
            <Text style={styles.partnerNote}>
              {isBusinessCategorySelected
                ? 'Kimlik kartınızı ve vergi levhanızı görsel olarak yükleyin'
                : driverCategory === 'courier'
                  ? 'Kimlik ve sabıka kaydınızı yükleyin'
                  : 'Tüm belgelerin ön ve arka yüzünü yükleyin'}
            </Text>

            {driverCategory !== 'courier' && (
              <View style={styles.docSection}>
                <Text style={styles.docLabel}>
                  {driverCategory === 'driver' ? 'Ehliyet (Sürücü Belgesi)' : 'Ehliyet / Sürücü Belgesi'}
                </Text>
                <View style={styles.docRow}>
                  <DocUploadBox label="Ön Yüz" uri={licenseFront} onPress={() => pickImage(setLicenseFront)} onRemove={() => setLicenseFront('')} />
                  <DocUploadBox label="Arka Yüz" uri={licenseBack} onPress={() => pickImage(setLicenseBack)} onRemove={() => setLicenseBack('')} />
                </View>
              </View>
            )}

            <View style={styles.docSection}>
              <Text style={styles.docLabel}>Kimlik Kartı</Text>
              <View style={styles.docRow}>
                <DocUploadBox label="Ön Yüz" uri={idCardFront} onPress={() => pickImage(setIdCardFront)} onRemove={() => setIdCardFront('')} />
                <DocUploadBox label="Arka Yüz" uri={idCardBack} onPress={() => pickImage(setIdCardBack)} onRemove={() => setIdCardBack('')} />
              </View>
            </View>

            {driverCategory !== 'courier' && (
              <View style={styles.docSection}>
                <Text style={styles.docLabel}>
                  {driverCategory === 'driver' ? 'Araç Ruhsatı' : 'Scooter Ruhsatı'}
                </Text>
                <View style={styles.docRow}>
                  <DocUploadBox label="Ön Yüz" uri={registrationFront} onPress={() => pickImage(setRegistrationFront)} onRemove={() => setRegistrationFront('')} />
                  <DocUploadBox label="Arka Yüz" uri={registrationBack} onPress={() => pickImage(setRegistrationBack)} onRemove={() => setRegistrationBack('')} />
                </View>
              </View>
            )}

            {shouldShowHelmetDocument && (
              <View style={styles.docSection}>
                <View style={styles.docLabelRow}>
                  <Text style={styles.docLabel}>Kask Fotoğrafı</Text>
                  <View style={styles.requiredBadge}>
                    <HardHat size={10} color="#EF4444" />
                    <Text style={styles.requiredBadgeText}>Zorunlu</Text>
                  </View>
                </View>
                {!helmetPhoto && (
                  <Text style={styles.taxWarningText}>Güvenlik için kask fotoğrafı yüklemek zorunludur</Text>
                )}
                <View style={styles.docRow}>
                  <DocUploadBox label="Kask Fotoğrafı" uri={helmetPhoto} onPress={() => pickImage(setHelmetPhoto)} onRemove={() => setHelmetPhoto('')} />
                  <View style={styles.docBox} />
                </View>
              </View>
            )}

            {shouldShowCriminalRecordDocument && (
              <View style={styles.docSection}>
                <Text style={styles.docLabel}>Sabıka Kaydı</Text>
                <View style={styles.docRow}>
                  <DocUploadBox label="Sabıka Kaydı" uri={criminalRecord} onPress={() => pickImage(setCriminalRecord)} onRemove={() => setCriminalRecord('')} />
                  <View style={styles.docBox} />
                </View>
              </View>
            )}

            {shouldShowTaxCertificateDocument && (
              <View style={styles.docSection}>
                <View style={styles.docLabelRow}>
                  <Text style={styles.docLabel}>Vergi Levhası</Text>
                  <View style={styles.requiredBadge}>
                    <AlertTriangle size={10} color="#EF4444" />
                    <Text style={styles.requiredBadgeText}>Zorunlu</Text>
                  </View>
                </View>
                {!taxCertificate && (
                  <Text style={styles.taxWarningText}>Vergi levhasını görsel olarak yüklemeden kayıt oluşturamazsınız</Text>
                )}
                <View style={styles.docRow}>
                  <DocUploadBox label={isBusinessCategorySelected ? 'Vergi Levhası Görseli' : 'Vergi Levhası'} uri={taxCertificate} onPress={() => pickImage(setTaxCertificate)} onRemove={() => setTaxCertificate('')} />
                  <View style={styles.docBox} />
                </View>
              </View>
            )}

            {driverCategory === 'driver' && (
              <>
                <Text style={styles.sectionTitle}>Partner Şoför</Text>
                <Text style={styles.partnerNote}>Her araçta 2 şoför çalışır. Partner bilgisi opsiyoneldir.</Text>
                <View style={styles.formSection}>
                  <InputField renderIcon={() => <Users size={18} color={Colors.dark.textMuted} />} label="Partner Adı" placeholder="Partner şoför adı" value={partnerName} onChangeText={setPartnerName} />
                </View>
              </>
            )}

            <View style={styles.agreementSection}>
              <View style={styles.agreementRow}>
                <TouchableOpacity
                  onPress={() => setAgreementAccepted(!agreementAccepted)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {agreementAccepted ? (
                    <CheckSquare size={22} color={Colors.dark.primary} />
                  ) : (
                    <Square size={22} color={Colors.dark.textMuted} />
                  )}
                </TouchableOpacity>
                <Text style={styles.agreementText}>
                  Koşulları okudum ve kabul ediyorum.{' '}
                  <Text style={styles.agreementLink} onPress={() => setShowAgreementModal(true)}>Tıklayınız</Text>
                </Text>
              </View>
              <View style={styles.agreementRow}>
                <TouchableOpacity
                  onPress={() => setKvkkAccepted(!kvkkAccepted)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {kvkkAccepted ? (
                    <CheckSquare size={22} color={Colors.dark.primary} />
                  ) : (
                    <Square size={22} color={Colors.dark.textMuted} />
                  )}
                </TouchableOpacity>
                <Text style={styles.agreementText}>
                  KVKK aydınlatma metnini okudum, kişisel verilerimin işlenmesini kabul ediyorum.{' '}
                  <Text style={styles.agreementLink} onPress={() => router.push('/privacy-policy' as any)}>Aydınlatma Metni</Text>
                </Text>
              </View>
            </View>

            {isRegistrationVerified ? (
              <View style={styles.verificationBanner}>
                <View style={styles.verificationBannerIcon}>
                  <CheckCircle size={16} color={Colors.dark.success} />
                </View>
                <View style={styles.verificationBannerContent}>
                  <Text style={styles.verificationBannerTitle}>Telefon doğrulandı</Text>
                  <Text style={styles.verificationBannerText}>SMS onayı tamamlandı. Artık başvurunu güvenle gönderebilirsin.</Text>
                </View>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.registerButton, (!agreementAccepted || !kvkkAccepted || isActionBusy) && styles.registerButtonDisabled]}
              onPress={handleRegister}
              disabled={isActionBusy || !agreementAccepted || !kvkkAccepted}
              activeOpacity={0.85}
              testID="register-driver-submit-button"
            >
              {isActionBusy ? (
                <ActivityIndicator color={Colors.dark.background} size="small" />
              ) : (
                <Text style={styles.registerButtonText}>{primaryActionLabel}</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <VerificationCodeModal
        visible={showVerificationModal}
        title="Telefonunu doğrula"
        subtitle="Şoför hesabını açmadan önce telefonuna gelen SMS kodunu doğrulaman gerekiyor."
        code={verificationCode}
        onCodeChange={setVerificationCode}
        onClose={() => setShowVerificationModal(false)}
        onConfirm={handleVerifyPhoneCode}
        onResend={() => startPhoneVerification(normalizedPhone)}
        isConfirming={verificationConfirming}
        isResending={verificationBusy}
        maskedPhone={verificationMaskedPhone}
        deliveryNote={verificationDeliveryNote}
        providerName={verificationProvider === 'netgsm' ? 'NetGSM' : null}
        confirmLabel="Telefonu Onayla"
        resendLabel="Kodu Yeniden Gönder"
        testIDPrefix="register-driver-verification"
      />

      <Modal visible={showAgreementModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.agreementModalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.agreementModalHeaderRow}>
                <FileText size={18} color={Colors.dark.primary} />
                <Text style={styles.modalTitle}>Sorumluluk Reddi Sözleşmesi</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAgreementModal(false)}>
                <X size={22} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.agreementModalScroll} showsVerticalScrollIndicator={true}>
              <Text style={styles.agreementModalText}>
                ForYou uygulaması yalnızca müşteri ile şoför arasında aracılık hizmeti sunar.{"\n\n"}
                • Yolculuk sırasında meydana gelebilecek her türlü kaza, hasar, yaralanma veya maddi/manevi zarardan ForYou şirketi sorumlu tutulamaz.{"\n\n"}
                • Şoför, yolculuk süresince aracın güvenli kullanımından ve trafik kurallarına uyulmasından şahsen sorumludur.{"\n\n"}
                • Müşterinin araca vereceği her türlü zarar (çizik, ezik, kırık vb.) müşterinin sorumluluğundadır.{"\n\n"}
                • Şoförün müşterinin aracına verdiği her türlü zarar (çizik, ezik, kırık, mekanik hasar vb.) tamamen şoförün kendi sorumluluğundadır. ForYou bu zararlardan hiçbir şekilde sorumlu tutulamaz.{"\n\n"}
                • Şoförün kusurlu davranışından kaynaklanan diğer tüm zararlar da şoförün kendi sorumluluğundadır.{"\n\n"}
                • Araçta oluşabilecek her türlü hasar durumunda sorumluluk tamamen yolculuğun taraflarına (müşteri ve/veya şoför) aittir.{"\n\n"}
                • ForYou, taraflar arasındaki anlaşmazlıklarda arabuluculuk yapabilir ancak hukuki sorumluluk kabul etmez.{"\n\n"}
                • İşbu sözleşmeden doğan her türlü uyuşmazlıkta Denizli Mahkemeleri ve İcra Daireleri yetkilidir.{"\n\n"}
                • Bu sözleşmeyi kabul ederek, yukarıdaki koşulları okuduğunuzu ve anladığınızı beyan etmiş olursunuz.
              </Text>
            </ScrollView>
            <TouchableOpacity
              style={styles.agreementModalButton}
              onPress={() => {
                setAgreementAccepted(true);
                setShowAgreementModal(false);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.agreementModalButtonText}>Okudum ve Kabul Ediyorum</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showSuccessModal} animationType="fade" transparent={true}>
        <View style={styles.successOverlay}>
          <RNAnimated.View style={[styles.successCard, { opacity: successAnim, transform: [{ scale: successScale }] }]}>
            <View style={styles.successIconWrap}>
              <View style={styles.successIconCircle}>
                <Heart size={36} color="#FFF" fill="#FFF" />
              </View>
            </View>
            <Text style={styles.successTitle}>Kaydınız Tamamlandı!</Text>
            <Text style={styles.successSubtitle}>Kaydınız başarıyla oluşturuldu. Hemen uygulamaya giriş yapabilir ve kullanmaya başlayabilirsiniz. Bol kazançlar dileriz!</Text>
            <TouchableOpacity
              style={styles.successMainButton}
              onPress={handleGoToApp}
              activeOpacity={0.85}
            >
              <Text style={styles.successMainButtonText}>Uygulamaya Gir</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.successSecondaryButton}
              onPress={handleRegisterAnother}
              activeOpacity={0.7}
            >
              <UserPlus size={18} color={Colors.dark.primary} />
              <Text style={styles.successSecondaryButtonText}>Başka Şoför Kayıt Et</Text>
            </TouchableOpacity>
          </RNAnimated.View>
        </View>
      </Modal>

      <Modal visible={showCityPicker} animationType="slide" transparent={true}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => { setShowCityPicker(false); setCitySearch(''); }} activeOpacity={1}>
          <KeyboardAvoidingView behavior="padding" style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>İl Seçin</Text>
              <TouchableOpacity onPress={() => { setShowCityPicker(false); setCitySearch(''); }}>
                <X size={22} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchRow}>
              <Search size={18} color={Colors.dark.textMuted} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="İl ara..."
                placeholderTextColor={Colors.dark.textMuted}
                value={citySearch}
                onChangeText={setCitySearch}
              />
            </View>
            <FlatList
              data={filteredCities}
              keyExtractor={(item) => item.name}
              style={styles.modalList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, item.name === selectedCity && styles.modalItemSelected]}
                  onPress={() => handleSelectCity(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalItemText, item.name === selectedCity && styles.modalItemTextSelected]}>
                    {item.plateCode} - {item.name}
                  </Text>
                  {item.name === selectedCity && <CheckCircle size={18} color={Colors.dark.primary} />}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="always"
            />
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showDistrictPicker} animationType="slide" transparent={true}>
        <TouchableOpacity style={styles.modalOverlay} onPress={() => { setShowDistrictPicker(false); setDistrictSearch(''); }} activeOpacity={1}>
          <KeyboardAvoidingView behavior="padding" style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{selectedCity} - İlçe Seçin</Text>
              <TouchableOpacity onPress={() => { setShowDistrictPicker(false); setDistrictSearch(''); }}>
                <X size={22} color={Colors.dark.textSecondary} />
              </TouchableOpacity>
            </View>
            <View style={styles.modalSearchRow}>
              <Search size={18} color={Colors.dark.textMuted} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="İlçe ara..."
                placeholderTextColor={Colors.dark.textMuted}
                value={districtSearch}
                onChangeText={setDistrictSearch}
              />
            </View>
            <FlatList
              data={filteredDistricts}
              keyExtractor={(item) => item}
              style={styles.modalList}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, item === selectedDistrict && styles.modalItemSelected]}
                  onPress={() => handleSelectDistrict(item)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.modalItemText, item === selectedDistrict && styles.modalItemTextSelected]}>
                    {item}
                  </Text>
                  {item === selectedDistrict && <CheckCircle size={18} color={Colors.dark.primary} />}
                </TouchableOpacity>
              )}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="always"
            />
          </KeyboardAvoidingView>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function DocUploadBox({ label, uri, onPress, onRemove }: {
  label: string; uri: string; onPress: () => void; onRemove: () => void;
}) {
  if (uri) {
    return (
      <View style={styles.docBox}>
        <TouchableOpacity style={styles.docImageContainer} onPress={onPress} activeOpacity={0.8}>
          <ExpoImage source={{ uri }} style={styles.docImage} contentFit="cover" cachePolicy="none" />
          <TouchableOpacity style={styles.docRemoveBtn} onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={12} color="#FFF" />
          </TouchableOpacity>
          <View style={styles.docImageLabel}>
            <Text style={styles.docImageLabelText}>{label}</Text>
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.docBox}>
      <TouchableOpacity style={styles.docPlaceholder} onPress={onPress} activeOpacity={0.7}>
        <Camera size={22} color={Colors.dark.textMuted} />
        <Text style={styles.docPlaceholderText}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function InputField({ renderIcon, label, placeholder, value, onChangeText, keyboardType, secure, autoCapitalize, helpText }: {
  renderIcon: () => React.ReactElement; label: string; placeholder: string; value: string;
  onChangeText: (t: string) => void; keyboardType?: 'default' | 'phone-pad' | 'email-address'; secure?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; helpText?: string;
}) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.inputWrapper}>
        {renderIcon()}
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.dark.textMuted}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          secureTextEntry={secure}
          autoCapitalize={autoCapitalize}
        />
      </View>
      {helpText ? <Text style={styles.inputHelpText}>{helpText}</Text> : null}
    </View>
  );
}

function BusinessImageField({ value, onPress, onClear }: { value: string; onPress: () => void; onClear: () => void }) {
  return (
    <View style={styles.inputGroup}>
      <View style={styles.businessFieldHeader}>
        <Text style={styles.inputLabel}>KAPAK GÖRSELİ</Text>
        {value ? (
          <TouchableOpacity onPress={onClear} activeOpacity={0.7} testID="clear-business-image-button">
            <Text style={styles.businessImageClearText}>Kaldır</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity style={styles.businessImagePicker} onPress={onPress} activeOpacity={0.85} testID="pick-business-image-button">
        {value ? (
          <>
            <ExpoImage source={{ uri: value }} style={styles.businessImagePreview} contentFit="cover" cachePolicy="none" />
            <View style={styles.businessImageOverlay}>
              <Camera size={18} color="#FFF" />
              <Text style={styles.businessImageOverlayText}>Görseli Değiştir</Text>
            </View>
          </>
        ) : (
          <View style={styles.businessImagePlaceholder}>
            <View style={styles.businessImagePlaceholderIcon}>
              <Camera size={22} color={Colors.dark.primary} />
            </View>
            <Text style={styles.businessImagePlaceholderTitle}>İşletme kapağı yükleyin</Text>
            <Text style={styles.businessImagePlaceholderSub}>Müşteri ana sayfasında gösterilecek kapak görselini seçin</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.background },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { paddingTop: 12, paddingBottom: 40 },
  backButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.dark.card, justifyContent: 'center', alignItems: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(245,166,35,0.1)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, alignSelf: 'flex-start', marginBottom: 16 },
  badgeText: { fontSize: 13, fontWeight: '600' as const, color: Colors.dark.primary },
  title: { fontSize: 30, fontWeight: '800' as const, color: Colors.dark.text, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: Colors.dark.textSecondary, marginTop: 6, marginBottom: 20 },
  categorySelector: {
    flexDirection: 'row',
    flexWrap: 'wrap' as const,
    justifyContent: 'space-between' as const,
    gap: 10,
    marginBottom: 28,
  },
  categoryCard: {
    width: '48%' as const,
    minHeight: 136,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.dark.cardBorder,
    position: 'relative' as const,
    overflow: 'hidden' as const,
  },
  categoryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    textAlign: 'center' as const,
    marginBottom: 4,
  },
  categoryDesc: {
    fontSize: 9,
    color: Colors.dark.textMuted,
    textAlign: 'center' as const,
    lineHeight: 12,
  },
  categoryCheck: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  scooterCategoryImagesRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    marginBottom: 8,
  },
  scooterCategoryImgWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(0,188,212,0.1)',
    overflow: 'hidden' as const,
  },
  scooterCategoryImg: {
    width: '100%',
    height: '100%',
  },
  scooterShowcase: {
    backgroundColor: Colors.dark.card,
    borderRadius: 20,
    padding: 18,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: 'rgba(0,188,212,0.25)',
  },
  scooterShowcaseTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    textAlign: 'center' as const,
    marginBottom: 4,
  },
  scooterShowcaseSubtitle: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    textAlign: 'center' as const,
    marginBottom: 16,
  },
  scooterImageRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  scooterImageCard: {
    flex: 1,
    alignItems: 'center' as const,
  },
  scooterImageWrap: {
    width: '100%' as const,
    height: 120,
    backgroundColor: 'rgba(0,188,212,0.06)',
    borderRadius: 14,
    overflow: 'hidden' as const,
    marginBottom: 10,
  },
  scooterImg: {
    width: '100%',
    height: '100%',
  },
  scooterLabelWrap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginBottom: 4,
  },
  scooterLabelText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#00BCD4',
  },
  scooterDescText: {
    fontSize: 10,
    color: Colors.dark.textMuted,
    textAlign: 'center' as const,
    lineHeight: 14,
  },
  scooterDivider: {
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    paddingVertical: 10,
  },
  scooterDividerLine: {
    width: 1,
    height: 20,
    backgroundColor: Colors.dark.cardBorder,
  },
  scooterDividerText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.dark.textMuted,
  },
  scooterSubTypeSelector: {
    marginBottom: 20,
  },
  scooterSubTypeTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    marginBottom: 12,
  },
  scooterSubTypeRow: {
    flexDirection: 'row' as const,
    gap: 12,
  },
  scooterSubTypeCard: {
    flex: 1,
    backgroundColor: Colors.dark.card,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center' as const,
    borderWidth: 1.5,
    borderColor: Colors.dark.cardBorder,
    position: 'relative' as const,
    gap: 6,
  },
  scooterSubTypeCardActive: {
    borderColor: '#00BCD4',
    backgroundColor: 'rgba(0,188,212,0.08)',
  },
  scooterSubTypeCardActiveMoto: {
    borderColor: '#FF5722',
    backgroundColor: 'rgba(255,87,34,0.08)',
  },
  scooterSubTypeLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    textAlign: 'center' as const,
  },
  scooterSubTypeDesc: {
    fontSize: 10,
    color: Colors.dark.textMuted,
    textAlign: 'center' as const,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700' as const, color: Colors.dark.text, marginBottom: 16 },
  partnerNote: { fontSize: 13, color: Colors.dark.textMuted, marginBottom: 16, marginTop: -8 },
  formSection: { gap: 18, marginBottom: 28 },
  inputGroup: { gap: 8 },
  inputLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.dark.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrapper: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.inputBg, borderRadius: 14, borderWidth: 1, borderColor: Colors.dark.inputBorder, paddingHorizontal: 16, gap: 12 },
  input: { flex: 1, paddingVertical: 16, fontSize: 16, color: Colors.dark.text },
  inputHelpText: { fontSize: 12, lineHeight: 18, color: Colors.dark.textMuted },
  businessFieldHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  businessImageClearText: { fontSize: 12, fontWeight: '700' as const, color: '#FF8A65' },
  businessImagePicker: { height: 172, borderRadius: 18, overflow: 'hidden' as const, borderWidth: 1, borderColor: Colors.dark.inputBorder, backgroundColor: Colors.dark.inputBg },
  businessImagePreview: { width: '100%', height: '100%' },
  businessImageOverlay: { position: 'absolute' as const, left: 12, right: 12, bottom: 12, borderRadius: 14, backgroundColor: 'rgba(13,16,24,0.7)', paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8 },
  businessImageOverlayText: { fontSize: 13, fontWeight: '700' as const, color: '#FFF' },
  businessImagePlaceholder: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 22, backgroundColor: 'rgba(255,138,101,0.08)' },
  businessImagePlaceholderIcon: { width: 52, height: 52, borderRadius: 18, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(245,166,35,0.14)', marginBottom: 14 },
  businessImagePlaceholderTitle: { fontSize: 15, fontWeight: '800' as const, color: Colors.dark.text, marginBottom: 6 },
  businessImagePlaceholderSub: { fontSize: 12, lineHeight: 18, color: Colors.dark.textMuted, textAlign: 'center' as const },
  businessToggleCard: { backgroundColor: Colors.dark.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.dark.cardBorder, padding: 16 },
  businessToggleCardActive: { borderColor: Colors.dark.primary, backgroundColor: 'rgba(245,166,35,0.08)' },
  businessToggleRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12 },
  businessToggleTextWrap: { flex: 1 },
  businessToggleTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.dark.text, marginBottom: 4 },
  businessToggleSub: { fontSize: 12, lineHeight: 18, color: Colors.dark.textMuted },
  pickerButton: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.dark.inputBg,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.dark.inputBorder,
    paddingHorizontal: 16, paddingVertical: 16, gap: 12,
  },
  pickerDisabled: { opacity: 0.5 },
  pickerText: { flex: 1, fontSize: 16, color: Colors.dark.text },
  pickerPlaceholder: { color: Colors.dark.textMuted },
  licenseDateRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  licenseDateField: {
    flex: 1,
    alignItems: 'center' as const,
  },
  licenseDateInput: {
    width: '100%' as const,
    backgroundColor: Colors.dark.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.dark.inputBorder,
    paddingVertical: 14,
    paddingHorizontal: 12,
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.dark.text,
    textAlign: 'center' as const,
  },
  licenseDateLabel: {
    fontSize: 10,
    color: Colors.dark.textMuted,
    fontWeight: '500' as const,
    marginTop: 4,
  },
  licenseDateSeparator: {
    fontSize: 20,
    color: Colors.dark.textMuted,
    fontWeight: '600' as const,
    marginTop: -14,
  },
  licenseDateErrorRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    backgroundColor: 'rgba(239,68,68,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  licenseDateErrorText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '600' as const,
    flex: 1,
  },
  licenseDateSuccessRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    backgroundColor: 'rgba(16,185,129,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  licenseDateSuccessText: {
    fontSize: 12,
    color: '#10B981',
    fontWeight: '600' as const,
    flex: 1,
  },
  licenseDateWarningRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginTop: 10,
    backgroundColor: 'rgba(245,158,11,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  licenseDateWarningText: {
    fontSize: 12,
    color: '#F59E0B',
    fontWeight: '600' as const,
    flex: 1,
  },
  agreementSection: { marginBottom: 24, marginTop: 8 },
  agreementRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, marginBottom: 14 },
  agreementText: { flex: 1, fontSize: 14, color: Colors.dark.text, lineHeight: 20, marginTop: 1 },
  agreementLink: { color: Colors.dark.primary, fontWeight: '700' as const, textDecorationLine: 'underline' as const },
  agreementModalContent: { backgroundColor: Colors.dark.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', overflow: 'hidden' as const },
  agreementModalHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  agreementModalScroll: { paddingHorizontal: 20, paddingBottom: 16, maxHeight: 400 },
  agreementModalText: { fontSize: 14, color: Colors.dark.textSecondary, lineHeight: 22 },
  agreementModalButton: { backgroundColor: Colors.dark.primary, marginHorizontal: 20, marginVertical: 16, paddingVertical: 16, borderRadius: 14, alignItems: 'center' as const },
  agreementModalButtonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.dark.background },
  verificationBanner: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    marginBottom: 16,
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(46,204,113,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(46,204,113,0.16)',
  },
  verificationBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(46,204,113,0.16)',
  },
  verificationBannerContent: {
    flex: 1,
    gap: 4,
  },
  verificationBannerTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.dark.text,
  },
  verificationBannerText: {
    fontSize: 13,
    lineHeight: 19,
    color: Colors.dark.textSecondary,
  },
  registerButton: { backgroundColor: Colors.dark.primary, paddingVertical: 18, borderRadius: 16, alignItems: 'center' as const, marginTop: 8 },
  registerButtonDisabled: { opacity: 0.6 },
  registerButtonText: { fontSize: 17, fontWeight: '700' as const, color: Colors.dark.background },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: Colors.dark.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', paddingBottom: 30 },
  modalList: { flexGrow: 0 },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
  },
  modalTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.dark.text },
  modalSearchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.dark.card, borderRadius: 12,
    marginHorizontal: 20, marginBottom: 12, paddingHorizontal: 14,
  },
  modalSearchInput: { flex: 1, paddingVertical: 14, fontSize: 15, color: Colors.dark.text },
  modalItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.dark.divider,
  },
  modalItemSelected: { backgroundColor: 'rgba(245,166,35,0.08)' },
  modalItemText: { fontSize: 16, color: Colors.dark.text },
  modalItemTextSelected: { color: Colors.dark.primary, fontWeight: '600' as const },
  docSection: { marginBottom: 20 },
  docLabelRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 10 },
  docLabel: { fontSize: 14, fontWeight: '600' as const, color: Colors.dark.textSecondary },
  requiredBadge: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, backgroundColor: 'rgba(239,68,68,0.1)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  requiredBadgeText: { fontSize: 11, fontWeight: '700' as const, color: '#EF4444' },
  taxWarningText: { fontSize: 12, color: '#F59E0B', fontWeight: '500' as const, marginBottom: 8 },
  docRow: { flexDirection: 'row', gap: 12 },
  docBox: { flex: 1 },
  docPlaceholder: {
    height: 110,
    borderWidth: 1.5,
    borderColor: Colors.dark.inputBorder,
    borderStyle: 'dashed',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.dark.card,
    gap: 6,
  },
  docPlaceholderText: { fontSize: 12, fontWeight: '500' as const, color: Colors.dark.textMuted },
  docImageContainer: {
    height: 110,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  docImage: { width: '100%', height: '100%' },
  docRemoveBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  docImageLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  docImageLabelText: { fontSize: 11, fontWeight: '600' as const, color: '#FFF' },
  successOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  successCard: {
    width: '100%',
    backgroundColor: Colors.dark.surface,
    borderRadius: 28,
    paddingVertical: 40,
    paddingHorizontal: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  successIconWrap: {
    marginBottom: 24,
  },
  successIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.primary,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.dark.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.dark.text,
    textAlign: 'center',
    lineHeight: 30,
    marginBottom: 10,
  },
  successSubtitle: {
    fontSize: 14,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  approvalPendingBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: 'rgba(245,158,11,0.12)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.25)',
  },
  approvalPendingText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#F59E0B',
  },
  successMainButton: {
    width: '100%',
    backgroundColor: Colors.dark.primary,
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 14,
  },
  successMainButtonText: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.dark.background,
  },
  successSecondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  successSecondaryButtonText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.dark.primary,
  },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, marginBottom: 24 },

});
