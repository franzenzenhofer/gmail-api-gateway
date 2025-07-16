/**
 * First Level Support Agent - Orchestrates all support operations
 * Combines email processing, knowledge base, tickets, and AI
 */

import { GmailService } from '@services/gmail.service';
import { AIService } from '@services/ai.service';
import { LoopPreventionService } from '@services/loop-prevention.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { TicketService, SupportTicket } from './ticket.service';
import { EmailMessage } from '@types/index';

export interface SupportResponse {
  action: 'reply' | 'escalate' | 'close' | 'wait';
  reply?: string;
  ticket?: SupportTicket;
  knowledgeArticles?: string[];
  confidence: number;
  reasoning: string;
}

export interface SupportConfig {
  autoReply: boolean;
  maxAutoReplies: number;
  escalationThreshold: number;
  sentimentEscalation: boolean;
  categorization: Record<string, string[]>; // category -> keywords
  businessHours?: {
    timezone: string;
    start: number; // hour
    end: number; // hour
    days: number[]; // 0-6
  };
}

export class FirstLevelSupportAgent {
  private knowledgeBase: KnowledgeBaseService;
  private ticketService: TicketService;
  private loopPrevention: LoopPreventionService;
  
  constructor(
    private gmailService: GmailService,
    private aiService: AIService,
    private config: SupportConfig
  ) {
    this.knowledgeBase = new KnowledgeBaseService(process.env.GEMINI_API_KEY!);
    this.ticketService = new TicketService();
    this.loopPrevention = new LoopPreventionService();
  }

  /**
   * Initialize the support agent
   */
  async initialize(): Promise<void> {
    // Load knowledge base
    await this.knowledgeBase.initialize(
      process.env.KNOWLEDGE_BASE_PATH || './knowledge-base'
    );
    
    console.log('First Level Support Agent initialized');
  }

  /**
   * Process incoming support email
   */
  async processEmail(email: EmailMessage): Promise<SupportResponse> {
    // Check for email loops first
    const loopCheck = await this.loopPrevention.checkForLoop({
      from: email.from,
      subject: email.subject,
      body: email.body,
      threadId: email.threadId
    });

    if (loopCheck.isLoop) {
      return {
        action: 'close',
        confidence: 1,
        reasoning: `Email loop detected: ${loopCheck.reason}`
      };
    }

    // Check if ticket exists for this thread
    let ticket = this.ticketService.findTicketByThread(email.threadId);
    
    // Analyze email with AI
    const analysis = await this.aiService.analyzeEmail(email);
    
    // Create or update ticket
    if (!ticket) {
      ticket = await this.ticketService.createTicket({
        customerEmail: email.from,
        subject: email.subject,
        description: email.body,
        emailThreadId: email.threadId,
        emailMessageId: email.id,
        category: this.categorizeEmail(email, analysis),
        sentiment: analysis.sentiment as any,
        priority: this.calculatePriority(email, analysis)
      });
    } else {
      // Add new message to existing ticket
      ticket.emailMessageIds.push(email.id);
      ticket.customerSentiment = analysis.sentiment as any;
      
      // Check if customer is getting frustrated
      if (analysis.sentiment === 'negative' && this.config.sentimentEscalation) {
        return this.escalateTicket(ticket, 'Customer sentiment is negative');
      }
    }

    // Search knowledge base for solutions
    const knowledgeResults = await this.knowledgeBase.searchKnowledge(
      `${email.subject} ${email.body}`,
      5
    );

    // Generate solution using knowledge base
    const solution = await this.knowledgeBase.generateSolution(
      email.body,
      `Previous context: ${ticket.description}`
    );

    // Update ticket with knowledge articles
    if (solution.articleIds.length > 0) {
      await this.ticketService.updateTicket(ticket.id, {
        knowledgeArticles: solution.articleIds
      });
    }

    // Decide on action
    if (solution.needsEscalation || solution.confidence < this.config.escalationThreshold) {
      return this.escalateTicket(ticket, 'Knowledge base insufficient');
    }

    // Check if we should auto-reply
    if (this.shouldAutoReply(ticket)) {
      const reply = await this.generatePersonalizedReply(
        email,
        ticket,
        solution.solution,
        knowledgeResults[0]?.article
      );

      return {
        action: 'reply',
        reply,
        ticket,
        knowledgeArticles: solution.articleIds,
        confidence: solution.confidence,
        reasoning: 'Found solution in knowledge base'
      };
    }

    // Wait for human review
    return {
      action: 'wait',
      ticket,
      knowledgeArticles: solution.articleIds,
      confidence: solution.confidence,
      reasoning: 'Awaiting human review'
    };
  }

  /**
   * Process batch of support emails
   */
  async processBatch(filter: any, limit = 20): Promise<SupportResponse[]> {
    const emails = await this.gmailService.listEmails(filter, limit);
    const responses: SupportResponse[] = [];

    for (const email of emails) {
      try {
        const response = await this.processEmail(email);
        responses.push(response);

        // Execute the action
        if (response.action === 'reply' && response.reply) {
          await this.sendReply(email, response.reply, response.ticket!);
        }
      } catch (error) {
        console.error(`Failed to process email ${email.id}:`, error);
      }
    }

    return responses;
  }

