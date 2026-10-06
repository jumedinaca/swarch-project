import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { nintendoTheme } from '../theme/nintendoTheme';
import { WiiButton } from '../components/common/WiiButton';

interface AuthScreenProps {
  onSuccess: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onSuccess }) => {
  const { login, register, isLoading, authError, clearError } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const displayedError = localError || authError;

  const handleLogin = async () => {
    setLocalError('');
    clearError();
    if (!username.trim()) {
      setLocalError('Por favor ingresa tu nombre de usuario o correo.');
      return;
    }
    const success = await login(username, password);
    if (success) {
      onSuccess();
    }
  };

  const handleRegister = async () => {
    setLocalError('');
    clearError();
    if (!username.trim()) {
      setLocalError('Ingresa un nombre de usuario.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setLocalError('Ingresa un correo electrónico válido.');
      return;
    }

    const success = await register(username, email, password);
    if (success) {
      onSuccess();
    }
  };

  const switchMode = (newMode: 'login' | 'register') => {
    setLocalError('');
    clearError();
    setMode(newMode);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Banner de Bienvenida estilo Menú Wii */}
        <View style={styles.headerBanner}>
          <View style={styles.logoBadge}>
            <View style={styles.logoIconBg}>
              <Ionicons name="chatbubbles" size={26} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.logoTitle}>GeoPicto</Text>
              <Text style={styles.logoSubtitle}>Plataforma Geoespacial Contextual</Text>
            </View>
          </View>
        </View>

        {/* Tarjeta principal estilo canal de Wii / consola Nintendo */}
        <View style={styles.authCard}>
          {/* Selector de modo estilo píldora */}
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[styles.modeToggleTab, mode === 'login' && styles.modeToggleActive]}
              onPress={() => switchMode('login')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="log-in-outline"
                size={16}
                color={mode === 'login' ? nintendoTheme.colors.wiiBlue : nintendoTheme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.modeToggleText,
                  mode === 'login' && styles.modeToggleTextActive,
                ]}
              >
                Iniciar Sesión
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeToggleTab, mode === 'register' && styles.modeToggleActive]}
              onPress={() => switchMode('register')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="person-add-outline"
                size={16}
                color={mode === 'register' ? nintendoTheme.colors.miiverseGreen : nintendoTheme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.modeToggleText,
                  mode === 'register' && styles.modeToggleTextActive,
                ]}
              >
                Registrarse
              </Text>
            </TouchableOpacity>
          </View>

          {/* Formulario de Inicio de Sesión */}
          {mode === 'login' ? (
            <View style={styles.formSection}>
              <Text style={styles.sectionSubtitle}>
                Ingresa con tu cuenta para descubrir y publicar notas:
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={18} color={nintendoTheme.colors.textSecondary} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Usuario o correo electrónico"
                  placeholderTextColor={nintendoTheme.colors.textMuted}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              </View>

              <View style={[styles.inputContainer, { marginTop: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color={nintendoTheme.colors.textSecondary} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Contraseña"
                  placeholderTextColor={nintendoTheme.colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              {displayedError ? <Text style={styles.errorText}>{displayedError}</Text> : null}

              <WiiButton
                title={isLoading ? 'Conectando...' : 'Iniciar Sesión'}
                variant="primary"
                size="lg"
                disabled={isLoading}
                onPress={handleLogin}
                style={{ marginTop: 20 }}
              />
            </View>
          ) : (
            /* Formulario de Registro */
            <View style={styles.formSection}>
              <Text style={styles.sectionSubtitle}>
                Crea una cuenta para compartir notas contextuales:
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={18} color={nintendoTheme.colors.textSecondary} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Nombre de usuario"
                  placeholderTextColor={nintendoTheme.colors.textMuted}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                />
              </View>

              <View style={[styles.inputContainer, { marginTop: 12 }]}>
                <Ionicons name="mail-outline" size={18} color={nintendoTheme.colors.textSecondary} />
                <TextInput
                  style={styles.textInput}
                  placeholder="correo@ejemplo.com"
                  placeholderTextColor={nintendoTheme.colors.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              </View>

              <View style={[styles.inputContainer, { marginTop: 12 }]}>
                <Ionicons name="lock-closed-outline" size={18} color={nintendoTheme.colors.textSecondary} />
                <TextInput
                  style={styles.textInput}
                  placeholder="Contraseña"
                  placeholderTextColor={nintendoTheme.colors.textMuted}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </View>

              {displayedError ? <Text style={styles.errorText}>{displayedError}</Text> : null}

              <WiiButton
                title={isLoading ? 'Registrando...' : 'Crear Cuenta'}
                variant="mint"
                size="lg"
                disabled={isLoading}
                onPress={handleRegister}
                style={{ marginTop: 20 }}
              />
            </View>
          )}
        </View>

        {/* Nota informativa estética estilo manual de Nintendo */}
        <View style={styles.footerNote}>
          <Ionicons name="sparkles-outline" size={14} color={nintendoTheme.colors.textMuted} />
          <Text style={styles.footerNoteText}>
            Inspirado en la estética lúdica y minimalista de Nintendo (Wii y DS).
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: nintendoTheme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 24,
    maxWidth: 440,
    alignSelf: 'center',
    width: '100%',
  },
  headerBanner: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: nintendoTheme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: '#DFE8E4',
    ...nintendoTheme.shadows.wiiSoft,
  },
  logoIconBg: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: nintendoTheme.colors.wiiBlue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: nintendoTheme.colors.wiiBlue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  logoTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  logoSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
  },
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 22,
    borderWidth: 1.5,
    borderColor: '#DDE6E2',
    ...nintendoTheme.shadows.wiiSoft,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#EEF3F1',
    borderRadius: nintendoTheme.borderRadius.pill,
    padding: 4,
    marginBottom: 18,
  },
  modeToggleTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: nintendoTheme.borderRadius.pill,
    gap: 6,
  },
  modeToggleActive: {
    backgroundColor: '#FFFFFF',
    ...nintendoTheme.shadows.wiiSoft,
  },
  modeToggleText: {
    fontSize: 13,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
  },
  modeToggleTextActive: {
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '700',
  },
  formSection: {
    width: '100%',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 16,
    lineHeight: 18,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#D4DFDB',
    paddingHorizontal: 14,
    height: 48,
    gap: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    textAlign: 'center',
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 20,
  },
  footerNoteText: {
    fontSize: 11,
    color: nintendoTheme.colors.textMuted,
    fontStyle: 'italic',
  },
});
