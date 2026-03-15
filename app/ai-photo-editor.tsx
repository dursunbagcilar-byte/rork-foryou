import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Animated,
  Alert,
  Platform,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ArrowLeft,
  Camera,
  ImagePlus,
  Wand2,
  Eraser,
  Palette,
  Sun,
  Sparkles,
  RotateCcw,
  Check,
  Zap,
  Crown,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/contexts/AuthContext';
import { useMutation } from '@tanstack/react-query';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type EditMode = 'remove-bg' | 'enhance' | 'studio' | 'clean' | 'cinematic' | 'neon';

interface EditOption {
  id: EditMode;
  icon: React.ElementType;
  label: string;
  description: string;
  prompt: string;
  gradient: [string, string];
}

const CAR_EDIT_BASE = 'Keep this exact same car model, brand, shape, and color. Do NOT change the car to a different model. No frames, no borders, no boxes around the image.';

const CAR_EDIT_NOBG = 'Keep this exact same car model, brand, shape, and color. Do NOT change the car to a different model. CRITICAL: The final image MUST have a completely transparent background (PNG with alpha channel). Remove ALL background elements. The car must be fully isolated with NO background, NO floor, NO shadows on ground, NO environment - just the car itself floating on transparent/empty space. No frames, no borders, no boxes around the image.';

const EDIT_OPTIONS: EditOption[] = [
  {
    id: 'studio',
    icon: Sparkles,
    label: 'Stüdyo',
    description: 'Premium stüdyo çekimi',
    prompt: `${CAR_EDIT_BASE} Position the car in a dynamic 3/4 side profile angle, slightly lowered stance. Place the car in a sleek dark premium studio environment with polished reflective floor. Add dramatic studio rim lighting from both sides highlighting the car body lines. The lighting should create sharp highlights on the edges and contours of the car, with subtle reflections on the car paint and floor. Background should be a dark gradient studio with soft volumetric light beams. Make it look like a high-end car advertisement photo. Ultra realistic, photographic quality.`,
    gradient: ['#F5A623', '#FF6B35'],
  },
  {
    id: 'cinematic',
    icon: Crown,
    label: 'Sinematik',
    description: 'Film sahnesi etkisi',
    prompt: `${CAR_EDIT_BASE} Position the car in a dynamic 3/4 side profile angle, slightly lowered stance. Place the car on a scenic coastal road during golden hour sunset. Apply cinematic golden hour warm sunset lighting on the car body creating copper and gold tone reflections. The warm light should reflect beautifully off the car paint. Background should show a dramatic sunset sky with warm orange and purple tones, distant mountains or ocean view. Ultra realistic, cinematic color grading, movie poster quality.`,
    gradient: ['#E74C3C', '#C0392B'],
  },
  {
    id: 'remove-bg',
    icon: Eraser,
    label: 'Arka Plan',
    description: 'Arka planı temizle',
    prompt: `${CAR_EDIT_NOBG} Position the car in a dynamic 3/4 side profile angle, slightly lowered stance. Remove the background completely. The car should be perfectly isolated with crisp edges on a fully transparent background. No shadows, no floor, no environment. Make it look like a professional car configurator cutout image. Keep the car paint reflections sharp and realistic. Ultra clean, dealership catalog quality, PNG with transparent background.`,
    gradient: ['#9B59B6', '#8E44AD'],
  },
  {
    id: 'neon',
    icon: Zap,
    label: 'Neon',
    description: 'Neon ışık efekti',
    prompt: `${CAR_EDIT_BASE} Position the car in a dynamic 3/4 side profile angle, slightly lowered stance. Place the car in a dark cyberpunk city street at night with wet reflective asphalt. Add dramatic neon lighting effects - cyan blue and copper orange neon light reflections on the car body surface and wet ground. The car paint should reflect neon colors creating a cyberpunk premium look. Background should have glowing neon signs, dark buildings with colored light strips, and light fog/mist. Ultra realistic, cyberpunk aesthetic.`,
    gradient: ['#3498DB', '#2980B9'],
  },
  {
    id: 'enhance',
    icon: Sun,
    label: 'HD Kalite',
    description: 'Kaliteyi yükselt',
    prompt: `${CAR_EDIT_BASE} Position the car in a dynamic 3/4 side profile angle, slightly lowered stance. Dramatically enhance the photo quality. Make the car paint look perfectly glossy and reflective like a freshly detailed car. Sharpen all details - wheels, badges, headlights, body lines. Improve the contrast and color saturation to make the car pop. The car should look showroom-new with perfect paint correction. Keep and enhance the existing background or place on a clean urban street with soft bokeh. 8K quality feel, ultra sharp details.`,
    gradient: ['#2ECC71', '#27AE60'],
  },
  {
    id: 'clean',
    icon: Palette,
    label: 'Showroom',
    description: 'Galeri görünümü',
    prompt: `${CAR_EDIT_BASE} Position the car in a dynamic 3/4 side profile angle, slightly lowered stance. Place the car in a luxury car showroom with polished white marble floor and soft ambient lighting. Apply soft, even showroom lighting highlighting every curve of the car. Make the car look absolutely pristine and brand new with perfect paint. Background should be a bright modern showroom with large glass windows and subtle reflections on the floor. Premium dealership photography style, ultra realistic.`,
    gradient: ['#F39C12', '#E67E22'],
  },
];

