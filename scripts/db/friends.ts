import { db } from '../db/connection';
import { FRIEND_JOIN_SQL as JOIN_SQL } from '../shared/constants';
import type {
  FriendConnection,
  FriendConnectionRow,
  FriendsList,
} from '../shared/types';

function rowToConnection(row: FriendConnectionRow): FriendConnection {
  return {
    id: row.id,
    askerId: row.asker_id,
    helperId: row.helper_id,
    askerName: row.asker_name ?? '',
    helperName: row.helper_name ?? '',
    status: row.status === 'active' ? 'active' : 'pending',
    createdAt: row.created_at,
  };
}

export function listMyFriends(userId: number): FriendsList {
  const rows = db
    .prepare(
      `${JOIN_SQL}
       WHERE c.asker_id = ? OR c.helper_id = ?
       ORDER BY c.id DESC`,
    )
    .all(userId, userId) as FriendConnectionRow[];
  const all = rows.map(rowToConnection);
  return {
    asAsker: all.filter((c) => c.askerId === userId && c.status === 'active'),
    asHelper: all.filter((c) => c.helperId === userId && c.status === 'active'),
    pendingIncoming: all.filter((c) => c.helperId === userId && c.status === 'pending'),
    pendingOutgoing: all.filter((c) => c.askerId === userId && c.status === 'pending'),
  };
}

export function getConnection(id: number): FriendConnection | null {
  const row = db
    .prepare(`${JOIN_SQL} WHERE c.id = ?`)
    .get(id) as FriendConnectionRow | undefined;
  return row ? rowToConnection(row) : null;
}

export function getActiveHelperFor(askerId: number): FriendConnection | null {
  const row = db
    .prepare(`${JOIN_SQL} WHERE c.asker_id = ? AND c.status = 'active' LIMIT 1`)
    .get(askerId) as FriendConnectionRow | undefined;
  return row ? rowToConnection(row) : null;
}

export function requestFriendship(
  askerId: number,
  helperId: number,
): { ok: true; connection: FriendConnection } | { ok: false; error: string } {
  if (askerId === helperId) return { ok: false, error: 'cannot connect with yourself' };

  const existing = db
    .prepare(
      `SELECT * FROM friend_connections WHERE asker_id = ? AND helper_id = ?`,
    )
    .get(askerId, helperId) as FriendConnectionRow | undefined;
  if (existing) {
    const connection = getConnection(existing.id);
    if (!connection) return { ok: false, error: 'inconsistent state' };
    return { ok: true, connection };
  }

  const info = db
    .prepare(
      `INSERT INTO friend_connections (asker_id, helper_id, status, created_at)
       VALUES (?, ?, 'pending', ?)`,
    )
    .run(askerId, helperId, Date.now());
  const connection = getConnection(Number(info.lastInsertRowid));
  if (!connection) return { ok: false, error: 'failed to create connection' };
  return { ok: true, connection };
}

export function acceptFriendship(connectionId: number, userId: number): FriendConnection | null {
  const conn = getConnection(connectionId);
  if (!conn || conn.helperId !== userId || conn.status !== 'pending') return null;
  db.prepare(`UPDATE friend_connections SET status = 'active' WHERE id = ?`).run(connectionId);
  return getConnection(connectionId);
}

export function removeFriendship(connectionId: number, userId: number): boolean {
  const conn = getConnection(connectionId);
  if (!conn) return false;
  if (conn.askerId !== userId && conn.helperId !== userId) return false;
  const info = db.prepare('DELETE FROM friend_connections WHERE id = ?').run(connectionId);
  return info.changes > 0;
}
