/**
 * Support Ticket Service - Manages customer support tickets
 * Integrates with email processing and knowledge base
 */

export interface SupportTicket {
  id: string;
  customerId: string;
  customerEmail: string;
  subject: string;
  description: string;
  status: 'open' | 'in-progress' | 'waiting-customer' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: string;
  assignedTo?: string;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date;
  
  // Email thread tracking
  emailThreadId?: string;
  emailMessageIds: string[];
  
  // Support metadata
  tags: string[];
  knowledgeArticles: string[];
  aiSuggestions: string[];
  customerSentiment: 'positive' | 'neutral' | 'negative';
  
  // Resolution tracking
  resolutionNotes?: string;
  resolutionTime?: number; // in minutes
  escalationCount: number;
  
  // Customer satisfaction
  satisfactionScore?: number; // 1-5
  satisfactionFeedback?: string;
}

export interface TicketUpdate {
  status?: SupportTicket['status'];
  priority?: SupportTicket['priority'];
  assignedTo?: string;
  notes?: string;
  internalNote?: boolean;
  knowledgeArticles?: string[];
}

export interface TicketMetrics {
  totalTickets: number;
  openTickets: number;
  avgResolutionTime: number;
  satisfactionScore: number;
  escalationRate: number;
  categoryCounts: Record<string, number>;
}

export class TicketService {
  private tickets: Map<string, SupportTicket> = new Map();
  private customerTickets: Map<string, string[]> = new Map();
  
  /**
   * Create a new support ticket
   */
  async createTicket(params: {
    customerEmail: string;
    subject: string;
    description: string;
    emailThreadId?: string;
    emailMessageId?: string;
    category?: string;
    priority?: SupportTicket['priority'];
    sentiment?: SupportTicket['customerSentiment'];
  }): Promise<SupportTicket> {
    const ticketId = this.generateTicketId();
    
    const ticket: SupportTicket = {
      id: ticketId,
      customerId: this.getCustomerId(params.customerEmail),
      customerEmail: params.customerEmail,
      subject: params.subject,
      description: params.description,
      status: 'open',
      priority: params.priority || this.calculatePriority(params),
      category: params.category || 'general',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailThreadId: params.emailThreadId,
      emailMessageIds: params.emailMessageId ? [params.emailMessageId] : [],
      tags: [],
      knowledgeArticles: [],
      aiSuggestions: [],
      customerSentiment: params.sentiment || 'neutral',
      escalationCount: 0
    };
    
    this.tickets.set(ticketId, ticket);
    
    // Track by customer
    const customerTickets = this.customerTickets.get(params.customerEmail) || [];
    customerTickets.push(ticketId);
    this.customerTickets.set(params.customerEmail, customerTickets);
    
    return ticket;
  }

  /**
   * Update an existing ticket
   */
  async updateTicket(
    ticketId: string, 
    update: TicketUpdate
  ): Promise<SupportTicket | null> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;
    
    // Update fields
    if (update.status) {
      ticket.status = update.status;
      
      // Track resolution
      if (update.status === 'resolved' && !ticket.resolvedAt) {
        ticket.resolvedAt = new Date();
        ticket.resolutionTime = Math.round(
          (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / 60000
        );
      }
    }
    
    if (update.priority) ticket.priority = update.priority;
    if (update.assignedTo) ticket.assignedTo = update.assignedTo;
    if (update.knowledgeArticles) {
      ticket.knowledgeArticles = [
        ...new Set([...ticket.knowledgeArticles, ...update.knowledgeArticles])
      ];
    }
    
    ticket.updatedAt = new Date();
    
    // Add notes to description if provided
    if (update.notes && !update.internalNote) {
      ticket.description += `\n\n[Update ${new Date().toISOString()}]\n${update.notes}`;
    }
    
    return ticket;
  }

  /**
   * Get ticket by ID
   */
  getTicket(ticketId: string): SupportTicket | null {
    return this.tickets.get(ticketId) || null;
  }

  /**
   * Find ticket by email thread
   */
  findTicketByThread(threadId: string): SupportTicket | null {
    for (const ticket of this.tickets.values()) {
      if (ticket.emailThreadId === threadId) {
        return ticket;
      }
    }
    return null;
  }

  /**
   * Get all tickets for a customer
   */
  getCustomerTickets(customerEmail: string): SupportTicket[] {
    const ticketIds = this.customerTickets.get(customerEmail) || [];
    return ticketIds
      .map(id => this.tickets.get(id))
      .filter(ticket => ticket !== undefined) as SupportTicket[];
  }

