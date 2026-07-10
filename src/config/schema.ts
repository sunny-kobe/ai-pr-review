export interface ReviewConfig {
  behavior: {
    batchSize: number;
    maxDiffLines: number;
    contextLines: number;
    debugMode: boolean;
    commentDelay: number;
    inlineCommentRetries: number;
  };
  scope: {
    fileTypes: string[];
    excludePatterns: string[];
    maxFiles: number;
  };
  reviewer: {
    role: string;
    focus: string;
  };
  reviewRules: ReviewRules;
  strategy: {
    reviewMode: string;
    skipDraft: boolean;
    inlineSeverityThreshold: string;
    pathPolicies: PathPolicy[];
  };
}

export interface ReviewRules {
  crashPrevention: string[];
  architecture: string[];
  security: string[];
  performance: string[];
  ignore: string[];
}

export interface PathPolicy {
  glob: string;
  reviewMode?: string;
  reviewerFocus?: string;
  reviewRules?: Partial<ReviewRules>;
}

export type PartialReviewConfig = Partial<{
  role: string;
  focus: string;
  fileTypes: string[];
  excludePatterns: string[];
  maxFiles: number;
  reviewMode: string;
  skipDraft: boolean;
  inlineSeverityThreshold: string;
  pathPolicies: PathPolicy[];
  batchSize: number;
  maxDiffLines: number;
  contextLines: number;
  debugMode: boolean;
  commentDelay: number;
  inlineCommentRetries: number;
  behavior: Partial<ReviewConfig['behavior']>;
  scope: Partial<ReviewConfig['scope']>;
  reviewer: Partial<ReviewConfig['reviewer']>;
  reviewRules: Partial<ReviewRules> & {
    universal?: Partial<ReviewRules>;
    frontend?: Partial<ReviewRules>;
    backend?: Partial<ReviewRules>;
  };
  strategy: Partial<ReviewConfig['strategy']>;
}>;
