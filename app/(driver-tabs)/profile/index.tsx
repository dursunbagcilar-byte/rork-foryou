import React, { useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Phone, Mail, Car, Star, LogOut, Hash, MapPin, UserPlus, Camera, Info, ArrowLeft, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import type { Driver } from '@/constants/mockData';
import { PhoneNumberEditorCard } from '@/components/PhoneNumberEditorCard';
import { getTurkishPhoneValidationError, normalizeTurkishPhone } from '@/utils/phone';

export default function DriverProfileScreen() {
  const { user, logout, teamMembers, profilePhoto, updateProfilePhoto, teamMemberPhotos, updateTeamMemberPhoto, updateAccountPhone } = useAuth();
  const router = useRouter();
  const driver = user as Driver | null;

  const navigatedAwayRef = useRef(false);
  const [showHomeBtn, setShowHomeBtn] = useState<boolean>(false);
  const [phoneDraft, setPhoneDraft] = useState<string>(driver?.phone ?? '');
  const [isUpdatingPhone, setIsUpdatingPhone] = useState<boolean>(false);

  useEffect(() => {
    setPhoneDraft(driver?.phone ?? '');
  }, [driver?.phone]);

  useFocusEffect(
    useCallback(() => {
      if (navigatedAwayRef.current) {
        setShowHomeBtn(true);
      }
      return () => {
        navigatedAwayRef.current = true;
      };
    }, [])
  );

  const handlePickPhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('İzin Gerekli', 'Galeriye erişim izni gereklidir.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        await updateProfilePhoto(result.assets[0].uri);
        console.log('Profile photo selected:', result.assets[0].uri);
      }
    } catch (e) {
      console.log('Photo pick error:', e);
      Alert.alert('Hata', 'Fotoğraf seçilirken bir hata oluştu.');
    }
  };

  const handlePickTeamMemberPhoto = async (memberId: string) => {
    try {
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('İzin Gerekli', 'Galeriye erişim izni gereklidir.');
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        await updateTeamMemberPhoto(memberId, result.assets[0].uri);
        console.log('Team member photo selected:', memberId, result.assets[0].uri);
      }
    } catch (e) {
      console.log('Team member photo pick error:', e);
      Alert.alert('Hata', 'Fotoğraf seçilirken bir hata oluştu.');
    }
  };

  const handlePhoneSave = useCallback(async () => {
    const normalizedPhone = normalizeTurkishPhone(phoneDraft);
    const phoneValidationError = getTurkishPhoneValidationError(normalizedPhone);
    if (phoneValidationError) {
      Alert.alert('Uyarı', phoneValidationError);
      return;
    }

    if (normalizedPhone === normalizeTurkishPhone(driver?.phone ?? '')) {
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
  }, [driver?.phone, phoneDraft, updateAccountPhone]);

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

  const initials = driver?.name
    ? driver.name.split(' ').map(n => n[0]).join('').toUpperCase()
    : 'Ş';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => {
                if (showHomeBtn) {
                  navigatedAwayRef.current = false;
                  setShowHomeBtn(false);
                  router.replace('/(driver-tabs)/map' as any);
                } else {
                  router.push('/driver-menu' as any);
                }
              }}
              activeOpacity={0.7}
              testID="back-btn"
            >
              {showHomeBtn ? <X size={22} color={Colors.light.text} /> : <ArrowLeft size={22} color={Colors.light.text} />}
            </TouchableOpacity>
            <Text style={styles.title}>Profil</Text>
            <View style={styles.backButton} />
          </View>
          <View style={styles.profileCard}>
            <View style={styles.accountsRow}>
              <View style={styles.accountItem}>
                <TouchableOpacity style={styles.avatarContainer} activeOpacity={0.7} onPress={handlePickPhoto} testID="change-photo-btn">
                  {profilePhoto ? (
                    <Image source={{ uri: profilePhoto }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials}</Text>
                    </View>
                  )}
                  <View style={styles.cameraOverlay}>
                    <Camera size={14} color="#fff" />
                  </View>
                </TouchableOpacity>
                <Text style={styles.accountName} numberOfLines={1}>{driver?.name ?? 'Şoför'}</Text>
                <Text style={styles.memberBadge}>Şoför Hesabı</Text>
                <TouchableOpacity
                  style={styles.infoButton}
                  activeOpacity={0.7}
                  onPress={() => router.push('/(driver-tabs)/profile/documents')}
                  testID="main-info-btn"
                >
                  <Info size={12} color={Colors.light.primary} />
                  <Text style={styles.infoButtonText}>Bilgilerim</Text>
                </TouchableOpacity>
              </View>

              {teamMembers.map((member, idx) => {
                const memberInitials = member.name
                  .split(' ')
                  .map(n => n[0])
                  .join('')
                  .toUpperCase();
                const memberPhoto = teamMemberPhotos[member.id] ?? null;
                return (
                  <View key={member.id} style={styles.accountItem}>
                    <TouchableOpacity
                      style={styles.avatarContainer}
                      activeOpacity={0.7}
                      onPress={() => handlePickTeamMemberPhoto(member.id)}
                      testID={`change-team-photo-btn-${idx}`}
                    >
                      {memberPhoto ? (
                        <Image source={{ uri: memberPhoto }} style={styles.teamAvatarImage} />
                      ) : (
                        <View style={styles.teamAvatarCircle}>
                          <Text style={styles.teamAvatarCircleText}>{memberInitials}</Text>
                        </View>
                      )}
                      <View style={styles.teamCameraOverlay}>
                        <Camera size={12} color="#fff" />
                      </View>
                    </TouchableOpacity>
                    <Text style={styles.accountName} numberOfLines={1}>{member.name}</Text>
                    <Text style={styles.teamBadgeInline}>Hesap {idx + 2}</Text>
                    <TouchableOpacity
                      style={styles.infoButtonTeam}
                      activeOpacity={0.7}
                      onPress={() => router.push({ pathname: '/(driver-tabs)/profile/documents', params: { memberId: member.id } } as any)}
                      testID={`team-info-btn-${idx}`}
                    >
                      <Info size={12} color="#4A90D9" />
                      <Text style={styles.infoButtonTeamText}>Bilgilerim</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              {teamMembers.length === 0 && (
                <TouchableOpacity
                  style={styles.addAccountItem}
                  activeOpacity={0.7}
                  onPress={() => router.push('/(driver-tabs)/profile/team-member')}
                  testID="add-team-btn"
                >
                  <View style={styles.addAvatarCircle}>
                    <UserPlus size={22} color={Colors.light.primary} />
                  </View>
                  <Text style={styles.addAccountLabel}>Ekip Ekle</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.mainInfoArea}>
              <Text style={styles.name}>{driver?.name ?? 'Şoför'}</Text>
              <View style={styles.ratingBadge}>
                <Star size={14} color={Colors.light.primary} fill={Colors.light.primary} />
                <Text style={styles.ratingText}>{driver?.rating ?? 0}</Text>
                <Text style={styles.ratingCount}>({driver?.totalRides ?? 0} yolculuk)</Text>
              </View>
            </View>
          </View>
          <View style={styles.infoSection}>
            <View style={styles.infoRow}>
              <Phone size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{driver?.phone ?? '-'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Mail size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{driver?.email ?? '-'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Car size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{driver?.vehicleModel ?? '-'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <Hash size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{driver?.vehiclePlate ?? '-'}</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoRow}>
              <MapPin size={18} color={Colors.light.textMuted} />
              <Text style={styles.infoText}>{driver?.city ?? '-'}{driver?.district ? ` / ${driver.district}` : ''}</Text>
            </View>
          </View>

          <PhoneNumberEditorCard
            title="Telefon numarasını güncelle"
            subtitle="Yeni numaranız sürücü profilinde, şifre sıfırlamada ve hesap genelinde hemen kullanılır."
            value={phoneDraft}
            onChangeText={setPhoneDraft}
            onSave={handlePhoneSave}
            isSaving={isUpdatingPhone}
            inputTestID="driver-phone-update-input"
            buttonTestID="driver-phone-update-button"
          />

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
  avatarContainer: {
    position: 'relative' as const,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  cameraOverlay: {
    position: 'absolute' as const,
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.light.primary,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.light.card,
  },
  avatarText: { fontSize: 22, fontWeight: '700' as const, color: Colors.light.background },
  name: { fontSize: 20, fontWeight: '700', color: Colors.light.text },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  ratingText: { fontSize: 15, fontWeight: '700', color: Colors.light.primary },
  ratingCount: { fontSize: 13, color: Colors.light.textMuted },
  accountsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 24,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  accountItem: {
    alignItems: 'center',
    width: 90,
  },
  accountName: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.light.text,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  memberBadge: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.light.primary,
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
    overflow: 'hidden',
  },
  teamAvatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(245,166,35,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  teamAvatarImage: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  teamCameraOverlay: {
    position: 'absolute' as const,
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#4A90D9',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.light.card,
  },
  teamAvatarCircleText: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.light.primary,
  },
  teamBadgeInline: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#4A90D9',
    backgroundColor: 'rgba(74,144,217,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 6,
    overflow: 'hidden',
  },
  addAccountItem: {
    alignItems: 'center',
    width: 90,
  },
  addAvatarCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: Colors.light.cardBorder,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  addAccountLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.light.textMuted,
    marginTop: 8,
    textAlign: 'center' as const,
  },
  mainInfoArea: {
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: Colors.light.divider,
    paddingTop: 16,
    marginHorizontal: 16,
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
  infoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    backgroundColor: 'rgba(245,166,35,0.10)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  infoButtonText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.light.primary,
  },
  infoButtonTeam: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    backgroundColor: 'rgba(74,144,217,0.10)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  infoButtonTeamText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: '#4A90D9',
  },

});

