export const RAIL_COOKIE = 'pg_rail';
export type RailState = 'open' | 'collapsed';

export const parseRailState = (value: string | undefined): RailState =>
  value === 'collapsed' ? 'collapsed' : 'open';

export const railCookie = (state: RailState) =>
  `${RAIL_COOKIE}=${state}; Path=/; Max-Age=31536000; SameSite=Lax`;
