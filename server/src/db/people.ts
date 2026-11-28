import type { DB } from './connection.ts';

export interface ResidentRecord { id: string; name: string; unit: string }
export interface StaffRecord { id: string; name: string; role: 'technician' | 'manager' }

export function listResidents(db: DB): ResidentRecord[] {
  return db.prepare('SELECT id, name, unit FROM residents ORDER BY id').all() as unknown as ResidentRecord[];
}

export function getResident(db: DB, id: string): ResidentRecord | null {
  return (db.prepare('SELECT id, name, unit FROM residents WHERE id = ?').get(id) as ResidentRecord | undefined) ?? null;
}

export function listStaff(db: DB): StaffRecord[] {
  return db.prepare('SELECT id, name, role FROM staff ORDER BY id').all() as unknown as StaffRecord[];
}
