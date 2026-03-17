import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { Home, Clock, User } from 'lucide-react-native';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/hooks/useNotifications';

export default function CustomerTabsLayout() {
  const { user } = useAuth();
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
          display: 'none' as const,
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
