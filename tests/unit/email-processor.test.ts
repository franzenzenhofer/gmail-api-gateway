import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailProcessor } from '../../src/core/email-processor';
import { GmailService } from '../../src/services/gmail.service';
import { AIService } from '../../src/services/ai.service';
import { EmailMessage, AIAnalysis } from '../../src/types';

// Mock the services
vi.mock('../../src/services/gmail.service');
vi.mock('../../src/services/ai.service');

describe('EmailProcessor', () => {
  let processor: EmailProcessor;
  let mockGmailService: any;
  let mockAIService: any;

  const mockEmail: EmailMessage = {
    id: 'email123',
    threadId: 'thread123',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    subject: 'Test Email',
    body: 'This is a test email body',
    date: new Date()
  };

  const mockAnalysis: AIAnalysis = {
    sentiment: 'positive',
    category: 'general',
    summary: 'Test email summary',
    urgency: 'low',
    entities: [],
    intent: 'information'
  };

  beforeEach(() => {
    mockGmailService = {
      getEmail: vi.fn().mockResolvedValue(mockEmail),
      listEmails: vi.fn().mockResolvedValue([mockEmail]),
      addLabel: vi.fn().mockResolvedValue(undefined),
      replyToEmail: vi.fn().mockResolvedValue('reply123')
    };

    mockAIService = {
      analyzeEmail: vi.fn().mockResolvedValue(mockAnalysis),
      generateReply: vi.fn().mockResolvedValue('Generated reply'),
      summarizeThread: vi.fn().mockResolvedValue('Thread summary')
    };

    processor = new EmailProcessor(
      mockGmailService as any,
      mockAIService as any
    );
  });

  describe('processEmail', () => {
    it('should process single email successfully', async () => {
      const result = await processor.processEmail('email123');

      expect(result.success).toBe(true);
      expect(result.emailId).toBe('email123');
      expect(result.analysis).toEqual(mockAnalysis);
      expect(result.processingTime).toBeGreaterThanOrEqual(0);

      expect(mockGmailService.getEmail).toHaveBeenCalledWith('email123');
      expect(mockAIService.analyzeEmail).toHaveBeenCalledWith(mockEmail);
    });

    it('should add labels when requested', async () => {
      await processor.processEmail('email123', { addLabels: true });

      expect(mockGmailService.addLabel).toHaveBeenCalledWith('email123', 'ai/general');
    });

    it('should handle processing errors', async () => {
      mockGmailService.getEmail.mockRejectedValue(new Error('Gmail error'));

      const result = await processor.processEmail('email123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Gmail error');
    });

    it('should skip analysis when requested', async () => {
      const result = await processor.processEmail('email123', { 
        analyzeContent: false 
      });

      expect(result.success).toBe(true);
      expect(result.analysis).toBeUndefined();
      expect(mockAIService.analyzeEmail).not.toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    it('should process multiple emails', async () => {
      mockGmailService.listEmails.mockResolvedValue([
        { ...mockEmail, id: 'email1' },
        { ...mockEmail, id: 'email2' },
        { ...mockEmail, id: 'email3' }
      ]);

      const results = await processor.processBatch({}, {}, 3);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
      expect(mockGmailService.getEmail).toHaveBeenCalledTimes(3);
    });

    it('should handle partial failures in batch', async () => {
      mockGmailService.listEmails.mockResolvedValue([
        { ...mockEmail, id: 'email1' },
        { ...mockEmail, id: 'email2' }
      ]);

      mockGmailService.getEmail
        .mockResolvedValueOnce(mockEmail)
        .mockRejectedValueOnce(new Error('Failed'));

      const results = await processor.processBatch({}, {}, 2);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });
  });

  describe('processAndReply', () => {
    it('should analyze email and generate reply', async () => {
      mockAnalysis.suggestedReply = 'AI suggested reply';
      mockAIService.analyzeEmail.mockResolvedValue(mockAnalysis);

      const result = await processor.processAndReply('email123', 'Extra context');

      expect(result.analysis).toEqual(mockAnalysis);
      expect(result.suggestedReply).toBe('Generated reply');
      expect(mockAIService.generateReply).toHaveBeenCalledWith(mockEmail, 'Extra context');
    });
  });

  describe('autoRespond', () => {
    it('should auto-respond to high urgency customer support', async () => {
      const urgentAnalysis: AIAnalysis = {
        ...mockAnalysis,
        category: 'customer-support',
        urgency: 'high',
        suggestedReply: 'Urgent response'
      };

      mockAIService.analyzeEmail.mockResolvedValue(urgentAnalysis);

      const count = await processor.autoRespond({});

      expect(count).toBe(1);
      expect(mockGmailService.replyToEmail).toHaveBeenCalled();
      expect(mockGmailService.addLabel).toHaveBeenCalledWith('email123', 'auto-responded');
    });

    it('should not auto-respond to newsletters', async () => {
      const newsletterAnalysis: AIAnalysis = {
        ...mockAnalysis,
        category: 'newsletter'
      };

      mockAIService.analyzeEmail.mockResolvedValue(newsletterAnalysis);

      const count = await processor.autoRespond({});

      expect(count).toBe(0);
      expect(mockGmailService.replyToEmail).not.toHaveBeenCalled();
    });

    it('should handle auto-respond errors gracefully', async () => {
      const urgentAnalysis: AIAnalysis = {
        ...mockAnalysis,
        category: 'customer-support',
        urgency: 'high'
      };

      mockAIService.analyzeEmail.mockResolvedValue(urgentAnalysis);
      mockGmailService.replyToEmail.mockRejectedValue(new Error('Send failed'));

      const count = await processor.autoRespond({});

      expect(count).toBe(0); // Failed to send
    });
  });

  describe('summarizeThread', () => {
    it('should summarize email thread', async () => {
      const threadEmails = [
        { ...mockEmail, id: '1', date: new Date('2024-01-01') },
        { ...mockEmail, id: '2', date: new Date('2024-01-02') },
        { ...mockEmail, id: '3', date: new Date('2024-01-03') }
      ];

      mockGmailService.listEmails.mockResolvedValue(threadEmails);

      const summary = await processor.summarizeThread('thread123');

      expect(summary).toBe('Thread summary');
      expect(mockAIService.summarizeThread).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: '1' }),
          expect.objectContaining({ id: '2' }),
          expect.objectContaining({ id: '3' })
        ])
      );
    });

    it('should throw error for empty thread', async () => {
      mockGmailService.listEmails.mockResolvedValue([]);

      await expect(processor.summarizeThread('thread123'))
        .rejects.toThrow('Thread not found');
    });
  });
});