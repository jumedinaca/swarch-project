import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Modal,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LocationCoords } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useMessages } from '../../context/MessagesContext';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { WiiButton } from '../common/WiiButton';
import {
  DEFAULT_BOGOTA_GROUND_ALTITUDE,
  getFloorFromRelativeAltitude,
} from '../../utils/geoUtils';

interface CreateMessageModalProps {
  visible: boolean;
  onClose: () => void;
  targetCoords: LocationCoords;
}

export const CreateMessageModal: React.FC<CreateMessageModalProps> = ({
  visible,
  onClose,
  targetCoords,
}) => {
  const { user } = useAuth();
  const { createMessage } = useMessages();

  const [content, setContent] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const charLimit = 140;
  const charsRemaining = charLimit - content.length;

  const relAlt = targetCoords.relativeAltitude ?? 0;
  const isElevated = relAlt >= 4;
  const altValue = targetCoords.altitude ?? (DEFAULT_BOGOTA_GROUND_ALTITUDE + relAlt);
  const floor = getFloorFromRelativeAltitude(relAlt);

  const handlePublish = async () => {
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      const res = await createMessage(content, targetCoords, 'publicado', 24);
      if (res.success) {
        setContent('');
        onClose();
      } else {
        setErrorMsg(res.error || 'No se pudo publicar la nota.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setErrorMsg('');
    setContent('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleClose}
          />
        </View>

        <View style={styles.modalCard}>
          {/* Cabecera estilo pantalla táctil Nintendo DS PictoChat */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.stylusIconSquare, { backgroundColor: user?.color || nintendoTheme.colors.roomA }]}>
                <Ionicons name="pencil" size={14} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.modalTitle}>PICTOCHAT • REDACTAR</Text>
                <Text style={styles.modalSubTitle}>CANVAS TÁCTIL DS</Text>
              </View>
            </View>

            <TouchableOpacity onPress={handleClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Libreta cuadriculada con área de texto y líneas pautadas clásicas de PictoChat */}
          <View style={styles.notepadContainer}>
            {/* Trama de líneas pautadas del lienzo táctil PictoChat */}
            <View style={styles.gridOverlay}>
              <View style={[styles.notepadGridLine, { top: 28 }]} />
              <View style={[styles.notepadGridLine, { top: 56 }]} />
              <View style={[styles.notepadGridLine, { top: 84 }]} />
              <View style={[styles.notepadGridLine, { top: 112 }]} />
            </View>

            <TextInput
              style={styles.notepadInput}
              placeholder="Escribe tu mensaje en la pantalla táctil (máximo 140 caracteres)..."
              placeholderTextColor={nintendoTheme.colors.textMuted}
              value={content}
              onChangeText={setContent}
              maxLength={charLimit}
              multiline
              autoFocus
              textAlignVertical="top"
            />

            {/* Contador de caracteres digital reactivo */}
            <View style={styles.counterRow}>
              <View style={styles.counterBadge}>
                <Text
                  style={[
                    styles.counterText,
                    charsRemaining <= 10 && styles.counterWarning,
                    charsRemaining === 0 && styles.counterExceeded,
                  ]}
                >
                  [{content.length} / {charLimit}]
                </Text>
              </View>
            </View>
          </View>

          {/* Indicador de Altitud y Piso en que se ancla la nota */}
          <View style={[styles.altitudeNoticeBox, isElevated && styles.altitudeNoticeBoxElevated]}>
            <Ionicons
              name={isElevated ? 'business' : 'layers-outline'}
              size={14}
              color={isElevated ? '#0D6832' : nintendoTheme.colors.roomA}
            />
            <Text style={[styles.altitudeNoticeText, isElevated && styles.altitudeNoticeTextElevated]}>
              ANCLAJE 3D: {altValue}m s.n.m.
              {isElevated
                ? ` • Edificio (Piso ${floor}, +${relAlt}m)`
                : ' • Nivel Suelo / Calle'}
            </Text>
          </View>

          {/* Aviso de expiración en 24 horas */}
          <View style={styles.expirationNoticeBox}>
            <Ionicons name="time" size={14} color={nintendoTheme.colors.roomA} />
            <Text style={styles.expirationNoticeText}>
              TRANSMISIÓN ACTIVA POR 24 HORAS EN EL MAPA
            </Text>
          </View>

          {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

          {/* Botones de acción táctiles PictoChat */}
          <View style={styles.actionButtonsRow}>
            <WiiButton
              title="CANCELAR"
              variant="secondary"
              onPress={handleClose}
              style={{ flex: 1 }}
            />
            <WiiButton
              title={isSubmitting ? 'ENVIANDO...' : 'ENVIAR NOTA'}
              variant="mint"
              icon={<Ionicons name="send" size={14} color="#FFFFFF" />}
              onPress={handlePublish}
              disabled={content.trim().length === 0 || isSubmitting}
              style={{ flex: 1.4 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(24, 32, 35, 0.6)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 2,
    borderColor: nintendoTheme.colors.pictoBorder,
    padding: 16,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: nintendoTheme.colors.pictoBorder,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stylusIconSquare: {
    width: 26,
    height: 26,
    borderRadius: nintendoTheme.borderRadius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  modalSubTitle: {
    fontSize: 8.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  closeIconButton: {
    width: 28,
    height: 28,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#F0F6F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  notepadContainer: {
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    padding: 10,
    position: 'relative',
    height: 135,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
  },
  notepadGridLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: '#E5EDE8',
  },
  notepadInput: {
    flex: 1,
    fontSize: 13.5,
    lineHeight: 28,
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
    zIndex: 2,
  },
  counterRow: {
    alignItems: 'flex-end',
    marginTop: 2,
    zIndex: 3,
  },
  counterBadge: {
    backgroundColor: '#EEF5F1',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#D4E0DA',
  },
  counterText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.3,
  },
  counterWarning: {
    color: '#D97814',
  },
  counterExceeded: {
    color: '#D43247',
  },
  altitudeNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  altitudeNoticeBoxElevated: {
    backgroundColor: '#EEF9F1',
    borderColor: '#2CD96B',
  },
  altitudeNoticeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.3,
  },
  altitudeNoticeTextElevated: {
    color: '#0D6832',
  },
  expirationNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3FAF6',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  expirationNoticeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.3,
  },
  errorText: {
    color: '#D43247',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 6,
    textAlign: 'center',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
});
