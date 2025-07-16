import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { EmailMessage, EmailFilter, GmailTokens } from '@types/index';

export class GmailService {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      process.env.GMAIL_REDIRECT_URI
    );
  }

  /**
   * Set user credentials for Gmail API access
   */
  setCredentials(tokens: GmailTokens): void {
    this.oauth2Client.setCredentials(tokens);
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Get authorization URL for OAuth flow
   */
  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });
  }

  /**
   * Exchange authorization code for tokens
   */
  async getTokens(code: string): Promise<GmailTokens> {
    const { tokens } = await this.oauth2Client.getToken(code);
    return tokens as GmailTokens;
  }

  /**
   * List emails with optional filters
   */
  async listEmails(filter: EmailFilter = {}, maxResults = 10): Promise<EmailMessage[]> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized. Call setCredentials first.');
    }

    const query = this.buildQuery(filter);
    
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults
    });

    if (!response.data.messages) {
      return [];
    }

    const emails = await Promise.all(
      response.data.messages.map(msg => this.getEmail(msg.id!))
    );

    return emails;
  }

  /**
   * Get a single email by ID
   */
  async getEmail(messageId: string): Promise<EmailMessage> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }

    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    return this.parseMessage(response.data);
  }

  /**
   * Send an email
   */
  async sendEmail(to: string[], subject: string, body: string, cc?: string[]): Promise<string> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }

    const message = this.createMessage(to, subject, body, cc);
    
    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: message
      }
    });

    return response.data.id!;
  }

  /**
   * Reply to an email thread
   */
  async replyToEmail(threadId: string, messageId: string, body: string): Promise<string> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }

    // Get original message for context
    const original = await this.getEmail(messageId);
    
    const replyMessage = this.createReply(original, body, threadId);
    
    const response = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: replyMessage,
        threadId
      }
    });

    return response.data.id!;
  }

  /**
   * Add label to email
   */
  async addLabel(messageId: string, labelName: string): Promise<void> {
    if (!this.gmail) {
      throw new Error('Gmail client not initialized');
    }

    // Get or create label
    const labelId = await this.getLabelId(labelName);

    await this.gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        addLabelIds: [labelId]
      }
    });
  }

  /**
   * Build Gmail search query from filter
   */
  private buildQuery(filter: EmailFilter): string {
    const parts: string[] = [];

    if (filter.from) parts.push(`from:${filter.from}`);
    if (filter.to) parts.push(`to:${filter.to}`);
    if (filter.subject) parts.push(`subject:${filter.subject}`);
    if (filter.after) parts.push(`after:${filter.after.toISOString().split('T')[0]}`);
    if (filter.before) parts.push(`before:${filter.before.toISOString().split('T')[0]}`);
    if (filter.hasAttachment) parts.push('has:attachment');
    if (filter.label) parts.push(`label:${filter.label}`);
    if (filter.query) parts.push(filter.query);

    return parts.join(' ');
  }

  /**
   * Parse Gmail message to our EmailMessage format
   */
  private parseMessage(message: gmail_v1.Schema$Message): EmailMessage {
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name === name)?.value || '';

    const email: EmailMessage = {
      id: message.id!,
      threadId: message.threadId!,
      from: getHeader('From'),
      to: getHeader('To').split(',').map(e => e.trim()),
      cc: getHeader('Cc') ? getHeader('Cc').split(',').map(e => e.trim()) : undefined,
      subject: getHeader('Subject'),
      body: this.getBody(message.payload!, 'text/plain'),
      bodyHtml: this.getBody(message.payload!, 'text/html'),
      date: new Date(parseInt(message.internalDate!)),
      snippet: message.snippet || '',
      labels: message.labelIds,
      attachments: this.getAttachments(message.payload!)
    };

    return email;
  }

  /**
   * Extract body from message payload
   */
  private getBody(payload: gmail_v1.Schema$MessagePart, mimeType: string): string {
    if (payload.mimeType === mimeType && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        const body = this.getBody(part, mimeType);
        if (body) return body;
      }
    }

    return '';
  }

  /**
   * Extract attachments from message
   */
  private getAttachments(payload: gmail_v1.Schema$MessagePart): any[] {
    const attachments: any[] = [];

    const extractAttachments = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType!,
          size: part.body.size!,
          attachmentId: part.body.attachmentId
        });
      }

      if (part.parts) {
        part.parts.forEach(extractAttachments);
      }
    };

    extractAttachments(payload);
    return attachments;
  }

  /**
   * Create email message in RFC 2822 format
   */
  private createMessage(to: string[], subject: string, body: string, cc?: string[]): string {
    const lines = [
      `To: ${to.join(', ')}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64'
    ];

    if (cc && cc.length > 0) {
      lines.splice(1, 0, `Cc: ${cc.join(', ')}`);
    }

    lines.push('', Buffer.from(body).toString('base64'));

    const message = lines.join('\r\n');
    return Buffer.from(message).toString('base64url');
  }

  /**
   * Create reply message
   */
  private createReply(original: EmailMessage, body: string, threadId: string): string {
    const replyTo = original.from;
    const subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`;
    
    const lines = [
      `To: ${replyTo}`,
      `Subject: ${subject}`,
      `In-Reply-To: ${original.id}`,
      `References: ${original.id}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(body).toString('base64')
    ];

    const message = lines.join('\r\n');
    return Buffer.from(message).toString('base64url');
  }

  /**
   * Get or create label by name
   */
  private async getLabelId(labelName: string): Promise<string> {
    const response = await this.gmail.users.labels.list({ userId: 'me' });
    
    const existingLabel = response.data.labels?.find(
      label => label.name === labelName
    );

    if (existingLabel) {
      return existingLabel.id!;
    }

    // Create new label
    const newLabel = await this.gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: labelName,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show'
      }
    });

    return newLabel.data.id!;
  }
}