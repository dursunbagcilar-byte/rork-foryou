import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';

const PRIVACY_CONSENT_KEY = 'kvkk_privacy_consent';
const LOCATION_CONSENT_KEY = 'kvkk_location_consent';
const DATA_PROCESSING_CONSENT_KEY = 'kvkk_data_processing_consent';
const CONSENT_TIMESTAMP_KEY = 'kvkk_consent_timestamp';

interface PrivacyConsents {
  privacyPolicy: boolean;
  locationTracking: boolean;
  dataProcessing: boolean;
  consentTimestamp: string | null;
}

export const [PrivacyProvider, usePrivacy] = createContextHook(() => {
  const [consents, setConsents] = useState<PrivacyConsents>({
    privacyPolicy: false,
    locationTracking: false,
    dataProcessing: false,
    consentTimestamp: null,
  });
  const [isLoaded, setIsLoaded] = useState<boolean>(false);

  useEffect(() => {
    const loadConsents = async () => {
      try {
        const [privacy, location, dataProcessing, timestamp] = await Promise.all([
          AsyncStorage.getItem(PRIVACY_CONSENT_KEY),
          AsyncStorage.getItem(LOCATION_CONSENT_KEY),
          AsyncStorage.getItem(DATA_PROCESSING_CONSENT_KEY),
          AsyncStorage.getItem(CONSENT_TIMESTAMP_KEY),
        ]);
        setConsents({
          privacyPolicy: privacy === 'true',
          locationTracking: location === 'true',
          dataProcessing: dataProcessing === 'true',
          consentTimestamp: timestamp,
        });
        console.log('[Privacy] Consents loaded - privacy:', privacy, 'location:', location, 'data:', dataProcessing);
      } catch (e) {
        console.log('[Privacy] Load error:', e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadConsents();
  }, []);

  const acceptPrivacyPolicy = useCallback(async () => {
    const timestamp = new Date().toISOString();
    await AsyncStorage.setItem(PRIVACY_CONSENT_KEY, 'true');
    await AsyncStorage.setItem(CONSENT_TIMESTAMP_KEY, timestamp);
    setConsents(prev => ({ ...prev, privacyPolicy: true, consentTimestamp: timestamp }));
    console.log('[Privacy] Privacy policy accepted at:', timestamp);
  }, []);

  const acceptLocationTracking = useCallback(async () => {
    await AsyncStorage.setItem(LOCATION_CONSENT_KEY, 'true');
    setConsents(prev => ({ ...prev, locationTracking: true }));
    console.log('[Privacy] Location tracking consent accepted');
  }, []);

  const acceptDataProcessing = useCallback(async () => {
    await AsyncStorage.setItem(DATA_PROCESSING_CONSENT_KEY, 'true');
    setConsents(prev => ({ ...prev, dataProcessing: true }));
    console.log('[Privacy] Data processing consent accepted');
  }, []);

  const acceptAllConsents = useCallback(async () => {
    const timestamp = new Date().toISOString();
    await Promise.all([
      AsyncStorage.setItem(PRIVACY_CONSENT_KEY, 'true'),
      AsyncStorage.setItem(LOCATION_CONSENT_KEY, 'true'),
      AsyncStorage.setItem(DATA_PROCESSING_CONSENT_KEY, 'true'),
      AsyncStorage.setItem(CONSENT_TIMESTAMP_KEY, timestamp),
    ]);
    setConsents({
      privacyPolicy: true,
      locationTracking: true,
      dataProcessing: true,
      consentTimestamp: timestamp,
    });
    console.log('[Privacy] All consents accepted at:', timestamp);
  }, []);

  const revokeAllConsents = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(PRIVACY_CONSENT_KEY),
      AsyncStorage.removeItem(LOCATION_CONSENT_KEY),
      AsyncStorage.removeItem(DATA_PROCESSING_CONSENT_KEY),
      AsyncStorage.removeItem(CONSENT_TIMESTAMP_KEY),
    ]);
    setConsents({
      privacyPolicy: false,
      locationTracking: false,
      dataProcessing: false,
      consentTimestamp: null,
    });
    console.log('[Privacy] All consents revoked');
  }, []);

  const revokeLocationConsent = useCallback(async () => {
    await AsyncStorage.removeItem(LOCATION_CONSENT_KEY);
    setConsents(prev => ({ ...prev, locationTracking: false }));
    console.log('[Privacy] Location consent revoked');
  }, []);

  const hasAllRequiredConsents = consents.privacyPolicy && consents.dataProcessing;
  const hasLocationConsent = consents.locationTracking;

  return {
    consents,
    isLoaded,
    acceptPrivacyPolicy,
    acceptLocationTracking,
    acceptDataProcessing,
    acceptAllConsents,
    revokeAllConsents,
    revokeLocationConsent,
    hasAllRequiredConsents,
    hasLocationConsent,
  };
});
