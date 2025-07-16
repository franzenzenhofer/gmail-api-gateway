export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments?: Attachment[];
  labels?: string[];
  date: Date;
  snippet?: string;
}

export interface Attachment {
  filename: string;
  mimeType: string;
  size: number;
  data?: string;
  attachmentId?: string;
}

export interface EmailFilter {
  from?: string;
  to?: string;
  subject?: string;
  after?: Date;
  before?: Date;
  hasAttachment?: boolean;
  label?: string;
  query?: string;
}

export interface AIAnalysis {
  sentiment: 'positive' | 'negative' | 'neutral';
  category: string;
  summary: string;
  suggestedReply?: string;
  urgency: 'low' | 'medium' | 'high';
  entities: Entity[];
  intent: string;
}

export interface Entity {
  type: 'person' | 'organization' | 'location' | 'date' | 'money' | 'other';
  value: string;
  confidence: number;
}

export interface User {
  id: string;
  email: string;
  name: string;
  gmailTokens?: GmailTokens;
  createdAt: Date;
  updatedAt: Date;
}

export interface GmailTokens {
  access_token: string;
  refresh_token: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

export interface ProcessingResult {
  success: boolean;
  emailId: string;
  analysis?: AIAnalysis;
  error?: string;
  processingTime: number;
}