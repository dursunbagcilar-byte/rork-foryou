import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Animated,
  Platform,
  Share,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { X, Phone, ChevronDown, Copy, Share2, Gift, Users, Ticket } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { trpc } from '@/lib/trpc';

export default function InviteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const scaleAnim = useRef(new Animated.Value(0.95)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const referralQuery = trpc.auth.getReferralInfo.useQuery(
    { userId: user?.id ?? '' },
    { enabled: !!user?.id }
  );

  const referralCode = referralQuery.data?.referralCode || (user as any)?.referralCode || '---';
  const freeRidesRemaining = referralQuery.data?.freeRidesRemaining ?? (user as any)?.freeRidesRemaining ?? 0;
  const referralsList = referralQuery.data?.referrals ?? [];

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 6,
        tension: 40,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleInvite = async () => {
    if (!phoneNumber || phoneNumber.length < 10) {
      Alert.alert('Hata', 'Lütfen geçerli bir telefon numarası girin.');
      return;
    }
    try {
      await Share.share({
        message: `Foryou 2Go'ya katıl, ikimiz de 2 ücretsiz sürüş kazanalım! 🚗\n\nDavet kodum: ${referralCode}\n\nKayıt olurken bu kodu gir, ikimiz de 2 ücretsiz sürüş hakkı kazanalım!`,
      });
    } catch (e) {
      console.log('[Invite] Share error:', e);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Foryou 2Go'ya katıl, ikimiz de 2 ücretsiz sürüş kazanalım! 🚗\n\nDavet kodum: ${referralCode}\n\nKayıt olurken bu kodu gir, ikimiz de 2 ücretsiz sürüş hakkı kazanalım!`,
      });
    } catch (e) {
      console.log('[Invite] Share error:', e);
    }
  };

  const handleCopyCode = () => {
    Alert.alert('Kopyalandı!', `Davet kodunuz: ${referralCode}`);
  };

  const isButtonActive = phoneNumber.length >= 10;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <TouchableOpacity
        style={[styles.closeBtn, { top: insets.top + 8 }]}
        onPress={() => router.back()}
        activeOpacity={0.7}
        testID="invite-close-btn"
      >
        <X size={22} color="#333" />
      </TouchableOpacity>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View style={[styles.bannerContainer, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
            <View style={styles.banner}>
              <View style={styles.confettiRow}>
                {['🎊', '🎉', '✨', '🎈', '🎊', '✨', '🎉'].map((emoji, i) => (
                  <Text key={i} style={[styles.confettiEmoji, { fontSize: 18 + (i % 3) * 4 }]}>{emoji}</Text>
                ))}
              </View>
              <View style={styles.bannerIconRow}>
                <Text style={styles.carEmoji}>🚗</Text>
                <View style={styles.peopleRow}>
                  <Text style={styles.personEmoji}>🧑</Text>
                  <Text style={styles.personEmoji}>👩</Text>
                </View>
              </View>
              <View style={styles.confettiRow}>
                {['✨', '🎈', '🎊', '🎉', '✨', '🎊', '🎈'].map((emoji, i) => (
                  <Text key={i} style={[styles.confettiEmoji, { fontSize: 16 + (i % 3) * 3 }]}>{emoji}</Text>
                ))}
              </View>
            </View>
          </Animated.View>

          <View style={styles.contentSection}>
            <Text style={styles.title}>
              Arkadaşını Foryou'ya Davet Et,{'\n'}Ücretsiz 2 Sürüş Kazan!
            </Text>

            <View style={styles.divider} />

            <Text style={styles.description}>
              Arkadaşın kayıt olurken senin davet kodunu girdiğinde, ikinizin de hesabına 2 ücretsiz sürüş hakkı tanımlanır.
            </Text>

            {freeRidesRemaining > 0 && (
              <View style={styles.freeRidesBadge}>
                <Ticket size={20} color="#1B9E5A" />
                <Text style={styles.freeRidesText}>
                  {freeRidesRemaining} ücretsiz sürüş hakkınız var!
                </Text>
              </View>
            )}

            {referralsList.length > 0 && (
              <View style={styles.referralsCard}>
                <View style={styles.referralsHeader}>
                  <Users size={18} color={Colors.dark.primary} />
                  <Text style={styles.referralsTitle}>Davet Ettikleriniz ({referralsList.length})</Text>
                </View>
                {referralsList.map((r) => (
                  <View key={r.id} style={styles.referralItem}>
                    <Text style={styles.referralName}>{r.referredName}</Text>
                    <Text style={styles.referralReward}>+2 sürüş</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.phoneInputContainer}>
              <View style={styles.countryCode}>
                <Text style={styles.flagText}>🇹🇷</Text>
                <Text style={styles.codeText}>+90</Text>
                <ChevronDown size={14} color={Colors.dark.textMuted} />
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="Telefon Numarası"
                placeholderTextColor="#999999"
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                keyboardType="phone-pad"
                maxLength={11}
                testID="invite-phone-input"
              />
            </View>

            <View style={styles.orDivider}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>veya</Text>
              <View style={styles.orLine} />
            </View>

            <View style={styles.codeSection}>
              <Text style={styles.codeSectionLabel}>Senin Davet Kodun</Text>
              <TouchableOpacity style={styles.codeBox} onPress={handleCopyCode} activeOpacity={0.7}>
                {referralQuery.isLoading ? (
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                ) : (
                  <Text style={styles.codeValue}>{referralCode}</Text>
                )}
                <Copy size={18} color={Colors.dark.primary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.shareRow} onPress={handleShare} activeOpacity={0.7}>
              <Share2 size={18} color={Colors.dark.primary} />
              <Text style={styles.shareText}>Bağlantıyı Paylaş</Text>
            </TouchableOpacity>

            <View style={styles.howItWorks}>
              <Text style={styles.howTitle}>Nasıl Çalışır?</Text>
              <View style={styles.stepRow}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>1</Text></View>
                <Text style={styles.stepText}>Davet kodunu arkadaşınla paylaş</Text>
              </View>
              <View style={styles.stepRow}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>2</Text></View>
                <Text style={styles.stepText}>Arkadaşın kayıt olurken kodunu girsin</Text>
              </View>
              <View style={styles.stepRow}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>3</Text></View>
                <Text style={styles.stepText}>İkiniz de 2 ücretsiz sürüş kazanın!</Text>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={[styles.bottomArea, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <TouchableOpacity
            style={[styles.inviteButton, !isButtonActive && styles.inviteButtonDisabled]}
            onPress={handleInvite}
            activeOpacity={0.8}
            disabled={!isButtonActive}
            testID="invite-send-btn"
          >
            <Text style={[styles.inviteButtonText, !isButtonActive && styles.inviteButtonTextDisabled]}>
              Arkadaşını Davet Et
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  closeBtn: {
    position: 'absolute' as const,
    left: 16,
    zIndex: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  bannerContainer: {
    marginTop: 12,
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden' as const,
  },
  banner: {
    backgroundColor: '#1B9E5A',
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 20,
  },
  confettiRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-around' as const,
    width: '100%',
    marginVertical: 2,
  },
  confettiEmoji: {
    opacity: 0.85,
  },
  bannerIconRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginVertical: 10,
    gap: 14,
  },
  carEmoji: {
    fontSize: 64,
  },
  peopleRow: {
    flexDirection: 'row' as const,
    gap: 4,
  },
  personEmoji: {
    fontSize: 52,
  },
  contentSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#1A1A1A',
    lineHeight: 30,
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E5E5',
    marginVertical: 16,
  },
  description: {
    fontSize: 15,
    color: '#666666',
    lineHeight: 22,
    marginBottom: 18,
  },
  freeRidesBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: 'rgba(27,158,90,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(27,158,90,0.2)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  freeRidesText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1B9E5A',
  },
  referralsCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#EFEFEF',
  },
  referralsHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 10,
  },
  referralsTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: '#1A1A1A',
  },
  referralItem: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#EFEFEF',
  },
  referralName: {
    fontSize: 14,
    color: '#444',
    fontWeight: '500' as const,
  },
  referralReward: {
    fontSize: 13,
    color: '#1B9E5A',
    fontWeight: '600' as const,
  },
  phoneInputContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 14,
    overflow: 'hidden' as const,
    marginBottom: 14,
  },
  countryCode: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
  },
  flagText: {
    fontSize: 18,
  },
  codeText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1A1A1A',
  },
  phoneInput: {
    flex: 1,
    fontSize: 15,
    color: '#1A1A1A',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  orDivider: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginVertical: 12,
    gap: 12,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E5E5',
  },
  orText: {
    fontSize: 13,
    color: '#999999',
  },
  codeSection: {
    marginTop: 8,
    marginBottom: 14,
  },
  codeSectionLabel: {
    fontSize: 13,
    color: '#999999',
    marginBottom: 8,
    fontWeight: '500' as const,
  },
  codeBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  codeValue: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    letterSpacing: 2,
  },
  shareRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    paddingVertical: 12,
  },
  shareText: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.dark.primary,
  },
  howItWorks: {
    marginTop: 16,
    backgroundColor: '#FAFAFA',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  howTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    marginBottom: 14,
  },
  stepRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    marginBottom: 10,
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  stepNumberText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  stepText: {
    fontSize: 14,
    color: '#555',
    flex: 1,
  },
  bottomArea: {
    paddingHorizontal: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    backgroundColor: '#FFFFFF',
  },
  inviteButton: {
    backgroundColor: Colors.dark.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  inviteButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  inviteButtonText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  inviteButtonTextDisabled: {
    color: '#999999',
  },
});
