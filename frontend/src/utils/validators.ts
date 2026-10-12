/**
 * Utilidades de validación para GeoPicto
 * Asegura que las entradas del usuario cumplan con los contratos del API Gateway
 * y los microservicios de Autenticación, Mensajes y Red Social.
 */

// Patrón de username exigido por services/auth: letras, números, '.', '_' o '-'
export const USERNAME_REGEX = /^[\w.-]+$/;

// Patrón estándar para validación de correo electrónico
export const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Patrón estándar UUID v4
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Valida el nombre de usuario según las reglas de services/auth:
 * - Longitud entre 3 y 30 caracteres
 * - Solo letras, números, '.', '_' o '-'
 */
export function validateUsername(username: string): ValidationResult {
  const trimmed = username.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Ingresa un nombre de usuario.' };
  }
  if (trimmed.length < 3 || trimmed.length > 30) {
    return {
      isValid: false,
      error: 'El usuario debe tener entre 3 y 30 caracteres.',
    };
  }
  if (!USERNAME_REGEX.test(trimmed)) {
    return {
      isValid: false,
      error: 'Solo se permiten letras, números, puntos (.), guiones (-) y guiones bajos (_).',
    };
  }
  return { isValid: true };
}

/**
 * Valida el formato de correo electrónico
 */
export function validateEmail(email: string): ValidationResult {
  const trimmed = email.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Ingresa un correo electrónico.' };
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return { isValid: false, error: 'Ingresa un correo electrónico válido (ej: usuario@dominio.com).' };
  }
  return { isValid: true };
}

/**
 * Valida la contraseña según las reglas de services/auth:
 * - En registro: mínimo 8 caracteres, máximo 128
 * - En login: mínimo 1 carácter
 */
export function validatePassword(password: string, isRegister: boolean = false): ValidationResult {
  if (!password) {
    return { isValid: false, error: 'Ingresa una contraseña.' };
  }
  if (isRegister) {
    if (password.length < 8) {
      return { isValid: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
    }
    if (password.length > 128) {
      return { isValid: false, error: 'La contraseña no puede superar los 128 caracteres.' };
    }
  }
  return { isValid: true };
}

/**
 * Valida el identificador o correo para el login
 */
export function validateUsernameOrEmail(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Por favor ingresa tu nombre de usuario o correo.' };
  }
  return { isValid: true };
}

/**
 * Valida el contenido de una nota según services/messages y la estética PictoChat:
 * - No vacía ni solo espacios
 * - Máximo 140 caracteres
 */
export function validateMessageContent(content: string): ValidationResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { isValid: false, error: 'El mensaje no puede estar vacío.' };
  }
  if (trimmed.length > 140) {
    return { isValid: false, error: 'El mensaje no puede superar los 140 caracteres.' };
  }
  return { isValid: true };
}

/**
 * Valida coordenadas geográficas:
 * - Latitud entre -90 y 90
 * - Longitud entre -180 y 180
 */
export function validateCoordinates(lat: number, lng: number): ValidationResult {
  if (typeof lat !== 'number' || isNaN(lat) || lat < -90 || lat > 90) {
    return { isValid: false, error: 'Latitud inválida (debe estar entre -90 y 90).' };
  }
  if (typeof lng !== 'number' || isNaN(lng) || lng < -180 || lng > 180) {
    return { isValid: false, error: 'Longitud inválida (debe estar entre -180 y 180).' };
  }
  return { isValid: true };
}

/**
 * Verifica si un string es un UUID válido
 */
export function isValidUUID(id: string): boolean {
  return UUID_REGEX.test(id.trim());
}

/**
 * Valida el ID de destinatario para enviar solicitud de amistad:
 * - No vacío
 * - No puede ser uno mismo
 * - Debe ser un UUID válido (o identificador mock válido en modo de prueba)
 */
export function validateRecipientId(
  recipientId: string,
  currentUserId?: string,
  isMockMode: boolean = false
): ValidationResult {
  const trimmed = recipientId.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Ingresa el ID del usuario.' };
  }
  if (currentUserId && trimmed.toLowerCase() === currentUserId.trim().toLowerCase()) {
    return { isValid: false, error: 'No puedes enviarte una solicitud de amistad a ti mismo.' };
  }

  // En modo mock se permiten IDs como 'user-demo-1' o UUIDs reales
  if (isMockMode) {
    if (trimmed.length < 3) {
      return { isValid: false, error: 'El ID ingresado es demasiado corto.' };
    }
    return { isValid: true };
  }

  // En modo backend real, services/network exige UUID
  if (!isValidUUID(trimmed)) {
    return {
      isValid: false,
      error: 'El ID debe ser un UUID válido (ej: 123e4567-e89b-12d3-a456-426614174000).',
    };
  }

  return { isValid: true };
}
