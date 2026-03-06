import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  Modal, Pressable, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Camera, X, FileText, CheckCircle2, AlertCircle, Phone, Mail, Car, Hash, MapPin, User } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import type { Driver, DriverDocuments } from '@/constants/mockData';

interface DocItem {
  key: keyof DriverDocuments;
  label: string;
}

const DOC_SECTIONS: { title: string; icon: string; items: DocItem[] }[] = [
  {
    title: 'Ehliyet (Sürücü Belgesi)',
    icon: 'license',
    items: [
      { key: 'licenseFront', label: 'Ön Yüz' },
      { key: 'licenseBack', label: 'Arka Yüz' },
    ],
  },
  {
    title: 'Kimlik Kartı',
    icon: 'id',
    items: [
      { key: 'idCardFront', label: 'Ön Yüz' },
      { key: 'idCardBack', label: 'Arka Yüz' },
    ],
  },
  {
    title: 'Araç Ruhsatı',
    icon: 'registration',
    items: [
      { key: 'registrationFront', label: 'Ön Yüz' },
      { key: 'registrationBack', label: 'Arka Yüz' },
    ],
  },
  {
    title: 'Sabıka Kaydı',
    icon: 'criminal',
    items: [
      { key: 'criminalRecord', label: 'Sabıka Kaydı' },
    ],
  },
  {
    title: 'Vergi Levhası',
    icon: 'tax',
    items: [
      { key: 'taxCertificate', label: 'Vergi Levhası' },
    ],
  },
];

