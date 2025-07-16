import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIService } from '../../src/services/ai.service';
import { EmailMessage } from '../../src/types';

// Mock the Google Generative AI
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: vi.fn().mockReturnValue({
      generateContent: vi.fn()
    })
  }))
}));

describe('AIService', () => {
  let aiService: AIService;
  let mockModel: any;

  beforeEach(() => {
    aiService = new AIService('test-api-key');
    mockModel = (aiService as any).model;
  });

  describe('analyzeEmail', () => {
    it('should analyze email and return structured analysis', async () => {
      const mockEmail: EmailMessage = {
        id: '123',
        threadId: 'thread123',
        from: 'customer@example.com',
        to: ['support@company.com'],
        subject: 'Urgent: Product not working',
        body: 'Hi, I bought your product yesterday and it is not working. I need help ASAP!',
        date: new Date()
      };

      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            sentiment: 'negative',
            category: 'customer-support',
            summary: 'Customer reporting product issue',
            suggestedReply: 'We apologize for the inconvenience...',
            urgency: 'high',
            entities: [
              { type: 'date', value: 'yesterday', confidence: 0.9 }
            ],
            intent: 'complaint'
          })
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const analysis = await aiService.analyzeEmail(mockEmail);

      expect(analysis).toEqual({
        sentiment: 'negative',
        category: 'customer-support',
        summary: 'Customer reporting product issue',
        suggestedReply: 'We apologize for the inconvenience...',
        urgency: 'high',
        entities: [
          { type: 'date', value: 'yesterday', confidence: 0.9 }
        ],
        intent: 'complaint'
      });

      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Urgent: Product not working')
      );
    });

    it('should handle AI errors gracefully', async () => {
      const mockEmail: EmailMessage = {
        id: '123',
        threadId: 'thread123',
        from: 'test@example.com',
        to: ['test@company.com'],
        subject: 'Test',
        body: 'Test email',
        date: new Date()
      };

      mockModel.generateContent.mockRejectedValue(new Error('AI API error'));

      await expect(aiService.analyzeEmail(mockEmail)).rejects.toThrow('Failed to analyze email');
    });
  });

  describe('generateReply', () => {
    it('should generate appropriate reply for email', async () => {
      const mockEmail: EmailMessage = {
        id: '123',
        threadId: 'thread123',
        from: 'customer@example.com',
        to: ['support@company.com'],
        subject: 'Question about pricing',
        body: 'What are your pricing plans?',
        date: new Date()
      };

      const mockResponse = {
        response: {
          text: () => 'Thank you for your interest in our pricing...'
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const reply = await aiService.generateReply(mockEmail);

      expect(reply).toBe('Thank you for your interest in our pricing...');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Generate a professional email reply')
      );
    });

    it('should include context in reply generation', async () => {
      const mockEmail: EmailMessage = {
        id: '123',
        threadId: 'thread123',
        from: 'customer@example.com',
        to: ['support@company.com'],
        subject: 'Follow-up',
        body: 'Any updates?',
        date: new Date()
      };

      const context = 'Customer is VIP with active subscription';

      const mockResponse = {
        response: {
          text: () => 'Thank you for following up...'
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      await aiService.generateReply(mockEmail, context);

      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining(context)
      );
    });
  });

  describe('classifyEmail', () => {
    it('should classify email into correct category', async () => {
      const mockEmail: EmailMessage = {
        id: '123',
        threadId: 'thread123',
        from: 'noreply@newsletter.com',
        to: ['user@example.com'],
        subject: 'Weekly Newsletter',
        body: 'Here are this week\'s updates...',
        date: new Date()
      };

      const mockResponse = {
        response: {
          text: () => 'newsletter'
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const category = await aiService.classifyEmail(mockEmail);

      expect(category).toBe('newsletter');
    });

    it('should return "other" on classification error', async () => {
      const mockEmail: EmailMessage = {
        id: '123',
        threadId: 'thread123',
        from: 'test@example.com',
        to: ['test@company.com'],
        subject: 'Test',
        body: 'Test',
        date: new Date()
      };

      mockModel.generateContent.mockRejectedValue(new Error('API error'));

      const category = await aiService.classifyEmail(mockEmail);

      expect(category).toBe('other');
    });
  });

  describe('extractEntities', () => {
    it('should extract entities from text', async () => {
      const text = 'John Smith from Acme Corp called about the $5000 invoice due on January 15th';

      const mockResponse = {
        response: {
          text: () => `[
            {"type": "person", "value": "John Smith", "confidence": 0.95},
            {"type": "organization", "value": "Acme Corp", "confidence": 0.9},
            {"type": "money", "value": "$5000", "confidence": 0.98},
            {"type": "date", "value": "January 15th", "confidence": 0.92}
          ]`
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const entities = await aiService.extractEntities(text);

      expect(entities).toHaveLength(4);
      expect(entities[0]).toEqual({
        type: 'person',
        value: 'John Smith',
        confidence: 0.95
      });
    });

    it('should return empty array on extraction error', async () => {
      mockModel.generateContent.mockRejectedValue(new Error('API error'));

      const entities = await aiService.extractEntities('Some text');

      expect(entities).toEqual([]);
    });
  });

  describe('summarizeThread', () => {
    it('should summarize email thread', async () => {
      const emails: EmailMessage[] = [
        {
          id: '1',
          threadId: 'thread1',
          from: 'alice@example.com',
          to: ['bob@example.com'],
          subject: 'Project Update',
          body: 'The project is on track',
          date: new Date('2024-01-01')
        },
        {
          id: '2',
          threadId: 'thread1',
          from: 'bob@example.com',
          to: ['alice@example.com'],
          subject: 'Re: Project Update',
          body: 'Great! When can we launch?',
          date: new Date('2024-01-02')
        }
      ];

      const mockResponse = {
        response: {
          text: () => 'Project status discussion. Alice confirmed project is on track. Bob inquired about launch date.'
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const summary = await aiService.summarizeThread(emails);

      expect(summary).toBe('Project status discussion. Alice confirmed project is on track. Bob inquired about launch date.');
      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Project Update')
      );
    });
  });
});