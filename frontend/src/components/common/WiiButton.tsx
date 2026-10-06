import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { nintendoTheme } from '../../theme/nintendoTheme';

interface WiiButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'mint' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const WiiButton: React.FC<WiiButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  style,
  textStyle,
}) => {
  // Configuración de colores según variante
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          bg: nintendoTheme.colors.wiiBlue,
          border: '#0083B8',
          text: '#FFFFFF',
          gloss: 'rgba(255, 255, 255, 0.35)',
        };
      case 'mint':
        return {
          bg: nintendoTheme.colors.miiverseGreen,
          border: '#249C42',
          text: '#FFFFFF',
          gloss: 'rgba(255, 255, 255, 0.35)',
        };
      case 'danger':
        return {
          bg: '#E74C3C',
          border: '#C0392B',
          text: '#FFFFFF',
          gloss: 'rgba(255, 255, 255, 0.3)',
        };
      case 'secondary':
        return {
          bg: '#FFFFFF',
          border: '#D0DADB',
          text: nintendoTheme.colors.textPrimary,
          gloss: 'rgba(255, 255, 255, 0.7)',
        };
      case 'ghost':
        return {
          bg: 'transparent',
          border: 'transparent',
          text: nintendoTheme.colors.textSecondary,
          gloss: 'transparent',
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingVertical: 7,
          paddingHorizontal: 14,
          fontSize: 13,
          height: 34,
        };
      case 'lg':
        return {
          paddingVertical: 14,
          paddingHorizontal: 28,
          fontSize: 17,
          height: 52,
        };
      case 'md':
      default:
        return {
          paddingVertical: 10,
          paddingHorizontal: 20,
          fontSize: 15,
          height: 44,
        };
    }
  };

  const vConfig = getVariantStyles();
  const sConfig = getSizeStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.buttonBase,
        {
          backgroundColor: disabled ? '#D2DBDE' : vConfig.bg,
          borderColor: disabled ? '#BDC6C9' : vConfig.border,
          height: sConfig.height,
          paddingHorizontal: sConfig.paddingHorizontal,
        },
        variant !== 'ghost' && styles.shadow,
        style,
      ]}
    >
      {/* Brillo superior característico estilo glossy Nintendo Wii */}
      {variant !== 'ghost' && !disabled && (
        <View style={[styles.glossHighlight, { backgroundColor: vConfig.gloss }]} />
      )}

      <View style={styles.contentRow}>
        {icon && <View style={styles.iconWrapper}>{icon}</View>}
        <Text
          style={[
            styles.buttonText,
            {
              color: disabled ? '#8E9DA3' : vConfig.text,
              fontSize: sConfig.fontSize,
            },
            textStyle,
          ]}
        >
          {title}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  buttonBase: {
    borderRadius: nintendoTheme.borderRadius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  shadow: {
    shadowColor: '#1A332B',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  glossHighlight: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    height: '40%',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    opacity: 0.65,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    marginRight: 6,
  },
  buttonText: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
