export interface QuestionMeta {
  id: number;
  question: string;
  options: string[];
  correctAnswer: string;
  tags: string[];
  createdAt: number;
}

export interface QuestionRow {
  id: number;
  user_id: number;
  image: Buffer;
  mime: string;
  question: string;
  options: string;
  correct_answer: string;
  tags: string;
  created_at: number;
}

export interface QuestionImage {
  data: Buffer;
  mime: string;
}
