import type { ActorContext, Scope } from '../../contracts';
import { AppError } from '../errors';
export function requireScope(ctx: ActorContext, scope: Scope): void {
  if (!ctx.scopes.includes(scope)) throw new AppError('FORBIDDEN', `Scope ${scope} is required`);
}
