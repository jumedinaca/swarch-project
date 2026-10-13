import { Friendship } from '../types';

const now = new Date();
const hoursAgo = (h: number) => new Date(now.getTime() - 3600000 * h).toISOString();
const daysAgo = (d: number) => new Date(now.getTime() - 86400000 * d).toISOString();

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