  /**
   * Search tickets
   */
  searchTickets(params: {
    status?: SupportTicket['status'];
    priority?: SupportTicket['priority'];
    category?: string;
    assignedTo?: string;
    customerEmail?: string;
    dateFrom?: Date;
    dateTo?: Date;
  }): SupportTicket[] {
    const results: SupportTicket[] = [];
    
    this.tickets.forEach(ticket => {
      if (params.status && ticket.status !== params.status) return;
      if (params.priority && ticket.priority !== params.priority) return;
      if (params.category && ticket.category !== params.category) return;
      if (params.assignedTo && ticket.assignedTo !== params.assignedTo) return;
      if (params.customerEmail && ticket.customerEmail !== params.customerEmail) return;
      if (params.dateFrom && ticket.createdAt < params.dateFrom) return;
      if (params.dateTo && ticket.createdAt > params.dateTo) return;
      
      results.push(ticket);
    });
    
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get ticket metrics
   */
  getMetrics(dateRange?: { from: Date; to: Date }): TicketMetrics {
    let tickets = Array.from(this.tickets.values());
    
    if (dateRange) {
      tickets = tickets.filter(t => 
        t.createdAt >= dateRange.from && 
        t.createdAt <= dateRange.to
      );
    }
    
    const openTickets = tickets.filter(t => 
      ['open', 'in-progress', 'waiting-customer'].includes(t.status)
    ).length;
    
    const resolvedTickets = tickets.filter(t => t.resolvedAt);
    const avgResolutionTime = resolvedTickets.length > 0
      ? resolvedTickets.reduce((sum, t) => sum + (t.resolutionTime || 0), 0) / resolvedTickets.length
      : 0;
    
    const ratedTickets = tickets.filter(t => t.satisfactionScore);
    const satisfactionScore = ratedTickets.length > 0
      ? ratedTickets.reduce((sum, t) => sum + (t.satisfactionScore || 0), 0) / ratedTickets.length
      : 0;
    
    const escalatedTickets = tickets.filter(t => t.escalationCount > 0).length;
    const escalationRate = tickets.length > 0 ? escalatedTickets / tickets.length : 0;
    
    const categoryCounts: Record<string, number> = {};
    tickets.forEach(t => {
      categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1;
    });
    
    return {
      totalTickets: tickets.length,
      openTickets,
      avgResolutionTime,
      satisfactionScore,
      escalationRate,
      categoryCounts
    };
  }

  /**
   * Auto-assign ticket based on rules
   */
  async autoAssignTicket(ticket: SupportTicket): Promise<string | null> {
    // Priority-based assignment
    if (ticket.priority === 'urgent') {
      return 'senior-support-team';
    }
    
    // Category-based assignment
    const categoryAssignments: Record<string, string> = {
      'technical': 'tech-support-team',
      'billing': 'billing-team',
      'account': 'account-team',
      'general': 'support-team'
    };
    
    return categoryAssignments[ticket.category] || 'support-team';
  }

  /**
   * Escalate ticket
   */
  async escalateTicket(
    ticketId: string, 
    reason: string
  ): Promise<SupportTicket | null> {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) return null;
    
    ticket.escalationCount++;
    ticket.priority = this.increasePriority(ticket.priority);
    ticket.status = 'in-progress';
    ticket.updatedAt = new Date();
    
    // Re-assign to higher tier
    if (ticket.assignedTo === 'support-team') {
      ticket.assignedTo = 'senior-support-team';
    } else if (!ticket.assignedTo || ticket.assignedTo === 'senior-support-team') {
      ticket.assignedTo = 'support-manager';
    }
    
    return ticket;
  }

  /**
   * Merge duplicate tickets
   */
  async mergeTickets(
    primaryTicketId: string, 
    duplicateTicketIds: string[]
  ): Promise<SupportTicket | null> {
    const primaryTicket = this.tickets.get(primaryTicketId);
    if (!primaryTicket) return null;
    
    duplicateTicketIds.forEach(dupId => {
      const dupTicket = this.tickets.get(dupId);
      if (!dupTicket) return;
      
      // Merge email message IDs
      primaryTicket.emailMessageIds = [
        ...new Set([...primaryTicket.emailMessageIds, ...dupTicket.emailMessageIds])
      ];
      
      // Merge knowledge articles
      primaryTicket.knowledgeArticles = [
        ...new Set([...primaryTicket.knowledgeArticles, ...dupTicket.knowledgeArticles])
      ];
      
      // Append description
      primaryTicket.description += `\n\n[Merged from ticket ${dupId}]\n${dupTicket.description}`;
      
      // Update priority to highest
      if (this.priorityLevel(dupTicket.priority) > this.priorityLevel(primaryTicket.priority)) {
        primaryTicket.priority = dupTicket.priority;
      }
      
      // Close duplicate
      dupTicket.status = 'closed';
      dupTicket.resolutionNotes = `Merged into ticket ${primaryTicketId}`;
      dupTicket.updatedAt = new Date();
    });
    
    primaryTicket.updatedAt = new Date();
    return primaryTicket;
  }

  /**
   * Calculate priority based on content and customer
   */
  private calculatePriority(params: {
    subject: string;
    description: string;
    sentiment?: SupportTicket['customerSentiment'];
  }): SupportTicket['priority'] {
    const urgentKeywords = ['urgent', 'emergency', 'critical', 'down', 'broken', 'immediately'];
    const highKeywords = ['important', 'asap', 'quickly', 'issue', 'problem', 'error'];
    
    const content = `${params.subject} ${params.description}`.toLowerCase();
    
    // Check for urgent keywords
    if (urgentKeywords.some(keyword => content.includes(keyword))) {
      return 'urgent';
    }
    
    // Negative sentiment increases priority
    if (params.sentiment === 'negative') {
      return 'high';
    }
    
    // Check for high priority keywords
    if (highKeywords.some(keyword => content.includes(keyword))) {
      return 'high';
    }
    
    return 'medium';
  }

  /**
   * Get or create customer ID
   */
  private getCustomerId(email: string): string {
    // In production, this would look up or create customer in database
    return createHash('md5').update(email).digest('hex').substring(0, 12);
  }

  /**
   * Generate unique ticket ID
   */
  private generateTicketId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 6);
    return `TKT-${timestamp}-${random}`.toUpperCase();
  }

  /**
   * Get priority level for comparison
   */
  private priorityLevel(priority: SupportTicket['priority']): number {
    const levels = { low: 1, medium: 2, high: 3, urgent: 4 };
    return levels[priority];
  }

  /**
   * Increase priority level
   */
  private increasePriority(current: SupportTicket['priority']): SupportTicket['priority'] {
    const progression: Record<string, SupportTicket['priority']> = {
      low: 'medium',
      medium: 'high',
      high: 'urgent',
      urgent: 'urgent'
    };
    return progression[current];
  }
}

// Re-export for convenience
export { createHash } from 'crypto';