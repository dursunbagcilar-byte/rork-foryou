import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Platform, StatusBar } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider, useTheme } from "@/contexts/ThemeContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationProvider, useNotificationContext } from "@/contexts/NotificationContext";
import { SecurityProvider } from "@/contexts/SecurityContext";
import { PrivacyProvider } from "@/contexts/PrivacyContext";
import { RideForOthersProvider } from "@/contexts/RideForOthersContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import InAppNotification from "@/components/InAppNotification";
import { ScalePressable } from '@/components/ScalePressable';
import { Colors } from "@/constants/colors";
import { trpc, trpcClient, resetCircuitBreaker } from "@/lib/trpc";
import { getDbBootstrapPayload, getDbHeaders, hasDbConfig } from "@/utils/db";
import { androidTextFix, crossPlatformShadow, getStatusBarConfig } from "@/utils/platform";
import { useMounted } from "@/hooks/useMounted";

async function safelyCompleteAuthSession(): Promise<void> {
  try {
    const WebBrowser = await import('expo-web-browser');
    WebBrowser.maybeCompleteAuthSession();
  } catch (e) {
    console.log('[Layout] WebBrowser.maybeCompleteAuthSession error:', e);
  }
}

async function safelySyncSystemBackground(backgroundColor: string): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    const SystemUI = await import('expo-system-ui');
    await SystemUI.setBackgroundColorAsync(backgroundColor);
  } catch (error) {
    console.log('[Layout] SystemUI.setBackgroundColorAsync error:', error);
  }
}

let queryClientSingleton: QueryClient | null = null;
function getQueryClient() {
  if (!queryClientSingleton) {
    queryClientSingleton = new QueryClient({
      defaultOptions: {
        queries: {
          retry: 0,
          staleTime: 30000,
          networkMode: 'always' as const,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
        mutations: {
          retry: 0,
          networkMode: 'always' as const,
        },
      },
    });
  }
  return queryClientSingleton;
}

console.log('[Layout] Root layout module loaded v3 - Platform:', Platform.OS);

function NotificationOverlay() {
  const { notification, dismiss } = useNotificationContext();
  return (
    <InAppNotification
      visible={notification.visible}
      title={notification.title}
      message={notification.message}
      type={notification.type}
      onDismiss={dismiss}
      onPress={notification.onPress}
    />
  );
}

function RootLayoutNav() {
  const { colors, isDark } = useTheme();
  console.log('[Layout] RootLayoutNav rendering');

  useEffect(() => {
    console.log('[Layout] Syncing system background for theme:', isDark ? 'dark' : 'light');
    void safelySyncSystemBackground(colors.background);
  }, [colors.background, isDark]);

  const statusBarConfig = getStatusBarConfig({
    backgroundColor: colors.background,
    isDark,
  });

  return (
    <View style={bootStyles.rootLayoutNavContainer}>
      <StatusBar {...statusBarConfig} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register-customer" options={{ presentation: 'modal' }} />
        <Stack.Screen name="register-driver" options={{ presentation: 'modal' }} />
        <Stack.Screen name="customer-menu" options={{ presentation: 'fullScreenModal', animation: 'fade_from_bottom', animationDuration: 250 }} />
        <Stack.Screen name="driver-menu" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="ai-chat" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="ai-photo-editor" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="scheduled-ride" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="cancellation-policy" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="forgot-password" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="system-status" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen name="privacy-policy" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="terms-of-service" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="driver-help" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="kvkk-data-management" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        <Stack.Screen name="(customer-tabs)" />
        <Stack.Screen name="(driver-tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </View>
  );
}

function CrashFallback({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <View style={crashStyles.container}>
      <Text style={crashStyles.emoji}>⚠️</Text>
      <Text style={crashStyles.title}>Uygulama Başlatılamadı</Text>
      <Text style={crashStyles.message}>Bir hata oluştu. Lütfen tekrar deneyin.</Text>
      {error ? <Text style={crashStyles.detail} numberOfLines={4}>{error}</Text> : null}
      <ScalePressable style={crashStyles.button} onPress={onRetry} pressedScale={0.985} pressedOpacity={0.96}>
        <Text style={crashStyles.buttonText}>Tekrar Dene</Text>
      </ScalePressable>
    </View>
  );
}

const crashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emoji: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700' as const, color: Colors.dark.text, marginBottom: 8, ...androidTextFix({ fontWeight: '700' }) },
  message: { fontSize: 14, color: Colors.dark.textSecondary, textAlign: 'center' as const, marginBottom: 16, ...androidTextFix({ lineHeight: 20 }) },
  detail: { fontSize: 12, color: Colors.dark.textMuted, backgroundColor: Colors.dark.card, padding: 12, borderRadius: 10, width: '100%', marginBottom: 20, overflow: 'hidden' as const, ...androidTextFix({ lineHeight: 18 }) },
  button: { backgroundColor: Colors.dark.primary, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 14, ...crossPlatformShadow({ color: Colors.dark.primary, offsetY: 8, opacity: 0.24, radius: 14, elevation: 6 }) },
  buttonText: { fontSize: 16, fontWeight: '700' as const, color: Colors.dark.background, ...androidTextFix({ fontWeight: '700' }) },
});

const bootStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  rootLayoutNavContainer: {
    flex: 1,
  },
});

function BootShell() {
  return <View style={bootStyles.container} testID="web-hydration-shell" />;
}

function AppProviders({ queryClient }: { queryClient: QueryClient }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ErrorBoundary>
            <ThemeProvider>
              <PrivacyProvider>
                <SecurityProvider>
                  <AuthProvider>
                    <RideForOthersProvider>
                      <LanguageProvider>
                        <NotificationProvider>
                          <NotificationOverlay />
                          <RootLayoutNav />
                        </NotificationProvider>
                      </LanguageProvider>
                    </RideForOthersProvider>
                  </AuthProvider>
                </SecurityProvider>
              </PrivacyProvider>
            </ThemeProvider>
          </ErrorBoundary>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

export default function RootLayout() {
  const [initError, setInitError] = useState<string | null>(null);
  const mounted = useMounted();

  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    console.log('[Layout] RootLayout mounted');
    mountedRef.current = true;
    resetCircuitBreaker();
    void safelyCompleteAuthSession();

    const bootstrapDb = async () => {
      if (!mountedRef.current) return;
      try {
        const { buildApiUrl, getBaseUrl, waitForBaseUrl } = await import('@/lib/trpc');
        let baseUrl = getBaseUrl();
        if (!baseUrl) {
          console.log('[Layout] DB bootstrap - waiting for base URL...');
          baseUrl = await waitForBaseUrl(12000);
        }
        const hasClientDbConfig = hasDbConfig();
        const dbBootstrapPayload = getDbBootstrapPayload();

        console.log('[Layout] DB bootstrap - baseUrl:', baseUrl ? baseUrl.substring(0, 50) : 'MISSING', 'clientDbConfig:', hasClientDbConfig ? 'SET' : 'MISSING');

        if (baseUrl) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          try {
            const bootstrapUrl = buildApiUrl('/api/bootstrap-db');
            console.log('[Layout] DB bootstrap URL:', bootstrapUrl);
            const res = await fetch(bootstrapUrl, {
              method: 'POST',
              headers: getDbHeaders(),
              body: JSON.stringify(dbBootstrapPayload),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (res.ok) {
              const data = await res.json();
              console.log('[Layout] DB bootstrap OK - configured:', data.configured, 'storageMode:', data.storageMode, 'drivers:', data.drivers, 'users:', data.users);
            } else {
              console.log('[Layout] DB bootstrap status:', res.status);
            }
          } catch (fetchErr) {
            clearTimeout(timeoutId);
            console.log('[Layout] DB bootstrap fetch error (non-critical):', fetchErr);
          }
        }
      } catch (e) {
        console.log('[Layout] DB bootstrap error (non-critical):', e);
      }
    };
    void bootstrapDb();

    return () => {
      mountedRef.current = false;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, []);

  if (initError) {
    return <CrashFallback error={initError} onRetry={() => setInitError(null)} />;
  }

  if (Platform.OS === 'web' && !mounted) {
    console.log('[Layout] Waiting for web mount before rendering providers');
    return <BootShell />;
  }

  const queryClient = getQueryClient();

  return <AppProviders queryClient={queryClient} />;
}
