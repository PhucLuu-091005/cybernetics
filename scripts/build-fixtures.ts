import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
  Act,
  ActType,
  Alias,
  Annotation,
  BreakdownType,
  Department,
  EngineInput,
  EntityCollection,
  GraphContext,
  GraphOperation,
  GraphSnapshot,
  Loop,
  LoopState,
  Milestone,
  MilestoneStatus,
  Party,
  Person,
  RecordDecision,
  RecordInput,
  Verdict,
} from '../src/contracts';

// Type-only imports from src keep this script runnable with plain `node --experimental-strip-types`.
interface StoryEvent {
  date: string;
  time?: string;
  person: string;
  kind: ActType;
  quote: string;
  due: string | null;
  hedged: boolean;
  channel: string;
  before: string;
  after: string;
  quotedReply?: { event: number; header: string };
  attachments?: string[];
}
interface StoryLoop {
  key: string;
  title: string;
  customer: string;
  performer: string;
  action: string;
  milestone: string;
  expect: { state: LoopState; breakdowns: BreakdownType[] };
  events: StoryEvent[];
}
interface NonActSource {
  key: string;
  date: string;
  time: string;
  person: string;
  quote: string;
  channel: string;
  title: string;
  before: string;
  after: string;
  recipients?: string[];
  decision: 'included' | 'ignored' | 'pending';
  reason?: string;
  act?: {
    kind: ActType;
    quote: string;
    customer: string;
    performer: string;
    action: string;
    due: string | null;
    hedged: boolean;
    loop: string | null;
  };
}
interface PersonSource {
  name: string;
  side: 'client' | 'vendor';
  department: string;
  role: string;
  email: string;
}
interface MilestoneSource {
  name: string;
  order: number;
  plannedDate: string;
  reachedAt: string | null;
  anchor: string | null;
  expect: MilestoneStatus;
}
interface ProjectSource {
  key: string;
  title: string;
  clientName: string;
  vendorName: string;
  departments: Omit<Department, 'id'>[];
  people: PersonSource[];
  milestones: MilestoneSource[];
}
type Calendar = Omit<GraphContext, 'people' | 'departments' | 'milestones'>;
interface LarkspurSource extends ProjectSource, Calendar {
  sideRules: { domain: string; side: 'client' | 'vendor' }[];
}
interface IsolationSource extends ProjectSource {
  channel: string;
  story: StoryLoop[];
}
interface ClaimSource {
  text: string;
  type: string;
  verdict: Verdict;
  supporting: string[];
  contradicting: string[];
}
interface HistorySource {
  key: string;
  kind: 'merge' | 'revert';
  message: string;
  target?: string;
  decisions?: { record: string; disposition: 'included' | 'ignored'; reason: string }[];
  annotations?: { key: string; text: string; acts: string[] }[];
}
interface ProposalSource {
  key: string;
  title: string;
  author: { kind: 'user' | 'agent'; name: string };
  rationale: string;
  competesWith?: string;
  loopTitles?: { loop: string; title: string }[];
  acts?: {
    key: string;
    record: string;
    quote: string;
    kind: ActType;
    person: string;
    loop: string;
    confidence: number;
  }[];
  decisions?: { record: string; disposition: 'included' | 'ignored'; reason: string }[];
}
interface StorySource {
  project: LarkspurSource;
  story: StoryLoop[];
  nonacts: NonActSource[];
  escalations: { key: string; complaint: string; claims: ClaimSource[] }[];
  history: HistorySource[];
  proposals: ProposalSource[];
  isolation: IsolationSource;
}
export interface FixtureRecord {
  projectKey: 'larkspur' | 'isolation';
  source: 'agent' | 'paste';
  sourceLabel: string;
  recordVersionId: string;
  record: RecordInput;
}
type Change = { collection: EntityCollection; id: string; kind: 'added' | 'removed' | 'changed' };

