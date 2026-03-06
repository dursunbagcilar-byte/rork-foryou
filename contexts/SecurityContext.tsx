import { useEffect, useCallback, useState } from 'react';
import { Platform, Alert, AppState, AppStateStatus } from 'react-native';
import createContextHook from '@nkzw/create-context-hook';
import * as SecureStore from 'expo-secure-store';

const SECURITY_LOG_KEY = 'security_events';
const MAX_LOG_ENTRIES = 50;

interface SecurityEvent {
  type: 'screenshot' | 'screen_record' | 'app_background' | 'suspicious_activity' | 'session_expired';
  timestamp: string;
  details?: string;
}

export const [SecurityProvider, useSecurity] = createContextHook(() => {
  const [screenCaptureBlocked, setScreenCaptureBlocked] = useState<boolean>(true);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);

  const logSecurityEvent = useCallback(async (event: SecurityEvent) => {
    try {
      setSecurityEvents(prev => {
        const updated = [event, ...prev].slice(0, MAX_LOG_ENTRIES);
        return updated;
      });

      const stored = await SecureStore.getItemAsync(SECURITY_LOG_KEY);
      const existing: SecurityEvent[] = stored ? JSON.parse(stored) : [];
      const updated = [event, ...existing].slice(0, MAX_LOG_ENTRIES);
      await SecureStore.setItemAsync(SECURITY_LOG_KEY, JSON.stringify(updated));
      console.log(`[SECURITY] Event logged: ${event.type} - ${event.details || ''}`);
    } catch (e) {
      console.log('[SECURITY] Failed to log event:', e);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let ScreenCapture: typeof import('expo-screen-capture') | null = null;

    const setupScreenCapture = async () => {
      try {
        ScreenCapture = await import('expo-screen-capture');

        await ScreenCapture.preventScreenCaptureAsync('security_global');
        setScreenCaptureBlocked(true);
        console.log('[SECURITY] Screen capture prevention activated');

        if (Platform.OS === 'ios') {
          try {
            await ScreenCapture.enableAppSwitcherProtectionAsync();
            console.log('[SECURITY] App switcher protection enabled');
          } catch (e) {
            console.log('[SECURITY] App switcher protection not available:', e);
          }
        }
      } catch (e) {
        console.log('[SECURITY] Screen capture module not available:', e);
      }
    };

    setupScreenCapture();

    return () => {
      if (ScreenCapture) {
        ScreenCapture.allowScreenCaptureAsync('security_global').catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let subscription: { remove: () => void } | null = null;

    const setupListener = async () => {
      try {
        const ScreenCapture = await import('expo-screen-capture');
        subscription = ScreenCapture.addScreenshotListener(() => {
          console.log('[SECURITY] Screenshot detected!');
          logSecurityEvent({
            type: 'screenshot',
            timestamp: new Date().toISOString(),
            details: 'Ekran görüntüsü algılandı',
          });
          Alert.alert(
            'Güvenlik Uyarısı',
            'Ekran görüntüsü almak bu uygulamada kısıtlanmıştır. Kişisel verilerinizin güvenliği için lütfen ekran görüntüsü almayınız.',
            [{ text: 'Anladım' }]
          );
        });
      } catch (e) {
        console.log('[SECURITY] Screenshot listener not available:', e);
      }
    };

    setupListener();

    return () => {
      subscription?.remove();
    };
  }, [logSecurityEvent]);

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (appState === 'active' && nextAppState === 'background') {
        logSecurityEvent({
          type: 'app_background',
          timestamp: new Date().toISOString(),
          details: 'Uygulama arka plana alındı',
        });
      }
      setAppState(nextAppState);
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [appState, logSecurityEvent]);

  useEffect(() => {
    const loadEvents = async () => {
      try {
        const stored = await SecureStore.getItemAsync(SECURITY_LOG_KEY);
        if (stored) {
          setSecurityEvents(JSON.parse(stored));
        }
      } catch (e) {
        console.log('[SECURITY] Failed to load security events:', e);
      }
    };
    loadEvents();
  }, []);

  const toggleScreenCapture = useCallback(async (block: boolean) => {
    if (Platform.OS === 'web') return;

    try {
      const ScreenCapture = await import('expo-screen-capture');
      if (block) {
        await ScreenCapture.preventScreenCaptureAsync('security_global');
        setScreenCaptureBlocked(true);
        console.log('[SECURITY] Screen capture blocked');
      } else {
        await ScreenCapture.allowScreenCaptureAsync('security_global');
        setScreenCaptureBlocked(false);
        console.log('[SECURITY] Screen capture allowed');
      }
    } catch (e) {
      console.log('[SECURITY] Toggle screen capture failed:', e);
    }
  }, []);

  const clearSecurityLogs = useCallback(async () => {
    try {
      await SecureStore.deleteItemAsync(SECURITY_LOG_KEY);
      setSecurityEvents([]);
      console.log('[SECURITY] Security logs cleared');
    } catch (e) {
      console.log('[SECURITY] Failed to clear logs:', e);
    }
  }, []);

  return {
    screenCaptureBlocked,
    securityEvents,
    logSecurityEvent,
    toggleScreenCapture,
    clearSecurityLogs,
  };
});
