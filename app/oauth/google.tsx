import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';

export default function GoogleOAuthReturnScreen() {
  const router = useRouter();

  useEffect(() => {
    console.log('[GoogleOAuthReturn] Legacy oauth route opened, redirecting to /login');
    const timer = setTimeout(() => {
      router.replace('/login');
    }, 150);

    return () => {
      clearTimeout(timer);
    };
  }, [router]);

  return (
    <View style={styles.container} testID="google-oauth-return-screen">
      <ActivityIndicator size="small" color={Colors.dark.primary} />
      <Text style={styles.title}>Girişe dönülüyor...</Text>
      <Text style={styles.subtitle}>Google doğrulaması tamamlanırken lütfen bekleyin.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.dark.text,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center' as const,
    color: Colors.dark.textSecondary,
  },
});
