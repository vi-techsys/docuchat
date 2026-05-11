import { sendMessage } from '../../src/services/conversation.services';
import { createConversation } from '../../src/services/conversation.services';
import { prisma } from '../../src/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface EvaluationQuestion {
  id: string;
  question: string;
  expectedTopics: string[];
  expectedCitationCount: number;
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
}

export interface EvaluationResult {
  questionId: string;
  question: string;
  answer: string;
  citations: any[];
  context: any;
  usage: any;
  scores: {
    correctness: number; // 1-5
    relevance: number; // 1-5
    citationAccuracy: number; // 1-5
    overall: number; // average
  };
  evaluatorNotes: string;
  processingTime: number;
  cost: number;
}

export interface EvaluationReport {
  evaluationId: string;
  timestamp: Date;
  totalQuestions: number;
  averageScores: {
    correctness: number;
    relevance: number;
    citationAccuracy: number;
    overall: number;
  };
  totalCost: number;
  averageProcessingTime: number;
  results: EvaluationResult[];
  summary: string;
}

// Test questions based on company policies document
const EVALUATION_QUESTIONS: EvaluationQuestion[] = [
  {
    id: 'refund-basic',
    question: 'What is your refund policy?',
    expectedTopics: ['refund', 'return', '30 days', 'original condition'],
    expectedCitationCount: 1,
    difficulty: 'easy',
    category: 'Refunds'
  },
  {
    id: 'refund-details',
    question: 'How long does it take to process a refund and what are the requirements?',
    expectedTopics: ['5-7 business days', 'receipt', 'original condition'],
    expectedCitationCount: 1,
    difficulty: 'medium',
    category: 'Refunds'
  },
  {
    id: 'refund-defective',
    question: 'What if the product is defective?',
    expectedTopics: ['defective', 'full refund', 'shipping costs'],
    expectedCitationCount: 1,
    difficulty: 'medium',
    category: 'Refunds'
  },
  {
    id: 'vacation-basic',
    question: 'How many vacation days do employees get?',
    expectedTopics: ['15 days', 'paid vacation'],
    expectedCitationCount: 1,
    difficulty: 'easy',
    category: 'Time Off'
  },
  {
    id: 'vacation-process',
    question: 'What is the process for requesting vacation?',
    expectedTopics: ['2 weeks advance', 'manager approval'],
    expectedCitationCount: 1,
    difficulty: 'medium',
    category: 'Time Off'
  },
  {
    id: 'vacation-carryover',
    question: 'Can unused vacation days be carried over?',
    expectedTopics: ['carry over', '6 months'],
    expectedCitationCount: 1,
    difficulty: 'medium',
    category: 'Time Off'
  },
  {
    id: 'sick-basic',
    question: 'How many sick days are provided?',
    expectedTopics: ['10 days', 'per year'],
    expectedCitationCount: 1,
    difficulty: 'easy',
    category: 'Time Off'
  },
  {
    id: 'sick-process',
    question: 'What do I need to do if I am sick?',
    expectedTopics: ['notify manager', '2 hours', 'start time'],
    expectedCitationCount: 1,
    difficulty: 'medium',
    category: 'Time Off'
  },
  {
    id: 'sick-extended',
    question: 'What happens if I am sick for more than 3 days?',
    expectedTopics: ['doctor note', '3 days'],
    expectedCitationCount: 1,
    difficulty: 'hard',
    category: 'Time Off'
  },
  {
    id: 'remote-basic',
    question: 'Is remote work available?',
    expectedTopics: ['remote work', 'eligible employees'],
    expectedCitationCount: 1,
    difficulty: 'easy',
    category: 'Remote Work'
  },
  {
    id: 'remote-requirements',
    question: 'What are the requirements for remote work?',
    expectedTopics: ['home office', 'manager approval', 'weekly check-ins'],
    expectedCitationCount: 1,
    difficulty: 'medium',
    category: 'Remote Work'
  },
  {
    id: 'remote-stipend',
    question: 'Does the company provide equipment for remote work?',
    expectedTopics: ['equipment stipend', '$500', 'per year'],
    expectedCitationCount: 1,
    difficulty: 'hard',
    category: 'Remote Work'
  },
  {
    id: 'comparison-time-off',
    question: 'Compare vacation and sick leave policies',
    expectedTopics: ['vacation', 'sick leave', 'carry over', 'days'],
    expectedCitationCount: 2,
    difficulty: 'hard',
    category: 'Comparison'
  },
  {
    id: 'no-context',
    question: 'What is quantum computing?',
    expectedTopics: [],
    expectedCitationCount: 0,
    difficulty: 'easy',
    category: 'No Context'
  },
  {
    id: 'vague-question',
    question: 'Tell me about time off',
    expectedTopics: ['vacation', 'sick leave'],
    expectedCitationCount: 2,
    difficulty: 'medium',
    category: 'Vague'
  }
];

