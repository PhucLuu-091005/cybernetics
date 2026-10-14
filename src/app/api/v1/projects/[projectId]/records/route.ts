import { ingestRecords, searchRecords } from '../../../../../../server/domain/records';
import { domain, pasteImport, route } from '../../../../../../server/http/route';
export const runtime = 'nodejs';
export const GET = route(domain(searchRecords));
export const POST = route(domain(ingestRecords, pasteImport));
