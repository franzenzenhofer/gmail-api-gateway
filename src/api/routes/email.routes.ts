import { Router, Request, Response } from 'express';
import { GmailService } from '@services/gmail.service';
import { AIService } from '@services/ai.service';
import { EmailProcessor } from '@core/email-processor';
import { EmailFilter } from '@types/index';

const router = Router();

// Middleware to ensure Gmail service is authenticated
const requireAuth = (req: Request, res: Response, next: Function) => {
  // In production, get tokens from session/database
  const tokens = req.headers.authorization;
  if (!tokens) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
};

/**
 * List emails with optional filters
 */
router.get('/emails', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    // In production, get tokens from secure storage
    // gmailService.setCredentials(userTokens);
    
    const filter: EmailFilter = {
      from: req.query.from as string,
      to: req.query.to as string,
      subject: req.query.subject as string,
      label: req.query.label as string,
      query: req.query.q as string
    };
    
    const maxResults = parseInt(req.query.limit as string) || 10;
    const emails = await gmailService.listEmails(filter, maxResults);
    
    res.json({
      count: emails.length,
      emails
    });
  } catch (error) {
    console.error('List emails error:', error);
    res.status(500).json({ error: 'Failed to list emails' });
  }
});

/**
 * Get single email by ID
 */
router.get('/emails/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    const email = await gmailService.getEmail(req.params.id);
    res.json(email);
  } catch (error) {
    console.error('Get email error:', error);
    res.status(500).json({ error: 'Failed to get email' });
  }
});

/**
 * Analyze email with AI
 */
router.post('/emails/:id/analyze', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    const aiService = new AIService(process.env.GEMINI_API_KEY!);
    const processor = new EmailProcessor(gmailService, aiService);
    
    const result = await processor.processEmail(req.params.id, {
      analyzeContent: true,
      generateReply: req.body.generateReply || false,
      categorize: true,
      extractEntities: true,
      addLabels: req.body.addLabels || false
    });
    
    res.json(result);
  } catch (error) {
    console.error('Analyze email error:', error);
    res.status(500).json({ error: 'Failed to analyze email' });
  }
});

/**
 * Generate reply for email
 */
router.post('/emails/:id/reply', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    const aiService = new AIService(process.env.GEMINI_API_KEY!);
    const processor = new EmailProcessor(gmailService, aiService);
    
    const { context } = req.body;
    const result = await processor.processAndReply(req.params.id, context);
    
    res.json(result);
  } catch (error) {
    console.error('Generate reply error:', error);
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

/**
 * Send email
 */
router.post('/emails/send', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    const { to, subject, body, cc } = req.body;
    
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const messageId = await gmailService.sendEmail(
      Array.isArray(to) ? to : [to],
      subject,
      body,
      cc
    );
    
    res.json({ 
      success: true, 
      messageId 
    });
  } catch (error) {
    console.error('Send email error:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

/**
 * Batch process emails
 */
router.post('/emails/batch-process', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    const aiService = new AIService(process.env.GEMINI_API_KEY!);
    const processor = new EmailProcessor(gmailService, aiService);
    
    const { filter, options, maxEmails } = req.body;
    const results = await processor.processBatch(filter || {}, options || {}, maxEmails || 10);
    
    res.json({
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (error) {
    console.error('Batch process error:', error);
    res.status(500).json({ error: 'Failed to process emails' });
  }
});

/**
 * Summarize email thread
 */
router.get('/threads/:threadId/summary', requireAuth, async (req: Request, res: Response) => {
  try {
    const gmailService = new GmailService();
    const aiService = new AIService(process.env.GEMINI_API_KEY!);
    const processor = new EmailProcessor(gmailService, aiService);
    
    const summary = await processor.summarizeThread(req.params.threadId);
    
    res.json({ 
      threadId: req.params.threadId,
      summary 
    });
  } catch (error) {
    console.error('Summarize thread error:', error);
    res.status(500).json({ error: 'Failed to summarize thread' });
  }
});

export default router;