export class RAGEvaluator {
  private userId: string;
  private documentId: string;
  private conversationId: string = '';

  constructor(userId: string, documentId: string) {
    this.userId = userId;
    this.documentId = documentId;
  }

  async setupEvaluation(): Promise<void> {
    const conversation = await createConversation(this.userId, this.documentId, 'RAG Quality Evaluation');
    this.conversationId = conversation.id;
  }

  async runEvaluation(): Promise<EvaluationReport> {
    const evaluationId = `eval-${Date.now()}`;
    const results: EvaluationResult[] = [];
    
    console.log(`🧪 Starting RAG Evaluation: ${evaluationId}`);
    console.log(`📝 Questions to evaluate: ${EVALUATION_QUESTIONS.length}`);

    for (let i = 0; i < EVALUATION_QUESTIONS.length; i++) {
      const question = EVALUATION_QUESTIONS[i];
      console.log(`\n[${i + 1}/${EVALUATION_QUESTIONS.length}] Evaluating: ${question.question}`);

      try {
        const startTime = Date.now();
        const response = await sendMessage({
          conversationId: this.conversationId,
          userId: this.userId,
          content: question.question,
          documentId: this.documentId,
          correlationId: `${evaluationId}-${question.id}`
        });
        const processingTime = Date.now() - startTime;

        const result: EvaluationResult = {
          questionId: question.id,
          question: question.question,
          answer: response.assistantMessage.content,
          citations: response.assistantMessage.citations,
          context: response.assistantMessage.context,
          usage: response.assistantMessage.usage,
          scores: {
            correctness: 0,
            relevance: 0,
            citationAccuracy: 0,
            overall: 0
          },
          evaluatorNotes: '',
          processingTime,
          cost: response.assistantMessage.usage.cost
        };

        results.push(result);
        
        console.log(`   ✅ Answer generated (${result.answer.length} chars)`);
        console.log(`   📊 Citations: ${result.citations.length}, Cost: $${result.cost.toFixed(4)}`);
        
      } catch (error) {
        console.error(`   ❌ Failed to process question: ${error}`);
        
        results.push({
          questionId: question.id,
          question: question.question,
          answer: `Error: ${error}`,
          citations: [],
          context: { chunks: 0, tokens: 0, searchResults: 0 },
          usage: { tokens: { prompt: 0, completion: 0, total: 0 }, cost: 0, processingTime: 0 },
          scores: { correctness: 1, relevance: 1, citationAccuracy: 1, overall: 1 },
          evaluatorNotes: `Processing error: ${error}`,
          processingTime: 0,
          cost: 0
        });
      }
    }

    const report = this.generateReport(evaluationId, results);
    await this.saveReport(report);
    
    return report;
  }

  private generateReport(evaluationId: string, results: EvaluationResult[]): EvaluationReport {
    const validResults = results.filter(r => r.scores.overall > 0);
    
    const averageScores = {
      correctness: validResults.reduce((sum, r) => sum + r.scores.correctness, 0) / validResults.length,
      relevance: validResults.reduce((sum, r) => sum + r.scores.relevance, 0) / validResults.length,
      citationAccuracy: validResults.reduce((sum, r) => sum + r.scores.citationAccuracy, 0) / validResults.length,
      overall: validResults.reduce((sum, r) => sum + r.scores.overall, 0) / validResults.length
    };

    const totalCost = results.reduce((sum, r) => sum + r.cost, 0);
    const averageProcessingTime = results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;

    const summary = this.generateSummary(averageScores, totalCost, averageProcessingTime);

    return {
      evaluationId,
      timestamp: new Date(),
      totalQuestions: results.length,
      averageScores,
      totalCost,
      averageProcessingTime,
      results,
      summary
    };
  }

  private generateSummary(scores: any, totalCost: number, avgTime: number): string {
    const grade = this.getGrade(scores.overall);
    return `
RAG Quality Evaluation Results:
Overall Score: ${scores.overall.toFixed(2)}/5.0 (${grade})
- Correctness: ${scores.correctness.toFixed(2)}/5.0
- Relevance: ${scores.relevance.toFixed(2)}/5.0  
- Citation Accuracy: ${scores.citationAccuracy.toFixed(2)}/5.0

Performance Metrics:
- Total Cost: $${totalCost.toFixed(4)}
- Average Processing Time: ${avgTime.toFixed(0)}ms

${this.getRecommendations(scores)}
    `.trim();
  }

