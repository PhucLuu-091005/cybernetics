import { ProjectSchema } from '../../contracts';

const { title: TitleSchema, clientName: ClientSchema } = ProjectSchema.shape;
export const NAME_MAX = TitleSchema.maxLength ?? undefined;
export const CLIENT_MAX = ClientSchema.maxLength ?? undefined;

export type NewProjectBody = { title: string; clientName: string };

/** The contract's own field schemas decide validity, so the dialog never drifts from the server. */
export function newProjectBody(name: string, client: string): NewProjectBody | null {
  const title = TitleSchema.safeParse(name.trim());
  const clientName = ClientSchema.safeParse(client.trim());
  return title.success && clientName.success
    ? { title: title.data, clientName: clientName.data }
    : null;
}
