import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Alert, Linking, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Phone, Mail, MessageSquare, ChevronDown, ChevronUp,
  HelpCircle, MapPin, CreditCard, Shield, Car, Star, Clock,
  AlertTriangle, Send, ExternalLink,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { SUPPORT_PHONE_TEL_URL, SUPPORT_WHATSAPP_DISPLAY, SUPPORT_WHATSAPP_URL } from '@/constants/support';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: 'rides',
    question: 'Yolculuk taleplerini nasıl kabul ederim?',
    answer: 'Harita ekranında yeni bir yolculuk talebi geldiğinde bildirim alırsınız. Talebi kabul etmek için "Kabul Et" butonuna tıklayın. Talebi reddetmek için "Reddet" butonunu kullanın. Kabul oranınız performans puanınızı etkiler.',
    icon: Car,
    iconColor: '#2ECC71',
    iconBg: 'rgba(46,204,113,0.1)',
  },
  {
    id: 'earnings',
    question: 'Kazançlarım ne zaman ödenir?',
    answer: 'Kazançlarınız haftalık olarak hesabınıza aktarılır. Günlük, haftalık ve aylık kazanç detaylarınızı "Kazançlarım" bölümünden takip edebilirsiniz. Ödeme günü her haftanın Pazartesi günüdür.',
    icon: CreditCard,
    iconColor: '#F5A623',
    iconBg: 'rgba(245,166,35,0.1)',
  },
  {
    id: 'rating',
    question: 'Puanlama sistemi nasıl çalışır?',
    answer: 'Her yolculuk sonrasında müşteriler sizi 1-5 arası puanlar. Ortalama puanınız 4.0\'ın altına düşerse uyarı alırsınız. Yüksek puan almak için: nazik olun, aracınızı temiz tutun, güvenli sürün ve zamanında varış noktasına ulaşın.',
    icon: Star,
    iconColor: '#E67E22',
    iconBg: 'rgba(230,126,34,0.1)',
  },
  {
    id: 'documents',
    question: 'Belgelerimi nasıl güncellerim?',
    answer: 'Menüden "Belgelerim" bölümüne giderek ehliyet, kimlik kartı, araç ruhsatı ve sabıka kaydı belgelerinizi yükleyebilir veya güncelleyebilirsiniz. Süresi dolan belgeler için otomatik hatırlatma alırsınız.',
    icon: Shield,
    iconColor: '#3498DB',
    iconBg: 'rgba(52,152,219,0.1)',
  },
  {
    id: 'navigation',
    question: 'Navigasyon nasıl kullanılır?',
    answer: 'Yolculuğu kabul ettikten sonra harita üzerinde rota otomatik olarak çizilir. Müşterinin konumuna ve varış noktasına en kısa yolu takip edebilirsiniz. Konum paylaşımı aktif olduğunda müşteri sizi canlı olarak takip edebilir.',
    icon: MapPin,
    iconColor: '#9B59B6',
    iconBg: 'rgba(155,89,182,0.1)',
  },
  {
    id: 'cancel',
    question: 'Yolculuğu iptal edersem ne olur?',
    answer: 'Yolculuğu kabul ettikten sonra iptal etmeniz performans puanınızı olumsuz etkiler. Acil durumlar haricinde iptal etmemeye dikkat edin. İptal politikası detayları için "İptal Politikası" bölümünü inceleyin.',
    icon: AlertTriangle,
    iconColor: '#E74C3C',
    iconBg: 'rgba(231,76,60,0.1)',
  },
  {
    id: 'hours',
    question: 'Çalışma saatlerim nasıl belirlenir?',
    answer: '2GO\'da esnek çalışma saatleri sunulmaktadır. İstediğiniz zaman çevrimiçi olabilir, yolculuk talepleri alabilirsiniz. Yoğun saatlerde (07:00-09:00, 17:00-20:00) daha fazla talep alabilirsiniz.',
    icon: Clock,
    iconColor: '#1ABC9C',
    iconBg: 'rgba(26,188,156,0.1)',
  },
];

const CONTACT_ITEMS = [
  {
    icon: Phone,
    label: 'Telefon Desteği',
    value: SUPPORT_WHATSAPP_DISPLAY,
    color: '#2ECC71',
    bg: 'rgba(46,204,113,0.1)',
    action: SUPPORT_PHONE_TEL_URL,
  },
  {
    icon: Mail,
    label: 'E-posta Desteği',
    value: 'destekforyou2go@gmail.com',
    color: '#3498DB',
    bg: 'rgba(52,152,219,0.1)',
    action: 'mailto:destekforyou2go@gmail.com',
  },
  {
    icon: MessageSquare,
    label: 'WhatsApp Destek',
    value: SUPPORT_WHATSAPP_DISPLAY,
    color: '#25D366',
    bg: 'rgba(37,211,102,0.1)',
    action: SUPPORT_WHATSAPP_URL,
  },
];

