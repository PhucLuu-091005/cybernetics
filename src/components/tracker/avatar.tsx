import type { Member, Person } from '../../tracker';
import { PhotoImg } from '../shell/PhotoImg';

const GREY = '#737373';

export type Directory = {
  name: (id: string) => string;
  first: (id: string) => string;
  color: (id: string) => string;
  role: (id: string) => string;
  photo: (id: string) => string | null;
};

/** Ops and CRs name members; events and work items name people in the story. One lookup serves both. */
export function makeDirectory(members: readonly Member[], people: readonly Person[]): Directory {
  const byId = new Map(members.map((m) => [m.id, m]));
  const byName = new Map(members.map((m) => [m.name, m]));
  const personName = new Map(people.map((p) => [p.id, p.name]));
  const name = (id: string) => byId.get(id)?.name ?? personName.get(id) ?? id;
  const member = (id: string) => byId.get(id) ?? byName.get(name(id));
  return {
    name,
    first: (id) => name(id).split(' ')[0],
    color: (id) => member(id)?.color ?? GREY,
    role: (id) => member(id)?.roleLabel ?? '',
    photo: (id) => member(id)?.photo ?? null,
  };
}

const initials = (name: string) =>
  name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Avatar({ id, dir, sm }: { id: string; dir: Directory; sm?: boolean }) {
  const photo = dir.photo(id);
  return (
    <span
      className={`av${sm ? ' sm' : ''}`}
      style={{ background: dir.color(id) }}
      title={dir.name(id)}
      aria-hidden="true"
    >
      {photo ? <PhotoImg src={photo} size={sm ? 20 : 28} /> : initials(dir.name(id))}
    </span>
  );
}

export function Avatars({ ids, dir }: { ids: readonly string[]; dir: Directory }) {
  return (
    <span className="avs" role="img" aria-label={ids.map(dir.name).join(', ')}>
      {ids.map((id) => (
        <Avatar key={id} id={id} dir={dir} sm />
      ))}
    </span>
  );
}
