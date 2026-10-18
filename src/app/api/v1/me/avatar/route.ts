import { deletePhoto, uploadPhoto } from '../../../../../server/avatars/http';
export const runtime = 'nodejs';
export const PUT = uploadPhoto;
export const DELETE = deletePhoto;