export function uuidFromKey(key: string): string {
  const hex = createHash('sha256').update(`promise-graph:${key}`).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Equals canonicalJson for record inputs, which hold no entity collections; a fixture test pins the equality.
function sortedJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${sortedJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}
const recordDigest = (record: unknown) =>
  createHash('sha256').update(sortedJson(record)).digest('hex');

type SnapshotLike = { acts: readonly { citation: { recordVersionId: string } }[] };
type RecordLike = {
  recordVersionId: string;
  record: {
    occurredAt?: string;
    bodyText: string;
    quotedRanges?: readonly { start: number; end: number }[];
  };
};
/** Fixture JSON is schema-checked by the fixture tests; versions missing here surface as the engine's EngineInputError. */
export function engineInputFromFixtures(
  snapshot: SnapshotLike,
  records: readonly RecordLike[],
  T: string,
): EngineInput {
  const byVersion = new Map(records.map((item) => [item.recordVersionId, item]));
  const cited = [...new Set(snapshot.acts.map((act) => act.citation.recordVersionId))];
  return {
    snapshot: snapshot as GraphSnapshot,
    T,
    records: cited.flatMap((id) => {
      const item = byVersion.get(id);
      if (!item?.record.occurredAt) return [];
      return [
        {
          recordVersionId: id,
          occurredAt: item.record.occurredAt,
          bodyText: item.record.bodyText,
          digest: recordDigest(item.record),
          withdrawn: false,
          quotedRanges: (item.record.quotedRanges ?? []).map(({ start, end }) => ({ start, end })),
        },
      ];
    }),
  };
}

const OFFSET = '+07:00';
const defaultTime: Record<ActType, string> = {
  request: '09:20',
  follow_up: '09:30',
  agree_change: '09:15',
  renegotiate: '10:40',
  promise: '10:45',
  counter: '11:00',
  decline: '11:00',
  cancel: '11:00',
  reject: '11:30',
  report_done: '15:10',
  accept: '16:40',
};
const slackChannels: Record<string, string> = {
  '#larkspur-onboarding': 'C-ONBOARDING',
  '#larkspur-it': 'C-IT',
};
const slug = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const clone = <T>(value: T): T => structuredClone(value);
const fail = (message: string): never => {
  throw new Error(message);
};

interface Draft {
  key: string;
  threadKey: string;
  channel: string;
  occurredAt: string;
  person: string;
  recipients: string[];
  title: string;
  bodyText: string;
  quotedRanges?: { start: number; end: number }[];
  attachmentNames?: string[];
}
interface Built {
  records: FixtureRecord[];
  snapshot: GraphSnapshot;
  actId: (ref: string) => string;
  recordId: (ref: string) => string;
  party: (name: string) => Party;
  cite: (ref: string, quote: string) => Act['citation'];
}

function buildProject(
  projectKey: FixtureRecord['projectKey'],
  prefix: string,
  spec: ProjectSource,
  calendar: Calendar,
  story: StoryLoop[],
  nonacts: NonActSource[],
  source: FixtureRecord['source'],
): Built {
  const id = (key: string) => uuidFromKey(`${prefix}${key}`);
  const departments: Department[] = spec.departments.map((item) => ({
    id: id(`department:${slug(item.name)}`),
    name: item.name,
    side: item.side,
    order: item.order,
  }));
  const departmentOf = (name: string) =>
    departments.find((item) => item.name === name)?.id ?? fail(`Unknown department ${name}`);
  const personSpec = (name: string) =>
    spec.people.find((item) => item.name === name) ?? fail(`Unknown person ${name}`);
  const people: Person[] = spec.people.map((item) => ({
    id: id(`person:${slug(item.name)}`),
    name: item.name,
    side: item.side,
    departmentId: departmentOf(item.department),
    role: item.role,
  }));
  const party = (name: string): Party => ({
    kind: 'person',
    personId: id(`person:${slug(personSpec(name).name)}`),
  });
  const loopId = (key: string) =>
    story.some((loop) => loop.key === key) ? id(`loop:${key}`) : fail(`Unknown loop ${key}`);
  const milestones: Milestone[] = spec.milestones.map((item) => ({
    id: id(`milestone:${slug(item.name)}`),
    name: item.name,
    order: item.order,
    plannedDate: item.plannedDate,
    currentDate: item.plannedDate,
    reachedAt: item.reachedAt,
    anchorLoopId: item.anchor ? loopId(item.anchor) : null,
  }));
  const milestoneOf = (name: string) =>
    milestones.find((item) => item.name === name)?.id ?? fail(`Unknown milestone ${name}`);
  const recordId = (ref: string) => id(`record-version:${ref}`);
  const actId = (ref: string) => {
    const [loopKey, index] = ref.split('#');
    if (ref.startsWith('nonact:'))
      return nonacts.some((item) => `nonact:${item.key}` === ref && item.act)
        ? id(`act:${ref}`)
        : fail(`No act on ${ref}`);
    return story.find((loop) => loop.key === loopKey)?.events[Number(index)]
      ? id(`act:${loopKey}:${index}`)
      : fail(`Unknown act ${ref}`);
  };

  const drafts = new Map<string, Draft>();
  const acts: Act[] = [];
  const cite = (ref: string, quote: string) => {
    const draft = drafts.get(ref) ?? fail(`Unknown record ${ref}`);
    const start = draft.bodyText.indexOf(quote),
      end = start + quote.length;
    if (start < 0 || draft.bodyText.slice(start, end) !== quote)
      fail(`Quote not found in ${ref}: ${quote}`);
    if (quote.length > 400) fail(`Quote over 400 code units in ${ref}`);
    if ((draft.quotedRanges ?? []).some((range) => start < range.end && end > range.start))
      fail(`Quote inside a quoted range in ${ref}`);
    return { recordVersionId: recordId(ref), start, end };
  };
  const body = (event: { before: string; quote: string; after: string }) =>
    `${event.before} ${event.quote} ${event.after}`;
  for (const loop of story) {
    loop.events.forEach((event, index) => {
      const counterpart = event.person === loop.customer ? loop.performer : loop.customer;
      let bodyText = body(event),
        quotedRanges: Draft['quotedRanges'];
      if (event.quotedReply) {
        const prior =
          loop.events[event.quotedReply.event] ?? fail(`Unknown quoted event in ${loop.key}`);
        bodyText += '\n\n';
        const start = bodyText.length;
        bodyText += `${event.quotedReply.header}\n> ${body(prior)}`;
        quotedRanges = [{ start, end: bodyText.length }];
      }
      drafts.set(`${loop.key}:${index}`, {
        key: `${loop.key}:${index}`,
        threadKey: loop.key,
        channel: event.channel,
        occurredAt: `${event.date}T${event.time ?? defaultTime[event.kind]}:00${OFFSET}`,
        person: event.person,
        recipients: [counterpart],
        title: loop.title,
        bodyText,
        quotedRanges,
        attachmentNames: event.attachments,
      });
    });
  }
  for (const item of nonacts)
    drafts.set(`nonact:${item.key}`, {
      key: `nonact:${item.key}`,
      threadKey: item.key,
      channel: item.channel,
      occurredAt: `${item.date}T${item.time}:00${OFFSET}`,
      person: item.person,
      recipients: item.recipients ?? [],
      title: item.title,
      bodyText: body(item),
    });

  const loops: Loop[] = story.map((loop) => {
    const performer = personSpec(loop.performer);
    loop.events.forEach((event, index) =>
      acts.push({
        id: id(`act:${loop.key}:${index}`),
        citation: cite(`${loop.key}:${index}`, event.quote),
        type: event.kind,
        actor: party(event.person),
        customer: party(loop.customer),
        performer: party(loop.performer),
        action: loop.action,
        due: event.due ? { date: event.due, precision: 'day' } : null,
        hedged: event.hedged,
        loopId: id(`loop:${loop.key}`),
        hidden: false,
        origin: 'human',
        confidence: null,
      }),
    );
    return {
      id: id(`loop:${loop.key}`),
      title: loop.title,
      customer: party(loop.customer),
      performer: party(loop.performer),
      performerDepartmentId: departmentOf(performer.department),
      milestoneId: milestoneOf(loop.milestone),
    };
  });
  for (const item of nonacts) {
    if (!item.act) continue;
    acts.push({
      id: id(`act:nonact:${item.key}`),
      citation: cite(`nonact:${item.key}`, item.act.quote),
      type: item.act.kind,
      actor: party(item.person),
      customer: party(item.act.customer),
      performer: party(item.act.performer),
      action: item.act.action,
      due: item.act.due ? { date: item.act.due, precision: 'day' } : null,
      hedged: item.act.hedged,
      loopId: item.act.loop ? loopId(item.act.loop) : null,
      hidden: false,
      origin: 'human',
      confidence: null,
    });
  }

  const ordered = [...drafts.values()].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || (a.key < b.key ? -1 : 1),
  );
  const alias = (name: string, slack: boolean): Alias => ({
    name,
    email: personSpec(name).email,
    ...(slack ? { slackUserId: `U-${slug(name).toUpperCase()}` } : {}),
  });
  const externalIds = new Map<string, string>(),
    lastInThread = new Map<string, string>(),
    threadRoots = new Map<string, string>();
  const records: FixtureRecord[] = ordered.map((draft, sequence) => {
    const epoch = Date.parse(draft.occurredAt) / 1000;
    const [kind, channelName] = draft.channel.startsWith('#')
      ? ['slack', draft.channel]
      : draft.channel.split(':');
    let externalId: string,
      threadExternalId: string | undefined,
      parentExternalId: string | undefined,
      permalink: string | undefined,
      title = draft.title;
    if (kind === 'slack') {
      const channelId = slackChannels[channelName] ?? fail(`Unknown Slack channel ${channelName}`);
      externalId = `slack:${channelId}:${epoch}.${String(sequence).padStart(6, '0')}`;
      const root = threadRoots.get(`${draft.channel}/${draft.threadKey}`);
      threadExternalId = root ?? externalId;
      parentExternalId = root;
      if (!root) threadRoots.set(`${draft.channel}/${draft.threadKey}`, externalId);
      permalink = `https://fundline-larkspur.slack.example/archives/${channelId}/p${epoch}${String(sequence).padStart(6, '0')}`;
      title = `${draft.channel}: ${draft.title}`;
    } else if (kind === 'notion') {
      externalId = `notion:${channelName}:${draft.threadKey}`;
      permalink = `https://notion.example/fundline/larkspur-${channelName}`;
    } else {
      const previous = lastInThread.get(draft.channel);
      externalId = `${kind}:${channelName}:${String(sequence).padStart(3, '0')}`;
      threadExternalId = draft.channel;
      parentExternalId = previous;
      if (previous && kind === 'gmail') title = `Re: ${draft.title}`;
      lastInThread.set(draft.channel, externalId);
    }
    if (externalIds.has(externalId)) fail(`Duplicate external ID ${externalId}`);
    externalIds.set(externalId, draft.key);
    const record: RecordInput = {
      externalId,
      ...(threadExternalId ? { threadExternalId } : {}),
      ...(parentExternalId ? { parentExternalId } : {}),
      sourceLabel: draft.channel,
      occurredAt: draft.occurredAt,
      author: alias(draft.person, kind === 'slack'),
      recipients:
        kind === 'slack' || kind === 'notion'
          ? []
          : draft.recipients.map((name) => alias(name, false)),
      title,
      bodyText: draft.bodyText,
      ...(permalink ? { permalink } : {}),
      ...(draft.quotedRanges ? { quotedRanges: draft.quotedRanges } : {}),
      ...(draft.attachmentNames ? { attachmentNames: draft.attachmentNames } : {}),
    };
    return {
      projectKey,
      source,
      sourceLabel: draft.channel,
      recordVersionId: recordId(draft.key),
      record,
    };
  });

  const acted = new Set(acts.map((act) => act.citation.recordVersionId));
  const recordDecisions: RecordDecision[] = records.flatMap(
    ({ recordVersionId }): RecordDecision[] => {
      const nonact = nonacts.find((item) => recordId(`nonact:${item.key}`) === recordVersionId);
      if (acted.has(recordVersionId))
        return [{ recordVersionId, disposition: 'included', reason: '' }];
      if (nonact?.decision === 'ignored')
        return [
          {
            recordVersionId,
            disposition: 'ignored',
            reason: nonact.reason ?? fail(`Ignored ${nonact.key} needs a reason`),
          },
        ];
      if (nonact?.decision === 'included') fail(`Included ${nonact.key} has no act`);
      return [];
    },
  );
  const snapshot: GraphSnapshot = {
    schemaVersion: 1,
    context: { ...calendar, people, departments, milestones },
    acts,
    loops,
    annotations: [],
    recordDecisions,
  };
  return { records, snapshot, actId, recordId, party, cite };
}

