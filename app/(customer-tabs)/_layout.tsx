import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Home, Clock, User } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useNotifications } from '@/hooks/useNotifications';
import { androidTextFix, crossPlatformShadow, isAndroid } from '@/utils/platform';

export default function CustomerTabsLayout() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const { scheduleEveningNotifications } = useNotifications(user?.id ?? null);

  useEffect(() => {
    if (user?.id) {
      void scheduleEveningNotifications();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.cardBorder,
          borderTopWidth: isAndroid ? 0 : 1,
          ...crossPlatformShadow({
            color: '#000',
            offsetY: -2,
            opacity: isAndroid ? 0.18 : 0.08,
            radius: 10,
            elevation: 12,
          }),
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarItemStyle: {
          paddingTop: isAndroid ? 4 : 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600' as const,
          ...androidTextFix({ lineHeight: 13, fontWeight: '600' }),
        },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          title: 'Ana Sayfa',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="rides"
        options={{
          title: 'Yolculuklar',
          tabBarIcon: ({ color, size }) => <Clock size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
