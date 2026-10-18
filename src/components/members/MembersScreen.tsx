'use client';
import '../tracker/tracker.css';
import './members.css';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { MembersPayload, ProjectMember, ProjectTeam } from '../../server/tracker/members';
import {
  closeGrants,
  GRANT_LABEL,
  GRANTS,
  impliedBy,
  setGrant,
  type Grant,
} from '../../tracker/permissions';
import type { Account } from '../shell/AccountMenu';
import { errorText, send, type ApiError } from '../shell/api';
import { useHydrated } from '../shell/hydrated';
import { PageHead } from '../shell/PageHead';
import { PhotoImg } from '../shell/PhotoImg';
import { Checkbox } from '../tracker/Checkbox';
import { Icon } from '../tracker/icons';
import { ModalFrame } from '../tracker/Modals';
import { Toast, type ToastState } from '../tracker/Toast';

const SHORT: Record<Grant, string> = {
  viewMain: 'View Main',
  viewCrs: 'View CRs',
  createCrs: 'Create CRs',
  mergeCrs: 'Merge',
};

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

type Confirm = { kind: 'lead' | 'remove'; member: ProjectMember };
type Reply = Awaited<ReturnType<typeof send<MembersPayload>>>;

function Face({ member, sm }: { member: ProjectMember; sm?: boolean }) {
  return (
    <span
      className={`acct-av${member.pending ? ' pending' : ''}${sm ? ' mb-sm' : ''}`}
      style={member.pending ? undefined : { background: member.color }}
      title={sm ? member.name : undefined}
      aria-hidden="true"
    >
      {member.photo ? <PhotoImg src={member.photo} size={sm ? 22 : 28} /> : initials(member.name)}
    </span>
  );
}

/** Why a box cannot change on its own, or null when the project lead may tick it. */
function lockedBy(member: ProjectMember, teamLeadOf: string[], grant: Grant): string | null {
  if (member.projectLead) return 'The project lead has every right.';
  if (grant === 'createCrs' && teamLeadOf.length)
    return `Team lead of ${teamLeadOf.join(', ')}, so they can always create change requests.`;
  const effective = closeGrants(
    teamLeadOf.length ? { ...member.grants, createCrs: true } : member.grants,
  );
  const needs = impliedBy(effective, grant);
  return needs.length ? `${GRANT_LABEL[needs[0]]} needs it.` : null;
}

