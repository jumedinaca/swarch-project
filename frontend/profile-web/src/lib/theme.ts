export const nintendoTheme = {
  colors: {
    background: "#F4F3EE",
    cardBackground: "#FFFFFF",
    surfaceAlt: "#ECEAE3",
    surfaceMuted: "#E2DFD6",
    famicomRed: "#B52B32",
    famicomRedLight: "#FDF1F1",
    famicomRedBorder: "#F2C6C8",
    wiiBlue: "#2563EB",
    wiiBlueLight: "#EFF6FF",
    wiiBlueBorder: "#BFDBFE",
    miiverseGreen: "#2D6A4F",
    miiverseGreenLight: "#EEF5ED",
    miiverseGreenBorder: "#C6DEC4",
    retroDpad: "#24272A",
    retroDpadLight: "#3A3F45",
    miiPeach: "#92400E",
    miiPeachLight: "#FEF3C7",
    textPrimary: "#1C1F22",
    textSecondary: "#525B62",
    textMuted: "#848E96",
    textLight: "#FFFFFF",
    borderLight: "#E2DFD8",
    borderMedium: "#CBC7BD",
    borderDark: "#24272A",
    pictoGridBg: "#FAF9F6",
    pictoGridLine: "#E7E4DC",
    avatarColors: ["#B52B32", "#2A5D84", "#2D6A4F", "#8A5A00", "#5E4378", "#2E6F68"],
  },
} as const;

export const avatarPalette = nintendoTheme.colors.avatarColors;

export const levelLadder = [
  { name: "Novato", min: 0, max: 49 },
  { name: "Miembro", min: 50, max: 149 },
  { name: "Confiable", min: 150, max: 349 },
  { name: "Experto", min: 350, max: 699 },
  { name: "Leyenda", min: 700, max: 1000 },
] as const;

export const DEFAULT_LOCATION = {
  latitude: 4.6382,
  longitude: -74.0841,
  radius: 1500,
  label: "Campus UNAL · Bogotá",
};

export const PROFILE_TABS = [
  { id: "profile", label: "PERFIL" },
  { id: "messages", label: "MENSAJES" },
  { id: "reputation", label: "REPUTACIÓN" },
  { id: "network", label: "RED" },
] as const;

export type ProfileTab = (typeof PROFILE_TABS)[number]["id"];
