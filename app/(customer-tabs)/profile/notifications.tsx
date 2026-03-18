import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  Car,
  Tag,
  ShieldAlert,
  MessageSquare,
  Mail,
  Smartphone,
  Moon,
  Volume2,
  VolumeX,
  BellOff,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

interface NotifSetting {
  key: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
}

const RIDE_NOTIFS: NotifSetting[] = [
  { key: 'driverArriving', label: 'Şoför Yolda', desc: 'Şoför size doğru yola çıktığında', icon: Car, color: Colors.light.primary, iconBg: 'rgba(245,166,35,0.12)' },
  { key: 'driverArrived', label: 'Şoför Geldi', desc: 'Şoför konumunuza ulaştığında', icon: Car, color: Colors.light.success, iconBg: 'rgba(46,204,113,0.12)' },
  { key: 'rideComplete', label: 'Yolculuk Tamamlandı', desc: 'Yolculuğunuz bittiğinde', icon: Car, color: '#3498DB', iconBg: 'rgba(52,152,219,0.12)' },
];

const PROMO_NOTIFS: NotifSetting[] = [
  { key: 'promotions', label: 'Kampanyalar', desc: 'İndirim ve promosyon fırsatları', icon: Tag, color: Colors.light.secondary, iconBg: 'rgba(255,107,53,0.12)' },
];

const SECURITY_NOTIFS: NotifSetting[] = [
  { key: 'newLogin', label: 'Yeni Giriş', desc: 'Hesabınıza yeni bir cihazdan giriş yapıldığında', icon: ShieldAlert, color: Colors.light.accent, iconBg: 'rgba(231,76,60,0.12)' },
  { key: 'passwordChange', label: 'Şifre Değişikliği', desc: 'Şifreniz değiştirildiğinde', icon: ShieldAlert, color: Colors.light.warning, iconBg: 'rgba(243,156,18,0.12)' },
];

type ChannelKey = 'push' | 'sms' | 'email';

interface ChannelSetting {
  key: ChannelKey;
  label: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
}

const CHANNELS: ChannelSetting[] = [
  { key: 'push', label: 'Push Bildirim', icon: Smartphone, color: Colors.light.primary, iconBg: 'rgba(245,166,35,0.12)' },
  { key: 'sms', label: 'SMS', icon: MessageSquare, color: Colors.light.success, iconBg: 'rgba(46,204,113,0.12)' },
  { key: 'email', label: 'E-posta', icon: Mail, color: '#3498DB', iconBg: 'rgba(52,152,219,0.12)' },
];

