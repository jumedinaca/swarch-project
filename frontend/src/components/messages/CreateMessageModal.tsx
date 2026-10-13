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
import { validateMessageContent, validateCoordinates } from '../../utils/validators';

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

  const handlePublish = async () => {
    setErrorMsg('');

    const contentVal = validateMessageContent(content);
    if (!contentVal.isValid) {
      setErrorMsg(contentVal.error || 'Mensaje inválido.');
      return;
    }

    const coordsVal = validateCoordinates(targetCoords.latitude, targetCoords.longitude);
    if (!coordsVal.isValid) {
      setErrorMsg(coordsVal.error || 'Coordenadas inválidas.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await createMessage(content.trim(), targetCoords, 'publicado', 24);
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
          {/* Cabecera estilo libreta Nintendo PictoChat */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={[styles.stylusIconCircle, { backgroundColor: user?.color || nintendoTheme.colors.retroDpad }]}>
                <Ionicons name="pencil" size={13} color="#FFFFFF" />
              </View>
              <Text style={styles.modalTitle}>PICTOCHAT // NUEVA NOTA</Text>
            </View>

            <TouchableOpacity onPress={handleClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Libreta cuadriculada con área de texto */}
          <View style={styles.notepadContainer}>
            <View style={styles.notepadGridLine1} />
            <View style={styles.notepadGridLine2} />
            <View style={styles.notepadGridLine3} />

            <TextInput
              style={styles.notepadInput}
              placeholder="Escribe tu mensaje geoespacial contextual (máximo 140 caracteres)..."
              placeholderTextColor={nintendoTheme.colors.textMuted}
              value={content}
              onChangeText={setContent}
              maxLength={charLimit}
              multiline
              autoFocus
              textAlignVertical="top"
            />

            {/* Contador de caracteres reactivo */}
            <View style={styles.counterRow}>
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

          {/* Aviso de expiración en 24 horas */}
          <View style={styles.expirationNoticeBox}>
            <Ionicons name="time-outline" size={14} color={nintendoTheme.colors.textSecondary} />
            <Text style={styles.expirationNoticeText}>
              EXPIRACIÓN AUTOMÁTICA EN 24 HORAS
            </Text>
          </View>

          {errorMsg ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={14} color={nintendoTheme.colors.famicomRed} />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Botones de acción táctiles */}
          <View style={styles.actionButtonsRow}>
            <WiiButton
              title="CANCELAR"
              variant="secondary"
              onPress={handleClose}
              style={{ flex: 1 }}
            />
            <WiiButton
              title={isSubmitting ? 'PUBLICANDO...' : 'PUBLICAR NOTA'}
              variant="mint"
              icon={<Ionicons name="paper-plane" size={14} color="#FFFFFF" />}
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
    backgroundColor: 'rgba(20, 24, 28, 0.55)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.borderDark,
    padding: 16,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: nintendoTheme.colors.borderMedium,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stylusIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  closeIconButton: {
    padding: 4,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DFD8',
  },
  notepadContainer: {
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    padding: 10,
    position: 'relative',
    height: 120,
  },
  notepadGridLine1: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 34,
    height: 1,
    backgroundColor: '#EBE8E0',
  },
  notepadGridLine2: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 66,
    height: 1,
    backgroundColor: '#EBE8E0',
  },
  notepadGridLine3: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 98,
    height: 1,
    backgroundColor: '#EBE8E0',
  },
  notepadInput: {
    flex: 1,
    fontSize: 13,
    lineHeight: 20,
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    zIndex: 2,
  },
  counterRow: {
    alignItems: 'flex-end',
    marginTop: 2,
  },
  counterText: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  counterWarning: {
    color: '#D97706',
  },
  counterExceeded: {
    color: nintendoTheme.colors.famicomRed,
  },
  expirationNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECEAE3',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  expirationNoticeText: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.famicomRedBorder,
  },
  errorText: {
    color: nintendoTheme.colors.famicomRed,
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
});
