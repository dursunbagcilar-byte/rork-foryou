import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Lock,
  KeyRound,
  Smartphone,
  MapPin,
  Trash2,
  Snowflake,
  Eye,
  EyeOff,
  Plus,
  X,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { trpc } from '@/lib/trpc';

interface TrustedContact {
  id: string;
  name: string;
  phone: string;
}

export default function DriverSecurityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const changePasswordMutation = trpc.auth.changePassword.useMutation();

  const [pinEnabled, setPinEnabled] = useState<boolean>(false);
  const [locationSharing, setLocationSharing] = useState<boolean>(true);
  const [showPasswordForm, setShowPasswordForm] = useState<boolean>(false);
  const [showContactForm, setShowContactForm] = useState<boolean>(false);
  const [currentPassword, setCurrentPassword] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showCurrentPass, setShowCurrentPass] = useState<boolean>(false);
  const [showNewPass, setShowNewPass] = useState<boolean>(false);
  const [contactName, setContactName] = useState<string>('');
  const [contactPhone, setContactPhone] = useState<string>('');
  const [trustedContacts, setTrustedContacts] = useState<TrustedContact[]>([
    { id: '1', name: 'Mehmet Kaya', phone: '+90 535 678 9012' },
  ]);

  const handlePasswordChange = useCallback(async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Hata', 'Tüm alanları doldurun.');
      return;
    }
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      Alert.alert('Hata', 'Yeni şifre en az 8 karakter olmalı ve büyük harf, küçük harf, rakam içermelidir.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Hata', 'Yeni şifreler eşleşmiyor.');
      return;
    }
    try {
      const email = user?.email;
      if (!email) {
        Alert.alert('Hata', 'Kullanıcı bilgisi bulunamadı.');
        return;
      }
      const result = await changePasswordMutation.mutateAsync({
        email,
        oldPassword: currentPassword,
        newPassword,
      });
      if (result.success) {
        Alert.alert('Başarılı', 'Şifreniz başarıyla değiştirildi.');
        setShowPasswordForm(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        Alert.alert('Hata', result.error ?? 'Şifre değiştirilemedi.');
      }
    } catch (e) {
      console.log('[Security] Password change error:', e);
      Alert.alert('Hata', 'Şifre değiştirilirken bir hata oluştu.');
    }
  }, [currentPassword, newPassword, confirmPassword, user, changePasswordMutation]);

  const handleAddContact = useCallback(() => {
    if (!contactName.trim() || !contactPhone.trim()) {
      Alert.alert('Hata', 'İsim ve telefon numarası gereklidir.');
      return;
    }
    const newContact: TrustedContact = {
      id: Date.now().toString(),
      name: contactName.trim(),
      phone: contactPhone.trim(),
    };
    setTrustedContacts(prev => [...prev, newContact]);
    setContactName('');
    setContactPhone('');
    setShowContactForm(false);
  }, [contactName, contactPhone]);

  const handleRemoveContact = useCallback((id: string) => {
    Alert.alert('Kişiyi Sil', 'Bu güvenilir kişiyi silmek istediğinize emin misiniz?', [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: () => setTrustedContacts(prev => prev.filter(c => c.id !== id)),
      },
    ]);
  }, []);

  const handleFreezeAccount = useCallback(() => {
    Alert.alert(
      'Hesabı Dondur',
      'Hesabınız dondurulacak ve tekrar giriş yapana kadar kullanılamayacak. Devam etmek istiyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        { text: 'Dondur', style: 'destructive', onPress: () => Alert.alert('Bilgi', 'Hesabınız donduruldu.') },
      ]
    );
  }, []);

  const handleDeleteAccount = useCallback(() => {
    Alert.alert(
      'Hesabı Sil',
      'Bu işlem geri alınamaz! Tüm verileriniz silinecektir. Devam etmek istiyor musunuz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Hesabı Sil',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Son Onay',
              'Hesabınız kalıcı olarak silinecek. Emin misiniz?',
              [
                { text: 'Vazgeç', style: 'cancel' },
                { text: 'Evet, Sil', style: 'destructive', onPress: () => Alert.alert('Bilgi', 'Hesap silme talebi alındı. 7 gün içinde hesabınız silinecektir.') },
              ]
            );
          },
        },
      ]
    );
  }, []);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.push('/driver-menu' as any)} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Güvenlik</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.shieldBanner}>
            <View style={styles.shieldIconWrap}>
              <ShieldCheck size={28} color={Colors.light.success} />
            </View>
            <Text style={styles.shieldTitle}>Hesabınız Korunuyor</Text>
            <Text style={styles.shieldDesc}>Güvenlik ayarlarınızı buradan yönetin</Text>
          </View>

          <Text style={styles.sectionTitle}>Hesap Güvenliği</Text>
          <View style={styles.card}>
            <TouchableOpacity
              style={styles.menuItem}
              activeOpacity={0.7}
              onPress={() => setShowPasswordForm(!showPasswordForm)}
            >
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(245,166,35,0.12)' }]}>
                <Lock size={18} color={Colors.light.primary} />
              </View>
              <Text style={styles.menuLabel}>Şifre Değiştir</Text>
              <ChevronRight size={18} color={Colors.light.textMuted} style={{ transform: [{ rotate: showPasswordForm ? '90deg' : '0deg' }] }} />
            </TouchableOpacity>

            <View style={[styles.formWrap, { display: showPasswordForm ? 'flex' : 'none' }]}>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Mevcut şifre"
                  placeholderTextColor={Colors.light.textMuted}
                  secureTextEntry={!showCurrentPass}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                />
                <TouchableOpacity onPress={() => setShowCurrentPass(!showCurrentPass)} style={styles.eyeBtn}>
                  {showCurrentPass ? <EyeOff size={18} color={Colors.light.textMuted} /> : <Eye size={18} color={Colors.light.textMuted} />}
                </TouchableOpacity>
              </View>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Yeni şifre"
                  placeholderTextColor={Colors.light.textMuted}
                  secureTextEntry={!showNewPass}
                  value={newPassword}
                  onChangeText={setNewPassword}
                />
                <TouchableOpacity onPress={() => setShowNewPass(!showNewPass)} style={styles.eyeBtn}>
                  {showNewPass ? <EyeOff size={18} color={Colors.light.textMuted} /> : <Eye size={18} color={Colors.light.textMuted} />}
                </TouchableOpacity>
              </View>
              <TextInput
                style={[styles.input, { marginBottom: 12 }]}
                placeholder="Yeni şifre tekrar"
                placeholderTextColor={Colors.light.textMuted}
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity style={styles.saveBtn} onPress={handlePasswordChange} activeOpacity={0.8}>
                <Text style={styles.saveBtnText}>Şifreyi Güncelle</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            <View style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(46,204,113,0.12)' }]}>
                <KeyRound size={18} color={Colors.light.success} />
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={styles.menuLabel}>PIN Kilidi</Text>
                <Text style={styles.menuDesc}>Uygulamayı PIN ile koruyun</Text>
              </View>
              <Switch
                value={pinEnabled}
                onValueChange={setPinEnabled}
                trackColor={{ false: Colors.light.inputBorder, true: Colors.light.success }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Sürüş Güvenliği</Text>
          <View style={styles.card}>
            <View style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(255,107,53,0.12)' }]}>
                <MapPin size={18} color={Colors.light.secondary} />
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={styles.menuLabel}>Konum Paylaşımı</Text>
                <Text style={styles.menuDesc}>Yolculuk sırasında konumunuzu müşterilerle paylaşın</Text>
              </View>
              <Switch
                value={locationSharing}
                onValueChange={setLocationSharing}
                trackColor={{ false: Colors.light.inputBorder, true: Colors.light.success }}
                thumbColor="#fff"
              />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Güvenilir Kişiler</Text>
          <Text style={styles.sectionDesc}>Acil durumda bilgilendirilecek kişiler</Text>
          <View style={styles.card}>
            {trustedContacts.map((contact, idx) => (
              <View key={contact.id}>
                {idx > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.contactRow}>
                  <View style={[styles.contactAvatar, { backgroundColor: `hsl(${(idx * 60) % 360}, 60%, 45%)` }]}>
                    <Text style={styles.contactInitial}>{contact.name[0]}</Text>
                  </View>
                  <View style={styles.contactInfo}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.contactPhone}>{contact.phone}</Text>
                  </View>
                  <TouchableOpacity onPress={() => handleRemoveContact(contact.id)} style={styles.removeBtn} activeOpacity={0.7}>
                    <X size={16} color={Colors.light.accent} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <View style={[styles.formWrap, { display: showContactForm ? 'flex' : 'none' }]}>
              <View style={styles.divider} />
              <TextInput
                style={styles.input}
                placeholder="Kişi adı"
                placeholderTextColor={Colors.light.textMuted}
                value={contactName}
                onChangeText={setContactName}
              />
              <TextInput
                style={[styles.input, { marginBottom: 12 }]}
                placeholder="Telefon numarası"
                placeholderTextColor={Colors.light.textMuted}
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
              />
              <View style={styles.formBtns}>
                <TouchableOpacity
                  style={[styles.formActionBtn, styles.cancelBtn]}
                  onPress={() => { setShowContactForm(false); setContactName(''); setContactPhone(''); }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelBtnText}>İptal</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.formActionBtn, styles.addBtn]} onPress={handleAddContact} activeOpacity={0.8}>
                  <Text style={styles.addBtnText}>Ekle</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ display: showContactForm ? 'none' : 'flex' }}>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.addContactBtn} onPress={() => setShowContactForm(true)} activeOpacity={0.7}>
                <Plus size={18} color={Colors.light.primary} />
                <Text style={styles.addContactText}>Kişi Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Oturumlar</Text>
          <View style={styles.card}>
            <View style={styles.menuItem}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(149,149,168,0.12)' }]}>
                <Smartphone size={18} color={Colors.light.textSecondary} />
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={styles.menuLabel}>Bu Cihaz</Text>
                <Text style={styles.menuDesc}>Şu an aktif</Text>
              </View>
              <View style={styles.activeDot} />
            </View>
          </View>

          <Text style={styles.sectionTitle}>Hesap İşlemleri</Text>
          <View style={styles.card}>
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={handleFreezeAccount}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(52,152,219,0.12)' }]}>
                <Snowflake size={18} color="#3498DB" />
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={styles.menuLabel}>Hesabı Dondur</Text>
                <Text style={styles.menuDesc}>Geçici olarak hesabınızı devre dışı bırakın</Text>
              </View>
              <ChevronRight size={18} color={Colors.light.textMuted} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.menuItem} activeOpacity={0.7} onPress={handleDeleteAccount}>
              <View style={[styles.menuIcon, { backgroundColor: 'rgba(231,76,60,0.12)' }]}>
                <Trash2 size={18} color={Colors.light.accent} />
              </View>
              <View style={styles.menuLabelWrap}>
                <Text style={[styles.menuLabel, { color: Colors.light.accent }]}>Hesabı Sil</Text>
                <Text style={styles.menuDesc}>Kalıcı olarak hesabınızı silin</Text>
              </View>
              <ChevronRight size={18} color={Colors.light.textMuted} />
            </TouchableOpacity>
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
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.light.text },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  shieldBanner: {
    alignItems: 'center',
    paddingVertical: 24,
    marginBottom: 8,
  },
  shieldIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(46,204,113,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  shieldTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 4 },
  shieldDesc: { fontSize: 13, color: Colors.light.textSecondary },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  sectionDesc: { fontSize: 13, color: Colors.light.textMuted, marginBottom: 8 },
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
  menuLabel: { fontSize: 15, color: Colors.light.text, fontWeight: '500' as const },
  menuLabelWrap: { flex: 1 },
  menuDesc: { fontSize: 12, color: Colors.light.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: Colors.light.divider, marginLeft: 16 },
  formWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  input: {
    flex: 1,
    height: 46,
    backgroundColor: Colors.light.inputBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.inputBorder,
    paddingHorizontal: 14,
    fontSize: 14,
    color: Colors.light.text,
    marginBottom: 10,
  },
  eyeBtn: { position: 'absolute' as const, right: 12, top: 14 },
  saveBtn: {
    backgroundColor: Colors.light.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.background },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  contactInitial: { fontSize: 16, fontWeight: '700' as const, color: '#fff' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '500' as const, color: Colors.light.text },
  contactPhone: { fontSize: 13, color: Colors.light.textMuted, marginTop: 2 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(231,76,60,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  addContactText: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.primary },
  formBtns: { flexDirection: 'row', gap: 10 },
  formActionBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelBtn: { backgroundColor: Colors.light.inputBg, borderWidth: 1, borderColor: Colors.light.inputBorder },
  cancelBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.textSecondary },
  addBtn: { backgroundColor: Colors.light.primary },
  addBtnText: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.background },
  activeDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.light.success },
});

