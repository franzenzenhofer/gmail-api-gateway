import { describe, it, expect, beforeEach } from 'vitest';
import { LoopPreventionService } from '../../src/services/loop-prevention.service';

describe('LoopPreventionService', () => {
  let service: LoopPreventionService;

  beforeEach(() => {
    service = new LoopPreventionService();
  });

  describe('Pattern Detection', () => {
    it('should detect autoresponder patterns', async () => {
      const result = await service.checkForLoop({
        from: 'noreply@system.com',
        subject: 'Auto-Reply: Your message has been received',
        body: 'This is an automated response. Do not reply.'
      });

      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.action).not.toBe('proceed');
    });

    it('should detect out of office messages', async () => {
      const result = await service.checkForLoop({
        from: 'user@example.com',
        subject: 'Out of Office',
        body: 'I am currently out of office and will respond when I return.'
      });

      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should allow normal emails', async () => {
      const result = await service.checkForLoop({
        from: 'customer@example.com',
        subject: 'Question about your product',
        body: 'Hi, I have a question about pricing.'
      });

      expect(result.action).toBe('proceed');
      expect(result.isLoop).toBe(false);
    });
  });

  describe('Frequency Detection', () => {
    it('should detect burst patterns', async () => {
      const sender = 'burst@example.com';
      
      // Send 5 emails rapidly (burst threshold)
      for (let i = 0; i < 5; i++) {
        await service.checkForLoop({
          from: sender,
          subject: `Email ${i}`,
          body: `Message ${i}`
        });
      }

      const result = await service.checkForLoop({
        from: sender,
        subject: 'Email 6',
        body: 'Message 6'
      });

      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.action).not.toBe('proceed');
    });

    it('should enforce hourly limits', async () => {
      const sender = 'frequent@example.com';
      
      // Send 11 emails (over 10/hour limit)
      for (let i = 0; i < 11; i++) {
        await service.checkForLoop({
          from: sender,
          subject: `Email ${i}`,
          body: `Different content ${i}`
        });
      }

      const result = await service.checkForLoop({
        from: sender,
        subject: 'Email 12',
        body: 'Message 12'
      });

      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Reply Chain Detection', () => {
    it('should detect excessive Re: chains', async () => {
      const result = await service.checkForLoop({
        from: 'user@example.com',
        subject: 'Re: Re: Re: Re: Meeting',
        body: 'Another reply'
      });

      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should allow normal reply chains', async () => {
      const result = await service.checkForLoop({
        from: 'user@example.com',
        subject: 'Re: Meeting tomorrow',
        body: 'Sounds good!'
      });

      expect(result.action).toBe('proceed');
    });
  });

  describe('Content Similarity', () => {
    it('should detect duplicate content', async () => {
      const sender = 'duplicate@example.com';
      const duplicateBody = 'This is the exact same message content.';

      // First email
      await service.checkForLoop({
        from: sender,
        subject: 'Test 1',
        body: duplicateBody
      });

      // Same content
      const result = await service.checkForLoop({
        from: sender,
        subject: 'Test 2',
        body: duplicateBody
      });

      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('should allow different content from same sender', async () => {
      const sender = 'normal@example.com';

      await service.checkForLoop({
        from: sender,
        subject: 'First email',
        body: 'This is my first message about topic A.'
      });

      const result = await service.checkForLoop({
        from: sender,
        subject: 'Second email',
        body: 'This is a completely different message about topic B.'
      });

      expect(result.confidence).toBeLessThan(0.5);
    });
  });

  describe('Header Detection', () => {
    it('should detect autoresponder headers', async () => {
      const result = await service.checkForLoop({
        from: 'system@example.com',
        subject: 'Notification',
        body: 'System message',
        headers: {
          'x-autoresponder': 'true',
          'auto-submitted': 'auto-replied',
          'precedence': 'bulk'
        }
      });

      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.action).not.toBe('proceed');
    });

    it('should detect list headers', async () => {
      const result = await service.checkForLoop({
        from: 'newsletter@example.com',
        subject: 'Weekly Update',
        body: 'Newsletter content',
        headers: {
          'list-unsubscribe': '<mailto:unsubscribe@example.com>',
          'list-id': 'weekly-newsletter'
        }
      });

      expect(result.confidence).toBeGreaterThan(0.2);
    });
  });

  describe('Thread Reply Limits', () => {
    it('should limit replies per thread', async () => {
      const threadId = 'thread123';
      
      // Send many replies to same thread
      for (let i = 0; i < 20; i++) {
        await service.checkForLoop({
          from: `user${i % 3}@example.com`,
          subject: 'Re: Discussion',
          body: `Reply ${i}`,
          threadId
        });
      }

      const result = await service.checkForLoop({
        from: 'user@example.com',
        subject: 'Re: Discussion',
        body: 'Another reply',
        threadId
      });

      expect(result.confidence).toBeGreaterThan(0.6);
    });
  });

  describe('Whitelist Functionality', () => {
    it('should always allow whitelisted domains', async () => {
      const result = await service.checkForLoop({
        from: 'ceo@company.com',
        subject: 'Auto-Reply: Out of Office',
        body: 'This is an automated response',
        headers: {
          'x-autoresponder': 'true'
        }
      });

      expect(result.action).toBe('proceed');
      expect(result.isLoop).toBe(false);
    });
  });

  describe('Blacklist and Backoff', () => {
    it('should block previously problematic senders', async () => {
      const sender = 'spammer@example.com';
      
      // Trigger multiple high-score detections
      for (let i = 0; i < 15; i++) {
        await service.checkForLoop({
          from: sender,
          subject: 'Auto-Reply: Message',
          body: 'This is an automated response'
        });
      }

      const result = await service.checkForLoop({
        from: sender,
        subject: 'Different subject',
        body: 'Different content'
      });

      expect(result.action).toBe('block');
      expect(result.reason).toContain('previously blocked');
    });

    it('should apply progressive delays', async () => {
      const sender = 'retry@example.com';
      
      // First few emails trigger medium confidence
      for (let i = 0; i < 3; i++) {
        const result = await service.checkForLoop({
          from: sender,
          subject: `Automated message ${i}`,
          body: 'Automatic reply content'
        });
        
        if (i > 0 && result.action === 'delay') {
          expect(result.delayMinutes).toBeDefined();
        }
      }
    });
  });

  describe('Status and Management', () => {
    it('should provide accurate status', async () => {
      // Send emails from different senders
      await service.checkForLoop({
        from: 'user1@example.com',
        subject: 'Test 1',
        body: 'Message 1'
      });

      await service.checkForLoop({
        from: 'user2@example.com',
        subject: 'Test 2',
        body: 'Message 2'
      });

      const status = service.getStatus();
      
      expect(status.totalSenders).toBe(2);
      expect(status.blockedSenders).toBe(0);
      expect(status.activeThreads).toBe(0);
    });

    it('should clear sender history', async () => {
      const sender = 'test@example.com';
      
      await service.checkForLoop({
        from: sender,
        subject: 'Test',
        body: 'Message'
      });

      service.clearSenderHistory(sender);
      
      const status = service.getStatus();
      expect(status.totalSenders).toBe(0);
    });
  });
});