async function imageToBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export default function AIPhotoEditorScreen() {
  const router = useRouter();
  const { updateCustomVehicleImage } = useAuth();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<EditMode | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const imageScaleAnim = useRef(new Animated.Value(0.9)).current;
  const resultAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    if (selectedImage) {
      imageScaleAnim.setValue(0.85);
      Animated.spring(imageScaleAnim, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }).start();
    }
  }, [selectedImage]);

  useEffect(() => {
    if (editedImage) {
      resultAnim.setValue(0);
      Animated.spring(resultAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }).start();
    }
  }, [editedImage]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const editMutation = useMutation({
    mutationFn: async ({ base64, prompt }: { base64: string; prompt: string }) => {
      console.log('[AIPhotoEditor] Starting image edit...');
      const response = await fetch('https://toolkit.rork.com/images/edit/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          images: [{ type: 'image', image: base64 }],
          aspectRatio: '16:9',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log('[AIPhotoEditor] Error:', errorText);
        throw new Error('Fotoğraf düzenlenemedi');
      }

      const data = await response.json();
      console.log('[AIPhotoEditor] Edit successful');
      return data.image;
    },
    onSuccess: (data) => {
      const uri = `data:${data.mimeType};base64,${data.base64Data}`;
      setEditedImage(uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
    onError: (error) => {
      console.log('[AIPhotoEditor] Mutation error:', error);
      Alert.alert('Hata', 'Fotoğraf düzenlenirken bir hata oluştu. Lütfen tekrar deneyin.');
    },
  });

  const pickImage = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        setSelectedImage(result.assets[0].uri);
        setEditedImage(null);
        setSelectedMode(null);
        console.log('[AIPhotoEditor] Image selected:', result.assets[0].uri);
      }
    } catch (error) {
      console.log('[AIPhotoEditor] Pick image error:', error);
      Alert.alert('Hata', 'Fotoğraf seçilemedi');
    }
  }, []);

  const takePhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('İzin Gerekli', 'Kamera izni verilmedi');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        setSelectedImage(result.assets[0].uri);
        setEditedImage(null);
        setSelectedMode(null);
      }
    } catch (error) {
      console.log('[AIPhotoEditor] Camera error:', error);
      Alert.alert('Hata', 'Kamera açılamadı');
    }
  }, []);

  const handleEdit = useCallback(async (option: EditOption) => {
    if (!selectedImage) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSelectedMode(option.id);
    setEditedImage(null);

    try {
      const base64 = await imageToBase64(selectedImage);
      editMutation.mutate({ base64, prompt: option.prompt });
    } catch (error) {
      console.log('[AIPhotoEditor] Base64 conversion error:', error);
      Alert.alert('Hata', 'Fotoğraf işlenemedi');
    }
  }, [selectedImage, editMutation]);

  const handleApply = useCallback(async () => {
    if (editedImage && updateCustomVehicleImage) {
      try {
        await updateCustomVehicleImage(editedImage);
        console.log('[AIPhotoEditor] Vehicle image applied successfully');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Başarılı', 'Fotoğraf araç profilinize uygulandı!', [
          { text: 'Tamam', onPress: () => router.back() },
        ]);
      } catch (e) {
        console.log('[AIPhotoEditor] Apply error:', e);
        Alert.alert('Hata', 'Fotoğraf kaydedilirken bir hata oluştu. Lütfen tekrar deneyin.');
      }
    }
  }, [editedImage, updateCustomVehicleImage, router]);

  const handleReset = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setEditedImage(null);
    setSelectedMode(null);
  }, []);

  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#0A0A12', '#12121E', '#0A0A12']}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                router.back();
              }}
              style={styles.backBtn}
              activeOpacity={0.6}
              testID="photo-editor-back"
            >
              <ArrowLeft size={22} color="#FFFFFF" strokeWidth={2.2} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <View style={styles.headerBadge}>
                <Wand2 size={14} color="#F5A623" strokeWidth={2.5} />
              </View>
              <Text style={styles.headerTitle}>AI Editör</Text>
            </View>
            <View style={styles.headerRight}>
              {editedImage ? (
                <TouchableOpacity
                  onPress={handleApply}
                  style={styles.applyBtn}
                  activeOpacity={0.7}
                  testID="photo-editor-apply"
                >
                  <Check size={16} color="#0A0A12" strokeWidth={3} />
                  <Text style={styles.applyBtnText}>Oluştur</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.headerPlaceholder} />
              )}
            </View>
          </View>

          <ScrollView
            style={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContentInner}
          >
            {selectedImage ? (
              <>
                <View style={styles.imageSection}>
                  <Animated.View style={[styles.imageFloat, { transform: [{ scale: editedImage ? resultAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1]}) : imageScaleAnim }]}]}>
                    <LinearGradient
                      colors={['#F5A62330', '#FF6B3520', 'transparent']}
                      style={styles.imageGlow}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                    />

                    <View style={[
                      styles.imageFrame,
                      editedImage && selectedMode === 'remove-bg' && styles.imageFrameRemoveBg,
                    ]}>
                      <Image
                        source={{ uri: editedImage || selectedImage }}
                        style={[
                          styles.previewImage,
                          editedImage && selectedMode === 'remove-bg' && styles.previewImageRemoveBg,
                        ]}
                        contentFit={editedImage && selectedMode === 'remove-bg' ? 'contain' : 'cover'}
                        testID={editedImage ? "edited-image" : "original-image"}
                      />
                      {editedImage && selectedMode === 'remove-bg' ? (
                        <View style={styles.carShadow} />
                      ) : null}

                      {editedImage ? (
                        <View style={styles.editedBadge}>
                          <Sparkles size={10} color="#F5A623" />
                          <Text style={styles.editedBadgeText}>AI</Text>
                        </View>
                      ) : null}

                      {editMutation.isPending && (
                        <View style={styles.processingOverlay}>
                          <Animated.View style={[styles.processingShimmer, { opacity: shimmerOpacity }]} />
                          <View style={styles.processingContent}>
                            <ActivityIndicator size="large" color="#F5A623" />
                            <Text style={styles.processingText}>AI ile dönüştürülüyor</Text>
                            <View style={styles.processingDots}>
                              {[0, 1, 2].map((i) => (
                                <Animated.View
                                  key={i}
                                  style={[
                                    styles.dot,
                                    {
                                      opacity: shimmerAnim.interpolate({
                                        inputRange: [0, 0.33 * i, 0.33 * i + 0.33, 1],
                                        outputRange: [0.3, 0.3, 1, 0.3],
                                        extrapolate: 'clamp',
                                      }),
                                    },
                                  ]}
                                />
                              ))}
                            </View>
                          </View>
                        </View>
                      )}
                    </View>

                    <LinearGradient
                      colors={['transparent', '#F5A62315', 'transparent']}
                      style={styles.imageShadow}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                  </Animated.View>

                  <View style={styles.imageControls}>
                    <TouchableOpacity
                      style={styles.controlBtn}
                      onPress={pickImage}
                      activeOpacity={0.7}
                    >
                      <ImagePlus size={15} color="#9595A8" />
                      <Text style={styles.controlBtnText}>Değiştir</Text>
                    </TouchableOpacity>
                    {editedImage ? (
                      <TouchableOpacity
                        style={styles.controlBtn}
                        onPress={handleReset}
                        activeOpacity={0.7}
                      >
                        <RotateCcw size={15} color="#9595A8" />
                        <Text style={styles.controlBtnText}>Sıfırla</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {!editedImage && !editMutation.isPending ? (
                    <Animated.View style={[styles.createBtnWrap, { transform: [{ scale: pulseAnim }]}]}>
                      <Text style={styles.createHint}>Bir efekt seçerek aracınızı dönüştürün</Text>
                    </Animated.View>
                  ) : null}
                </View>

                <View style={styles.optionsSection}>
                  <View style={styles.optionsTitleRow}>
                    <Text style={styles.optionsTitle}>Efektler</Text>
                    <View style={styles.optionsBadge}>
                      <Zap size={10} color="#F5A623" />
                      <Text style={styles.optionsBadgeText}>AI</Text>
                    </View>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.optionsRow}
                  >
                    {EDIT_OPTIONS.map((option) => {
                      const isActive = selectedMode === option.id;
                      const isProcessing = editMutation.isPending && isActive;
                      const IconComp = option.icon;

                      return (
                        <TouchableOpacity
                          key={option.id}
                          style={[styles.optionPill, isActive && styles.optionPillActive]}
                          onPress={() => handleEdit(option)}
                          activeOpacity={0.7}
                          disabled={editMutation.isPending}
                          testID={`edit-option-${option.id}`}
                        >
                          <LinearGradient
                            colors={isActive ? option.gradient : ['#1A1A2E', '#1A1A2E']}
                            style={styles.optionGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                          >
                            {isProcessing ? (
                              <ActivityIndicator size="small" color="#FFF" />
                            ) : (
                              <IconComp
                                size={20}
                                color={isActive ? '#FFF' : '#9595A8'}
                                strokeWidth={2}
                              />
                            )}
                          </LinearGradient>
                          <Text style={[styles.optionPillLabel, isActive && styles.optionPillLabelActive]}>
                            {option.label}
                          </Text>
                          <Text style={styles.optionPillDesc}>{option.description}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </>
            ) : (
              <View style={styles.emptyState}>
                <Animated.View style={[styles.emptyIconContainer, { transform: [{ scale: pulseAnim }]}]}>
                  <LinearGradient
                    colors={['#F5A62325', '#FF6B3515', 'transparent']}
                    style={styles.emptyIconGlow}
                  />
                  <View style={styles.emptyIconInner}>
                    <Wand2 size={36} color="#F5A623" strokeWidth={1.5} />
                  </View>
                </Animated.View>

                <Text style={styles.emptyTitle}>Aracınızı Dönüştürün</Text>
                <Text style={styles.emptyDesc}>
                  Yapay zeka ile aracınızın fotoğrafını profesyonel bir çekime çevirin
                </Text>

                <View style={styles.emptyActions}>
                  <TouchableOpacity
                    style={styles.primaryAction}
                    onPress={pickImage}
                    activeOpacity={0.8}
                    testID="pick-image-btn"
                  >
                    <LinearGradient
                      colors={['#F5A623', '#FF6B35']}
                      style={styles.primaryActionGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    >
                      <ImagePlus size={20} color="#FFF" strokeWidth={2} />
                      <Text style={styles.primaryActionText}>Galeriden Seç</Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  {Platform.OS !== 'web' && (
                    <TouchableOpacity
                      style={styles.secondaryAction}
                      onPress={takePhoto}
                      activeOpacity={0.8}
                      testID="take-photo-btn"
                    >
                      <Camera size={18} color="#F5A623" strokeWidth={2} />
                      <Text style={styles.secondaryActionText}>Fotoğraf Çek</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.featureList}>
                  {[
                    { icon: Sparkles, text: 'Stüdyo kalitesinde çekim' },
                    { icon: Eraser, text: 'Arka plan temizleme' },
                    { icon: Zap, text: 'Neon & sinematik efektler' },
                  ].map((feature, index) => (
                    <View key={index} style={styles.featureItem}>
                      <feature.icon size={14} color="#F5A623" strokeWidth={2} />
                      <Text style={styles.featureText}>{feature.text}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0A12',
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginLeft: 12,
  },
  headerBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#F5A62320',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerRight: {
    minWidth: 80,
    alignItems: 'flex-end' as const,
  },
  headerPlaceholder: {
    width: 80,
  },
  applyBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    backgroundColor: '#F5A623',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: 22,
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  applyBtnText: {
    fontSize: 15,
    fontWeight: '900' as const,
    color: '#0A0A12',
    letterSpacing: 0.5,
  },
  scrollContent: {
    flex: 1,
  },
  scrollContentInner: {
    paddingBottom: 60,
  },
  imageSection: {
    paddingTop: 8,
    alignItems: 'center' as const,
  },
  imageFloat: {
    width: SCREEN_WIDTH - 24,
    alignItems: 'center' as const,
  },
  imageGlow: {
    position: 'absolute' as const,
    top: -30,
    left: 20,
    right: 20,
    height: 60,
    borderRadius: 30,
  },
  imageFrame: {
    width: '100%',
    borderRadius: 20,
    overflow: 'hidden' as const,
    backgroundColor: '#2A2A3A',
  },
  imageFrameRemoveBg: {
    backgroundColor: '#F5F6F8',
  },
  previewImage: {
    width: '100%' as const,
    aspectRatio: 16 / 9,
  },
  previewImageRemoveBg: {
    aspectRatio: 16 / 9,
  },
  carShadow: {
    position: 'absolute' as const,
    bottom: 18,
    left: '15%' as unknown as number,
    right: '15%' as unknown as number,
    height: 30,
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: 100,
    transform: [{ scaleY: 0.3 }],
  },
  editedBadge: {
    position: 'absolute' as const,
    top: 14,
    right: 14,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F5A62340',
  },
  editedBadgeText: {
    fontSize: 11,
    color: '#F5A623',
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 10, 18, 0.85)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  processingShimmer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F5A62308',
  },
  processingContent: {
    alignItems: 'center' as const,
    gap: 14,
  },
  processingText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  processingDots: {
    flexDirection: 'row' as const,
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F5A623',
  },
  imageShadow: {
    height: 20,
    width: '80%',
    marginTop: -2,
    borderRadius: 10,
  },
  imageControls: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    gap: 12,
    marginTop: 14,
  },
  controlBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  controlBtnText: {
    fontSize: 13,
    color: '#9595A8',
    fontWeight: '600' as const,
  },
  optionsSection: {
    marginTop: 28,
    paddingLeft: 16,
  },
  optionsTitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 14,
  },
  optionsTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  optionsBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 3,
    backgroundColor: '#F5A62320',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  optionsBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    color: '#F5A623',
    letterSpacing: 0.5,
  },
  optionsRow: {
    gap: 10,
    paddingRight: 16,
  },
  optionPill: {
    width: 110,
    alignItems: 'center' as const,
    gap: 8,
  },
  optionPillActive: {},
  optionGradient: {
    width: 56,
    height: 56,
    borderRadius: 18,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  optionPillLabel: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#9595A8',
    textAlign: 'center' as const,
  },
  optionPillLabelActive: {
    color: '#FFFFFF',
  },
  optionPillDesc: {
    fontSize: 10,
    color: '#5C5C72',
    textAlign: 'center' as const,
    lineHeight: 14,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center' as const,
    paddingHorizontal: 32,
    paddingTop: 60,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 28,
  },
  emptyIconGlow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 50,
  },
  emptyIconInner: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: 'rgba(245, 166, 35, 0.12)',
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: '#F5A62325',
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '800' as const,
    color: '#FFFFFF',
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  emptyDesc: {
    fontSize: 14,
    color: '#9595A8',
    textAlign: 'center' as const,
    lineHeight: 22,
    marginBottom: 32,
  },
  emptyActions: {
    width: '100%',
    gap: 12,
    marginBottom: 40,
  },
  primaryAction: {
    borderRadius: 16,
    overflow: 'hidden' as const,
  },
  primaryActionGradient: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    paddingVertical: 16,
  },
  primaryActionText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#FFF',
    letterSpacing: 0.3,
  },
  secondaryAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 10,
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#F5A62330',
    backgroundColor: 'rgba(245, 166, 35, 0.05)',
  },
  secondaryActionText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#F5A623',
  },
  featureList: {
    gap: 14,
  },
  featureItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  featureText: {
    fontSize: 13,
    color: '#6B6B80',
    fontWeight: '500' as const,
  },
  createBtnWrap: {
    alignItems: 'center' as const,
    marginTop: 18,
    paddingHorizontal: 20,
  },
  createHint: {
    fontSize: 13,
    color: '#9595A8',
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    letterSpacing: 0.2,
  },
});
