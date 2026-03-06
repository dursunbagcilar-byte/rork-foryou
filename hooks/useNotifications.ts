import { useState, useEffect, useRef, useCallback } from 'react';
import { Platform, LogBox } from 'react-native';
import Constants from 'expo-constants';
import { trpc } from '@/lib/trpc';

const isExpoGoApp = Constants.appOwnership === 'expo';
const isStandaloneBuild = (Constants.appOwnership as string) === 'standalone' || Constants.appOwnership === null;

let Notifications: typeof import('expo-notifications') | null = null;

try {
  Notifications = require('expo-notifications');
  console.log('[Notifications] Module loaded successfully');
} catch (e) {
  console.log('[Notifications] Module not available');
}

if (Platform.OS !== 'web' && Notifications) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    console.log('[Notifications] Handler set successfully');
  } catch (e) {
    console.log('[Notifications] Handler setup failed:', e);
  }
}

LogBox.ignoreLogs([
  'expo-notifications',
  'Remote notifications',
  'remote notifications',
  'Notifications.getPermissionsAsync',
  'Notifications.requestPermissionsAsync',
]);

const EVENING_NOTIFICATIONS = [
  {
    id: 'daily-17',
    hour: 17,
    minute: 0,
    title: '🌇 Akşam Planınız Hazır mı?',
    body: 'Trafiğe takılmadan evinize konforlu bir yolculuk için hemen araç çağırın!',
  },
  {
    id: 'daily-20',
    hour: 20,
    minute: 0,
    title: '🌙 Gece Planlarınız İçin Buradayız',
    body: 'Akşam programınız mı var? Güvenli ve hızlı ulaşım bir tık uzağınızda.',
  },
];

export type NotificationEnvironment = 'standalone' | 'expo-go' | 'web' | 'unknown';

export function getNotificationEnvironment(): NotificationEnvironment {
  if (Platform.OS === 'web') return 'web';
  if (isExpoGoApp) return 'expo-go';
  if (isStandaloneBuild) return 'standalone';
  return 'unknown';
}

export interface UseNotificationsResult {
  expoPushToken: string | null;
  hasPermission: boolean;
  environment: NotificationEnvironment;
  isReady: boolean;
  sendLocalNotification: (title: string, body: string, data?: Record<string, string>) => Promise<void>;
  sendRideNotification: (
    type: 'ride_accepted' | 'driver_arriving' | 'driver_arrived' | 'ride_completed' | 'ride_cancelled' | 'new_ride_request',
    details?: Record<string, string>
  ) => Promise<void>;
  registerForPushNotifications: () => Promise<string | null>;
  scheduleEveningNotifications: () => Promise<void>;
  cancelEveningNotifications: () => Promise<void>;
}

