import { GmailService } from '@services/gmail.service';
import { AIService } from '@services/ai.service';
import { LoopPreventionService } from '@services/loop-prevention.service';
import { EmailMessage, EmailFilter, AIAnalysis, ProcessingResult } from '@types/index';

export interface ProcessingOptions {
  analyzeContent?: boolean;
  generateReply?: boolean;
  categorize?: boolean;
  extractEntities?: boolean;
  addLabels?: boolean;
}

export class EmailProcessor {
  private loopPreventionService: LoopPreventionService;

  constructor(
    private gmailService: GmailService,
    private aiService: AIService
  ) {
    this.loopPreventionService = new LoopPreventionService();
  }

  /**
   * Process a single email with AI analysis
   */
  async processEmail(
    emailId: string, 
    options: ProcessingOptions = {}
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    try {
      // Fetch email from Gmail
      const email = await this.gmailService.getEmail(emailId);
      
      let analysis: AIAnalysis | undefined;
      
      if (options.analyzeContent !== false) {
        // Analyze email with AI
        analysis = await this.aiService.analyzeEmail(email);
        
        // Add labels based on analysis
        if (options.addLabels) {
          await this.addAnalysisLabels(email.id, analysis);
        }
      }
      
      return {
        success: true,
        emailId: email.id,
        analysis,
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        emailId,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Process multiple emails in batch
   */
  async processBatch(
    filter: EmailFilter, 
    options: ProcessingOptions = {},
    maxEmails = 50
  ): Promise<ProcessingResult[]> {
    const emails = await this.gmailService.listEmails(filter, maxEmails);
    
    const results = await Promise.allSettled(
      emails.map(email => this.processEmail(email.id, options))
    );
    
    return results.map(result => 
      result.status === 'fulfilled' ? result.value : {
        success: false,
        emailId: '',
        error: 'Processing failed',
        processingTime: 0
      }
    );
  }

  /**
   * Process email and generate smart reply
   */
  async processAndReply(
    emailId: string,
    context?: string
  ): Promise<{ analysis: AIAnalysis; suggestedReply: string }> {
    const email = await this.gmailService.getEmail(emailId);
    const analysis = await this.aiService.analyzeEmail(email);
    
    // Generate reply based on analysis
    const suggestedReply = await this.aiService.generateReply(email, context);
    
    return { analysis, suggestedReply };
  }

  /**
   * Auto-respond to emails based on rules
   */
  async autoRespond(
    filter: EmailFilter,
    responseTemplate?: string
  ): Promise<number> {
    const emails = await this.gmailService.listEmails(filter, 10);
    let responded = 0;
    
    for (const email of emails) {
      try {
        // Check for email loops first
        const loopCheck = await this.loopPreventionService.checkForLoop({
          from: email.from,
          subject: email.subject,
          body: email.body,
          threadId: email.threadId
        });

        if (loopCheck.action === 'block') {
          console.log(`Blocked potential loop from ${email.from}: ${loopCheck.reason}`);
          await this.gmailService.addLabel(email.id, 'loop-blocked');
          continue;
        }

        if (loopCheck.action === 'delay') {
          console.log(`Delaying response to ${email.from} by ${loopCheck.delayMinutes} minutes`);
          // In production, schedule delayed response
          continue;
        }

        const analysis = await this.aiService.analyzeEmail(email);
        
        // Only auto-respond to certain categories
        if (this.shouldAutoRespond(analysis)) {
          const reply = responseTemplate || analysis.suggestedReply || 
            await this.aiService.generateReply(email);
          
          await this.gmailService.replyToEmail(
            email.threadId,
            email.id,
            reply
          );
          
          // Mark as responded
          await this.gmailService.addLabel(email.id, 'auto-responded');
          responded++;
        }
      } catch (error) {
        console.error(`Failed to auto-respond to ${email.id}:`, error);
      }
    }
    
    return responded;
  }

  /**
   * Summarize email thread
   */
  async summarizeThread(threadId: string): Promise<string> {
    // Get all emails in thread
    const emails = await this.gmailService.listEmails({ query: `threadId:${threadId}` }, 100);
    
    if (emails.length === 0) {
      throw new Error('Thread not found');
    }
    
    // Sort by date
    emails.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    return await this.aiService.summarizeThread(emails);
  }

  /**
   * Add labels based on AI analysis
   */
  private async addAnalysisLabels(emailId: string, analysis: AIAnalysis): Promise<void> {
    const labels: string[] = [];
    
    // Add category label
    if (analysis.category && analysis.category !== 'other') {
      labels.push(`ai/${analysis.category}`);
    }
    
    // Add urgency label
    if (analysis.urgency === 'high') {
      labels.push('ai/urgent');
    }
    
    // Add sentiment label
    if (analysis.sentiment !== 'neutral') {
      labels.push(`ai/sentiment-${analysis.sentiment}`);
    }
    
    // Apply all labels
    await Promise.all(
      labels.map(label => this.gmailService.addLabel(emailId, label))
    );
  }

  /**
   * Determine if email should receive auto-response
   */
  private shouldAutoRespond(analysis: AIAnalysis): boolean {
    // Don't auto-respond to newsletters, spam, or internal emails
    const noResponseCategories = ['newsletter', 'spam', 'internal-communication'];
    if (noResponseCategories.includes(analysis.category)) {
      return false;
    }
    
    // Only respond to high urgency customer support
    if (analysis.category === 'customer-support' && analysis.urgency === 'high') {
      return true;
    }
    
    // Respond to simple inquiries
    if (analysis.category === 'sales-inquiry' && analysis.intent === 'information-request') {
      return true;
    }
    
    return false;
  }
}