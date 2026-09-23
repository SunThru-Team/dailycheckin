/**
 * Who can see which tasks. Enforced in SQL (see lib/tasks.ts), not in the UI,
 * so an employee's API responses can never contain a ceo_only task.
 */
export type Role = 'ceo' | 'leadership' | 'employee';

/** The identity a query runs as. `employeeId` is null only for the admin-token CEO view. */
export type Viewer =
  | { kind: 'ceo' }
  | { kind: 'leadership'; employeeId: number }
  | { kind: 'employee'; employeeId: number };

export const viewerFor = (e: { id: number; role: Role }): Viewer =>
  e.role === 'ceo' ? { kind: 'ceo' } : e.role === 'leadership'
    ? { kind: 'leadership', employeeId: e.id }
    : { kind: 'employee', employeeId: e.id };

export const canSeeUnpublishedNotes = (v: Viewer) => v.kind === 'ceo';
