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

  const { messages, sendMessage, setMessages } = useRorkAgent({
    tools: {
      estimatePrice: createRorkTool({
        description: 'Tahmini fiyat hesapla',
        zodSchema: z.object({
          distance: z.number().describe('Mesafe (km)'),
          vehicleType: z.string().describe('Araç tipi'),
        }),
        execute(params) {
          const basePrice = params.distance * 12.5;
          return `Tahmini fiyat: ${basePrice.toFixed(0)} TL (${params.vehicleType}, ${params.distance} km)`;
        },
      }),
      getTrafficInfo: createRorkTool({
        description: 'Trafik durumunu öğren',
        zodSchema: z.object({
          area: z.string().describe('Bölge adı'),
        }),
        execute(params) {
          const levels = ['Hafif', 'Orta', 'Yoğun'];
          const random = levels[Math.floor(Math.random() * levels.length)];
          return `${params.area} bölgesinde trafik: ${random}`;
        },
      }),
    },
  });

  useEffect(() => {
    if (messages.length === 0) {
      const greeting = isDriver
        ? `Merhaba ${user?.name ?? 'Şoför'}! Ben 2GO AI asistanınızım. Size yoğunluk analizi, rota önerileri ve kazanç ipuçları konusunda yardımcı olabilirim. Nasıl yardımcı olabilirim?`
        : `Merhaba ${user?.name ?? ''}! Ben 2GO AI asistanınızım. Size mekan önerileri, fiyat tahminleri ve yolculuk bilgileri konusunda yardımcı olabilirim. Nasıl yardımcı olabilirim?`;

      setMessages([
        {
          id: 'welcome',
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
    sendMessage(`${systemPrompt}\n\nKullanıcı mesajı: ${trimmed}`);
    setInput('');
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 200);
  }, [input, sendMessage, systemPrompt]);

  const handleQuickPrompt = useCallback((prompt: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setInput(prompt);
    setTimeout(() => {
      sendMessage(`${systemPrompt}\n\nKullanıcı mesajı: ${prompt}`);
      setInput('');
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 200);
    }, 100);
  }, [sendMessage, systemPrompt]);

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
