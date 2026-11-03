import { colorForId } from "./format";
import type {
  AccountData,
  AccountMessage,
  NetworkMember,
  Profile,
  ReputationEntry,
} from "./types";
import { nintendoTheme } from "./theme";

export const DEMO_USER_ID = "user-demo-1";

const now = Date.now();
const hoursAgo = (hours: number) => new Date(now - hours * 3600_000).toISOString();

function profile(
  userId: string,
  username: string,
  displayName: string,
  about: string,
  color: string,
  avatarUrl: string | null = null,
): Profile {
  return {
    userId,
    username,
    displayName,
    about,
    avatarUrl,
    color,
    createdAt: hoursAgo(24 * 40),
    updatedAt: hoursAgo(4),
  };
}

const profiles: Record<string, Profile> = {
  [DEMO_USER_ID]: profile(
    DEMO_USER_ID,
    "ExploradorGeo",
    "Explorador Geo",
    "Cazando pictos y notas contextuales por Bogotá. Me gustan el café, los mapas y las historias que deja la gente en el territorio.",
    nintendoTheme.colors.famicomRed,
  ),
  "user-demo-2": profile(
    "user-demo-2",
    "ViajeroContextual",
    "Viajero Contextual",
    "Siempre con la cámara lista y una nota nueva para compartir.",
    nintendoTheme.colors.avatarColors[1],
  ),
  "user-demo-3": profile(
    "user-demo-3",
    "PictoRolo",
    "Picto Rolo",
    "Dibujante de cuadernos y explorador de la ciudad.",
    nintendoTheme.colors.avatarColors[2],
  ),
  "user-demo-4": profile(
    "user-demo-4",
    "EstudianteUN",
    "Estudiante UN",
    "Arte, campus y cafés escondidos de Teusaquillo.",
    nintendoTheme.colors.avatarColors[3],
  ),
  "user-demo-5": profile(
    "user-demo-5",
    "BiciRutaBta",
    "Bici Ruta Bta",
    "Reporto rutas, estaciones y planes sobre ruedas.",
    nintendoTheme.colors.avatarColors[4],
  ),
  "user-demo-6": profile(
    "user-demo-6",
    "CafeteroAndino",
    "Cafetero Andino",
    "La mejor ruta siempre termina en una buena taza de café.",
    nintendoTheme.colors.avatarColors[5],
  ),
  "user-demo-7": profile(
    "user-demo-7",
    "RoloViajero",
    "Rolo Viajero",
    "Recorriendo el centro histórico una nota a la vez.",
    nintendoTheme.colors.avatarColors[1],
  ),
};

function message(
  id: string,
  authorId: string,
  content: string,
  latitude: number,
  longitude: number,
  createdAt: string,
  status: AccountMessage["status"] = "publicado",
): AccountMessage {
  const author = profiles[authorId];
  return {
    id,
    authorId,
    authorName: author?.displayName || author?.username || `Explorador ${authorId.slice(0, 4)}`,
    authorColor: author?.color || colorForId(authorId),
    content,
    latitude,
    longitude,
    createdAt,
    status,
    moderationStatus: status === "publicado" ? "ALLOW" : "PENDING",
    isMine: authorId === DEMO_USER_ID,
  };
}

