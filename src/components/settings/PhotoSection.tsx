'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { errorText, send, type ApiError } from '../shell/api';
import { useHydrated } from '../shell/hydrated';
import { PhotoOr } from '../shell/PhotoImg';
import { ModalFrame } from '../tracker/Modals';
import { initialsOf, photoProblem, PHOTO_RULE, PHOTO_TYPES } from './photo';

type Props = {
  name: string;
  color: string;
  photo: string | null;
  /** The photo route of the person on screen, with the project whose acting member it names. */
  api: string;
  /** Set when the visitor of a demo copy acts as a seeded person, who then gets the photo. */
  actingAs?: string;
};

/** The 28 px avatar drawn at 96 px, so the initials keep the avatar type scale. */
function Face({
  name,
  color,
  src,
  onError,
}: {
  name: string;
  color: string;
  src: string | null;
  onError?: () => void;
}) {
  return (
    <span className="pf-face" style={{ background: color }} aria-hidden="true">
      <PhotoOr src={src} size={96} onError={onError}>
        <svg viewBox="0 0 28 28" width="96" height="96">
          <text x="14" y="14" dominantBaseline="central" textAnchor="middle">
            {initialsOf(name)}
          </text>
        </svg>
      </PhotoOr>
    </span>
  );
}

async function upload(api: string, file: File): Promise<ApiError | null> {
  try {
    const response = await fetch(api, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as Partial<ApiError>;
    return {
      status: response.status,
      code: data.code ?? 'INTERNAL',
      message: data.message ?? 'The photo was not saved.',
      ...(data.errors ? { errors: data.errors } : {}),
    };
  } catch {
    return {
      status: 0,
      code: 'NETWORK',
      message: 'The photo did not reach the server. Try again.',
    };
  }
}

function UploadDialog({ name, color, photo, api, onClose }: Props & { onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const pick = (picked: File | undefined) => {
    if (!picked) return;
    const problem = photoProblem(picked);
    setError(problem);
    setFile(problem ? null : picked);
    setPreview(problem ? null : URL.createObjectURL(picked));
  };
  const save = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const failure = await upload(api, file);
    if (failure) {
      setBusy(false);
      setError(errorText(failure));
      return;
    }
    startRefresh(() => {
      router.refresh();
      onClose();
    });
  };
  return (
    <>
      {/* Outside the dialog, so the dialog's first focus lands on the dialog and not on this input. */}
      <input
        ref={input}
        className="sr"
        type="file"
        accept={PHOTO_TYPES.join(',')}
        aria-label="Photo file"
        tabIndex={-1}
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <ModalFrame title="Upload a photo" onClose={onClose}>
        <div className="pf-pick">
          <Face
            name={name}
            color={color}
            src={preview ?? photo}
            onError={() => {
              // A file the browser cannot draw would only show a broken image; the server would refuse it too.
              if (!preview) return;
              setError(PHOTO_RULE);
              setFile(null);
              setPreview(null);
            }}
          />
          <div className="pf-pick-text">
            <button className="btn" type="button" onClick={() => input.current?.click()}>
              {file ? 'Choose another file' : 'Choose a file'}
            </button>
            <small className="pg-hint">
              {file ? file.name : 'PNG, JPEG or WebP, up to 5 MB. The app crops it to a square.'}
            </small>
            {error && (
              <p className="pg-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="m-foot">
          <button className="btn big" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn big btn-ink"
            type="button"
            disabled={!file || busy || refreshing}
            onClick={save}
          >
            {busy || refreshing ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </ModalFrame>
    </>
  );
}

export function PhotoSection(props: Props) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const remove = async () => {
    setBusy(true);
    setFailure(null);
    const result = await send<{ photo: null }>(props.api, 'DELETE');
    if (!result.ok) {
      setBusy(false);
      setFailure(errorText(result.error));
      return;
    }
    startRefresh(() => {
      setBusy(false);
      router.refresh();
    });
  };
  return (
    <section className="pg-sec" aria-labelledby="photo-head">
      <h2 id="photo-head">Photo</h2>
      <div className="pf-photo">
        <Face name={props.name} color={props.color} src={props.photo} />
        <div className="pf-photo-text">
          <p className="pg-lede">
            {props.actingAs
              ? `You act as ${props.actingAs} in your demo copy, so this photo is theirs there.`
              : 'The people of your projects see your photo instead of your initials.'}
          </p>
          <div className="pg-acts">
            <button
              className="btn"
              type="button"
              disabled={!hydrated}
              onClick={() => setOpen(true)}
            >
              Upload photo
            </button>
            {props.photo && (
              <button
                className="btn"
                type="button"
                disabled={!hydrated || busy || refreshing}
                onClick={remove}
              >
                {busy || refreshing ? 'Removing…' : 'Remove photo'}
              </button>
            )}
          </div>
          {failure && (
            <p className="pg-error" role="alert">
              {failure}
            </p>
          )}
        </div>
      </div>
      {open && <UploadDialog {...props} onClose={() => setOpen(false)} />}
    </section>
  );
}
