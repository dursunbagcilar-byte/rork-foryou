import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Car,
  Hash,
  Palette,
  FileText,
  Calendar,
  Fuel,
  Settings,
  Save,
  CircleCheck as CheckCircle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import type { Driver } from '@/constants/mockData';

interface VehicleField {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  placeholder: string;
  editable: boolean;
}

export default function VehicleInfoScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const driver = user as Driver | null;

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [vehicleModel, setVehicleModel] = useState<string>(driver?.vehicleModel ?? '');
  const [vehiclePlate, setVehiclePlate] = useState<string>(driver?.vehiclePlate ?? '');
  const [vehicleColor, setVehicleColor] = useState<string>(driver?.vehicleColor ?? '');
  const [vehicleYear, setVehicleYear] = useState<string>('2022');
  const [vehicleFuel, setVehicleFuel] = useState<string>('Benzin + LPG');
  const [insuranceDate, setInsuranceDate] = useState<string>('15.08.2026');
  const [inspectionDate, setInspectionDate] = useState<string>('22.03.2026');

  const FIELDS: VehicleField[] = [
    { key: 'model', label: 'Araç Modeli', icon: Car, color: Colors.light.primary, iconBg: 'rgba(245,166,35,0.12)', placeholder: 'Ör: Toyota Corolla', editable: true },
    { key: 'plate', label: 'Plaka', icon: Hash, color: '#3498DB', iconBg: 'rgba(52,152,219,0.12)', placeholder: 'Ör: 34 ABC 123', editable: true },
    { key: 'color', label: 'Renk', icon: Palette, color: Colors.light.secondary, iconBg: 'rgba(255,107,53,0.12)', placeholder: 'Ör: Beyaz', editable: true },
    { key: 'year', label: 'Model Yılı', icon: Calendar, color: Colors.light.success, iconBg: 'rgba(46,204,113,0.12)', placeholder: 'Ör: 2022', editable: true },
    { key: 'fuel', label: 'Yakıt Tipi', icon: Fuel, color: '#9B59B6', iconBg: 'rgba(155,89,182,0.12)', placeholder: 'Ör: Benzin + LPG', editable: true },
  ];

  const getFieldValue = (key: string): string => {
    switch (key) {
      case 'model': return vehicleModel;
      case 'plate': return vehiclePlate;
      case 'color': return vehicleColor;
      case 'year': return vehicleYear;
      case 'fuel': return vehicleFuel;
      default: return '';
    }
  };

  const setFieldValue = (key: string, val: string) => {
    switch (key) {
      case 'model': setVehicleModel(val); break;
      case 'plate': setVehiclePlate(val); break;
      case 'color': setVehicleColor(val); break;
      case 'year': setVehicleYear(val); break;
      case 'fuel': setVehicleFuel(val); break;
    }
  };

  const handleSave = useCallback(() => {
    if (!vehicleModel.trim() || !vehiclePlate.trim()) {
      Alert.alert('Hata', 'Araç modeli ve plaka zorunludur.');
      return;
    }
    Alert.alert('Başarılı', 'Araç bilgileriniz güncellendi.');
    setIsEditing(false);
  }, [vehicleModel, vehiclePlate]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.push('/driver-menu' as any)} style={styles.backBtn} activeOpacity={0.7}>
            <ArrowLeft size={22} color={Colors.light.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Araç Bilgileri</Text>
          <TouchableOpacity
            onPress={() => isEditing ? handleSave() : setIsEditing(true)}
            style={[styles.backBtn, isEditing && styles.editActiveBtn]}
            activeOpacity={0.7}
          >
            {isEditing ? <Save size={20} color={Colors.light.primary} /> : <Settings size={20} color={Colors.light.textMuted} />}
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          <View style={styles.vehicleBanner}>
            <View style={styles.vehicleIconWrap}>
              <Car size={32} color={Colors.light.primary} />
            </View>
            <Text style={styles.vehicleName}>{vehicleModel || 'Araç Bilgisi Yok'}</Text>
            <Text style={styles.vehiclePlateText}>{vehiclePlate || '-'}</Text>
            {vehicleColor ? (
              <View style={styles.colorBadge}>
                <View style={[styles.colorDot, { backgroundColor: getColorHex(vehicleColor) }]} />
                <Text style={styles.colorText}>{vehicleColor}</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>Araç Detayları</Text>
          <View style={styles.card}>
            {FIELDS.map((field, idx) => (
              <View key={field.key}>
                {idx > 0 ? <View style={styles.divider} /> : null}
                <View style={styles.fieldRow}>
                  <View style={[styles.fieldIcon, { backgroundColor: field.iconBg }]}>
                    <field.icon size={18} color={field.color} />
                  </View>
                  <View style={styles.fieldContent}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    {isEditing ? (
                      <TextInput
                        style={styles.fieldInput}
                        value={getFieldValue(field.key)}
                        onChangeText={(val) => setFieldValue(field.key, val)}
                        placeholder={field.placeholder}
                        placeholderTextColor={Colors.light.textMuted}
                      />
                    ) : (
                      <Text style={styles.fieldValue}>{getFieldValue(field.key) || '-'}</Text>
                    )}
                  </View>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Belge Bilgileri</Text>
          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <View style={[styles.fieldIcon, { backgroundColor: 'rgba(46,204,113,0.12)' }]}>
                <FileText size={18} color={Colors.light.success} />
              </View>
              <View style={styles.fieldContent}>
                <Text style={styles.fieldLabel}>Sigorta Bitiş Tarihi</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.fieldInput}
                    value={insuranceDate}
                    onChangeText={setInsuranceDate}
                    placeholder="GG.AA.YYYY"
                    placeholderTextColor={Colors.light.textMuted}
                  />
                ) : (
                  <View style={styles.dateRow}>
                    <Text style={styles.fieldValue}>{insuranceDate}</Text>
                    <View style={styles.statusBadge}>
                      <CheckCircle size={12} color={Colors.light.success} />
                      <Text style={styles.statusText}>Geçerli</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <View style={[styles.fieldIcon, { backgroundColor: 'rgba(52,152,219,0.12)' }]}>
                <FileText size={18} color="#3498DB" />
              </View>
              <View style={styles.fieldContent}>
                <Text style={styles.fieldLabel}>Muayene Bitiş Tarihi</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.fieldInput}
                    value={inspectionDate}
                    onChangeText={setInspectionDate}
                    placeholder="GG.AA.YYYY"
                    placeholderTextColor={Colors.light.textMuted}
                  />
                ) : (
                  <View style={styles.dateRow}>
                    <Text style={styles.fieldValue}>{inspectionDate}</Text>
                    <View style={styles.statusBadge}>
                      <CheckCircle size={12} color={Colors.light.success} />
                      <Text style={styles.statusText}>Geçerli</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          </View>

          {isEditing ? (
            <View style={styles.actionBtns}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setIsEditing(false);
                  setVehicleModel(driver?.vehicleModel ?? '');
                  setVehiclePlate(driver?.vehiclePlate ?? '');
                  setVehicleColor(driver?.vehicleColor ?? '');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleSave} activeOpacity={0.8}>
                <Save size={18} color={Colors.light.background} />
                <Text style={styles.saveButtonText}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function getColorHex(colorName: string): string {
  const map: Record<string, string> = {
    'Beyaz': '#FFFFFF',
    'Siyah': '#1A1A2E',
    'Gri': '#7F8C8D',
    'Kırmızı': '#E74C3C',
    'Mavi': '#3498DB',
    'Lacivert': '#2C3E50',
    'Gümüş': '#BDC3C7',
    'Yeşil': '#2ECC71',
  };
  return map[colorName] ?? Colors.light.textMuted;
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
  editActiveBtn: { borderWidth: 1, borderColor: Colors.light.primary },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.light.text },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 30 },
  vehicleBanner: {
    alignItems: 'center',
    paddingVertical: 28,
    marginBottom: 8,
  },
  vehicleIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  vehicleName: { fontSize: 20, fontWeight: '700' as const, color: Colors.light.text, marginBottom: 4 },
  vehiclePlateText: { fontSize: 16, fontWeight: '600' as const, color: Colors.light.primary, letterSpacing: 1 },
  colorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: Colors.light.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
  },
  colorDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  colorText: { fontSize: 13, fontWeight: '500' as const, color: Colors.light.textSecondary },
  sectionTitle: { fontSize: 14, fontWeight: '700' as const, color: Colors.light.textSecondary, marginTop: 20, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  card: {
    backgroundColor: Colors.light.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.light.cardBorder,
    overflow: 'hidden',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fieldIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  fieldContent: { flex: 1 },
  fieldLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.light.textMuted, marginBottom: 4 },
  fieldValue: { fontSize: 15, fontWeight: '500' as const, color: Colors.light.text },
  fieldInput: {
    height: 38,
    backgroundColor: Colors.light.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.light.inputBorder,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Colors.light.text,
  },
  dateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(46,204,113,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: '600' as const, color: Colors.light.success },
  divider: { height: 1, backgroundColor: Colors.light.divider, marginLeft: 16 },
  actionBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.light.inputBorder,
    alignItems: 'center',
  },
  cancelButtonText: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.textSecondary },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: Colors.light.primary,
  },
  saveButtonText: { fontSize: 15, fontWeight: '600' as const, color: Colors.light.background },
});