  private getGrade(score: number): string {
    if (score >= 4.5) return 'A+ (Excellent)';
    if (score >= 4.0) return 'A (Very Good)';
    if (score >= 3.5) return 'B+ (Good)';
    if (score >= 3.0) return 'B (Acceptable)';
    if (score >= 2.5) return 'C+ (Fair)';
    if (score >= 2.0) return 'C (Poor)';
    return 'F (Very Poor)';
  }

  private getRecommendations(scores: any): string {
    const recommendations: string[] = [];
    
    if (scores.correctness < 3.5) {
      recommendations.push('• Improve retrieval accuracy - check chunk quality and search parameters');
    }
    if (scores.relevance < 3.5) {
      recommendations.push('• Refine system prompts for better question understanding');
    }
    if (scores.citationAccuracy < 3.5) {
      recommendations.push('• Enhance citation formatting and context assembly');
    }
    if (scores.overall < 3.0) {
      recommendations.push('• Consider adjusting chunk size, overlap, or embedding model');
    }

    return recommendations.length > 0 
      ? '\nRecommendations:\n' + recommendations.join('\n')
      : '\n✅ Performance is within acceptable ranges';
  }

  private async saveReport(report: EvaluationReport): Promise<void> {
    try {
      await mkdir('./test-results', { recursive: true });
      
      const reportPath = join('./test-results', `${report.evaluationId}-report.json`);
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      
      const csvPath = join('./test-results', `${report.evaluationId}-summary.csv`);
      const csvContent = this.generateCSV(report);
      await writeFile(csvPath, csvContent);
      
      console.log(`\n📊 Reports saved:`);
      console.log(`   📄 Detailed: ${reportPath}`);
      console.log(`   📈 Summary: ${csvPath}`);
      
    } catch (error) {
      console.error('Failed to save reports:', error);
    }
  }

  private generateCSV(report: EvaluationReport): string {
    const headers = [
      'Question ID', 'Question', 'Category', 'Difficulty',
      'Correctness', 'Relevance', 'Citation Accuracy', 'Overall',
      'Citations', 'Tokens', 'Cost ($)', 'Processing Time (ms)',
      'Answer Length', 'Notes'
    ];

    const rows = report.results.map(result => [
      result.questionId,
      `"${result.question}"`,
      EVALUATION_QUESTIONS.find(q => q.id === result.questionId)?.category || '',
      EVALUATION_QUESTIONS.find(q => q.id === result.questionId)?.difficulty || '',
      result.scores.correctness.toString(),
      result.scores.relevance.toString(),
      result.scores.citationAccuracy.toString(),
      result.scores.overall.toString(),
      result.citations.length.toString(),
      result.usage.tokens.total.toString(),
      result.cost.toFixed(4),
      result.processingTime.toString(),
      result.answer.length.toString(),
      `"${result.evaluatorNotes}"`
    ]);

    return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  }

  // Helper method for manual scoring
  async scoreManually(report: EvaluationReport): Promise<void> {
    console.log('\n📝 Manual Scoring Required');
    console.log('Please rate each answer on a scale of 1-5:');
    console.log('5 = Perfect, 4 = Good, 3 = Acceptable, 2 = Poor, 1 = Hallucination');
    console.log('\nScoring Criteria:');
    console.log('• Correctness: Is the answer factually accurate?');
    console.log('• Relevance: Does it answer the question asked?');
    console.log('• Citation Accuracy: Are sources properly cited and relevant?\n');

    // This would be interactive in a real scenario
    // For now, provide guidance for manual evaluation
    console.log('\n📋 Manual Evaluation Checklist:');
    
    report.results.forEach((result, index) => {
      const question = EVALUATION_QUESTIONS.find(q => q.id === result.questionId);
      console.log(`\n${index + 1}. ${result.question}`);
      console.log(`   Category: ${question?.category}, Difficulty: ${question?.difficulty}`);
      console.log(`   Expected Topics: ${question?.expectedTopics.join(', ')}`);
      console.log(`   Answer: ${result.answer.substring(0, 200)}...`);
      console.log(`   Citations: ${result.citations.length}`);
      console.log(`   📝 Rate: Correctness [1-5], Relevance [1-5], Citation Accuracy [1-5]`);
    });
  }
}

// Example usage
export async function runRAGEvaluation(userId: string, documentId: string): Promise<EvaluationReport> {
  const evaluator = new RAGEvaluator(userId, documentId);
  await evaluator.setupEvaluation();
  
  const report = await evaluator.runEvaluation();
  await evaluator.scoreManually(report);
  
  return report;
}