export function MembersScreen({
  projectId,
  project,
  account,
  initial,
}: {
  projectId: string;
  project: { title: string; clientName: string };
  account: Account;
  initial: MembersPayload;
}) {
  const hydrated = useHydrated();
  const [data, setData] = useState(initial);
  const [email, setEmail] = useState('');
  const [teamName, setTeamName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editing, setEditing] = useState<ProjectTeam | null>(null);
  const showToast = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  const closeToast = useCallback(() => setToast(null), []);
  const api = `/api/v1/projects/${projectId}`;
  const open = confirm !== null || editing !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setConfirm(null);
      setEditing(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const manage = data.canManage;
  const off = !hydrated || busy;
  const lead = data.members.find((m) => m.projectLead);
  const nameOf = (id: string) => data.members.find((m) => m.id === id)?.name ?? 'Someone';
  const teamLeadOf = (member: ProjectMember) =>
    data.teams.filter((team) => team.leadId === member.id).map((team) => team.name);

  const run = async (request: Promise<Reply>, done: (next: MembersPayload) => string) => {
    setBusy(true);
    setFailure(null);
    const result = await request;
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      setFailure(result.error);
      return false;
    }
    setData(result.data);
    showToast(done(result.data));
    return true;
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address || busy) return;
    const ok = await run(
      send<MembersPayload>(`${api}/members`, 'POST', { email: address }),
      (next) => {
        const row = next.members.find((m) => m.email === address.toLowerCase());
        return row?.pending
          ? `Invited ${address}. They join when they sign in with this email.`
          : `${row?.name ?? address} joined the project.`;
      },
    );
    if (ok) setEmail('');
  };
  const toggle = (member: ProjectMember, grant: Grant, on: boolean) =>
    void run(
      send<MembersPayload>(`${api}/members/${member.id}`, 'PATCH', {
        grants: setGrant(member.grants, grant, on),
      }),
      () => `${member.name}: ${GRANT_LABEL[grant]} ${on ? 'on' : 'off'}.`,
    );
  const confirmed = () => {
    if (!confirm) return;
    const { kind, member } = confirm;
    void run(
      kind === 'lead'
        ? send<MembersPayload>(`${api}/members/${member.id}`, 'PATCH', { projectLead: true })
        : send<MembersPayload>(`${api}/members/${member.id}`, 'DELETE'),
      () =>
        kind === 'lead'
          ? `${member.name} is the project lead now.`
          : `${member.name} is no longer in this project.`,
    );
  };
  const addTeam = async (event: FormEvent) => {
    event.preventDefault();
    const name = teamName.trim();
    if (!name || busy) return;
    if (await run(send<MembersPayload>(`${api}/teams`, 'POST', { name }), () => `Added ${name}.`))
      setTeamName('');
  };

  return (
    <div className="tk pg">
      <PageHead title="Members" project={project} account={account} />
      <div className="pg-body mb-body">
        <section className="mb-sec" aria-labelledby="mb-people">
          <div className="mb-head">
            <h2 id="mb-people">
              People <span className="mb-count">{data.members.length}</span>
            </h2>
            {manage && (
              <form className="mb-inline" aria-label="Invite a person" onSubmit={invite}>
                <input
                  type="email"
                  value={email}
                  required
                  maxLength={254}
                  autoComplete="off"
                  aria-label="Email"
                  placeholder="name@company.com"
                  onChange={(event) => setEmail(event.target.value)}
                />
                <button className="btn btn-ink" type="submit" disabled={off || !email.trim()}>
                  Invite
                </button>
              </form>
            )}
          </div>
          <p className="mb-lede">
            {lead ? `${lead.name} is the project lead, with every right. ` : ''}
            Create and Merge include View change requests, and every right includes View Main. A
            team lead can always create change requests.{' '}
            {manage
              ? 'An invite joins when the person signs in with Google using that email.'
              : `Only the project lead${lead ? `, ${lead.name},` : ''} can change access and teams.`}
          </p>
          {failure && (
            <p className="pg-error" role="alert">
              {errorText(failure)}
            </p>
          )}
          <div className="mb-table" role="table" aria-label="People">
            <div className="mb-row mb-cols" role="row">
              <span role="columnheader">Person</span>
              <span role="columnheader">Teams</span>
              {GRANTS.map((grant) => (
                <span key={grant} role="columnheader" className="mb-c" title={GRANT_LABEL[grant]}>
                  {SHORT[grant]}
                </span>
              ))}
              <span role="columnheader" className="mb-acts-h">
                <span className="sr">Actions</span>
              </span>
            </div>
            {data.members.map((member) => {
              const leads = teamLeadOf(member);
              const teams = data.teams.filter((team) => member.teamIds.includes(team.id));
              return (
                <div className="mb-row" role="row" key={member.id}>
                  <span className="mb-who" role="cell">
                    <Face member={member} />
                    <span className="mb-names">
                      <b>
                        <span className="mb-name">
                          {member.pending ? member.email : member.name}
                        </span>
                        {member.projectLead && <span className="chipx">Project lead</span>}
                        {member.you && <span className="chipx">You</span>}
                        {member.pending && <span className="chipx">Invited</span>}
                      </b>
                      <small>
                        {[
                          member.pending ? 'Waits for the first sign-in' : member.email,
                          member.label,
                        ]
                          .filter(Boolean)
                          .join(' · ') || ' '}
                      </small>
                    </span>
                  </span>
                  <span className="mb-teams" role="cell">
                    {teams.length ? (
                      teams.map((team) => (
                        <span className="mb-team" key={team.id}>
                          {team.name}
                          {team.leadId === member.id && <span className="mb-lead">Lead</span>}
                        </span>
                      ))
                    ) : (
                      <span className="mb-none">No team</span>
                    )}
                  </span>
                  {GRANTS.map((grant) => {
                    const why = lockedBy(member, leads, grant);
                    const checked =
                      grant === 'createCrs'
                        ? member.rights.create
                        : grant === 'mergeCrs'
                          ? member.rights.merge
                          : grant === 'viewCrs'
                            ? member.rights.viewCrs
                            : member.rights.viewMain;
                    return (
                      <label
                        className="mb-c mb-grant"
                        role="cell"
                        key={grant}
                        title={why ?? undefined}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!manage || off || why !== null}
                          aria-label={`${GRANT_LABEL[grant]}: ${member.name}`}
                          onChange={(on) => toggle(member, grant, on)}
                        />
                        <span className="mb-grant-name">{SHORT[grant]}</span>
                      </label>
                    );
                  })}
                  <span className="mb-acts" role="cell">
                    {manage && !member.projectLead && (
                      <>
                        {!member.pending && (
                          <button
                            className="btn sm"
                            type="button"
                            aria-label={`Make project lead: ${member.name}`}
                            disabled={off}
                            onClick={() => setConfirm({ kind: 'lead', member })}
                          >
                            Make project lead
                          </button>
                        )}
                        <button
                          className="btn sm btn-danger"
                          type="button"
                          aria-label={`Remove ${member.name}`}
                          disabled={off}
                          onClick={() => setConfirm({ kind: 'remove', member })}
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mb-sec" aria-labelledby="mb-teams">
          <div className="mb-head">
            <h2 id="mb-teams">
              Teams <span className="mb-count">{data.teams.length}</span>
            </h2>
            {manage && (
              <form className="mb-inline" aria-label="Add a team" onSubmit={addTeam}>
                <input
                  value={teamName}
                  maxLength={200}
                  autoComplete="off"
                  aria-label="Team name"
                  placeholder="Add a team"
                  onChange={(event) => setTeamName(event.target.value)}
                />
                <button className="btn" type="submit" disabled={off || !teamName.trim()}>
                  <Icon name="plus" /> Add
                </button>
              </form>
            )}
          </div>
          <p className="mb-lede">
            Every work item belongs to a team. A team has people and at most one lead.
          </p>
          <div className="mb-list" role="table" aria-label="Teams">
            <div className="mb-trow mb-cols" role="row">
              <span role="columnheader">Team</span>
              <span role="columnheader">Lead</span>
              <span role="columnheader">People</span>
              <span role="columnheader">
                <span className="sr">Actions</span>
              </span>
            </div>
            {data.teams.map((team) => {
              const leader = data.members.find((m) => m.id === team.leadId);
              const people = team.memberIds.map(nameOf);
              return (
                <div className="mb-trow" role="row" key={team.id}>
                  <span className="mb-tname" role="cell">
                    <b>{team.name}</b>
                    <small>{plural(team.workItems, 'work item')}</small>
                  </span>
                  <span className="mb-tlead" role="cell">
                    <span className="mb-cap">Lead</span>
                    {leader ? (
                      <>
                        <Face member={leader} sm />
                        <span className="mb-name">{leader.name}</span>
                      </>
                    ) : (
                      <span className="mb-none">No lead</span>
                    )}
                  </span>
                  <span className="mb-tpeople" role="cell" title={people.join(', ')}>
                    <span className="mb-cap">People</span>
                    {people.length ? (
                      <span className="mb-name">{people.join(', ')}</span>
                    ) : (
                      <span className="mb-none">No people</span>
                    )}
                  </span>
                  <span className="mb-acts" role="cell">
                    {manage && (
                      <button
                        className="btn sm"
                        type="button"
                        disabled={off}
                        aria-label={`Edit ${team.name}`}
                        onClick={() => {
                          setFailure(null);
                          setEditing(team);
                        }}
                      >
                        <Icon name="pencil" size={13} /> Edit
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
      {confirm && (
        <ModalFrame
          title={
            confirm.kind === 'lead'
              ? `Make ${confirm.member.name} the project lead?`
              : `Remove ${confirm.member.name}?`
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.kind === 'lead'
              ? `${confirm.member.name} gets every right and manages people, teams and access. A project has one lead, so you stop being the lead. You keep every grant, and only ${confirm.member.name} can change that.`
              : `${confirm.member.name} can no longer open this project and leaves every team. The change requests that ${confirm.member.name} edits go back to their author or to the project lead.`}
          </p>
          <div className="m-foot">
            <button className="btn big" type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn big btn-ink" type="button" disabled={busy} onClick={confirmed}>
              {confirm.kind === 'lead' ? 'Make project lead' : 'Remove'}
            </button>
          </div>
        </ModalFrame>
      )}
      {editing && (
        <TeamEditor
          key={editing.id}
          team={editing}
          members={data.members}
          busy={busy}
          failure={failure}
          onClose={() => setEditing(null)}
          onSave={async (body) => {
            const ok = await run(
              send<MembersPayload>(`${api}/teams/${editing.id}`, 'PATCH', body),
              () => `Saved ${body.name}.`,
            );
            if (ok) setEditing(null);
          }}
          onDelete={async () => {
            const ok = await run(
              send<MembersPayload>(`${api}/teams/${editing.id}`, 'DELETE'),
              () => `Deleted ${editing.name}.`,
            );
            if (ok) setEditing(null);
          }}
        />
      )}
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}

function TeamEditor({
  team,
  members,
  busy,
  failure,
  onClose,
  onSave,
  onDelete,
}: {
  team: ProjectTeam;
  members: ProjectMember[];
  busy: boolean;
  failure: ApiError | null;
  onClose: () => void;
  onSave: (body: { name: string; leadId: string | null; memberIds: string[] }) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(team.name);
  const [picked, setPicked] = useState<string[]>(team.memberIds);
  const [leadId, setLeadId] = useState<string | null>(team.leadId);
  const pick = (id: string, on: boolean) => {
    setPicked((current) => (on ? [...current, id] : current.filter((item) => item !== id)));
    if (!on && leadId === id) setLeadId(null);
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      leadId,
      memberIds: members.filter((m) => picked.includes(m.id)).map((m) => m.id),
    });
  };
  return (
    <ModalFrame title={`Edit ${team.name}`} onClose={onClose}>
      <form className="mb-editor" onSubmit={save}>
        <label className="field">
          Name
          <input
            value={name}
            required
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset className="mb-pick">
          <legend>People and lead</legend>
          <ul>
            {members.map((member) => {
              const inTeam = picked.includes(member.id);
              return (
                <li key={member.id}>
                  <label className="mb-pick-who">
                    <Checkbox checked={inTeam} onChange={(on) => pick(member.id, on)} />
                    <Face member={member} sm />
                    <span>
                      {member.pending ? member.email : member.name}
                      <small>{member.label}</small>
                    </span>
                  </label>
                  <label className="mb-pick-lead">
                    <input
                      type="radio"
                      name="team-lead"
                      checked={leadId === member.id}
                      onChange={() => {
                        setLeadId(member.id);
                        if (!inTeam) setPicked((current) => [...current, member.id]);
                      }}
                    />
                    Lead
                  </label>
                </li>
              );
            })}
          </ul>
          <label className="mb-pick-none">
            <input
              type="radio"
              name="team-lead"
              checked={leadId === null}
              onChange={() => setLeadId(null)}
            />
            No lead
          </label>
        </fieldset>
        <p className="tip">The lead is always in the team and can always create change requests.</p>
        {failure && (
          <p className="pg-error" role="alert">
            {errorText(failure)}
          </p>
        )}
        {team.keep && <p className="tip">{team.keep}</p>}
        <div className="m-foot mb-editor-foot">
          <button
            className="btn big btn-danger"
            type="button"
            disabled={busy || team.keep !== null}
            onClick={onDelete}
          >
            <Icon name="trash" size={14} /> Delete team
          </button>
          <span className="sp" />
          <button className="btn big" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn big btn-ink" type="submit" disabled={busy || !name.trim()}>
            Save
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
