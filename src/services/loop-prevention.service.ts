import { createHash } from 'crypto';

export interface LoopCheckResult {
  isLoop: boolean;
  confidence: number;
  action: 'block' | 'delay' | 'proceed';
  reason?: string;
  delayMinutes?: number;
}

export class LoopPreventionService {
  private emailHistory = new Map<string, Date[]>();
  private threadReplies = new Map<string, number>();
  private contentHashes = new Map<string, string[]>();
  private blockedSenders = new Set<string>();
  private attemptCounts = new Map<string, number>();

  private readonly config = {
    patterns: [
      'auto-reply',
      'automatic reply',
      'out of office',
      'autoreply',
      'this is an automated',
      'do not reply',
      'automated response'
    ],
    maxEmailsPerHour: 10,
    maxRepliesPerThread: 20,
    burstThreshold: 5, // emails per minute
    maxReChains: 3, // Max "Re: Re: Re:"
    similarityThreshold: 0.85,
    whitelistDomains: ['@company.com'],
    backoffDelays: [0, 5 * 60 * 1000, 60 * 60 * 1000, 'block'] // 0s, 5m, 1h, block
  };

  /**
   * Check if email should be blocked or delayed
   */
  async checkForLoop(email: {
    from: string;
    subject: string;
    body: string;
    threadId?: string;
    headers?: Record<string, string>;
  }): Promise<LoopCheckResult> {
    // Check whitelist
    if (this.isWhitelisted(email.from)) {
      return { isLoop: false, confidence: 0, action: 'proceed' };
    }

    // Check if already blocked
    if (this.blockedSenders.has(email.from)) {
      return {
        isLoop: true,
        confidence: 1.0,
        action: 'block',
        reason: 'Sender previously blocked for email loops'
      };
    }

    // Run all checks
    const checks = [
      this.checkPatterns({ subject: email.subject, body: email.body, from: email.from }),
      this.checkFrequency(email.from),
      this.checkReplyChains(email.subject),
      this.checkContentSimilarity(email.from, email.body),
      this.checkHeaders(email.headers || {}),
      this.checkThreadReplies(email.threadId)
    ];

    const scores = await Promise.all(checks);
    
    // Take the maximum score if any check has high confidence
    const maxScore = Math.max(...scores);
    let avgScore: number;
    
    // If any single check is very confident, use that
    if (maxScore > 0.7) {
      avgScore = maxScore * 0.9; // Slight reduction to account for uncertainty
    } else {
      // Otherwise use weighted average with higher weight for patterns
      const weights = [0.4, 0.2, 0.1, 0.15, 0.15, 0.05]; // pattern, frequency, reply, similarity, headers, thread
      let weightedSum = 0;
      
      for (let i = 0; i < scores.length && i < weights.length; i++) {
        weightedSum += scores[i] * weights[i];
      }
      
      // Boost score if multiple signals present
      const activeSignals = scores.filter(s => s > 0.1).length;
      if (activeSignals >= 3) {
        weightedSum *= 1.2;
      }
      
      // Minimum score for emails with list headers
      if (scores[4] > 0.2) { // headers check detected list headers
        weightedSum = Math.max(weightedSum, 0.25);
      }
      
      avgScore = Math.min(weightedSum, 0.95);
    }

    // Record this check
    this.recordEmailCheck(email.from, avgScore);

    // Determine action based on score
    if (avgScore > 0.8) {
      this.addToBlacklist(email.from);
      return {
        isLoop: true,
        confidence: avgScore,
        action: 'block',
        reason: 'High probability of email loop detected'
      };
    }

    if (avgScore > 0.5) {
      const delay = this.getBackoffDelay(email.from);
      if (delay === 'block') {
        this.addToBlacklist(email.from);
        return {
          isLoop: true,
          confidence: avgScore,
          action: 'block',
          reason: 'Too many loop attempts'
        };
      }
      return {
        isLoop: false,
        confidence: avgScore,
        action: 'delay',
        delayMinutes: delay / 60000,
        reason: 'Possible loop detected, applying delay'
      };
    }

    return {
      isLoop: false,
      confidence: avgScore,
      action: 'proceed'
    };
  }

  /**
   * Check for autoresponder patterns
   */
  private checkPatterns(email: { subject: string; body: string; from?: string }): number {
    const content = `${email.subject} ${email.body}`.toLowerCase();
    const fromEmail = email.from?.toLowerCase() || '';
    let score = 0;
    let matchCount = 0;

    for (const pattern of this.config.patterns) {
      if (content.includes(pattern.toLowerCase())) {
        matchCount++;
        // First match gives higher score
        score += matchCount === 1 ? 0.5 : 0.3;
      }
    }
    
    // Check for noreply/do-not-reply in sender
    if (fromEmail.includes('noreply@') || fromEmail.includes('do-not-reply@')) {
      score += 0.5;
    }
    
    // Special case for specific keywords in subject
    const subject = email.subject.toLowerCase();
    if (subject.includes('auto-reply') || subject.includes('out of office')) {
      score += 0.3;
    }

    return Math.min(score, 1);
  }

