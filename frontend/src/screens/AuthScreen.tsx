import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
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
import {
  validateUsername,
  validateEmail,
  validatePassword,
  validateUsernameOrEmail,
} from '../utils/validators';

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

    const userVal = validateUsernameOrEmail(username);
    if (!userVal.isValid) {
      setLocalError(userVal.error || 'Por favor ingresa tu nombre de usuario o correo.');
      return;
    }

    const passVal = validatePassword(password, false);
    if (!passVal.isValid) {
      setLocalError(passVal.error || 'Ingresa tu contraseña.');
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

    const userVal = validateUsername(username);
    if (!userVal.isValid) {
      setLocalError(userVal.error || 'Nombre de usuario inválido.');
      return;
    }

    const emailVal = validateEmail(email);
    if (!emailVal.isValid) {
      setLocalError(emailVal.error || 'Correo electrónico inválido.');
      return;
    }

    const passVal = validatePassword(password, true);
    if (!passVal.isValid) {
      setLocalError(passVal.error || 'La contraseña debe tener al menos 8 caracteres.');
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
        {/* Encabezado Editorial Retro Nintendo */}
        <View style={styles.headerBanner}>
          <View style={styles.systemTag}>
            <Text style={styles.systemTagText}>[ SISTEMA GEOESPACIAL // V1.0 ]</Text>
          </View>

          <View style={styles.logoBadge}>
            <View style={styles.logoWrapper}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logoImage}
                accessibilityLabel="Logo de GeoPicto"
              />
            </View>
            <View>
              <Text style={styles.logoTitle}>GeoPicto</Text>
              <Text style={styles.logoSubtitle}>Red de Notas de Proximidad</Text>
            </View>
          </View>
        </View>

        {/* Tarjeta Bento principal de Autenticación */}
        <View style={styles.authCard}>
          {/* Selector de modo estilo pestañas de cartucho */}
          <View style={styles.modeToggleContainer}>
            <TouchableOpacity
              style={[styles.modeToggleTab, mode === 'login' && styles.modeToggleActive]}
              onPress={() => switchMode('login')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.modeToggleText,
                  mode === 'login' && styles.modeToggleTextActive,
                ]}
              >
                INICIAR SESIÓN
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modeToggleTab, mode === 'register' && styles.modeToggleActive]}
              onPress={() => switchMode('register')}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.modeToggleText,
                  mode === 'register' && styles.modeToggleTextActive,
                ]}
              >
                REGISTRARSE
              </Text>
            </TouchableOpacity>
          </View>

          {/* Formulario de Inicio de Sesión */}
          {mode === 'login' ? (
            <View style={styles.formSection}>
              <Text style={styles.sectionSubtitle}>
                Ingresa con tus credenciales para acceder a la red:
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>USUARIO O CORREO</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={16} color={nintendoTheme.colors.textSecondary} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="ej. explorador o correo@ejemplo.com"
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={[styles.fieldGroup, { marginTop: 12 }]}>
                <Text style={styles.fieldLabel}>CONTRASEÑA</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={16} color={nintendoTheme.colors.textSecondary} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="••••••••"
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {displayedError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={15} color={nintendoTheme.colors.famicomRed} />
                  <Text style={styles.errorText}>{displayedError}</Text>
                </View>
              ) : null}

              <WiiButton
                title={isLoading ? 'CONECTANDO...' : 'INICIAR SESIÓN'}
                variant="primary"
                size="lg"
                disabled={isLoading}
                onPress={handleLogin}
                style={{ marginTop: 18 }}
              />
            </View>
          ) : (
            /* Formulario de Registro */
            <View style={styles.formSection}>
              <Text style={styles.sectionSubtitle}>
                Crea un nuevo perfil para publicar notas en el mapa:
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>NOMBRE DE USUARIO</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="person-outline" size={16} color={nintendoTheme.colors.textSecondary} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="ej. explorador_01"
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={[styles.fieldGroup, { marginTop: 12 }]}>
                <Text style={styles.fieldLabel}>CORREO ELECTRÓNICO</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="mail-outline" size={16} color={nintendoTheme.colors.textSecondary} />
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
              </View>

              <View style={[styles.fieldGroup, { marginTop: 12 }]}>
                <Text style={styles.fieldLabel}>CONTRASEÑA (MÍNIMO 8 CARACTERES)</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="lock-closed-outline" size={16} color={nintendoTheme.colors.textSecondary} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="••••••••"
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {displayedError ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={15} color={nintendoTheme.colors.famicomRed} />
                  <Text style={styles.errorText}>{displayedError}</Text>
                </View>
              ) : null}

              <WiiButton
                title={isLoading ? 'REGISTRANDO...' : 'CREAR CUENTA'}
                variant="mint"
                size="lg"
                disabled={isLoading}
                onPress={handleRegister}
                style={{ marginTop: 18 }}
              />
            </View>
          )}
        </View>

        {/* Pie de página con información del sistema */}
        <View style={styles.systemFooter}>
          <Text style={styles.footerNote}>GEOPICTO CONTEXTUAL CLIENT // BOGOTÁ RADAR</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 20,
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
  },
  headerBanner: {
    alignItems: 'center',
    marginBottom: 16,
  },
  systemTag: {
    marginBottom: 8,
  },
  systemTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textMuted,
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  logoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    ...nintendoTheme.shadows.wiiSoft,
  },
  logoWrapper: {
    width: 44,
    height: 44,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 3,
    backgroundColor: '#FAF9F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 36,
    height: 36,
  },
  logoTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.3,
  },
  logoSubtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  authCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    ...nintendoTheme.shadows.pictoCard,
  },
  modeToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#ECEAE3',
    borderRadius: nintendoTheme.borderRadius.sm,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  modeToggleTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: nintendoTheme.borderRadius.xs,
  },
  modeToggleActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBC7BD',
  },
  modeToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  modeToggleTextActive: {
    color: nintendoTheme.colors.textPrimary,
  },
  formSection: {
    width: '100%',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 14,
    lineHeight: 16,
  },
  fieldGroup: {
    width: '100%',
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 5,
    letterSpacing: 0.6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: '#D4D0C6',
    paddingHorizontal: 12,
    height: 42,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 13,
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.famicomRedBorder,
    padding: 8,
    marginTop: 12,
  },
  errorText: {
    color: nintendoTheme.colors.famicomRed,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  systemFooter: {
    alignItems: 'center',
    marginTop: 16,
  },
  footerNote: {
    fontSize: 9,
    color: nintendoTheme.colors.textMuted,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
