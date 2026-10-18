import { describe, expect, it } from 'vitest';
import {
  addTeamName,
  DEFAULT_TEAMS,
  newProjectBody,
  newProjectProblem,
  type NewProjectForm,
} from '../../../src/components/shell/new-project';

const form = (fields: Partial<NewProjectForm> = {}): NewProjectForm => ({
  name: 'Project',
  client: 'Client',
  teams: DEFAULT_TEAMS,
  milestoneName: '',
  milestoneDate: '',
  ...fields,
});

describe('new project body', () => {
  it('starts with five default teams', () => {
    expect(DEFAULT_TEAMS).toEqual(['Product', 'Design', 'Engineering', 'QA', 'Operations']);
  });
  it('trims the fields and maps them to the contract names', () => {
    expect(
      newProjectBody(
        form({
          name: '  Brightwater Bank KYC portal ',
          client: ' Brightwater Bank ',
          teams: ['Implementation', 'Engineering', 'QA'],
        }),
      ),
    ).toEqual({
      title: 'Brightwater Bank KYC portal',
      clientName: 'Brightwater Bank',
      teams: ['Implementation', 'Engineering', 'QA'],
    });
  });
  it('adds a typed team at the end, trimmed, and refuses a name the list has', () => {
    expect(addTeamName(['QA'], '  Legal ')).toEqual({ teams: ['QA', 'Legal'], problem: null });
    expect(addTeamName(['QA'], '   ')).toEqual({ teams: ['QA'], problem: null });
    expect(addTeamName(['QA'], 'qa')).toEqual({
      teams: ['QA'],
      problem: 'QA is already in the list.',
    });
    expect(addTeamName(['QA'], 'a'.repeat(201)).problem).toBe(
      'Keep each team name to 200 characters.',
    );
    const fifty = Array.from({ length: 50 }, (_, i) => `T${i}`);
    expect(addTeamName(fifty, 'One more').problem).toBe('Add at most 50 teams.');
  });
  it('refuses a blank name or a blank client', () => {
    expect(newProjectBody(form({ name: '' }))).toBeNull();
    expect(newProjectBody(form({ client: '   ' }))).toBeNull();
  });
  it('accepts exactly the contract limit and refuses one character more', () => {
    expect(newProjectBody(form({ name: 'a'.repeat(200), client: 'b'.repeat(200) }))).not.toBeNull();
    expect(newProjectBody(form({ name: 'a'.repeat(201) }))).toBeNull();
    expect(newProjectBody(form({ client: 'b'.repeat(201) }))).toBeNull();
  });
  it('needs at least one team and refuses the same team twice', () => {
    expect(newProjectBody(form({ teams: [] }))).toBeNull();
    expect(newProjectBody(form({ teams: ['QA', 'Engineering', 'qa'] }))).toBeNull();
  });
  it('adds the first milestone only when it has a name and a date', () => {
    expect(
      newProjectBody(form({ milestoneName: ' Go-live ', milestoneDate: '2026-12-01' })),
    ).toMatchObject({ milestone: { name: 'Go-live', date: '2026-12-01' } });
    expect(newProjectBody(form({ milestoneName: 'Go-live' }))).toBeNull();
    expect(newProjectBody(form({ milestoneDate: '2026-12-01' }))).toBeNull();
    expect(newProjectBody(form({ milestoneName: '  ', milestoneDate: '' }))).not.toHaveProperty(
      'milestone',
    );
  });
  it('adds an optional time to the first milestone', () => {
    expect(
      newProjectBody(
        form({ milestoneName: 'Go-live', milestoneDate: '2026-12-01', milestoneTime: '17:00' }),
      ),
    ).toMatchObject({ milestone: { name: 'Go-live', date: '2026-12-01', time: '17:00' } });
    expect(
      newProjectBody(form({ milestoneName: 'Go-live', milestoneDate: '2026-12-01' }))!.milestone,
    ).not.toHaveProperty('time');
    expect(newProjectBody(form({ milestoneName: 'Go-live', milestoneTime: '17:00' }))).toBeNull();
  });
  it('refuses a time without a name and a date instead of dropping it', () => {
    expect(newProjectBody(form({ milestoneTime: '17:00' }))).toBeNull();
    expect(newProjectProblem(form({ milestoneTime: '17:00' }))).toBe(
      'Give the first milestone a name and a date, or leave its fields empty.',
    );
  });
  it('names the team or milestone problem in plain words', () => {
    expect(newProjectProblem(form())).toBeNull();
    expect(newProjectProblem(form({ teams: [] }))).toBe('Add at least one team');
    expect(newProjectProblem(form({ teams: ['QA', 'qa'] }))).toBe('Each team needs its own name');
    expect(newProjectProblem(form({ milestoneDate: '2026-12-01' }))).toBe(
      'Give the first milestone a name and a date, or leave its fields empty.',
    );
    expect(newProjectProblem(form({ teams: ['a'.repeat(201)] }))).toBe(
      'Keep each team name to 200 characters',
    );
    expect(newProjectProblem(form({ teams: Array.from({ length: 51 }, (_, i) => `T${i}`) }))).toBe(
      'Add at most 50 teams',
    );
    expect(
      newProjectProblem(form({ milestoneName: 'm'.repeat(201), milestoneDate: '2026-12-01' })),
    ).toBe('Keep the milestone name to 200 characters');
    expect(newProjectProblem(form({ teams: ['Q\u0000A'] }))).toBe('Remove the NUL character');
  });
});
