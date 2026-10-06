export const nintendoTheme = {
  colors: {
    // Fondos principales PictoChat Nintendo DS
    background: '#EAF0EC',        // Fondo clásico pantalla táctil PictoChat (verde grisáceo suave)
    cardBackground: '#FFFFFF',    // Lienzo blanco limpio
    surfaceAlt: '#E1E9E4',        // Superficie panel DS
    surfaceMuted: '#D8E2DC',      // Gris pizarra suave DS
    mintSoft: '#DFF4E8',          // Verde menta suave PictoChat
    mintBorder: '#84D8A7',
    
    // Salas clásicas PictoChat (Salas A, B, C y D)
    roomA: '#1A7BB9',             // Sala A: Azul cian PictoChat
    roomALight: '#E3F2FD',
    roomABorder: '#81C3EB',
    roomB: '#2E9E4B',             // Sala B: Verde lima PictoChat
    roomBLight: '#E5F7EB',
    roomBBorder: '#88DC9F',
    roomC: '#D97814',             // Sala C: Ámbar / Naranja PictoChat
    roomCLight: '#FDF1E2',
    roomCBorder: '#F7BD7E',
    roomD: '#CE2A6E',             // Sala D: Magenta PictoChat
    roomDLight: '#FDEAF1',
    roomDBorder: '#F38BB5',

    // Alias retrocompatibles para no alterar código existente
    wiiBlue: '#1A7BB9',           // PictoChat Azul principal
    wiiBlueLight: '#E3F2FD',
    miiverseGreen: '#2E9E4B',     // PictoChat Verde principal
    miiverseGreenLight: '#E5F7EB',
    miiPeach: '#D97814',
    miiPeachLight: '#FDF1E2',
    berryPink: '#CE2A6E',
    berryPinkLight: '#FDEAF1',

    // Hardware e indicadores Nintendo DS
    dsWirelessGreen: '#1DB954',   // Señal inalámbrica verde Nintendo DS
    dsBatteryGreen: '#25A244',
    dsBezelDark: '#21272A',       // Carcasa grafito Nintendo DS Lite / DSi
    dsBezelLight: '#DFE5E2',      // Carcasa blanca polar DS
    dsHinge: '#30383D',
    dsButtonFace: '#F3F7F5',      // Botón táctil DS
    dsButtonBorder: '#2C3539',    // Borde negro marcado PictoChat
    
    // Tipografía y textos
    textPrimary: '#1E2528',       // Tinta carbón oscura nítida PictoChat
    textSecondary: '#536268',     // Subtítulos y metadatos
    textMuted: '#7D8E94',         // Marcadores y placeholders
    textLight: '#FFFFFF',

    // Cuadrícula y marcos PictoChat
    pictoBorder: '#242D30',       // Borde sólido de alta definición PictoChat
    pictoBorderSoft: '#BAC7C1',   // Borde secundario de paneles
    pictoGridBg: '#FAFDFB',       // Fondo de libreta
    pictoGridLine: '#DEE7E2',     // Líneas pautadas del lienzo de dibujo
    pictoGridDot: '#CBD6D0',

    // Estados del mensaje adaptados a sellos PictoChat
    status: {
      publicado: {
        bg: '#E5F7EB',
        text: '#1E7E3B',
        border: '#6FD192',
        label: 'Publicado',
      },
      pendiente: {
        bg: '#FDF1E2',
        text: '#A65805',
        border: '#F7BD7E',
        label: 'Pendiente',
      },
      oculto: {
        bg: '#E6ECE9',
        text: '#4F5D62',
        border: '#B6C4BE',
        label: 'Oculto',
      },
      eliminado: {
        bg: '#FDEBEB',
        text: '#AF2424',
        border: '#F59696',
        label: 'Eliminado',
      },
    },

    // Colores para avatares y marcadores (inspirados en stylus y salas DS)
    avatarColors: ['#1A7BB9', '#2E9E4B', '#D97814', '#CE2A6E', '#7846BA'],
  },

  // Radios de borde PictoChat (ligeramente redondeados, botones táctiles DS y pestañas)
  borderRadius: {
    xs: 4,
    sm: 6,
    md: 10,
    lg: 14,
    pill: 20,
  },

  shadows: {
    // Sombra táctil estilo botón de consola Nintendo DS (bisel y relieve inferior)
    wiiSoft: {
      shadowColor: '#1A2422',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 3,
      elevation: 2,
    },
    wiiGlossy: {
      shadowColor: '#1E2528',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.18,
      shadowRadius: 4,
      elevation: 3,
    },
    pictoCard: {
      shadowColor: '#1E2528',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.14,
      shadowRadius: 4,
      elevation: 3,
    },
    // Bisel físico DS
    dsTactile: {
      shadowColor: '#20292C',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.22,
      shadowRadius: 1,
      elevation: 3,
    },
  },
};
