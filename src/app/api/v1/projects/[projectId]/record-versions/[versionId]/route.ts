import { readRecordChunk } from '../../../../../../../server/domain/records';
import { domain, route } from '../../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(readRecordChunk));
