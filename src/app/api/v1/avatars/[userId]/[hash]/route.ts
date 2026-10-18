import { servePhoto } from '../../../../../../server/avatars/http';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string; hash: string }> },
): Promise<Response> {
  const { userId, hash } = await context.params;
  return servePhoto(request, userId, hash);
}
