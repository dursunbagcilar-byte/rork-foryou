import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Animated,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Send, Bot, User, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useRorkAgent, createRorkTool } from '@rork-ai/toolkit-sdk';
import { z } from 'zod';
import { calculatePrice, PRICING } from '@/constants/pricing';
import { getGoogleMapsApiKey, getDirectionsApiUrl } from '@/utils/maps';
import { keyboardAvoidingBehavior, keyboardVerticalOffset } from '@/utils/platform';

const QUICK_PROMPTS_CUSTOMER = [
  'En yakın restoran nerede?',
  'Havaalanına ne kadar sürer?',
  'Fiyat tahmini yap',
  'Güvenli yolculuk ipuçları',
];

const QUICK_PROMPTS_DRIVER = [
  'Bugün en yoğun bölgeler?',
  'Kazancımı nasıl artırırım?',
  'Yakıt tasarrufu ipuçları',
  'En iyi sürüş rotası öner',
];

const MAX_AI_CHAT_MESSAGES = 24;
const WELCOME_MESSAGE_ID = 'welcome';

interface ChatBubbleProps {
  role: string;
  text: string;
  isLast: boolean;
}

const ChatBubble = React.memo(({ role, text, isLast: _isLast }: ChatBubbleProps) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(role === 'assistant' ? -12 : 12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 100,
        friction: 14,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const isUser = role === 'user';

  return (
    <Animated.View
      style={[
        styles.bubbleRow,
        isUser ? styles.bubbleRowUser : styles.bubbleRowAssistant,
        { opacity: fadeAnim, transform: [{ translateX: slideAnim }] },
      ]}
    >
      {!isUser && (
        <View style={styles.avatarBot}>
          <Bot size={16} color="#FFF" strokeWidth={2.2} />
        </View>
      )}
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant]}>
          {text}
        </Text>
      </View>
      {isUser ? (
        <View style={styles.avatarUser}>
          <User size={14} color="#FFF" strokeWidth={2.2} />
        </View>
      ) : null}
    </Animated.View>
  );
});

ChatBubble.displayName = 'ChatBubble';

