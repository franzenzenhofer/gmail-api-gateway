/**
 * Support Routes - First-level support API endpoints
 */

import { Router, Request, Response } from 'express';
import { FirstLevelSupportAgent } from '@modules/support/first-level-agent';
import { KnowledgeBaseService } from '@modules/support/knowledge-base.service';
import { TicketService } from '@modules/support/ticket.service';
import { GmailService } from '@services/gmail.service';
import { AIService } from '@services/ai.service';

const router = Router();

// Initialize services
const gmailService = new GmailService();
const aiService = new AIService(process.env.GEMINI_API_KEY!);
const ticketService = new TicketService();
const knowledgeBase = new KnowledgeBaseService(process.env.GEMINI_API_KEY!);

// Support agent configuration
const supportConfig = {
  autoReply: true,
  maxAutoReplies: 3,
  escalationThreshold: 0.7,
  sentimentEscalation: true,
  categorization: {
    technical: ['error', 'bug', 'crash', 'not working', 'broken'],
    billing: ['payment', 'invoice', 'charge', 'refund', 'subscription'],
    account: ['password', 'login', 'access', 'security', '2fa'],
    feature: ['feature', 'request', 'add', 'implement', 'suggestion'],
    complaint: ['complaint', 'unhappy', 'disappointed', 'angry', 'worst']
  },
  businessHours: {
    timezone: 'UTC',
    start: 9,
    end: 17,
    days: [1, 2, 3, 4, 5] // Mon-Fri
  }
};

const supportAgent = new FirstLevelSupportAgent(
  gmailService,
  aiService,
  supportConfig
);

// Initialize on startup
supportAgent.initialize().catch(console.error);
knowledgeBase.initialize(process.env.KNOWLEDGE_BASE_PATH || './knowledge-base').catch(console.error);

/**
 * Process incoming support email
 */
router.post('/process-email', async (req: Request, res: Response) => {
  try {
    const { emailId } = req.body;
    
    if (!emailId) {
      return res.status(400).json({ error: 'Email ID required' });
    }
    
    // Get email from Gmail
    const email = await gmailService.getEmail(emailId);
    
    // Process with support agent
    const response = await supportAgent.processEmail(email);
    
    // Execute action if auto-reply
    if (response.action === 'reply' && response.reply && response.ticket) {
      await gmailService.replyToEmail(
        email.threadId,
        email.id,
        response.reply
      );
    }
    
    res.json(response);
  } catch (error) {
    console.error('Support processing error:', error);
    res.status(500).json({ error: 'Failed to process support email' });
  }
});

/**
 * Batch process support emails
 */
router.post('/process-batch', async (req: Request, res: Response) => {
  try {
    const { filter, limit } = req.body;
    
    const responses = await supportAgent.processBatch(
      filter || { label: 'support' },
      limit || 10
    );
    
    res.json({
      processed: responses.length,
      responses
    });
  } catch (error) {
    console.error('Batch processing error:', error);
    res.status(500).json({ error: 'Failed to process batch' });
  }
});

/**
 * Get ticket by ID
 */
router.get('/tickets/:id', async (req: Request, res: Response) => {
  try {
    const ticket = ticketService.getTicket(req.params.id);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json(ticket);
  } catch (error) {
    console.error('Ticket fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

/**
 * Update ticket
 */
router.patch('/tickets/:id', async (req: Request, res: Response) => {
  try {
    const ticket = await ticketService.updateTicket(req.params.id, req.body);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json(ticket);
  } catch (error) {
    console.error('Ticket update error:', error);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

/**
 * Search tickets
 */
router.get('/tickets', async (req: Request, res: Response) => {
  try {
    const tickets = ticketService.searchTickets(req.query as any);
    res.json({ tickets, count: tickets.length });
  } catch (error) {
    console.error('Ticket search error:', error);
    res.status(500).json({ error: 'Failed to search tickets' });
  }
});

/**
 * Get customer tickets
 */
router.get('/customers/:email/tickets', async (req: Request, res: Response) => {
  try {
    const tickets = ticketService.getCustomerTickets(req.params.email);
    res.json({ tickets, count: tickets.length });
  } catch (error) {
    console.error('Customer tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch customer tickets' });
  }
});

/**
 * Search knowledge base
 */
router.post('/knowledge/search', async (req: Request, res: Response) => {
  try {
    const { query, limit } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }
    
    const results = await knowledgeBase.searchKnowledge(query, limit || 5);
    res.json({ results, count: results.length });
  } catch (error) {
    console.error('Knowledge search error:', error);
    res.status(500).json({ error: 'Failed to search knowledge base' });
  }
});

/**
 * Generate solution from knowledge base
 */
router.post('/knowledge/solution', async (req: Request, res: Response) => {
  try {
    const { query, context } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }
    
    const solution = await knowledgeBase.generateSolution(query, context);
    res.json(solution);
  } catch (error) {
    console.error('Solution generation error:', error);
    res.status(500).json({ error: 'Failed to generate solution' });
  }
});

/**
 * Add/update knowledge article
 */
router.post('/knowledge/articles', async (req: Request, res: Response) => {
  try {
    const article = req.body;
    
    if (!article.id || !article.title || !article.content) {
      return res.status(400).json({ error: 'Article ID, title, and content required' });
    }
    
    await knowledgeBase.upsertArticle(article);
    res.json({ success: true, article });
  } catch (error) {
    console.error('Article update error:', error);
    res.status(500).json({ error: 'Failed to update article' });
  }
});

/**
 * Get support metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  try {
    const dateRange = req.query.from && req.query.to ? {
      from: new Date(req.query.from as string),
      to: new Date(req.query.to as string)
    } : undefined;
    
    const metrics = await supportAgent.getMetrics(dateRange);
    res.json(metrics);
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * Analyze knowledge gaps
 */
router.post('/knowledge/analyze-gaps', async (req: Request, res: Response) => {
  try {
    const { interactions } = req.body;
    
    if (!interactions || !Array.isArray(interactions)) {
      return res.status(400).json({ error: 'Interactions array required' });
    }
    
    const analysis = await knowledgeBase.analyzeKnowledgeGaps(interactions);
    res.json(analysis);
  } catch (error) {
    console.error('Gap analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze knowledge gaps' });
  }
});

/**
 * Escalate ticket manually
 */
router.post('/tickets/:id/escalate', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    
    const ticket = await ticketService.escalateTicket(
      req.params.id,
      reason || 'Manual escalation'
    );
    
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    
    res.json(ticket);
  } catch (error) {
    console.error('Escalation error:', error);
    res.status(500).json({ error: 'Failed to escalate ticket' });
  }
});

/**
 * Merge tickets
 */
router.post('/tickets/:id/merge', async (req: Request, res: Response) => {
  try {
    const { duplicateIds } = req.body;
    
    if (!duplicateIds || !Array.isArray(duplicateIds)) {
      return res.status(400).json({ error: 'Duplicate IDs array required' });
    }
    
    const ticket = await ticketService.mergeTickets(req.params.id, duplicateIds);
    
    if (!ticket) {
      return res.status(404).json({ error: 'Primary ticket not found' });
    }
    
    res.json(ticket);
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({ error: 'Failed to merge tickets' });
  }
});

export default router;