function sortedChanges(changes: Change[]): Change[] {
  return [...changes].sort((a, b) =>
    `${a.collection}/${a.id}` < `${b.collection}/${b.id}` ? -1 : 1,
  );
}

export function buildFixtures(source: StorySource) {
  const { project, story, nonacts } = source;
  const calendar: Calendar = {
    timeZone: project.timeZone,
    windowStart: project.windowStart,
    windowEnd: project.windowEnd,
    asOfOverride: project.asOfOverride,
    holidays: project.holidays,
    replyWindowDays: project.replyWindowDays,
    acceptWindowDays: project.acceptWindowDays,
    hedgeWindowDays: project.hedgeWindowDays,
    atRiskWindowDays: project.atRiskWindowDays,
  };
  const larkspur = buildProject('larkspur', '', project, calendar, story, nonacts, 'agent');
  const isolation = buildProject(
    'isolation',
    'isolation:',
    source.isolation,
    calendar,
    source.isolation.story,
    [],
    'paste',
  );
  const main = larkspur.snapshot;

  const history: {
    key: string;
    kind: 'merge' | 'revert';
    message: string;
    targetKey: string | null;
    snapshot: GraphSnapshot;
    expectedDiff: Change[];
  }[] = [];
  const added = new Map<string, Change[]>();
  let parent = main;
  for (const step of source.history) {
    const next = clone(parent);
    let changes: Change[];
    if (step.kind === 'merge') {
      changes = [];
      for (const decision of step.decisions ?? []) {
        const recordVersionId = larkspur.recordId(decision.record);
        next.recordDecisions.push({
          recordVersionId,
          disposition: decision.disposition,
          reason: decision.reason,
        });
        changes.push({ collection: 'recordDecisions', id: recordVersionId, kind: 'added' });
      }
      for (const note of step.annotations ?? []) {
        const annotation: Annotation = {
          id: uuidFromKey(`annotation:${note.key}`),
          text: note.text,
          actIds: note.acts.map(larkspur.actId),
        };
        next.annotations.push(annotation);
        changes.push({ collection: 'annotations', id: annotation.id, kind: 'added' });
      }
      added.set(step.key, changes);
    } else {
      // History merges only add entities, so the hand-composed inverse removes exactly those additions.
      const target = added.get(step.target ?? '') ?? fail(`Unknown revert target ${step.target}`);
      const removed = new Set(target.map((change) => change.id));
      next.recordDecisions = next.recordDecisions.filter(
        (item) => !removed.has(item.recordVersionId),
      );
      next.annotations = next.annotations.filter((item) => !removed.has(item.id));
      changes = target.map((change) => ({ ...change, kind: 'removed' }));
    }
    history.push({
      key: step.key,
      kind: step.kind,
      message: step.message,
      targetKey: step.target ?? null,
      snapshot: next,
      expectedDiff: sortedChanges(changes),
    });
    parent = next;
  }
  const head = parent,
    headKey = history.at(-1)?.key ?? 'initial';

  const proposals = source.proposals.map((item) => {
    const candidate = clone(head),
      operations: GraphOperation[] = [],
      changes: Change[] = [];
    for (const change of item.loopTitles ?? []) {
      const loop =
        candidate.loops.find((entry) => entry.id === uuidFromKey(`loop:${change.loop}`)) ??
        fail(`Unknown loop ${change.loop}`);
      loop.title = change.title;
      operations.push({ op: 'put', collection: 'loops', value: clone(loop) });
      changes.push({ collection: 'loops', id: loop.id, kind: 'changed' });
    }
    for (const spec of item.acts ?? []) {
      const loop =
        story.find((entry) => entry.key === spec.loop) ?? fail(`Unknown loop ${spec.loop}`);
      const act: Act = {
        id: uuidFromKey(`act:${spec.key}`),
        citation: larkspur.cite(spec.record, spec.quote),
        type: spec.kind,
        actor: larkspur.party(spec.person),
        customer: larkspur.party(loop.customer),
        performer: larkspur.party(loop.performer),
        action: loop.action,
        due: null,
        hedged: false,
        loopId: uuidFromKey(`loop:${loop.key}`),
        hidden: false,
        origin: 'agent',
        confidence: spec.confidence,
      };
      candidate.acts.push(act);
      operations.push({ op: 'put', collection: 'acts', value: clone(act), quote: spec.quote });
      changes.push({ collection: 'acts', id: act.id, kind: 'added' });
    }
    for (const decision of item.decisions ?? []) {
      const value: RecordDecision = {
        recordVersionId: larkspur.recordId(decision.record),
        disposition: decision.disposition,
        reason: decision.reason,
      };
      candidate.recordDecisions.push(value);
      operations.push({ op: 'put', collection: 'recordDecisions', value: clone(value) });
      changes.push({ collection: 'recordDecisions', id: value.recordVersionId, kind: 'added' });
    }
    return {
      key: item.key,
      id: uuidFromKey(`proposal:${item.key}`),
      title: item.title,
      rationale: item.rationale,
      author: item.author,
      baseCommitKey: headKey,
      competesWith: item.competesWith ?? null,
      operations,
      candidate,
      expectedDiff: sortedChanges(changes),
    };
  });

  const expectations = (loops: StoryLoop[], prefix: string) =>
    Object.fromEntries(
      loops.map((loop) => [
        uuidFromKey(`${prefix}loop:${loop.key}`),
        {
          key: loop.key,
          title: loop.title,
          state: loop.expect.state,
          breakdowns: loop.expect.breakdowns,
        },
      ]),
    );
  const gold = {
    T: project.asOfOverride,
    loops: expectations(story, ''),
    milestones: Object.fromEntries(project.milestones.map((item) => [item.name, item.expect])),
    escalations: source.escalations.map((escalation) => ({
      key: escalation.key,
      complaint: escalation.complaint,
      claims: escalation.claims.map((claim, index) => ({
        id: uuidFromKey(`claim:${escalation.key}:${index}`),
        text: claim.text,
        type: claim.type,
        verdict: claim.verdict,
        supportingActIds: claim.supporting.map(larkspur.actId),
        contradictingActIds: claim.contradicting.map(larkspur.actId),
      })),
    })),
    isolation: {
      loops: expectations(source.isolation.story, 'isolation:'),
      milestones: Object.fromEntries(
        source.isolation.milestones.map((item) => [item.name, item.expect]),
      ),
    },
  };

  const decided = new Set(main.recordDecisions.map((item) => item.recordVersionId));
  const projects = {
    larkspur: {
      id: uuidFromKey('project:larkspur'),
      key: project.key,
      workspaceKey: 'sandbox',
      title: project.title,
      clientName: project.clientName,
      vendorName: project.vendorName,
      sideRules: project.sideRules,
      sourceLabels: [...new Set(larkspur.records.map((item) => item.sourceLabel))].sort(),
      pendingRecordVersionIds: larkspur.records
        .map((item) => item.recordVersionId)
        .filter((id) => !decided.has(id)),
    },
    isolation: {
      id: uuidFromKey('project:isolation'),
      key: source.isolation.key,
      workspaceKey: 'isolation',
      title: source.isolation.title,
      clientName: source.isolation.clientName,
      vendorName: source.isolation.vendorName,
      sideRules: [
        { domain: 'cobalt-ridge.example', side: 'client' },
        { domain: 'fundline.example', side: 'vendor' },
      ],
      sourceLabels: [source.isolation.channel],
      snapshot: isolation.snapshot,
    },
  };
  return {
    'project.json': projects,
    'records.json': [...larkspur.records, ...isolation.records],
    'main-snapshot.json': main,
    'proposals.json': proposals,
    'history.json': history,
    'gold.json': gold,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // A path, not `new URL(..., import.meta.url)`: the sandbox seed bundles this module, and Turbopack resolves URL literals as assets at build time.
  const directory = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
  const source = JSON.parse(
    readFileSync(join(directory, 'story-source.json'), 'utf8'),
  ) as StorySource;
  for (const [name, value] of Object.entries(buildFixtures(source))) {
    writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
    console.log(`wrote fixtures/${name}`);
  }
}
