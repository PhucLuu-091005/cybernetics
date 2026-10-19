import { serveMemberPhoto } from '../../../../../../../server/avatars/http';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ memberId: string; hash: string }> },
): Promise<Response> {
  const { memberId, hash } = await context.params;
  return serveMemberPhoto(request, memberId, hash);
}
