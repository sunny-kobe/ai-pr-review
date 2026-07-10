export type ReviewProviderName = 'openai' | 'gemini-cli';

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  file: string;
  line: number;
  severity: FindingSeverity;
  message: string;
  suggestion?: string;
  existing_code?: string;
  category?: string;
}

export interface ProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  apiPath?: string;
  model?: string;
  timeoutMs?: number;
  temperature?: number;
  responseFormat?: string;
  reasoningEffort?: string;
}

export interface ReviewProvider {
  name: ReviewProviderName;
  review(prompt: string, options: ProviderOptions): Promise<Finding[]>;
}
