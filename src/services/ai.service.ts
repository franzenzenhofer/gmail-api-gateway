import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIAnalysis, EmailMessage, Entity } from '@types/index';

export class AIService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  /**
   * Analyze email content using Gemini AI
   */
  async analyzeEmail(email: EmailMessage): Promise<AIAnalysis> {
    const prompt = this.buildAnalysisPrompt(email);
    
    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      return this.parseAnalysisResponse(text);
    } catch (error) {
      console.error('AI analysis error:', error);
      throw new Error('Failed to analyze email');
    }
  }

  /**
   * Generate reply suggestion for an email
   */
  async generateReply(email: EmailMessage, context?: string): Promise<string> {
    const prompt = `
Generate a professional email reply for the following email:

From: ${email.from}
Subject: ${email.subject}
Body: ${email.body}

${context ? `Additional context: ${context}` : ''}

Requirements:
- Professional and friendly tone
- Address all questions or concerns
- Keep it concise but complete
- End with appropriate closing

Reply:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Reply generation error:', error);
      throw new Error('Failed to generate reply');
    }
  }

  /**
   * Classify email into categories
   */
  async classifyEmail(email: EmailMessage): Promise<string> {
    const prompt = `
Classify the following email into ONE of these categories:
- customer-support
- sales-inquiry
- internal-communication
- newsletter
- spam
- personal
- billing
- technical-issue
- feedback
- other

Email:
From: ${email.from}
Subject: ${email.subject}
Body: ${email.body}

Category:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim().toLowerCase();
    } catch (error) {
      console.error('Classification error:', error);
      return 'other';
    }
  }

  /**
   * Extract entities from email
   */
  async extractEntities(text: string): Promise<Entity[]> {
    const prompt = `
Extract all named entities from this text and categorize them:

Text: ${text}

Return as JSON array with format:
[{"type": "person|organization|location|date|money|other", "value": "entity value", "confidence": 0.0-1.0}]

Entities:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      // Extract JSON from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch (error) {
      console.error('Entity extraction error:', error);
      return [];
    }
  }

  /**
   * Summarize long email threads
   */
  async summarizeThread(emails: EmailMessage[]): Promise<string> {
    const threadContent = emails
      .map(e => `From: ${e.from}\nDate: ${e.date}\n${e.body}`)
      .join('\n---\n');

    const prompt = `
Summarize this email thread concisely:

${threadContent}

Summary should include:
- Main topic
- Key decisions or outcomes
- Action items
- Unresolved questions

Summary:`;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Summarization error:', error);
      throw new Error('Failed to summarize thread');
    }
  }

  /**
   * Build comprehensive analysis prompt
   */
  private buildAnalysisPrompt(email: EmailMessage): string {
    return `
Analyze this email and provide a JSON response with the following structure:
{
  "sentiment": "positive|negative|neutral",
  "category": "category name",
  "summary": "brief summary",
  "suggestedReply": "suggested reply if action needed",
  "urgency": "low|medium|high",
  "entities": [{"type": "type", "value": "value", "confidence": 0.9}],
  "intent": "primary intent of the email"
}

Email to analyze:
From: ${email.from}
To: ${email.to.join(', ')}
Subject: ${email.subject}
Date: ${email.date}
Body: ${email.body}

Analysis:`;
  }

  /**
   * Parse AI response into structured analysis
   */
  private parseAnalysisResponse(text: string): AIAnalysis {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          sentiment: parsed.sentiment || 'neutral',
          category: parsed.category || 'other',
          summary: parsed.summary || '',
          suggestedReply: parsed.suggestedReply,
          urgency: parsed.urgency || 'medium',
          entities: parsed.entities || [],
          intent: parsed.intent || 'unknown'
        };
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
    }

    // Fallback response
    return {
      sentiment: 'neutral',
      category: 'other',
      summary: 'Unable to analyze email',
      urgency: 'medium',
      entities: [],
      intent: 'unknown'
    };
  }

  async summarizeThread(emails: EmailMessage[]): Promise<string> {
    const prompt = `
      Summarize the following email thread conversation:

      ${emails.map(email => `
        From: ${email.from}
        Date: ${email.date}
        Subject: ${email.subject}
        Body: ${email.body}
      `).join('\n---\n')}

      Provide a concise summary of the conversation, key points discussed, and any action items.
    `;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }
}