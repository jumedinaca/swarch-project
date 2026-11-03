import { Friendship, UserProfile } from '../types';

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - 3600000 * h).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - 86400000 * d).toISOString();

/** Perfiles simulados para que la lista de amigos muestre usuarios y no ids. */
export const INITIAL_MOCK_PROFILES: UserProfile[] = [
  {
    userId: 'user-demo-1',
    username: 'ExploradorGeo',
    displayName: 'Explorador Geo',
    about: 'Cazando pictos por Bogotá.',
    avatarUrl: null,
    color: '#D64545',
  },
  {
    userId: 'user-demo-2',
    username: 'ViajeroContextual',
    displayName: 'Viajero Contextual',
    about: 'Siempre con una nota nueva para compartir.',
    avatarUrl: null,
    color: '#3F7FBF',
  },
  {
    userId: 'user-demo-3',
    username: 'PictoRolo',
    displayName: 'Picto Rolo',
    about: 'Dibujante de cuadernos y explorador de la ciudad.',
    avatarUrl: null,
    color: '#4C9A5A',
  },
  {
    userId: 'user-demo-4',
    username: 'EstudianteUN',
    displayName: 'Estudiante UN',
    about: 'Arte, campus y cafés escondidos.',
    avatarUrl: null,
    color: '#C08A2E',
  },
  {
    userId: 'user-demo-5',
    username: 'BiciRutaBta',
    displayName: 'Bici Ruta Bta',
    about: 'Rutas y planes sobre ruedas.',
    avatarUrl: null,
    color: '#8A5FBF',
  },
];

export const INITIAL_MOCK_FRIENDSHIPS: Friendship[] = [
  // Amistad aceptada entre ExploradorGeo y ViajeroContextual
  {
    id: 'friendship-mock-1',
    user_a: 'user-demo-1',
    user_b: 'user-demo-2',
    status: 'accepted',
    requested_by: 'user-demo-2',
    created_at: daysAgo(3),
    updated_at: daysAgo(2),
    other_user_id: 'user-demo-2',
    sent_by_me: false,
  },
  // Solicitud entrante para user-demo-1 (enviada por user-demo-4)
  {
    id: 'friendship-mock-2',
    user_a: 'user-demo-1',
    user_b: 'user-demo-4',
    status: 'pending',
    requested_by: 'user-demo-4',
    created_at: hoursAgo(5),
    updated_at: hoursAgo(5),
    other_user_id: 'user-demo-4',
    sent_by_me: false,
  },
  // Solicitud saliente de user-demo-1 (enviada a user-demo-3)
  {
    id: 'friendship-mock-3',
    user_a: 'user-demo-1',
    user_b: 'user-demo-3',
    status: 'pending',
    requested_by: 'user-demo-1',
    created_at: hoursAgo(2),
    updated_at: hoursAgo(2),
    other_user_id: 'user-demo-3',
    sent_by_me: true,
  },
];