export function useNotifications(userId: string | null): UseNotificationsResult {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  const notificationListener = useRef<{ remove: () => void } | null>(null);
  const responseListener = useRef<{ remove: () => void } | null>(null);
  const registerMutation = trpc.notifications.registerPushToken.useMutation();
  const environment = getNotificationEnvironment();

  const registerForPushNotifications = useCallback(async (): Promise<string | null> => {
    try {
      if (Platform.OS === 'web') {
        console.log('[Notifications] Web platform - using in-app notifications only');
        setHasPermission(true);
        setIsReady(true);
        return null;
      }

      if (!Notifications) {
        console.log('[Notifications] Module not available - using in-app notifications only');
        setHasPermission(true);
        setIsReady(true);
        return null;
      }

      if (isExpoGoApp) {
        console.log('[Notifications] Expo Go detected - local notifications available, remote push disabled');
        setHasPermission(true);
        setIsReady(true);
        return null;
      }

      console.log('[Notifications] Standalone build - setting up full push notification support');

      let existingStatus: string = 'undetermined';
      try {
        const permResult = await Notifications.getPermissionsAsync();
        existingStatus = permResult.status;
        console.log('[Notifications] Current permission status:', existingStatus);
      } catch (_e) {
        console.log('[Notifications] Failed to get permission status');
        setIsReady(true);
        return null;
      }

      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        try {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
          console.log('[Notifications] Permission request result:', finalStatus);
        } catch (_e) {
          console.log('[Notifications] Permission request failed');
          setIsReady(true);
          return null;
        }
      }

      if (finalStatus !== 'granted') {
        console.log('[Notifications] Permission denied - in-app notifications will still work');
        setHasPermission(false);
        setIsReady(true);
        return null;
      }

      setHasPermission(true);

      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Varsayılan',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#FF9F1C',
            sound: 'default',
          });

          await Notifications.setNotificationChannelAsync('rides', {
            name: 'Yolculuklar',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 500, 250, 500],
            lightColor: '#4CAF50',
            sound: 'default',
          });
          console.log('[Notifications] Android channels created');
        } catch (_e) {
          console.log('[Notifications] Android channel creation failed');
        }
      }

      try {
        const projectId = process.env.EXPO_PUBLIC_PROJECT_ID;
        console.log('[Notifications] Getting push token with projectId:', projectId ? 'present' : 'missing');
        
        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: projectId,
        });
        const token = tokenData.data;
        setExpoPushToken(token);
        console.log('[Notifications] Push token obtained:', token.substring(0, 25) + '...');

        if (userId && token) {
          const platform = Platform.OS === 'ios' ? 'ios' : 'android';
          registerMutation.mutate({
            userId,
            token,
            platform,
          });
          console.log('[Notifications] Token registered for user:', userId, 'platform:', platform);
        }

        setIsReady(true);
        return token;
      } catch (tokenErr) {
        console.log('[Notifications] Push token error:', tokenErr);
        setIsReady(true);
        return null;
      }
    } catch (_e) {
      console.log('[Notifications] Unexpected error during registration');
      setIsReady(true);
      return null;
    }
  }, [userId, registerMutation]);

  useEffect(() => {
    if (!userId) return;

    if (Platform.OS === 'web' || !Notifications) {
      setHasPermission(true);
      setIsReady(true);
      return;
    }

    if (isExpoGoApp) {
      console.log('[Notifications] Expo Go - local notifications + in-app fallback active');
      setHasPermission(true);
      setIsReady(true);
    }

    registerForPushNotifications();

    try {
      notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
        console.log('[Notifications] Received:', notification.request.content.title);
      });

      responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
        const data = response.notification.request.content.data;
        console.log('[Notifications] User tapped notification, data:', data);
      });
      console.log('[Notifications] Listeners attached');
    } catch (_e) {
      console.log('[Notifications] Listener setup skipped (Expo Go)');
    }

    return () => {
      try {
        if (notificationListener.current) {
          notificationListener.current.remove();
        }
        if (responseListener.current) {
          responseListener.current.remove();
        }
      } catch (_e) {
        // ignore cleanup errors
      }
    };
  }, [userId]);

  const sendLocalNotification = useCallback(async (title: string, body: string, data?: Record<string, string>) => {
    if (Platform.OS === 'web' || !Notifications) {
      console.log('[Notifications] Local notification (in-app only):', title);
      return;
    }

    if (isExpoGoApp) {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title,
            body,
            data: data ?? {},
            sound: 'default',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: 1,
          },
        });
        console.log('[Notifications] Expo Go local notification scheduled:', title);
      } catch (_e) {
        console.log('[Notifications] Expo Go local notification failed, using in-app fallback');
      }
      return;
    }

    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data: data ?? {},
          sound: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 1,
        },
      });
      console.log('[Notifications] Local notification scheduled:', title);
    } catch (_e) {
      console.log('[Notifications] Local notification failed');
    }
  }, []);

  const sendRideNotification = useCallback(async (
    type: 'ride_accepted' | 'driver_arriving' | 'driver_arrived' | 'ride_completed' | 'ride_cancelled' | 'new_ride_request',
    details?: Record<string, string>
  ) => {
    const messages: Record<string, { title: string; body: string }> = {
      ride_accepted: {
        title: '✅ Yolculuk Kabul Edildi',
        body: details?.driverName ? `${details.driverName} yolculuğunuzu kabul etti!` : 'Şoförünüz yolda!',
      },
      driver_arriving: {
        title: '🚗 Şoför Yaklaşıyor',
        body: details?.eta ? `Şoförünüz ${details.eta} dakika içinde gelecek` : 'Şoförünüz yakınızda!',
      },
      driver_arrived: {
        title: '📍 Şoför Geldi!',
        body: 'Şoförünüz konumunuza ulaştı. Hazır olun!',
      },
      ride_completed: {
        title: '🎉 Yolculuk Tamamlandı',
        body: details?.price ? `Toplam: ₺${details.price}` : 'İyi yolculuklar!',
      },
      ride_cancelled: {
        title: '❌ Yolculuk İptal Edildi',
        body: details?.reason ?? 'Yolculuğunuz iptal edildi.',
      },
      new_ride_request: {
        title: '🔔 Yeni Yolculuk Talebi!',
        body: details?.pickup ? `${details.pickup} → ${details.dropoff}` : 'Yeni bir yolculuk talebi var!',
      },
    };

    const msg = messages[type];
    if (msg) {
      await sendLocalNotification(msg.title, msg.body, { type, ...details });

      if (userId) {
        try {
          registerMutation.reset();
        } catch (_e) {
          // ignore
        }
      }
    }
  }, [sendLocalNotification, userId, registerMutation]);

  const scheduleEveningNotifications = useCallback(async () => {
    try {
      if (Platform.OS === 'web' || !Notifications) {
        console.log('[Notifications] Evening notifications skipped (web/no module)');
        return;
      }

      if (isExpoGoApp) {
        console.log('[Notifications] Evening notifications skipped (Expo Go - no repeating support)');
        return;
      }

      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      console.log('[Notifications] Currently scheduled:', scheduled.length, 'notifications');

      for (const notif of EVENING_NOTIFICATIONS) {
        const exists = scheduled.some(s => s.identifier === notif.id);
        if (exists) {
          console.log('[Notifications] Evening notification already scheduled:', notif.id);
          continue;
        }

        await Notifications.scheduleNotificationAsync({
          identifier: notif.id,
          content: {
            title: notif.title,
            body: notif.body,
            sound: 'default',
            data: { type: 'evening_promo' },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DAILY,
            hour: notif.hour,
            minute: notif.minute,
          },
        });
        console.log('[Notifications] Evening notification scheduled:', notif.id, 'at', notif.hour + ':' + notif.minute);
      }
    } catch (_e) {
      console.log('[Notifications] Evening notification scheduling failed');
    }
  }, []);

  const cancelEveningNotifications = useCallback(async () => {
    if (!Notifications || isExpoGoApp) return;
    try {
      for (const notif of EVENING_NOTIFICATIONS) {
        await Notifications.cancelScheduledNotificationAsync(notif.id);
      }
      console.log('[Notifications] Evening notifications cancelled');
    } catch (_e) {
      // ignore
    }
  }, []);

  return {
    expoPushToken,
    hasPermission,
    environment,
    isReady,
    sendLocalNotification,
    sendRideNotification,
    registerForPushNotifications,
    scheduleEveningNotifications,
    cancelEveningNotifications,
  };
}
