export interface UserFile extends UserFileMeta {
  data: Buffer;
}

export interface UserFileMeta {
  id: number;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

export interface UserFileRow {
  id: number;
  user_id: number;
  name: string;
  mime: string;
  size: number;
  data: Buffer;
  created_at: number;
}