export default function DriverHelpScreen() {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);

  const toggleFAQ = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handleContact = useCallback((action: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (Platform.OS === 'web') {
      window.open(action, '_blank');
    } else {
      Linking.openURL(action).catch(() => {
        Alert.alert('Hata', 'Bu işlem şu anda gerçekleştirilemiyor.');
      });
    }
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!message.trim()) {
      Alert.alert('Uyarı', 'Lütfen mesajınızı yazın.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setMessage('');
      Alert.alert(
        'Mesaj Gönderildi',
        'Destek ekibimiz en kısa sürede size dönüş yapacaktır. Teşekkür ederiz!',
      );
    }, 1500);
  }, [message]);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.6}
            testID="help-back"
          >
            <ArrowLeft size={24} color="#1A1A1A" strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Yardım & Destek</Text>
          <View style={styles.backBtn} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.heroSection}>
            <View style={styles.heroIconWrap}>
              <HelpCircle size={32} color="#FFF" strokeWidth={2} />
            </View>
            <Text style={styles.heroTitle}>Size nasıl yardımcı olabiliriz?</Text>
            <Text style={styles.heroDesc}>
              Sıkça sorulan sorular veya destek ekibimiz ile iletişime geçin
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Sıkça Sorulan Sorular</Text>
            {FAQ_ITEMS.map((item) => {
              const isExpanded = expandedId === item.id;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.faqItem, isExpanded && styles.faqItemExpanded]}
                  onPress={() => toggleFAQ(item.id)}
                  activeOpacity={0.7}
                  testID={`faq-${item.id}`}
                >
                  <View style={styles.faqHeader}>
                    <View style={[styles.faqIconWrap, { backgroundColor: item.iconBg }]}>
                      <item.icon size={18} color={item.iconColor} strokeWidth={2} />
                    </View>
                    <Text style={styles.faqQuestion}>{item.question}</Text>
                    {isExpanded ? (
                      <ChevronUp size={20} color="#888" strokeWidth={2} />
                    ) : (
                      <ChevronDown size={20} color="#888" strokeWidth={2} />
                    )}
                  </View>
                  {isExpanded && (
                    <Text style={styles.faqAnswer}>{item.answer}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bize Ulaşın</Text>
            {CONTACT_ITEMS.map((item, index) => (
              <TouchableOpacity
                key={index}
                style={styles.contactItem}
                onPress={() => handleContact(item.action)}
                activeOpacity={0.6}
                testID={`contact-${index}`}
              >
                <View style={[styles.contactIconWrap, { backgroundColor: item.bg }]}>
                  <item.icon size={20} color={item.color} strokeWidth={2} />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactLabel}>{item.label}</Text>
                  <Text style={styles.contactValue}>{item.value}</Text>
                </View>
                <ExternalLink size={18} color="#CCC" strokeWidth={2} />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mesaj Gönderin</Text>
            <View style={styles.messageCard}>
              <Text style={styles.messageHint}>
                Sorununuzu detaylı bir şekilde açıklayın, size en kısa sürede dönüş yapacağız.
              </Text>
              <TextInput
                style={styles.messageInput}
                placeholder="Mesajınızı buraya yazın..."
                placeholderTextColor="#AAA"
                multiline
                numberOfLines={4}
                value={message}
                onChangeText={setMessage}
                textAlignVertical="top"
                testID="help-message-input"
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled]}
                onPress={handleSendMessage}
                activeOpacity={0.7}
                disabled={!message.trim() || sending}
                testID="help-send-btn"
              >
                <Send size={18} color="#FFF" strokeWidth={2} />
                <Text style={styles.sendBtnText}>
                  {sending ? 'Gönderiliyor...' : 'Gönder'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>


          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Destek Saatleri</Text>
            <Text style={styles.infoText}>Pazartesi - Cumartesi: 08:00 - 22:00</Text>
            <Text style={styles.infoText}>Pazar: 10:00 - 18:00</Text>
            <Text style={styles.infoNote}>
              Acil durumlar için 7/24 telefon desteği mevcuttur.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    letterSpacing: -0.3,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  heroSection: {
    alignItems: 'center' as const,
    paddingVertical: 28,
    paddingHorizontal: 24,
    backgroundColor: '#FFF',
    marginBottom: 8,
  },
  heroIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1A5C2E',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 14,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: '#1A1A1A',
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  heroDesc: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A1A',
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  faqItem: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  faqItemExpanded: {
    borderColor: '#1A5C2E20',
    backgroundColor: '#FAFFFE',
  },
  faqHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  faqIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: 12,
  },
  faqQuestion: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1A1A1A',
    lineHeight: 20,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#666',
    lineHeight: 21,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingLeft: 48,
  },
  contactItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  contactIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginRight: 14,
  },
  contactInfo: {
    flex: 1,
  },
  contactLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: '#1A1A1A',
    marginBottom: 2,
  },
  contactValue: {
    fontSize: 13,
    color: '#888',
  },
  messageCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  messageHint: {
    fontSize: 13,
    color: '#888',
    marginBottom: 12,
    lineHeight: 18,
  },
  messageInput: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: '#1A1A1A',
    minHeight: 100,
    borderWidth: 1,
    borderColor: '#ECECEC',
    marginBottom: 14,
  },
  sendBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: '#1A5C2E',
    paddingVertical: 14,
    borderRadius: 12,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  infoCard: {
    marginHorizontal: 20,
    marginTop: 24,
    backgroundColor: '#1A1A2E',
    borderRadius: 14,
    padding: 18,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 14,
    color: '#CCC',
    marginBottom: 4,
  },
  infoNote: {
    fontSize: 13,
    color: '#2ECC71',
    marginTop: 10,
    fontWeight: '600' as const,
  },

});
