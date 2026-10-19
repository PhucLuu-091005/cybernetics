'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { browserStore, readIntroSeen, writeIntroSeen } from '../tracker/view-state';
import { BrandMark } from './BrandMark';

const DemoContext = createContext<{ openIntro: () => void } | null>(null);

/** `userId` is the signed-in visitor, so Start over (a new visitor) shows the intro again. */
export function DemoMode({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!readIntroSeen(browserStore(), userId)) setOpen(true);
  }, [userId]);
  const close = useCallback(() => {
    setOpen(false);
    writeIntroSeen(browserStore(), userId);
  }, [userId]);
  const value = useMemo(() => ({ openIntro: () => setOpen(true) }), []);
  return (
    <DemoContext value={value}>
      {children}
      {open && <DemoIntro onClose={close} />}
    </DemoContext>
  );
}

export const useDemoMode = () => useContext(DemoContext) !== null;
export const useDemoIntro = () => useContext(DemoContext)?.openIntro ?? null;

function DemoIntro({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const explore = useRef<HTMLButtonElement>(null);
  const project = (usePathname() ?? '').match(/^\/projects\/([^/]+)/)?.[1];
  useEffect(() => {
    dialog.current?.showModal();
    explore.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="sheet-dialog demo-intro"
      aria-labelledby="demo-intro-title"
      onClose={onClose}
    >
      <h2 id="demo-intro-title">
        <BrandMark size={22} />
        Promise Graph
      </h2>
      <p className="demo-intro-lead">
        Pull requests for a project plan. Your team and your AI agents propose changes; a lead
        reviews and merges.
      </p>
      <ul>
        <li>
          <b>Main</b> is the agreed plan. Nobody edits it in place.
        </li>
        <li>
          <b>Change requests</b> propose edits to Main, like pull requests.
        </li>
        <li>
          <b>Agents</b> connect through MCP with a key from Settings.
        </li>
      </ul>
      <div className="sheet-dialog-actions">
        {project && (
          <Link
            className="btn big"
            href={`/projects/${project}/settings/tokens`}
            onClick={() => dialog.current?.close()}
          >
            Connect an agent
          </Link>
        )}
        <button
          className="btn btn-ink big"
          ref={explore}
          type="button"
          onClick={() => dialog.current?.close()}
        >
          Explore the demo
        </button>
      </div>
    </dialog>
  );
}
