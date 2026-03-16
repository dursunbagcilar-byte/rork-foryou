import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking } from 'react-native';
import { MapPin, AlertTriangle, Settings } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface LocationPermissionBannerProps {
  permissionGranted: boolean;
  isLoading: boolean;
  errorMsg: string | null;
  onRetry: () => Promise<boolean>;
}

export default function LocationPermissionBanner({
  permissionGranted,
  isLoading,
  errorMsg,
  onRetry,
}: LocationPermissionBannerProps) {
  const openSettings = useCallback(() => {
    if (Platform.OS === 'web') return;
    Linking.openSettings().catch(() => {
      console.log('[LocationBanner] Cannot open settings');
    });
  }, []);

  if (isLoading || permissionGranted) {
    return <View style={{ display: 'none' }} />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconRow}>
        <View style={styles.iconWrap}>
          <AlertTriangle size={18} color="#F5A623" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Konum İzni Gerekli</Text>
          <Text style={styles.message}>
            {errorMsg ?? 'Haritayı ve yakın şoförleri görebilmek için konum izni verin.'}
          </Text>
        </View>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} activeOpacity={0.7}>
          <MapPin size={14} color="#FFF" />
          <Text style={styles.retryText}>İzin Ver</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' && (
          <TouchableOpacity style={styles.settingsBtn} onPress={openSettings} activeOpacity={0.7}>
            <Settings size={14} color={Colors.dark.textSecondary} />
            <Text style={styles.settingsText}>Ayarlar</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#2E2A1A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F5A62330',
    padding: 14,
    marginHorizontal: 16,
    marginTop: 8,
    gap: 12,
  },
  iconRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F5A62318',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#F5A623',
    marginBottom: 3,
  },
  message: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    lineHeight: 17,
  },
  buttonRow: {
    flexDirection: 'row' as const,
    gap: 10,
  },
  retryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  retryText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: '#FFF',
  },
  settingsBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  settingsText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.dark.textSecondary,
  },
});