export default function NotificationsScreen() {
  const router = useRouter();

  const [notifStates, setNotifStates] = useState<Record<string, boolean>>({
    driverArriving: true,
    driverArrived: true,
    rideComplete: true,
    promotions: true,
    newLogin: true,
    passwordChange: true,
  });

  const [channels, setChannels] = useState<Record<ChannelKey, boolean>>({
    push: true,
    sms: true,
    email: false,
  });

  const [nightMode, setNightMode] = useState<boolean>(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  const toggleNotif = useCallback((key: string) => {
    setNotifStates(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleChannel = useCallback((key: ChannelKey) => {
    setChannels(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleMuteAll = useCallback(() => {
    const allOff = Object.values(notifStates).every(v => !v);
    if (allOff) {
      setNotifStates({
        driverArriving: true,
        driverArrived: true,
        rideComplete: true,
        promotions: true,
        newLogin: true,
        passwordChange: true,
      });
    } else {
      Alert.alert(
        'Tüm Bildirimleri Kapat',
        'Tüm bildirimleri kapatmak istediğinize emin misiniz?',
        [
          { text: 'İptal', style: 'cancel' },
          {
            text: 'Kapat',
            style: 'destructive',
            onPress: () => {
              const newStates: Record<string, boolean> = {};
              Object.keys(notifStates).forEach(k => { newStates[k] = false; });
              setNotifStates(newStates);
            },
          },
        ]
      );
    }
  }, [notifStates]);

  const allMuted = Object.values(notifStates).every(v => !v);

  const renderToggleSection = (title: string, items: NotifSetting[]) => (
    <View style={styles.card}>
      {items.map((item, idx) => (
        <React.Fragment key={item.key}>
          {idx > 0 && <View style={styles.divider} />}
          <View style={styles.menuItem}>
            <View style={[styles.menuIcon, { backgroundColor: item.iconBg }]}>
              <item.icon size={18} color={item.color} />
            </View>
            <View style={styles.menuLabelWrap}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDesc}>{item.desc}</Text>
            </View>
            <Switch
              value={notifStates[item.key] ?? false}
              onValueChange={() => toggleNotif(item.key)}
              trackColor={{ false: Colors.light.inputBorder, true: Colors.light.success }}
              thumbColor="#fff"
            />
          </View>
        </React.Fragment>
      ))}
    </View>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Bildirimler</Text>
          <TouchableOpacity onPress={handleMuteAll} style={styles.backBtn} activeOpacity={0.7}>
            {allMuted ? <Bell size={20} color={Colors.light.primary} /> : <BellOff size={20} color={Colors.light.textMuted} />}
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.banner}>
            <View style={styles.bannerIconWrap}>
              <Bell size={28} color={Colors.light.primary} />
            </View>
            <Text style={styles.bannerTitle}>Bildirim Tercihleri</Text>
            <Text style={styles.bannerDesc}>Hangi bildirimleri almak istediğinizi seçin</Text>
          </View>

          <Text style={styles.sectionTitle}>Yolculuk Bildirimleri</Text>
          {renderToggleSection('Yolculuk', RIDE_NOTIFS)}

          <Text style={styles.sectionTitle}>Promosyon</Text>
          {renderToggleSection('Promosyon', PROMO_NOTIFS)}

          <Text style={styles.sectionTitle}>Güvenlik Uyarıları</Text>
          {renderToggleSection('Güvenlik', SECURITY_NOTIFS)}

          <Text style={styles.sectionTitle}>Bildirim Kanalları</Text>
          <View style={styles.card}>
            {CHANNELS.map((ch, idx) => (
              <React.Fragment key={ch.key}>
                {idx > 0 && <View style={styles.divider} />}
                <View style={styles.menuItem}>
                  <View style={[styles.menuIcon, { backgroundColor: ch.iconBg }]}>
                    <ch.icon size={18} color={ch.color} />
                  </View>
                  <Text style={[styles.menuLabel, { flex: 1 }]}>{ch.label}</Text>
                  <Switch
                    value={channels[ch.key]}
                    onValueChange={() => toggleChannel(ch.key)}
                    trackColor={{ false: Colors.light.inputBorder, true: Colors.light.success }}
                    thumbColor="#fff"
                  />
                </View>
              </React.Fragment>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Genel Ayarlar</Text>
          <View style={styles.card}>
            <View style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(149,149,168,0.12)' }]}>
                {soundEnabled ? <Volume2 size={18} color={Colors.light.textSecondary} /> : <VolumeX size={18} color={Colors.light.textMuted} />}
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={styles.menuLabel}>Bildirim Sesi</Text>
                <Text style={styles.menuDesc}>Bildirimlerde ses çalsın</Text>
              </View>
              <Switch
                value={soundEnabled}
                onValueChange={setSoundEnabled}
                trackColor={{ false: Colors.light.inputBorder, true: Colors.light.success }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(52,73,94,0.2)' }]}>
                <Moon size={18} color="#9B59B6" />
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={styles.menuLabel}>Gece Modu</Text>
                <Text style={styles.menuDesc}>22:00 - 08:00 arası sessiz</Text>
              </View>
              <Switch
                value={nightMode}
                onValueChange={setNightMode}
                trackColor={{ false: Colors.light.inputBorder, true: Colors.light.success }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.light.card, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  banner: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 8,
  },
  bannerIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(245,166,35,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  bannerTitle: { fontSize: 18, fontWeight: '700', color: Colors.light.text, marginBottom: 4 },
  bannerDesc: { fontSize: 13, color: Colors.light.textSecondary },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.light.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuLabel: { fontSize: 15, color: Colors.light.text, fontWeight: '500' },
  menuLabelWrap: { flex: 1 },
  menuDesc: { fontSize: 12, color: Colors.light.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.light.divider, marginLeft: 16 },
});