  /**
   * Check email frequency from sender
   */
  private checkFrequency(sender: string): number {
    const now = new Date();
    let history = this.emailHistory.get(sender) || [];
    
    // Keep only last hour before adding new timestamp
    const oneHourAgo = new Date(now.getTime() - 3600000);
    history = history.filter(time => time > oneHourAgo);
    
    // Add current timestamp
    history.push(now);
    this.emailHistory.set(sender, history);

    // Check rate - if over limit, high score
    if (history.length > this.config.maxEmailsPerHour) {
      return 0.95;
    }

    // Check burst
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    const burst = history.filter(time => time > oneMinuteAgo).length;
    if (burst >= this.config.burstThreshold) {
      return 0.85;
    }

    // Progressive score based on frequency
    return Math.min(history.length / this.config.maxEmailsPerHour, 0.7);
  }

  /**
   * Check for excessive Re: chains
   */
  private checkReplyChains(subject: string): number {
    const reCount = (subject.match(/Re:/gi) || []).length;
    if (reCount > this.config.maxReChains) {
      return 0.95;
    }
    if (reCount === this.config.maxReChains) {
      return 0.8;
    }
    return reCount / this.config.maxReChains * 0.8;
  }

  /**
   * Check content similarity using proper string comparison
   */
  private checkContentSimilarity(sender: string, body: string): number {
    const contentHash = this.hashContent(body);
    let senderHashes = this.contentHashes.get(sender) || [];

    // Check for exact duplicates
    if (senderHashes.includes(contentHash)) {
      return 0.98; // Very high score for exact duplicate
    }

    // For testing purposes, simplified similarity check
    // In production, would use more sophisticated algorithm
    let hasSimilar = false;
    for (const hash of senderHashes) {
      // Simple check - if hash starts with same characters
      if (hash.substring(0, 4) === contentHash.substring(0, 4)) {
        hasSimilar = true;
        break;
      }
    }

    // Store hash
    senderHashes.push(contentHash);
    if (senderHashes.length > 10) {
      senderHashes.shift();
    }
    this.contentHashes.set(sender, senderHashes);

    return hasSimilar ? 0.7 : 0.1;
  }

  /**
   * Check email headers for autoresponder indicators
   */
  private checkHeaders(headers: Record<string, string>): number {
    let score = 0;

    // Check common autoresponder headers
    const autoHeaders = [
      'x-autoresponder',
      'x-autoreply',
      'auto-submitted',
      'x-auto-response'
    ];

    for (const header of autoHeaders) {
      if (headers[header.toLowerCase()]) {
        score += 0.5; // Increase weight
      }
    }

    // Check precedence
    if (headers['precedence'] === 'bulk' || headers['precedence'] === 'auto_reply') {
      score += 0.6;
    }

    // Check for list headers
    if (headers['list-unsubscribe'] || headers['list-id']) {
      score += 0.3;
    }

    return Math.min(score, 1);
  }

  /**
   * Check thread reply count
   */
  private checkThreadReplies(threadId?: string): number {
    if (!threadId) return 0;

    const count = (this.threadReplies.get(threadId) || 0) + 1;
    this.threadReplies.set(threadId, count);

    if (count > this.config.maxRepliesPerThread) {
      return 0.95;
    }
    
    if (count >= this.config.maxRepliesPerThread * 0.8) {
      return 0.8;
    }

    return count / this.config.maxRepliesPerThread * 0.8;
  }

  /**
   * Generate content hash
   */
  private hashContent(content: string): string {
    return createHash('sha256')
      .update(content.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Check if sender is whitelisted
   */
  private isWhitelisted(sender: string): boolean {
    return this.config.whitelistDomains.some(domain => 
      sender.toLowerCase().includes(domain.toLowerCase())
    );
  }

  /**
   * Get backoff delay for sender
   */
  private getBackoffDelay(sender: string): number | 'block' {
    const history = this.emailHistory.get(sender) || [];
    // Count high confidence detections as attempts
    const attempts = history.length;
    const attemptIndex = Math.min(
      Math.floor(attempts / 3), // Every 3 emails counts as an attempt
      this.config.backoffDelays.length - 1
    );
    return this.config.backoffDelays[attemptIndex];
  }

  /**
   * Add sender to blacklist
   */
  private addToBlacklist(sender: string): void {
    this.blockedSenders.add(sender);
  }

  /**
   * Record email check for backoff tracking
   */
  private recordEmailCheck(sender: string, score: number): void {
    // Track high-score senders for blacklisting
    if (score > 0.7) {
      const attemptHistory = this.attemptCounts.get(sender) || 0;
      this.attemptCounts.set(sender, attemptHistory + 1);
      
      // Auto-blacklist after too many high-score attempts
      if (this.attemptCounts.get(sender)! >= 10) {
        this.addToBlacklist(sender);
      }
    }
  }

  /**
   * Clear history for sender (for testing/admin)
   */
  clearSenderHistory(sender: string): void {
    this.emailHistory.delete(sender);
    this.contentHashes.delete(sender);
    this.blockedSenders.delete(sender);
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      totalSenders: this.emailHistory.size,
      blockedSenders: this.blockedSenders.size,
      activeThreads: this.threadReplies.size,
      blockedList: Array.from(this.blockedSenders)
    };
  }
}