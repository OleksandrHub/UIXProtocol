export type FriendStatus = 'pending' | 'active';

export interface FriendConnection {
  id: number;
  askerId: number;
  helperId: number;
  askerName: string;
  helperName: string;
  status: FriendStatus;
  createdAt: number;
}

export interface FriendConnectionRow {
  id: number;
  asker_id: number;
  helper_id: number;
  status: string;
  created_at: number;
  asker_name?: string | null;
  helper_name?: string | null;
}

export interface FriendsList {
  asAsker: FriendConnection[];
  asHelper: FriendConnection[];
  pendingIncoming: FriendConnection[];
  pendingOutgoing: FriendConnection[];
}