const messages: AccountMessage[] = [
  message(
    "demo-msg-1",
    DEMO_USER_ID,
    "¡Bienvenidos a la Plaza GeoPicto! Explora notas contextuales en 3D en Bogotá.",
    4.6382,
    -74.0841,
    hoursAgo(2),
  ),
  message(
    "demo-msg-2",
    "user-demo-4",
    "Encuentro de dibujo en la Plaza Che hoy a las 4pm. Traigan sus libretas.",
    4.6373,
    -74.0833,
    hoursAgo(1),
  ),
  message(
    "demo-msg-3",
    "user-demo-2",
    "Café delicioso cerca de la fuente central del campus. ¡Recomendadísimo!",
    4.6395,
    -74.0825,
    hoursAgo(4),
  ),
  message(
    "demo-msg-4",
    DEMO_USER_ID,
    "Museo del Oro: exhibición de orfebrería precolombina con entrada gratuita los domingos.",
    4.6018,
    -74.0721,
    hoursAgo(7),
  ),
  message(
    "demo-msg-5",
    "user-demo-3",
    "Auditorio León de Greiff: ensayo abierto de la Orquesta Filarmónica esta tarde.",
    4.6364,
    -74.0827,
    hoursAgo(3),
  ),
  message(
    "demo-msg-6",
    "user-demo-5",
    "Bici-estación sobre la Calle 26 funcionando con normalidad. Vía despejada.",
    4.6355,
    -74.088,
    hoursAgo(2),
  ),
  message(
    "demo-msg-7",
    DEMO_USER_ID,
    "Nueva nota en revisión: probando el radar de mensajes cercanos.",
    4.6401,
    -74.0846,
    hoursAgo(0.5),
    "pendiente",
  ),
  message(
    "demo-msg-8",
    "user-demo-6",
    "El bulevar del Park Way está florecido. Tarde perfecta para caminar con mascotas.",
    4.6315,
    -74.0725,
    hoursAgo(3),
  ),
];

function member(
  id: string,
  userId: string,
  status: "pending" | "accepted",
  requestedBy: string,
  createdAt: string,
): NetworkMember {
  const otherProfile = profiles[userId] ?? null;
  return {
    userId,
    profile: otherProfile,
    friendship: {
      id,
      user_a: requestedBy === DEMO_USER_ID ? DEMO_USER_ID : userId,
      user_b: requestedBy === DEMO_USER_ID ? userId : DEMO_USER_ID,
      status,
      requested_by: requestedBy,
      created_at: createdAt,
      updated_at: createdAt,
      other_user_id: userId,
      sent_by_me: requestedBy === DEMO_USER_ID,
    },
  };
}

const history: ReputationEntry[] = [
  {
    id: "rep-1",
    delta: 2,
    appliedDelta: 2,
    reason: "LIKE_RECEIVED",
    scoreAfter: 382,
    createdAt: hoursAgo(3),
  },
  {
    id: "rep-2",
    delta: 1,
    appliedDelta: 1,
    reason: "MESSAGE_ALLOWED",
    scoreAfter: 380,
    createdAt: hoursAgo(9),
  },
  {
    id: "rep-3",
    delta: 2,
    appliedDelta: 2,
    reason: "LIKE_RECEIVED",
    scoreAfter: 379,
    createdAt: hoursAgo(26),
  },
  {
    id: "rep-4",
    delta: -3,
    appliedDelta: -3,
    reason: "MESSAGE_WARNED",
    scoreAfter: 377,
    createdAt: hoursAgo(31),
  },
  {
    id: "rep-5",
    delta: 2,
    appliedDelta: 2,
    reason: "LIKE_RECEIVED",
    scoreAfter: 380,
    createdAt: hoursAgo(48),
  },
];

export const DEMO_ACCOUNT: AccountData = {
  profile: profiles[DEMO_USER_ID],
  reputation: {
    userId: DEMO_USER_ID,
    score: 382,
    level: "Experto",
    levelIndex: 3,
    nextLevelAt: 700,
    progress: (382 - 350) / (700 - 350),
    likesReceived: 214,
    dislikesReceived: 9,
    messagesBlocked: 1,
    messagesWarned: 3,
    updatedAt: hoursAgo(3),
  },
  history,
  messages,
  network: {
    friends: [
      member("friendship-demo-1", "user-demo-2", "accepted", "user-demo-2", hoursAgo(24 * 12)),
      member("friendship-demo-2", "user-demo-3", "accepted", DEMO_USER_ID, hoursAgo(24 * 8)),
      member("friendship-demo-3", "user-demo-6", "accepted", "user-demo-6", hoursAgo(24 * 4)),
    ],
    incoming: [
      member("friendship-demo-4", "user-demo-4", "pending", "user-demo-4", hoursAgo(5)),
      member("friendship-demo-5", "user-demo-5", "pending", "user-demo-5", hoursAgo(18)),
    ],
    outgoing: [member("friendship-demo-6", "user-demo-7", "pending", DEMO_USER_ID, hoursAgo(2))],
  },
  loadedAt: new Date().toISOString(),
};

export function demoProfiles(): Record<string, Profile> {
  return profiles;
}
