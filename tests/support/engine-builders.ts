import { deriveProject } from '../../src/server/loops/engine';
import type { EngineInput } from '../../src/contracts/engine';
import type { Act, ActType, Party } from '../../src/contracts/graph';

export const uuid = (name: string) =>
  `00000000-0000-4000-8000-${Array.from(name)
    .map((c) => c.charCodeAt(0).toString(16))
    .join('')
    .padStart(12, '0')
    .slice(-12)}`;
export const customer: Party = { kind: 'person', personId: uuid('customer') };
export const performer: Party = { kind: 'person', personId: uuid('performer') };
export const due = { date: '2026-10-09', precision: 'day' as const };
export const laterDue = { date: '2026-10-20', precision: 'day' as const };
export type Step = { type: ActType; actor?: Party; at?: string } & Partial<Act>;
export function fixture(steps: Step[], T = '2026-10-16T12:00:00Z'): EngineInput {
  const acts = steps.map((step, index): Act => {
    const { at: _at, ...terms } = step;
    void _at;
    return {
      id: uuid(`act-${index.toString().padStart(2, '0')}`),
      citation: { recordVersionId: uuid(`record-${index}`), start: 0, end: 12 },
      actor: ['request', 'accept', 'reject', 'cancel', 'follow_up', 'agree_change'].includes(
        step.type,
      )
        ? customer
        : performer,
      customer,
      performer,
      action: 'deliver mapping',
      due: null,
      hedged: false,
      loopId: uuid('loop'),
      hidden: false,
      origin: 'human',
      confidence: null,
      ...terms,
    };
  });
  return {
    T,
    records: acts.map((act, index) => ({
      recordVersionId: act.citation.recordVersionId,
      occurredAt: steps[index].at ?? `2026-10-${(5 + index).toString().padStart(2, '0')}T12:00:00Z`,
      bodyText: 'Mapping done for review.',
      digest: uuid('a').repeat(64),
      withdrawn: false,
      quotedRanges: [],
    })),
    snapshot: {
      schemaVersion: 1,
      acts,
      loops: [
        {
          id: uuid('loop'),
          title: 'Mapping',
          customer,
          performer,
          performerDepartmentId: uuid('engineering'),
          milestoneId: uuid('milestone'),
        },
      ],
      annotations: [],
      recordDecisions: [],
      context: {
        timeZone: 'UTC',
        windowStart: '2026-10-01',
        windowEnd: '2026-11-01',
        asOfOverride: null,
        holidays: [],
        replyWindowDays: 2,
        acceptWindowDays: 5,
        hedgeWindowDays: 5,
        atRiskWindowDays: 2,
        people: [
          {
            id: uuid('customer'),
            name: 'Ada',
            side: 'client',
            departmentId: uuid('implementation'),
            role: '',
          },
          {
            id: uuid('performer'),
            name: 'Ben',
            side: 'vendor',
            departmentId: uuid('engineering'),
            role: '',
          },
          {
            id: uuid('colleague'),
            name: 'Cam',
            side: 'client',
            departmentId: uuid('implementation'),
            role: '',
          },
        ],
        departments: [
          { id: uuid('implementation'), name: 'Implementation', side: 'client', order: 0 },
          { id: uuid('engineering'), name: 'Engineering', side: 'vendor', order: 1 },
        ],
        milestones: [
          {
            id: uuid('milestone'),
            name: 'Launch',
            order: 0,
            plannedDate: '2026-10-20',
            currentDate: '2026-10-20',
            reachedAt: null,
            anchorLoopId: uuid('loop'),
          },
        ],
      },
    },
  };
}
export const loop = (input: EngineInput) => deriveProject(input).loops[0];
export const types = (input: EngineInput) => loop(input).breakdowns.map((item) => item.type);
