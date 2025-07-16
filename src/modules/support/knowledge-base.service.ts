/**
 * Knowledge Base Service - Manages support documentation and FAQs
 * Uses Gemini's context caching for efficient knowledge retrieval
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface KnowledgeArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  solutions?: string[];
  relatedArticles?: string[];
  lastUpdated: Date;
}

export interface KnowledgeSearchResult {
  article: KnowledgeArticle;
  relevanceScore: number;
  excerpt: string;
}

export class KnowledgeBaseService {
  private genAI: GoogleGenerativeAI;
  private knowledgeCache: Map<string, KnowledgeArticle> = new Map();
  private contextCacheId?: string;
  private embeddingsCache: Map<string, number[]> = new Map();

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  /**
   * Initialize knowledge base from files or database
   */
  async initialize(knowledgePath: string): Promise<void> {
    try {
      // Load all knowledge articles
      const files = await fs.readdir(knowledgePath);
      const articles: KnowledgeArticle[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(
            path.join(knowledgePath, file), 
            'utf-8'
          );
          const article = JSON.parse(content) as KnowledgeArticle;
          this.knowledgeCache.set(article.id, article);
          articles.push(article);
        }
      }

      // Create context cache with all articles for Gemini
      await this.createContextCache(articles);
      
      console.log(`Loaded ${articles.length} knowledge articles`);
    } catch (error) {
      console.error('Failed to initialize knowledge base:', error);
    }
  }

  /**
   * Create a Gemini context cache with all knowledge articles
   */
  private async createContextCache(articles: KnowledgeArticle[]): Promise<void> {
    const model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash" 
    });

    // Prepare knowledge base content
    const knowledgeContent = articles.map(article => `
ARTICLE ID: ${article.id}
TITLE: ${article.title}
CATEGORY: ${article.category}
TAGS: ${article.tags.join(', ')}
CONTENT:
${article.content}
${article.solutions ? '\nSOLUTIONS:\n' + article.solutions.join('\n') : ''}
---
    `).join('\n\n');

    // Create system instruction for support agent
    const systemInstruction = `You are a first-level customer support AI agent with access to the following knowledge base:

${knowledgeContent}

Your responsibilities:
1. Answer customer questions accurately using the knowledge base
2. Identify the most relevant articles for each query
3. Provide step-by-step solutions when available
4. Escalate to human support when needed
5. Track common issues for knowledge base updates

Response Guidelines:
- Be empathetic and professional
- Provide clear, actionable solutions
- Reference specific article IDs when citing information
- Ask clarifying questions when needed
- Suggest related articles that might help`;

    // Cache this context for efficient reuse
    try {
      const cacheResponse = await model.countTokens({
        contents: [{ 
          role: 'user', 
          parts: [{ text: systemInstruction }] 
        }]
      });
      
      console.log(`Knowledge base cached: ${cacheResponse.totalTokens} tokens`);
      
      // Store the system instruction for reuse
      this.contextCacheId = this.generateCacheId(systemInstruction);
      
    } catch (error) {
      console.error('Failed to create context cache:', error);
    }
  }

  /**
   * Search knowledge base for relevant articles
   */
  async searchKnowledge(
    query: string, 
    limit: number = 5
  ): Promise<KnowledgeSearchResult[]> {
    const model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      }
    });

    // Use function calling to search knowledge base
    const searchFunction = {
      name: "search_knowledge_base",
      description: "Search the support knowledge base for relevant articles",
      parameters: {
        type: "object",
        properties: {
          relevantArticleIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of relevant articles, ordered by relevance"
          },
          searchTerms: {
            type: "array",
            items: { type: "string" },
            description: "Key terms identified in the query"
          }
        },
        required: ["relevantArticleIds", "searchTerms"]
      }
    };

    const prompt = `
Customer Query: "${query}"

Search the knowledge base and identify the most relevant articles to answer this query.
Consider article titles, content, tags, and categories.
Return up to ${limit} most relevant article IDs.`;

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ functionDeclarations: [searchFunction] }]
      });

      const response = await result.response;
      const functionCall = response.functionCalls()?.[0];
      
      if (functionCall?.name === 'search_knowledge_base') {
        const { relevantArticleIds } = functionCall.args as any;
        
        // Return the articles with relevance scores
        const results: KnowledgeSearchResult[] = [];
        
        relevantArticleIds.forEach((id: string, index: number) => {
          const article = this.knowledgeCache.get(id);
          if (article) {
            results.push({
              article,
              relevanceScore: 1 - (index * 0.1), // Descending relevance
              excerpt: this.generateExcerpt(article.content, query)
            });
          }
        });
        
        return results;
      }
    } catch (error) {
      console.error('Knowledge search error:', error);
    }

    // Fallback to simple keyword search
    return this.fallbackSearch(query, limit);
  }

  /**
   * Generate a solution for a customer query
   */
  async generateSolution(
    query: string, 
    context?: string
  ): Promise<{
    solution: string;
    articleIds: string[];
    confidence: number;
    needsEscalation: boolean;
  }> {
    const model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash",
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      }
    });

    // Define solution generation function
    const solutionFunction = {
      name: "generate_support_solution",
      description: "Generate a customer support solution based on knowledge base",
      parameters: {
        type: "object",
        properties: {
          solution: {
            type: "string",
            description: "Step-by-step solution for the customer"
          },
          articleIds: {
            type: "array",
            items: { type: "string" },
            description: "IDs of articles used for the solution"
          },
          confidence: {
            type: "number",
            description: "Confidence score (0-1) in the solution"
          },
          needsEscalation: {
            type: "boolean",
            description: "Whether this needs human support"
          },
          escalationReason: {
            type: "string",
            description: "Reason for escalation if needed"
          }
        },
        required: ["solution", "articleIds", "confidence", "needsEscalation"]
      }
    };

    const prompt = `
Customer Query: "${query}"
${context ? `Additional Context: ${context}` : ''}

Using the knowledge base, provide a comprehensive solution for this customer query.
If the knowledge base doesn't contain sufficient information, indicate that escalation is needed.
Be specific and provide actionable steps.`;

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ functionDeclarations: [solutionFunction] }]
      });

      const response = await result.response;
      const functionCall = response.functionCalls()?.[0];
      
      if (functionCall?.name === 'generate_support_solution') {
        return functionCall.args as any;
      }
    } catch (error) {
      console.error('Solution generation error:', error);
    }

    // Fallback response
    return {
      solution: "I'm having trouble generating a solution. Please let me connect you with a human support agent.",
      articleIds: [],
      confidence: 0,
      needsEscalation: true
    };
  }

  /**
   * Add or update a knowledge article
   */
  async upsertArticle(article: KnowledgeArticle): Promise<void> {
    article.lastUpdated = new Date();
    this.knowledgeCache.set(article.id, article);
    
    // Persist to file system (or database in production)
    const knowledgePath = process.env.KNOWLEDGE_BASE_PATH || './knowledge-base';
    await fs.writeFile(
      path.join(knowledgePath, `${article.id}.json`),
      JSON.stringify(article, null, 2)
    );
    
    // Recreate context cache with updated knowledge
    await this.createContextCache(Array.from(this.knowledgeCache.values()));
  }

  /**
   * Analyze support interactions to identify knowledge gaps
   */
  async analyzeKnowledgeGaps(
    interactions: Array<{
      query: string;
      wasResolved: boolean;
      escalated: boolean;
    }>
  ): Promise<{
    gaps: string[];
    suggestedArticles: Array<{
      title: string;
      category: string;
      content: string;
    }>;
  }> {
    const model = this.genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash" 
    });

    const prompt = `
Analyze these customer support interactions and identify knowledge base gaps:

${interactions.map((i, idx) => `
${idx + 1}. Query: "${i.query}"
   Resolved: ${i.wasResolved}
   Escalated: ${i.escalated}
