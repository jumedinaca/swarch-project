export const nintendoTheme = {
  colors: {
    // Fondos principales (Chasis retro Nintendo / Warm Monochrome)
    background: '#F4F3EE',        // Tono hueso cálido clásico Game Boy / Famicom
    cardBackground: '#FFFFFF',    // Superficie blanca limpia para bento cards
    surfaceAlt: '#ECEAE3',        // Gris perla cálido de contraste
    surfaceMuted: '#E2DFD6',      // Superficie secundaria hundida / bisel
    
    // Acentos icónicos retro Nintendo (desaturados y editoriales)
    famicomRed: '#B52B32',        // Rojo burdeos clásico Famicom / botón B
    famicomRedLight: '#FDF1F1',
    famicomRedBorder: '#F2C6C8',

    wiiBlue: '#2563EB',           // Azul técnico sutil
    wiiBlueLight: '#EFF6FF',
    wiiBlueBorder: '#BFDBFE',

    miiverseGreen: '#2D6A4F',     // Verde LCD / césped retro
    miiverseGreenLight: '#EEF5ED',
    miiverseGreenBorder: '#C6DEC4',

    retroDpad: '#24272A',         // Carbón mate de cruceta direccional D-Pad
    retroDpadLight: '#3A3F45',

    miiPeach: '#92400E',          // Ámbar cálido / hardware
    miiPeachLight: '#FEF3C7',

    // Textos de alta legibilidad editorial
    textPrimary: '#1C1F22',       // Carbón profundo (no negro puro #000)
    textSecondary: '#525B62',     // Gris editorial medio
    textMuted: '#848E96',         // Metadatos y notas técnicas
    textLight: '#FFFFFF',

    // Líneas estructurales y cuadrícula PictoChat
    borderLight: '#E2DFD8',       // Borde ultra-ligero bento
    borderMedium: '#CBC7BD',      // Borde de separación
    borderDark: '#24272A',        // Borde nítido retro 1.5px
    pictoBorder: '#24272A',       // Borde contorno PictoChat
    pictoBorderSoft: '#D8D4CA',   // Borde secundario de cuadrícula
    pictoGridBg: '#FAF9F6',       // Papel cuadriculado PictoChat
    pictoGridLine: '#E7E4DC',     // Línea tenue de libreta

    // Estados semánticos (pasteles apagados acordes al protocolo minimalist-ui)
    status: {
      publicado: {
        bg: '#EDF5EE',
        text: '#275E33',
        border: '#C2DEC5',
        label: 'Publicado',
      },
      pendiente: {
        bg: '#FDF6E4',
        text: '#8A5A00',
        border: '#F4E2B2',
        label: 'Pendiente',
      },
      oculto: {
        bg: '#F0F2F4',
        text: '#4B5762',
        border: '#D3D8DD',
        label: 'Oculto',
      },
      eliminado: {
        bg: '#FDF0F0',
        text: '#A62626',
        border: '#F5C6C6',
        label: 'Eliminado',
      },
    },

    // Paleta de avatares retro (tonos apagados y con carácter)
    avatarColors: ['#B52B32', '#2A5D84', '#2D6A4F', '#8A5A00', '#5E4378', '#2E6F68'],
  },

  borderRadius: {
    xs: 3,
    sm: 6,
    md: 8,
    lg: 12,
    pill: 9999,
  },

  // Sombras ultra-difusas (< 0.05 de opacidad o planas táctiles)
  shadows: {
    wiiSoft: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 3,
      elevation: 1,
    },
    wiiGlossy: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 5,
      elevation: 2,
    },
    pictoCard: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 3,
      elevation: 1,
    },
    retroPhysical: {
      shadowColor: '#1A1D20',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 0,
      elevation: 2,
    },
  },
};
