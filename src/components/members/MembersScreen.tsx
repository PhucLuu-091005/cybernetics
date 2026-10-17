'use client';
import '../tracker/tracker.css';
import { useCallback, useState, type FormEvent } from 'react';
import type { MemberRole, MembersPayload, ProjectMember } from '../../server/tracker/members';
import type { Account } from '../shell/AccountMenu';
import { send, type ApiError } from '../shell/api';
import { useHydrated } from '../shell/hydrated';
import { PageHead } from '../shell/PageHead';
import { ModalFrame } from '../tracker/Modals';
import { Toast, type ToastState } from '../tracker/Toast';

export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Owner',
  member: 'Member',
  viewer: 'Viewer',
};

const initials = (name: string) =>
  name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

type Confirm = { kind: 'owner' | 'remove'; member: ProjectMember };

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
  const [role, setRole] = useState<'member' | 'viewer'>('member');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const showToast = useCallback((text: string) => setToast({ text, at: Date.now() }), []);
  const closeToast = useCallback(() => setToast(null), []);
  const base = `/api/v1/projects/${projectId}/members`;
  const owner = data.members.find((m) => m.role === 'owner');

  const run = async (
    request: Promise<Awaited<ReturnType<typeof send<MembersPayload>>>>,
    done: (next: MembersPayload) => string,
  ) => {
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
    const ok = await run(send<MembersPayload>(base, 'POST', { email: address, role }), (next) => {
      const row = next.members.find((m) => m.email === address.toLowerCase());
      return row?.pending
        ? `Invited ${address}. They join when they sign in with this email.`
        : `${row?.name ?? address} joined as a ${ROLE_LABEL[role].toLowerCase()}.`;
    });
    if (ok) setEmail('');
  };
  const changeRole = (member: ProjectMember, next: MemberRole) => {
    if (next === member.role) return;
    if (next === 'owner') {
      setConfirm({ kind: 'owner', member });
      return;
    }
    void run(
      send<MembersPayload>(`${base}/${member.id}`, 'PATCH', { role: next }),
      () => `${member.name} is a ${ROLE_LABEL[next].toLowerCase()} now.`,
    );
  };
  const confirmed = () => {
    if (!confirm) return;
    const { kind, member } = confirm;
    void run(
      kind === 'owner'
        ? send<MembersPayload>(`${base}/${member.id}`, 'PATCH', { role: 'owner' })
        : send<MembersPayload>(`${base}/${member.id}`, 'DELETE'),
      () =>
        kind === 'owner'
          ? `${member.name} owns Main now.`
          : `${member.name} is no longer in this project.`,
    );
  };

  return (
    <div className="tk pg">
      <PageHead title="Members" project={project} account={account} />
      <div className="pg-body">
        <p className="pg-lede">
          The owner merges change requests into Main and manages the members. A member makes change
          requests and adds to the Queue. A viewer reads the project only.
        </p>
        {data.canManage ? (
          <form className="pg-form" aria-label="Invite a member" onSubmit={invite}>
            <label className="field pg-grow">
              Email
              <input
                type="email"
                value={email}
                required
                maxLength={254}
                autoComplete="off"
                placeholder="name@company.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              Role
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as 'member' | 'viewer')}
              >
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </label>
            <button
              className="btn btn-ink"
              type="submit"
              disabled={!hydrated || busy || !email.trim()}
            >
              Invite
            </button>
            <p className="pg-hint">
              The person joins when they sign in with Google using this email.
            </p>
          </form>
        ) : (
          <p className="pg-note" role="note">
            Only the owner{owner ? `, ${owner.name},` : ''} can invite people and change roles.
          </p>
        )}
        {failure && (
          <p className="pg-error" role="alert">
            {failure.message.replace(/\.?$/, '.')}
          </p>
        )}
        <ul className="pg-list" aria-label="Members">
          {data.members.map((member) => (
            <li className="pg-row" key={member.id}>
              <span
                className={`acct-av${member.pending ? ' pending' : ''}`}
                style={member.pending ? undefined : { background: member.color }}
                aria-hidden="true"
              >
                {initials(member.name)}
              </span>
              <span className="pg-who">
                <b>
                  {member.pending ? member.email : member.name}
                  {member.you && <span className="chipx">You</span>}
                  {member.pending && <span className="chipx">Invited</span>}
                </b>
                <small>
                  {[member.pending ? 'Waits for the first sign-in' : member.email, member.label]
                    .filter(Boolean)
                    .join(' · ') || ' '}
                </small>
              </span>
              {data.canManage && member.role !== 'owner' ? (
                <>
                  <select
                    className="pg-role"
                    aria-label={`Role of ${member.name}`}
                    value={member.role}
                    disabled={!hydrated || busy}
                    onChange={(event) => changeRole(member, event.target.value as MemberRole)}
                  >
                    {!member.pending && <option value="owner">Owner</option>}
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    className="btn sm"
                    type="button"
                    aria-label={`Remove ${member.name}`}
                    disabled={!hydrated || busy}
                    onClick={() => setConfirm({ kind: 'remove', member })}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="pg-role-text">{ROLE_LABEL[member.role]}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {confirm && (
        <ModalFrame
          title={
            confirm.kind === 'owner'
              ? `Make ${confirm.member.name} the owner?`
              : `Remove ${confirm.member.name}?`
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.kind === 'owner'
              ? `${confirm.member.name} will merge change requests into Main and manage the members. You become a member, and only the new owner can change that.`
              : `${confirm.member.name} can no longer open this project. The change requests that ${confirm.member.name} edits go back to their author or to the owner.`}
          </p>
          <div className="m-foot">
            <button className="btn big" type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn big btn-ink" type="button" disabled={busy} onClick={confirmed}>
              {confirm.kind === 'owner' ? 'Make owner' : 'Remove'}
            </button>
          </div>
        </ModalFrame>
      )}
      <Toast toast={toast} onClose={closeToast} />
    </div>
  );
}
