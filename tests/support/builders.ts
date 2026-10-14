import { GraphSnapshotSchema, type Act, type GraphSnapshot } from '../../src/contracts/graph';

export const ids = {
  person: '10000000-0000-4000-8000-000000000001',
  department: '10000000-0000-4000-8000-000000000002',
  milestone: '10000000-0000-4000-8000-000000000003',
  loop: '10000000-0000-4000-8000-000000000004',
  act: '10000000-0000-4000-8000-000000000005',
  record: '10000000-0000-4000-8000-000000000006',
  annotation: '10000000-0000-4000-8000-000000000007',
  other: '10000000-0000-4000-8000-000000000008',
};

export function snapshot(): GraphSnapshot {
  return GraphSnapshotSchema.parse({
    schemaVersion: 1,
    context: {
      timeZone: 'Asia/Ho_Chi_Minh',
      windowStart: '2026-10-01',
      windowEnd: '2026-10-31',
      asOfOverride: null,
      holidays: [],
      replyWindowDays: 2,
      acceptWindowDays: 3,
      hedgeWindowDays: 4,
      atRiskWindowDays: 5,
      people: [
        {
          id: ids.person,
          name: 'An',
          side: 'vendor',
          departmentId: ids.department,
          role: 'Engineer',
        },
      ],
      departments: [{ id: ids.department, name: 'Engineering', side: 'vendor', order: 0 }],
      milestones: [
        {
          id: ids.milestone,
          name: 'Delivery',
          order: 0,
          plannedDate: '2026-10-20',
          currentDate: '2026-10-20',
          reachedAt: null,
          anchorLoopId: ids.loop,
        },
      ],
    },
    loops: [
      {
        id: ids.loop,
        title: 'Deliver the draft',
        customer: { kind: 'side', side: 'client' },
        performer: { kind: 'person', personId: ids.person },
        performerDepartmentId: ids.department,
        milestoneId: ids.milestone,
      },
    ],
    acts: [
      {
        id: ids.act,
        citation: { recordVersionId: ids.record, start: 0, end: 10 },
        type: 'promise',
        actor: { kind: 'person', personId: ids.person },
        customer: { kind: 'side', side: 'client' },
        performer: { kind: 'person', personId: ids.person },
        action: 'Deliver the draft',
        due: { date: '2026-10-20', precision: 'day' },
        hedged: false,
        loopId: ids.loop,
        hidden: false,
        origin: 'human',
        confidence: null,
      },
    ],
    annotations: [{ id: ids.annotation, text: 'Draft delivery', actIds: [ids.act] }],
    recordDecisions: [{ recordVersionId: ids.record, disposition: 'included', reason: '' }],
  });
}

export function anotherAct(): Act {
  return { ...snapshot().acts[0], id: ids.other, action: 'Review the draft' };
}
