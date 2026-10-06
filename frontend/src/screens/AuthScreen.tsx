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
        {/* Banner de Bienvenida estilo PictoChat Nintendo DS */}
        <View style={styles.headerBanner}>
          <View style={styles.logoBadge}>
            <View style={styles.logoIconBg}>
              <Ionicons name="chatbubbles" size={24} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.logoTitle}>PICTOCHAT</Text>
              <Text style={styles.logoSubtitle}>COMUNICACIÓN GEOESPACIAL DS</Text>
            </View>
          </View>

          {/* Selector decorativo de salas PictoChat (A, B, C, D) */}
          <View style={styles.roomsPreviewStrip}>
            <View style={[styles.roomIndicator, { backgroundColor: nintendoTheme.colors.roomA }]}>
              <Text style={styles.roomLetter}>A</Text>
            </View>
            <View style={[styles.roomIndicator, { backgroundColor: nintendoTheme.colors.roomB }]}>
              <Text style={styles.roomLetter}>B</Text>
            </View>
            <View style={[styles.roomIndicator, { backgroundColor: nintendoTheme.colors.roomC }]}>
              <Text style={styles.roomLetter}>C</Text>
            </View>
            <View style={[styles.roomIndicator, { backgroundColor: nintendoTheme.colors.roomD }]}>
              <Text style={styles.roomLetter}>D</Text>
            </View>
            <Text style={styles.roomsStatusLabel}>SALAS INALÁMBRICAS</Text>
          </View>
        </View>

        {/* Tarjeta principal estilo panel táctil Nintendo DS */}
        <View style={styles.authCard}>
          {/* Selector de modo estilo pestañas táctiles DS */}
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[styles.modeToggleTab, mode === 'login' && styles.modeToggleActive]}
              onPress={() => switchMode('login')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="log-in"
                size={15}
                color={mode === 'login' ? nintendoTheme.colors.roomA : nintendoTheme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.modeToggleText,
                  mode === 'login' && styles.modeToggleTextActive,
                ]}
              >
                ENTRAR
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeToggleTab, mode === 'register' && styles.modeToggleActive]}
              onPress={() => switchMode('register')}
              activeOpacity={0.8}
            >
              <Ionicons
                name="person-add"
                size={15}
                color={mode === 'register' ? nintendoTheme.colors.roomB : nintendoTheme.colors.textSecondary}
              />
              <Text
                style={[
                  styles.modeToggleText,
                  mode === 'register' && styles.modeToggleTextActive,
                ]}
              >
                REGISTRO
              </Text>
            </TouchableOpacity>
          </View>

          {/* Formulario de Inicio de Sesión */}
          {mode === 'login' ? (
            <View style={styles.formSection}>
              <Text style={styles.sectionSubtitle}>
                Conéctate para descubrir y emitir notas en tu área:
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons name="person" size={16} color={nintendoTheme.colors.textSecondary} />
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
                <Ionicons name="lock-closed" size={16} color={nintendoTheme.colors.textSecondary} />
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
                title={isLoading ? 'CONECTANDO...' : 'INICIAR SESIÓN'}
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
                Crea tu apodo DS para compartir notas en el mapa:
              </Text>

              <View style={styles.inputContainer}>
                <Ionicons name="person" size={16} color={nintendoTheme.colors.textSecondary} />
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
                <Ionicons name="mail" size={16} color={nintendoTheme.colors.textSecondary} />
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
                <Ionicons name="lock-closed" size={16} color={nintendoTheme.colors.textSecondary} />
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
                title={isLoading ? 'REGISTRANDO...' : 'CREAR CUENTA DS'}
                variant="mint"
                size="lg"
                disabled={isLoading}
                onPress={handleRegister}
                style={{ marginTop: 20 }}
              />
            </View>
          )}
        </View>

        {/* Nota informativa estética estilo manual de Nintendo DS */}
        <View style={styles.footerNote}>
          <Ionicons name="hardware-chip-outline" size={13} color={nintendoTheme.colors.textSecondary} />
          <Text style={styles.footerNoteText}>
            Nintendo DS Wireless Communications • PictoChat Protocol
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
    paddingVertical: 20,
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  headerBanner: {
    alignItems: 'center',
    marginBottom: 16,
  },
  logoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    ...nintendoTheme.shadows.pictoCard,
  },
  logoIconBg: {
    width: 42,
    height: 42,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: nintendoTheme.colors.roomA,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#125C8E',
  },
  logoTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 1.5,
  },
  logoSubtitle: {
    fontSize: 9.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  roomsPreviewStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    backgroundColor: '#FAFDFB',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  roomIndicator: {
    width: 18,
    height: 18,
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.2)',
  },
  roomLetter: {
    fontSize: 10,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  roomsStatusLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
    marginLeft: 4,
  },
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    padding: 18,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    ...nintendoTheme.shadows.pictoCard,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#E5EFE9',
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  modeToggleTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: nintendoTheme.borderRadius.xs,
    gap: 6,
  },
  modeToggleActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.pictoBorder,
    ...nintendoTheme.shadows.wiiSoft,
  },
  modeToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  modeToggleTextActive: {
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '900',
  },
  formSection: {
    width: '100%',
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 14,
    lineHeight: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 13,
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
  },
  errorText: {
    color: '#D43247',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
    textAlign: 'center',
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
  },
  footerNoteText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