`).join('\n')}

Identify:
1. Common topics that led to escalation
2. Questions that couldn't be resolved
3. Suggested new knowledge base articles

Format as JSON:
{
  "gaps": ["gap1", "gap2"],
  "suggestedArticles": [
    {
      "title": "Article Title",
      "category": "Category",
      "content": "Article content..."
    }
  ]
}`;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('Knowledge gap analysis error:', error);
    }

    return { gaps: [], suggestedArticles: [] };
  }

  /**
   * Simple fallback search using keywords
   */
  private fallbackSearch(query: string, limit: number): KnowledgeSearchResult[] {
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/);
    
    const results: Array<[KnowledgeArticle, number]> = [];
    
    this.knowledgeCache.forEach(article => {
      let score = 0;
      
      // Check title matches
      const titleLower = article.title.toLowerCase();
      words.forEach(word => {
        if (titleLower.includes(word)) score += 2;
      });
      
      // Check content matches
      const contentLower = article.content.toLowerCase();
      words.forEach(word => {
        if (contentLower.includes(word)) score += 1;
      });
      
      // Check tag matches
      article.tags.forEach(tag => {
        if (words.includes(tag.toLowerCase())) score += 1.5;
      });
      
      if (score > 0) {
        results.push([article, score]);
      }
    });
    
    // Sort by score and return top results
    return results
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([article, score]) => ({
        article,
        relevanceScore: Math.min(score / 10, 1),
        excerpt: this.generateExcerpt(article.content, query)
      }));
  }

  /**
   * Generate excerpt highlighting query terms
   */
  private generateExcerpt(content: string, query: string): string {
    const words = query.toLowerCase().split(/\s+/);
    const sentences = content.split(/[.!?]+/);
    
    // Find most relevant sentence
    let bestSentence = sentences[0] || '';
    let bestScore = 0;
    
    sentences.forEach(sentence => {
      let score = 0;
      words.forEach(word => {
        if (sentence.toLowerCase().includes(word)) score++;
      });
      
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence;
      }
    });
    
    return bestSentence.trim().substring(0, 200) + '...';
  }

  /**
   * Generate cache ID for content
   */
  private generateCacheId(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}