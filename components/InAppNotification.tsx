import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X, Bell, CheckCircle, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { androidTextFix, crossPlatformShadow } from '@/utils/platform';

export type NotificationType = 'info' | 'success' | 'warning' | 'error';

interface InAppNotificationProps {
  visible: boolean;
  title: string;
  message: string;
  type?: NotificationType;
  duration?: number;
  onDismiss: () => void;
  onPress?: () => void;
}

const TYPE_CONFIG: Record<NotificationType, { bg: string; border: string; icon: string; iconColor: string }> = {
  info: { bg: '#1A2332', border: '#2563EB40', icon: 'info', iconColor: '#60A5FA' },
  success: { bg: '#1A2E1A', border: '#2ECC7140', icon: 'check', iconColor: '#2ECC71' },
  warning: { bg: '#2E2A1A', border: '#F5A62340', icon: 'warning', iconColor: '#F5A623' },
  error: { bg: '#2E1A1A', border: '#E74C3C40', icon: 'error', iconColor: '#E74C3C' },
};

function getIcon(type: NotificationType, color: string) {
  switch (type) {
    case 'success': return <CheckCircle size={20} color={color} />;
    case 'warning': return <AlertTriangle size={20} color={color} />;
    case 'error': return <AlertTriangle size={20} color={color} />;
    default: return <Bell size={20} color={color} />;
  }
}

export default function InAppNotification({
  visible,
  title,
  message,
  type = 'info',
  duration = 4000,
  onDismiss,
  onPress,
}: InAppNotificationProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = TYPE_CONFIG[type];

  const dismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 250, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => onDismiss());
  }, [translateY, opacity, onDismiss]);

  useEffect(() => {
    if (visible) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, tension: 80, friction: 12, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      if (duration > 0) {
        timerRef.current = setTimeout(dismiss, duration);
      }
    } else {
      dismiss();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismiss, duration, opacity, translateY, visible]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: Math.max(insets.top, 10) + 4,
          transform: [{ translateY }],
          opacity,
          backgroundColor: config.bg,
          borderColor: config.border,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.content}
        activeOpacity={onPress ? 0.7 : 1}
        onPress={onPress}
      >
        <View style={[styles.iconWrap, { backgroundColor: config.iconColor + '18' }]}>
          {getIcon(type, config.iconColor)}
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          <Text style={styles.message} numberOfLines={2}>{message}</Text>
        </View>
        <TouchableOpacity onPress={dismiss} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <X size={16} color="rgba(255,255,255,0.5)" />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute' as const,
    left: 12,
    right: 12,
    zIndex: 9999,
    borderRadius: 16,
    borderWidth: 1,
    ...crossPlatformShadow({
      color: '#000',
      offsetY: 8,
      opacity: 0.3,
      radius: 16,
      elevation: 12,
    }),
  },
  content: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  textWrap: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    marginBottom: 2,
    ...androidTextFix({ fontWeight: '700' }),
  },
  message: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 17,
    ...androidTextFix({ lineHeight: 17 }),
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
});