export default function DriverDocumentsScreen() {
  const { user, driverDocuments, updateDriverDocument, teamMembers } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ memberId?: string }>();
  const [viewImage, setViewImage] = useState<string>('');

  const driver = user as Driver | null;
  const isTeamMember = !!params.memberId;
  const teamMember = isTeamMember
    ? teamMembers.find(m => m.id === params.memberId) ?? null
    : null;

  const displayName = isTeamMember ? (teamMember?.name ?? 'Ekip Üyesi') : (driver?.name ?? 'Şoför');
  const displayPhone = isTeamMember ? (teamMember?.phone ?? '-') : (driver?.phone ?? '-');
  const displayEmail = isTeamMember ? (teamMember?.email ?? '-') : (driver?.email ?? '-');

  const pickImage = useCallback(async (field: keyof DriverDocuments) => {
    if (Platform.OS === 'web') {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.8,
          allowsEditing: true,
        });
        if (!result.canceled && result.assets && result.assets[0]) {
          await updateDriverDocument(field, result.assets[0].uri);
          console.log('Document updated (web):', field);
        }
      } catch (e) {
        console.log('Image picker error:', e);
      }
      return;
    }

    Alert.alert(
      'Belge Güncelle',
      'Nasıl yüklemek istersiniz?',
      [
        {
          text: 'Kamera',
          onPress: async () => {
            try {
              const { status } = await ImagePicker.requestCameraPermissionsAsync();
              if (status !== 'granted') {
                Alert.alert('İzin Gerekli', 'Kamera izni verilmedi');
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                quality: 0.8,
                allowsEditing: true,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                await updateDriverDocument(field, result.assets[0].uri);
                console.log('Document updated (camera):', field);
              }
            } catch (e) {
              console.log('Camera error:', e);
            }
          },
        },
        {
          text: 'Galeri',
          onPress: async () => {
            try {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.8,
                allowsEditing: true,
              });
              if (!result.canceled && result.assets && result.assets[0]) {
                await updateDriverDocument(field, result.assets[0].uri);
                console.log('Document updated (gallery):', field);
              }
            } catch (e) {
              console.log('Gallery error:', e);
            }
          },
        },
        { text: 'İptal', style: 'cancel' },
      ]
    );
  }, [updateDriverDocument]);

  const totalDocs = DOC_SECTIONS.reduce((acc, s) => acc + s.items.length, 0);
  const uploadedDocs = DOC_SECTIONS.reduce((acc, s) => {
    return acc + s.items.filter(i => !!driverDocuments[i.key]).length;
  }, 0);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.push('/driver-menu' as any)}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>

          <View style={styles.headerRow}>
            <View style={[styles.headerIcon, isTeamMember && styles.headerIconTeam]}>
              <User size={20} color={isTeamMember ? '#4A90D9' : Colors.light.primary} />
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.title}>Bilgilerim</Text>
              <Text style={styles.subtitle}>
                {isTeamMember ? `${displayName} - Hesap Bilgileri` : 'Kişisel bilgileriniz ve belgeleriniz'}
              </Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <Text style={styles.sectionLabel}>Kişisel Bilgiler</Text>
            <View style={styles.infoRow}>
              <View style={[styles.infoIconWrap, isTeamMember && styles.infoIconWrapTeam]}>
                <User size={16} color={isTeamMember ? '#4A90D9' : Colors.light.primary} />
              </View>
              <View style={styles.infoTextWrap}>
                <Text style={styles.infoLabel}>İsim</Text>
                <Text style={styles.infoValue}>{displayName}</Text>
              </View>
            </View>
            <View style={styles.infoSep} />
            <View style={styles.infoRow}>
              <View style={[styles.infoIconWrap, isTeamMember && styles.infoIconWrapTeam]}>
                <Phone size={16} color={isTeamMember ? '#4A90D9' : Colors.light.primary} />
              </View>
              <View style={styles.infoTextWrap}>
                <Text style={styles.infoLabel}>Telefon</Text>
                <Text style={styles.infoValue}>{displayPhone}</Text>
              </View>
            </View>
            <View style={styles.infoSep} />
            <View style={styles.infoRow}>
              <View style={[styles.infoIconWrap, isTeamMember && styles.infoIconWrapTeam]}>
                <Mail size={16} color={isTeamMember ? '#4A90D9' : Colors.light.primary} />
              </View>
              <View style={styles.infoTextWrap}>
                <Text style={styles.infoLabel}>E-posta</Text>
                <Text style={styles.infoValue}>{displayEmail}</Text>
              </View>
            </View>

            {!isTeamMember && (
              <>
                <View style={styles.infoSep} />
                <View style={styles.infoRow}>
                  <View style={styles.infoIconWrap}>
                    <Car size={16} color={Colors.light.primary} />
                  </View>
                  <View style={styles.infoTextWrap}>
                    <Text style={styles.infoLabel}>Araç</Text>
                    <Text style={styles.infoValue}>{driver?.vehicleModel ?? '-'}</Text>
                  </View>
                </View>
                <View style={styles.infoSep} />
                <View style={styles.infoRow}>
                  <View style={styles.infoIconWrap}>
                    <Hash size={16} color={Colors.light.primary} />
                  </View>
                  <View style={styles.infoTextWrap}>
                    <Text style={styles.infoLabel}>Plaka</Text>
                    <Text style={styles.infoValue}>{driver?.vehiclePlate ?? '-'}</Text>
                  </View>
                </View>
                <View style={styles.infoSep} />
                <View style={styles.infoRow}>
                  <View style={styles.infoIconWrap}>
                    <MapPin size={16} color={Colors.light.primary} />
                  </View>
                  <View style={styles.infoTextWrap}>
                    <Text style={styles.infoLabel}>Konum</Text>
                    <Text style={styles.infoValue}>
                      {driver?.city ?? '-'}{driver?.district ? ` / ${driver.district}` : ''}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </View>

          <View style={styles.docDivider}>
            <View style={styles.docDividerLine} />
            <View style={styles.docDividerBadge}>
              <FileText size={14} color={Colors.light.primary} />
              <Text style={styles.docDividerText}>Belgelerim</Text>
            </View>
            <View style={styles.docDividerLine} />
          </View>

          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              {uploadedDocs === totalDocs ? (
                <CheckCircle2 size={18} color={Colors.light.success} />
              ) : (
                <AlertCircle size={18} color={Colors.light.warning} />
              )}
              <Text style={styles.statusText}>
                {uploadedDocs}/{totalDocs} belge yüklendi
              </Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${(uploadedDocs / totalDocs) * 100}%` }]} />
            </View>
          </View>

          {DOC_SECTIONS.map((section) => {
            const sectionUploaded = section.items.filter(i => !!driverDocuments[i.key]).length;
            return (
              <View key={section.title} style={styles.docCard}>
                <View style={styles.docCardHeader}>
                  <Text style={styles.docCardTitle}>{section.title}</Text>
                  <Text style={[
                    styles.docCardStatus,
                    sectionUploaded === section.items.length ? styles.docCardStatusComplete : styles.docCardStatusIncomplete,
                  ]}>
                    {sectionUploaded === section.items.length ? 'Tamamlandı' : `${sectionUploaded}/${section.items.length}`}
                  </Text>
                </View>
                <View style={styles.docCardRow}>
                  {section.items.map((item) => {
                    const uri = driverDocuments[item.key];
                    return (
                      <View key={item.key} style={styles.docCardItem}>
                        {uri ? (
                          <TouchableOpacity
                            style={styles.docImageWrap}
                            onPress={() => setViewImage(uri)}
                            activeOpacity={0.8}
                          >
                            <Image source={{ uri }} style={styles.docImg} resizeMode="cover" />
                            <View style={styles.docImgOverlay}>
                              <Text style={styles.docImgLabel}>{item.label}</Text>
                            </View>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.docEmptyWrap}>
                            <Camera size={20} color={Colors.light.textMuted} />
                            <Text style={styles.docEmptyText}>{item.label}</Text>
                            <Text style={styles.docEmptySubtext}>Yüklenmedi</Text>
                          </View>
                        )}
                        <TouchableOpacity
                          style={styles.docUpdateBtn}
                          onPress={() => pickImage(item.key)}
                          activeOpacity={0.7}
                        >
                          <Camera size={14} color={Colors.light.primary} />
                          <Text style={styles.docUpdateText}>{uri ? 'Güncelle' : 'Yükle'}</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <Modal visible={!!viewImage} animationType="fade" transparent>
        <Pressable style={styles.viewOverlay} onPress={() => setViewImage('')}>
          <SafeAreaView style={styles.viewSafe}>
            <TouchableOpacity style={styles.viewCloseBtn} onPress={() => setViewImage('')}>
              <X size={24} color="#FFF" />
            </TouchableOpacity>
            {!!viewImage && (
              <Image source={{ uri: viewImage }} style={styles.viewImage} resizeMode="contain" />
            )}
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.light.background },
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  backButton: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: Colors.light.card,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 20, marginTop: 8,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  headerIcon: {
    width: 48, height: 48, borderRadius: 16,
    backgroundColor: 'rgba(245,166,35,0.12)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerIconTeam: {
    backgroundColor: 'rgba(74,144,217,0.12)',
  },
  headerInfo: { flex: 1 },
  title: { fontSize: 24, fontWeight: '800' as const, color: Colors.light.text },
  subtitle: { fontSize: 13, color: Colors.light.textMuted, marginTop: 2 },
  infoCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  infoIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoIconWrapTeam: {
    backgroundColor: 'rgba(74,144,217,0.10)',
  },
  infoTextWrap: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.light.textMuted,
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.light.text,
  },
  infoSep: {
    height: 1,
    backgroundColor: Colors.light.divider,
    marginLeft: 46,
  },
  docDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 10,
  },
  docDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.light.divider,
  },
  docDividerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,166,35,0.10)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
  },
  docDividerText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.light.primary,
  },
  statusCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 20,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusText: { fontSize: 14, fontWeight: '600' as const, color: Colors.light.text },
  progressBar: {
    height: 6,
    backgroundColor: Colors.light.divider,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.light.success,
    borderRadius: 3,
  },
  docCard: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    padding: 16,
    marginBottom: 16,
  },
  docCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  docCardTitle: { fontSize: 15, fontWeight: '700' as const, color: Colors.light.text },
  docCardStatus: {
    fontSize: 12,
    fontWeight: '600' as const,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    overflow: 'hidden',
  },
  docCardStatusComplete: {
    color: Colors.light.success,
    backgroundColor: 'rgba(46,204,113,0.12)',
  },
  docCardStatusIncomplete: {
    color: Colors.light.warning,
    backgroundColor: 'rgba(243,156,18,0.12)',
  },
  docCardRow: { flexDirection: 'row', gap: 12 },
  docCardItem: { flex: 1, gap: 8 },
  docImageWrap: {
    height: 100,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  docImg: { width: '100%', height: '100%' },
  docImgOverlay: {
    position: 'absolute' as const,
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingVertical: 4,
    alignItems: 'center',
  },
  docImgLabel: { fontSize: 11, fontWeight: '600' as const, color: '#FFF' },
  docEmptyWrap: {
    height: 100,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.light.inputBorder,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.light.surface,
    gap: 4,
  },
  docEmptyText: { fontSize: 12, fontWeight: '500' as const, color: Colors.light.textMuted },
  docEmptySubtext: { fontSize: 10, color: Colors.light.textMuted },
  docUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  docUpdateText: { fontSize: 12, fontWeight: '600' as const, color: Colors.light.primary },
  viewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewSafe: { flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' },
  viewCloseBtn: {
    position: 'absolute' as const,
    top: 16, right: 16,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
    zIndex: 10,
  },
  viewImage: { width: '90%', height: '70%' },
});