  /**
   * Generate personalized reply using AI and knowledge base
   */
  private async generatePersonalizedReply(
    email: EmailMessage,
    ticket: SupportTicket,
    solution: string,
    article?: any
  ): Promise<string> {
    const customerHistory = this.ticketService.getCustomerTickets(email.from);
    
    const prompt = `
Generate a personalized customer support reply:

CUSTOMER EMAIL:
From: ${email.from}
Subject: ${email.subject}
Body: ${email.body}

TICKET INFORMATION:
Ticket ID: ${ticket.id}
Category: ${ticket.category}
Priority: ${ticket.priority}
Previous interactions: ${customerHistory.length}

SOLUTION FROM KNOWLEDGE BASE:
${solution}

${article ? `
REFERENCE ARTICLE:
Title: ${article.title}
Link: ${process.env.SUPPORT_URL}/kb/${article.id}
` : ''}

INSTRUCTIONS:
1. Be empathetic and professional
2. Address the customer by name if known
3. Provide the solution in clear steps
4. Reference the knowledge base article if helpful
5. Ask if they need additional help
6. Include ticket ID for reference
7. Match the customer's language and tone appropriately

Generate the reply:`;

    const reply = await this.aiService.generateReply(email, prompt);
    
    // Add signature
    return `${reply}

Best regards,
Customer Support Team
Ticket ID: ${ticket.id}
${article ? `\nFor more information, see: ${process.env.SUPPORT_URL}/kb/${article.id}` : ''}`;
  }

  /**
   * Send reply and update ticket
   */
  private async sendReply(
    email: EmailMessage,
    reply: string,
    ticket: SupportTicket
  ): Promise<void> {
    // Send the reply
    await this.gmailService.replyToEmail(
      email.threadId,
      email.id,
      reply
    );

    // Update ticket status
    await this.ticketService.updateTicket(ticket.id, {
      status: 'waiting-customer',
      notes: `Auto-reply sent: ${new Date().toISOString()}`
    });

    // Add label to track
    await this.gmailService.addLabel(email.id, 'support/auto-replied');
  }

  /**
   * Escalate ticket to human support
   */
  private escalateTicket(
    ticket: SupportTicket,
    reason: string
  ): SupportResponse {
    this.ticketService.escalateTicket(ticket.id, reason);
    
    return {
      action: 'escalate',
      ticket,
      confidence: 0,
      reasoning: `Escalated: ${reason}`
    };
  }

  /**
   * Determine if we should auto-reply
   */
  private shouldAutoReply(ticket: SupportTicket): boolean {
    if (!this.config.autoReply) return false;
    
    // Check business hours
    if (this.config.businessHours && !this.isBusinessHours()) {
      return false;
    }
    
    // Check auto-reply limit
    const autoReplies = ticket.emailMessageIds.length - 1; // -1 for original
    if (autoReplies >= this.config.maxAutoReplies) {
      return false;
    }
    
    // Don't auto-reply to certain categories
    const noAutoReplyCategories = ['complaint', 'escalation', 'legal'];
    if (noAutoReplyCategories.includes(ticket.category)) {
      return false;
    }
    
    return true;
  }

  /**
   * Categorize email based on content
   */
  private categorizeEmail(email: EmailMessage, analysis: any): string {
    const content = `${email.subject} ${email.body}`.toLowerCase();
    
    // Check configured categories
    for (const [category, keywords] of Object.entries(this.config.categorization)) {
      if (keywords.some(keyword => content.includes(keyword.toLowerCase()))) {
        return category;
      }
    }
    
    // Use AI category if available
    if (analysis.category && analysis.category !== 'other') {
      return analysis.category;
    }
    
    return 'general';
  }

  /**
   * Calculate priority based on multiple factors
   */
  private calculatePriority(email: EmailMessage, analysis: any): any {
    // Urgent if mentioned in analysis
    if (analysis.urgency === 'high') return 'urgent';
    
    // Check subject for priority indicators
    const subject = email.subject.toLowerCase();
    if (subject.includes('urgent') || subject.includes('emergency')) {
      return 'urgent';
    }
    
    // Negative sentiment increases priority
    if (analysis.sentiment === 'negative') {
      return 'high';
    }
    
    return 'medium';
  }

  /**
   * Check if current time is within business hours
   */
  private isBusinessHours(): boolean {
    if (!this.config.businessHours) return true;
    
    const now = new Date();
    const hours = now.getHours();
    const day = now.getDay();
    
    const { start, end, days } = this.config.businessHours;
    
    return days.includes(day) && hours >= start && hours < end;
  }

  /**
   * Get support metrics
   */
  async getMetrics(dateRange?: { from: Date; to: Date }) {
    const ticketMetrics = this.ticketService.getMetrics(dateRange);
    
    // Additional AI metrics
    const knowledgeGapAnalysis = await this.analyzeKnowledgeGaps(dateRange);
    
    return {
      ...ticketMetrics,
      knowledgeGaps: knowledgeGapAnalysis
    };
  }

  /**
   * Analyze knowledge gaps from recent tickets
   */
  private async analyzeKnowledgeGaps(dateRange?: { from: Date; to: Date }) {
    const tickets = this.ticketService.searchTickets({
      dateFrom: dateRange?.from,
      dateTo: dateRange?.to
    });
    
    const interactions = tickets.map(t => ({
      query: t.description,
      wasResolved: t.status === 'resolved',
      escalated: t.escalationCount > 0
    }));
    
    return await this.knowledgeBase.analyzeKnowledgeGaps(interactions);
  }
}