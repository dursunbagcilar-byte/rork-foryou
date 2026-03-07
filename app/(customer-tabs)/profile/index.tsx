import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Phone, Mail, MapPin, LogOut, ChevronRight, ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { PhoneNumberEditorCard } from '@/components/PhoneNumberEditorCard';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';

export default function CustomerProfileScreen() {
  const { user, logout, updateAccountPhone } = useAuth();
  const router = useRouter();
  const [phoneDraft, setPhoneDraft] = useState<string>(user?.phone ?? '');
  const [isUpdatingPhone, setIsUpdatingPhone] = useState<boolean>(false);

  useEffect(() => {
    setPhoneDraft(user?.phone ?? '');
  }, [user?.phone]);

  const handlePhoneSave = useCallback(async () => {
    const normalizedPhone = normalizeTurkishPhone(phoneDraft);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      Alert.alert('Uyarı', phoneValidationError);
      return;
    }

    if (normalizedPhone === normalizeTurkishPhone(user?.phone ?? '')) {
      Alert.alert('Bilgi', 'Telefon numaranız zaten güncel.');
      return;
    }

    try {
      setIsUpdatingPhone(true);
      await updateAccountPhone(normalizedPhone);
      Alert.alert('Başarılı', 'Telefon numaranız tüm sistemde güncellendi.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telefon numarası güncellenemedi.';
      Alert.alert('Hata', message);
    } finally {
      setIsUpdatingPhone(false);
    }
  }, [phoneDraft, updateAccountPhone, user?.phone]);

  const handleLogout = () => {
    Alert.alert('Çıkış', 'Çıkış yapmak istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Çıkış Yap',
        style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/');
        },
      },
    ]);
  };

  const initials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : 'U';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              activeOpacity={0.7}
              testID="back-btn"
            >
              <ArrowLeft size={22} color={Colors.light.text} />
            </TouchableOpacity>
            <Text style={styles.title}>Profil</Text>
            <View style={styles.backButton} />
          </View>
          <View style={styles.profileCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <Text style={styles.name}>{user?.name ?? 'Kullanıcı'}</Text>
            <Text style={styles.memberBadge}>Müşteri Hesabı</Text>
          </View>
          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Phone size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{user?.phone ?? '-'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Mail size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{user?.email ?? '-'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <MapPin size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{user?.city ?? '-'}{user?.district ? ` / ${user.district}` : ''}</Text>
            </View>
          </View>
          <PhoneNumberEditorCard
            title="Telefon numarasını güncelle"
            subtitle="Buradan değiştirdiğiniz numara şifre sıfırlama ve hesap bilgilerinde hemen kullanılır."
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            onSave={handlePhoneSave}
            isSaving={isUpdatingPhone}
            inputTestID="customer-phone-update-input"
            buttonTestID="customer-phone-update-button"
          />
          <View style={styles.menuSection}>
            {[
              { icon: MapPin, label: 'Kayıtlı Adresler', color: Colors.light.primary, route: '__saved_addresses__' },
            ].map((item, i) => (
              <TouchableOpacity
                key={i}
                style={styles.menuItem}
                activeOpacity={0.7}
                onPress={() => {
                  if (item.route === '__saved_addresses__') {
                    Alert.alert('Kayıtlı Adresler', 'Kayıtlı adres özelliği yakında aktif olacaktır. Yolculuk sırasında adresinizi arama çubuğundan girebilirsiniz.');
                  } else if (item.route) {
                    router.push(item.route as any);
                  }
                }}
              >
                <View style={[styles.menuIcon, { backgroundColor: `${item.color}15` }]}>
                  <item.icon size={18} color={item.color} />
                </View>
                <Text style={styles.menuLabel}>{item.label}</Text>
                <ChevronRight size={18} color={Colors.light.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.7}>
            <LogOut size={18} color={Colors.light.accent} />
            <Text style={styles.logoutText}>Çıkış Yap</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.light.card,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.light.text },
  profileCard: {
    alignItems: 'center',
    backgroundColor: Colors.light.card,
    borderRadius: 20,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    marginBottom: 20,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarText: { fontSize: 26, fontWeight: '700', color: Colors.light.background },
  name: { fontSize: 20, fontWeight: '700', color: Colors.light.text },
  memberBadge: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.light.primary,
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
  },
  infoSection: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  infoDivider: { height: 1, backgroundColor: Colors.light.divider, marginLeft: 48 },
  infoText: { fontSize: 15, color: Colors.light.text },
  menuSection: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    marginBottom: 24,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.light.divider,
  },
  menuIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  menuLabel: { flex: 1, fontSize: 15, color: Colors.light.text, fontWeight: '500' },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.accent,
  },
  logoutText: { fontSize: 15, fontWeight: '600', color: Colors.light.accent },
});