export default function AIChatScreen() {
  const router = useRouter();
  const { user, userType } = useAuth();
  const [input, setInput] = useState<string>('');
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const isDriver = userType === 'driver';
  const quickPrompts = isDriver ? QUICK_PROMPTS_DRIVER : QUICK_PROMPTS_CUSTOMER;
  const accentColor = isDriver ? '#2ECC71' : '#F5A623';

  const systemPrompt = isDriver
    ? `Sen 2GO uygulamasının şoför asistanısın. Türkçe cevap ver. Şoförlere yoğunluk analizi, rota önerileri, kazanç artırma ipuçları, trafik bilgisi ve araç bakımı konularında yardım et. Kısa ve net cevaplar ver. Şoförün adı: ${user?.name ?? 'Şoför'}`
    : `Sen 2GO uygulamasının müşteri asistanısın. Türkçe cevap ver. Müşterilere yakın mekanlar, tahmini süreler, fiyat tahminleri, kampanyalar ve güvenli yolculuk ipuçları konularında yardım et. Kısa ve net cevaplar ver. Kullanıcının adı: ${user?.name ?? 'Kullanıcı'}`;
  const compactMessagePrompt = isDriver
    ? '2GO şoför asistanı olarak Türkçe, kısa ve net cevap ver.'
    : '2GO müşteri asistanı olarak Türkçe, kısa ve net cevap ver.';

  const { messages, sendMessage, setMessages } = useRorkAgent({
    tools: {
      estimatePrice: createRorkTool({
        description: 'İki nokta arası tahmini fiyat hesapla. Nereden ve nereye bilgisi gerekir.',
        zodSchema: z.object({
          origin: z.string().describe('Başlangıç noktası (adres veya yer adı, örn: Taksim)'),
          destination: z.string().describe('Varış noktası (adres veya yer adı, örn: Kadıköy)'),
        }),
        async execute(params) {
          const apiKey = getGoogleMapsApiKey();
          if (!apiKey) {
            const fallbackDist = 10;
            const scooterPrice = calculatePrice(fallbackDist, 'scooter');
            const motorcyclePrice = calculatePrice(fallbackDist, 'motorcycle');
            const carPrice = calculatePrice(fallbackDist, 'car');
            return `${params.origin} → ${params.destination} (tahmini ~${fallbackDist} km):\n🛴 Scooter: ₺${scooterPrice} | 🏍️ Motor: ₺${motorcyclePrice} | 🚗 Otomobil: ₺${carPrice}`;
          }

          try {
            const url = `${getDirectionsApiUrl()}?origin=${encodeURIComponent(params.origin + ', İstanbul')}&destination=${encodeURIComponent(params.destination + ', İstanbul')}&language=tr&departure_time=now&key=${apiKey}`;
            console.log('[AI-Price] Fetching directions for price estimate');
            const res = await fetch(url);
            const data = await res.json();

            if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
              console.log('[AI-Price] Directions API error:', data.status);
              return `${params.origin} → ${params.destination} için rota bulunamadı. Lütfen adresleri kontrol edin.`;
            }

            const leg = data.routes[0].legs[0];
            const distanceKm = Math.round((leg.distance.value / 1000) * 10) / 10;
            const durationMin = Math.ceil(leg.duration.value / 60);
            const durationInTrafficMin = leg.duration_in_traffic ? Math.ceil(leg.duration_in_traffic.value / 60) : durationMin;

            const scooterPrice = calculatePrice(distanceKm, 'scooter');
            const motorcyclePrice = calculatePrice(distanceKm, 'motorcycle');
            const carPrice = calculatePrice(distanceKm, 'car');

            console.log('[AI-Price] Result:', distanceKm, 'km, duration:', durationMin, 'min, traffic:', durationInTrafficMin, 'min');
            return `${params.origin} → ${params.destination} (${distanceKm} km, ~${durationInTrafficMin} dk):\n\n🛴 Scooter: ₺${scooterPrice}\n🏍️ Motor: ₺${motorcyclePrice}\n🚗 Otomobil: ₺${carPrice}\n\n📏 İlk ${PRICING.baseDistanceKm} km dahil, sonrası km başı ₺${PRICING.extraPerKm}`;
          } catch (err) {
            console.log('[AI-Price] Error:', err);
            return `${params.origin} → ${params.destination} fiyat hesaplanamadı. Lütfen tekrar deneyin.`;
          }
        },
      }),
      getTrafficInfo: createRorkTool({
        description: 'Bir bölgedeki veya iki nokta arasındaki gerçek zamanlı trafik durumunu öğren',
        zodSchema: z.object({
          area: z.string().describe('Bölge adı veya başlangıç noktası (örn: Taksim, Beşiktaş)'),
          destination: z.string().optional().describe('Varış noktası (opsiyonel, örn: Kadıköy)'),
        }),
        async execute(params) {
          const apiKey = getGoogleMapsApiKey();
          if (!apiKey) {
            return `${params.area} bölgesinde trafik bilgisi alınamadı. Google Maps API anahtarı gerekli.`;
          }

          try {
            const origin = params.area + ', İstanbul';
            const dest = params.destination ? params.destination + ', İstanbul' : params.area + ' Meydanı, İstanbul';
            const url = `${getDirectionsApiUrl()}?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&language=tr&departure_time=now&key=${apiKey}`;
            console.log('[AI-Traffic] Fetching real traffic data for:', params.area);
            const res = await fetch(url);
            const data = await res.json();

            if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
              console.log('[AI-Traffic] Directions API error:', data.status);
              return `${params.area} bölgesinde trafik bilgisi alınamadı.`;
            }

            const leg = data.routes[0].legs[0];
            const normalDurationMin = Math.ceil(leg.duration.value / 60);
            const trafficDurationMin = leg.duration_in_traffic ? Math.ceil(leg.duration_in_traffic.value / 60) : normalDurationMin;
            const distanceKm = Math.round((leg.distance.value / 1000) * 10) / 10;

            const ratio = trafficDurationMin / Math.max(normalDurationMin, 1);
            let trafficLevel: string;
            let trafficEmoji: string;
            if (ratio <= 1.15) {
              trafficLevel = 'Hafif';
              trafficEmoji = '🟢';
            } else if (ratio <= 1.4) {
              trafficLevel = 'Orta';
              trafficEmoji = '🟡';
            } else if (ratio <= 1.7) {
              trafficLevel = 'Yoğun';
              trafficEmoji = '🟠';
            } else {
              trafficLevel = 'Çok Yoğun';
              trafficEmoji = '🔴';
            }

            const routeLabel = params.destination
              ? `${params.area} → ${params.destination}`
              : `${params.area} bölgesi`;

            console.log('[AI-Traffic] Result:', trafficLevel, 'normal:', normalDurationMin, 'traffic:', trafficDurationMin, 'ratio:', ratio.toFixed(2));
            return `${trafficEmoji} ${routeLabel} trafik: ${trafficLevel}\n⏱️ Normal süre: ${normalDurationMin} dk | Şu an: ${trafficDurationMin} dk\n📏 Mesafe: ${distanceKm} km`;
          } catch (err) {
            console.log('[AI-Traffic] Error:', err);
            return `${params.area} bölgesinde trafik bilgisi alınamadı. Lütfen tekrar deneyin.`;
          }
        },
      }),
    },
  });

  const buildOutgoingMessage = useCallback((userMessage: string): string => {
    const hasUserHistory = messages.some((message) => message.role === 'user');
    if (!hasUserHistory) {
      return `${systemPrompt}\n\nKullanıcı mesajı: ${userMessage}`;
    }

    return `${compactMessagePrompt}\n\nKullanıcı mesajı: ${userMessage}`;
  }, [compactMessagePrompt, messages, systemPrompt]);

  useEffect(() => {
    if (messages.length <= MAX_AI_CHAT_MESSAGES) {
      return;
    }

    setMessages((currentMessages) => {
      if (currentMessages.length <= MAX_AI_CHAT_MESSAGES) {
        return currentMessages;
      }

      const welcomeMessage = currentMessages.find((message) => message.id === WELCOME_MESSAGE_ID) ?? null;
      const candidateMessages = welcomeMessage
        ? currentMessages.filter((message) => message.id !== WELCOME_MESSAGE_ID)
        : currentMessages;
      const keepCount = MAX_AI_CHAT_MESSAGES - (welcomeMessage ? 1 : 0);
      const recentMessages = candidateMessages.slice(-keepCount);
      const nextMessages = welcomeMessage ? [welcomeMessage, ...recentMessages] : [...recentMessages];

      console.log('[AI-CHAT] Pruned local chat history from', currentMessages.length, 'to', nextMessages.length);
      return nextMessages;
    });
  }, [messages.length, setMessages]);

  useEffect(() => {
    if (messages.length === 0) {
      const greeting = isDriver
        ? `Merhaba ${user?.name ?? 'Şoför'}! Ben 2GO AI asistanınızım. Size yoğunluk analizi, rota önerileri ve kazanç ipuçları konusunda yardımcı olabilirim. Nasıl yardımcı olabilirim?`
        : `Merhaba ${user?.name ?? ''}! Ben 2GO AI asistanınızım. Size mekan önerileri, fiyat tahminleri ve yolculuk bilgileri konusunda yardımcı olabilirim. Nasıl yardımcı olabilirim?`;

      setMessages([
        {
          id: WELCOME_MESSAGE_ID,
          role: 'assistant' as const,
          parts: [{ type: 'text' as const, text: greeting }],
        },
      ]);
    }
  }, [messages.length, isDriver, setMessages, user?.name]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    sendMessage(buildOutgoingMessage(trimmed));
    setInput('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 200);
  }, [buildOutgoingMessage, input, sendMessage]);

  const handleQuickPrompt = useCallback((prompt: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setInput(prompt);
    setTimeout(() => {
      sendMessage(buildOutgoingMessage(prompt));
      setInput('');
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 200);
    }, 100);
  }, [buildOutgoingMessage, sendMessage]);

  const renderMessage = useCallback(({ item, index }: { item: typeof messages[0]; index: number }) => {
    const textParts = item.parts.filter((p) => p.type === 'text');
    const toolParts = item.parts.filter((p) => p.type === 'tool');
    const isLast = index === messages.length - 1;

    return (
      <View>
        {textParts.map((part, i) => {
          if (part.type === 'text') {
            return (
              <ChatBubble
                key={`${item.id}-text-${i}`}
                role={item.role}
                text={part.text}
                isLast={isLast && i === textParts.length - 1}
              />
            );
          }
          return null;
        })}
        {toolParts.map((part, i) => {
          if (part.type === 'tool') {
            if (part.state === 'output-available') {
              return (
                <View key={`${item.id}-tool-${i}`} style={styles.toolResult}>
                  <Sparkles size={12} color={accentColor} />
                  <Text style={styles.toolResultText}>
                    {typeof part.output === 'string' ? part.output : JSON.stringify(part.output)}
                  </Text>
                </View>
              );
            }
            if (part.state === 'input-streaming' || part.state === 'input-available') {
              return (
                <View key={`${item.id}-tool-${i}`} style={styles.toolLoading}>
                  <ActivityIndicator size="small" color={accentColor} />
                  <Text style={styles.toolLoadingText}>İşleniyor...</Text>
                </View>
              );
            }
          }
          return null;
        })}
      </View>
    );
  }, [messages.length, accentColor]);

  const isLoading = messages.length > 0 && messages[messages.length - 1]?.role === 'user';

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              router.back();
            }}
            style={styles.backBtn}
            activeOpacity={0.6}
            testID="ai-chat-back"
          >
            <ArrowLeft size={22} color="#1A1A1A" strokeWidth={2.2} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={[styles.headerIcon, { backgroundColor: accentColor + '22' }]}>
              <Bot size={18} color={accentColor} strokeWidth={2} />
            </View>
            <View>
              <Text style={styles.headerTitle}>2GO Asistan</Text>
              <Text style={[styles.headerSub, { color: accentColor }]}>
                {isDriver ? 'Şoför Desteği' : 'Müşteri Desteği'}
              </Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.onlineDot, { backgroundColor: accentColor }]} />
            <Text style={styles.onlineText}>Çevrimiçi</Text>
          </View>
        </View>

        <KeyboardAvoidingView
          style={styles.chatArea}
          behavior={keyboardAvoidingBehavior()}
          keyboardVerticalOffset={keyboardVerticalOffset()}
        >
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              flatListRef.current?.scrollToEnd({ animated: true });
            }}
            ListHeaderComponent={
              messages.length <= 1 ? (
                <View style={styles.quickPromptsSection}>
                  <Text style={styles.quickPromptsTitle}>Hızlı sorular</Text>
                  <View style={styles.quickPromptsGrid}>
                    {quickPrompts.map((prompt, idx) => (
                      <TouchableOpacity
                        key={idx}
                        style={[styles.quickPromptBtn, { borderColor: accentColor + '40' }]}
                        onPress={() => handleQuickPrompt(prompt)}
                        activeOpacity={0.7}
                        testID={`quick-prompt-${idx}`}
                      >
                        <Text style={[styles.quickPromptText, { color: accentColor }]}>{prompt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              ) : null
            }
            ListFooterComponent={
              isLoading ? (
                <View style={styles.typingIndicator}>
                  <View style={styles.avatarBot}>
                    <Bot size={16} color="#FFF" strokeWidth={2.2} />
                  </View>
                  <View style={styles.typingDots}>
                    <TypingDot delay={0} color={accentColor} />
                    <TypingDot delay={200} color={accentColor} />
                    <TypingDot delay={400} color={accentColor} />
                  </View>
                </View>
              ) : null
            }
          />

          <View style={styles.inputArea}>
            <View style={styles.inputRow}>
              <TextInput
                ref={inputRef}
                style={styles.textInput}
                placeholder="Mesajınızı yazın..."
                placeholderTextColor="#666"
                value={input}
                onChangeText={setInput}
                multiline
                maxLength={500}
                testID="ai-chat-input"
              />
              <TouchableOpacity
                style={[
                  styles.sendBtn,
                  { backgroundColor: input.trim() ? accentColor : '#2A2A42' },
                ]}
                onPress={handleSend}
                disabled={!input.trim()}
                activeOpacity={0.7}
                testID="ai-chat-send"
              >
                <Send size={18} color={input.trim() ? '#FFF' : '#555'} strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function TypingDot({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: color, opacity: anim }]}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  safeArea: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EBEBF0',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginLeft: 4,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: '#1A1A1A',
  },
  headerSub: {
    fontSize: 12,
    fontWeight: '500' as const,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  onlineText: {
    fontSize: 11,
    color: '#6B6B80',
    fontWeight: '500' as const,
  },
  chatArea: {
    flex: 1,
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  bubbleRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    marginBottom: 12,
    gap: 8,
  },
  bubbleRowUser: {
    justifyContent: 'flex-end' as const,
  },
  bubbleRowAssistant: {
    justifyContent: 'flex-start' as const,
  },
  avatarBot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F2F2F4',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#E0E0E6',
  },
  avatarUser: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#F5A623',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  bubble: {
    maxWidth: '75%' as const,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleUser: {
    backgroundColor: '#2D1B69',
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: '#F2F2F4',
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: '#F0E6FF',
  },
  bubbleTextAssistant: {
    color: '#1A1A1A',
  },
  toolResult: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginLeft: 36,
    marginBottom: 8,
    backgroundColor: '#F7F7F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  toolResultText: {
    fontSize: 13,
    color: '#6B6B80',
    flex: 1,
  },
  toolLoading: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginLeft: 36,
    marginBottom: 8,
  },
  toolLoadingText: {
    fontSize: 12,
    color: '#9595A8',
  },
  typingIndicator: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 8,
  },
  typingDots: {
    flexDirection: 'row' as const,
    gap: 4,
    backgroundColor: '#F2F2F4',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E5E5EA',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  quickPromptsSection: {
    marginBottom: 20,
    marginTop: 8,
  },
  quickPromptsTitle: {
    fontSize: 13,
    color: '#9595A8',
    fontWeight: '600' as const,
    marginBottom: 10,
    textAlign: 'center' as const,
  },
  quickPromptsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
    justifyContent: 'center' as const,
  },
  quickPromptBtn: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#F7F7F9',
  },
  quickPromptText: {
    fontSize: 13,
    fontWeight: '500' as const,
  },
  inputArea: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#EBEBF0',
    backgroundColor: '#FFFFFF',
  },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 10,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F2F2F4',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingTop: 10,
    fontSize: 15,
    color: '#1A1A1A',
    maxHeight: 100,
    borderWidth: 1,
    borderColor: '#E0E0E6',
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
});

