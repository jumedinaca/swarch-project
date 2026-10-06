export const nintendoTheme = {
  colors: {
    // Fondos principales Nintendo
    background: '#F5F8F7',        // Perla menta muy suave
    cardBackground: '#FFFFFF',    // Blanco brillante
    surfaceAlt: '#EDF3F1',        // Gris perla suave
    mintSoft: '#E6F7EF',          // Verde menta suave Wii/DS
    mintBorder: '#BDE8D4',
    
    // Acentos icónicos
    wiiBlue: '#009CD8',           // Azul botón menú Wii
    wiiBlueLight: '#D8F1FB',
    miiverseGreen: '#2DC653',     // Verde césped StreetPass / Miiverse
    miiverseGreenLight: '#E3F8EB',
    miiPeach: '#FFA94D',          // Naranja cálido Mii
    miiPeachLight: '#FFF2E2',
    berryPink: '#E84393',
    berryPinkLight: '#FDEBF4',
    
    // Textos
    textPrimary: '#283338',       // Gris carbón redondeado y suave (no negro puro agresivo)
    textSecondary: '#66757D',
    textMuted: '#95A5A6',
    textLight: '#FFFFFF',

    // Cuadrícula y marcos PictoChat
    pictoBorder: '#3A4449',       // Borde clásico definido PictoChat
    pictoBorderSoft: '#C2CBD0',
    pictoGridBg: '#F8FAF9',
    pictoGridLine: '#E3E9E7',

    // Estados del mensaje
    status: {
      publicado: {
        bg: '#E2F8EB',
        text: '#1B823D',
        border: '#A7E8C0',
        label: 'Publicado',
      },
      pendiente: {
        bg: '#FFF6DF',
        text: '#B27608',
        border: '#FCE09E',
        label: 'Pendiente',
      },
      oculto: {
        bg: '#EAEFF2',
        text: '#5B6970',
        border: '#CBD5DA',
        label: 'Oculto',
      },
      eliminado: {
        bg: '#FDEAEA',
        text: '#B92D2D',
        border: '#F8BDBD',
        label: 'Eliminado',
      },
    },

    // Colores para avatares y marcadores
    avatarColors: ['#2AC769', '#1EA4E8', '#F5A623', '#E84393', '#9B51E0'],
  },

  borderRadius: {
    sm: 10,
    md: 18,
    lg: 26,
    pill: 999,
  },

  shadows: {
    wiiSoft: {
      shadowColor: '#1A332B',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 3,
    },
    wiiGlossy: {
      shadowColor: '#0083B0',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.16,
      shadowRadius: 8,
      elevation: 4,
    },
    pictoCard: {
      shadowColor: '#283338',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 0.09,
      shadowRadius: 12,
      elevation: 4,
    },
  },
};
