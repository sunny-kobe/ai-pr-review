import { loadReviewConfig, mergeReviewConfig } from './config/loadConfig.js';
import { policyReviewRulesMarkdown, resolvePathPolicy } from './config/pathPolicies.js';
import type { PathPolicy, ReviewConfig } from './config/schema.js';
import { collectReviewableLineAnchors, collectReviewableLines } from './diff/reviewableLines.js';
import { buildExistingStableFingerprints } from './findings/fingerprint.js';
import { processFindingsForReview } from './findings/processFindings.js';
import { filterInlineReviewComments, type ReviewFilterDecision } from './findings/reviewFilter.js';
import type { PullRequestReviewComment } from './github/comments.js';
import { findSummaryCommentId, buildReviewVerdict, buildSummaryCommentBody } from './output/summary.js';
import { buildBasePrompt, buildBatchPrompt, countPromptSensitiveMatches } from './prompt/buildPrompt.js';
import { resolveAgentInstructions } from './prompt/agentInstructions.js';
import type { Finding } from './providers/types.js';
import type { GitAdapter } from './utils/git.js';
import type { OutputWriter } from './utils/outputs.js';

export interface ReviewRunnerGithub {
  fetchPullRequestInfo(prNumber: number): Promise<{
    headSha: string;
    headRef: string;
    baseSha: string;
    baseRef: string;
    title: string;
    body: string;
    isDraft: boolean;
    changedFiles: number;
  }>;
  listPullRequestChangedFiles(prNumber: number): Promise<string[]>;
  listPullRequestCommitMessages(prNumber: number): Promise<string[]>;
  listReviewComments(prNumber: number): Promise<PullRequestReviewComment[]>;
  listIssueComments(prNumber: number): Promise<Array<{ id?: number; body?: string; created_at?: string; updated_at?: string }>>;
  updateSummaryComment(commentId: number, body: string): Promise<unknown>;
  createSummaryComment(prNumber: number, body: string): Promise<unknown>;
  submitInlineReview(options: {
    prNumber: number;
    commitSha: string;
    body: string;
    comments: Array<{ path: string; line: number; side: 'RIGHT'; body: string }>;
  }): Promise<unknown>;
}

export interface ReviewRunnerOptions {
  env: NodeJS.ProcessEnv;
  actionRoot: string;
  config?: ReviewConfig;
  github: ReviewRunnerGithub;
  git: GitAdapter;
  provider: (prompt: string) => Promise<Finding[]>;
  filterProvider?: (prompt: string) => Promise<ReviewFilterDecision[]>;
  writeOutput: OutputWriter;
  logger: (message: string) => void;
}

export interface ReviewRunnerResult {
  status: 'reviewed' | 'skipped-draft' | 'no-files';
}

export async function runReview(options: ReviewRunnerOptions): Promise<ReviewRunnerResult> {
  const prNumber = Number(options.env.PR_NUMBER || 0);
  if (!prNumber) {
    throw new Error('PR_NUMBER environment variable required');
  }

  const config = options.config ?? await loadReviewConfig({
    preset: options.env.PRESET,
    presetDir: options.env.PRESET_DIR,
    configFile: options.env.CONFIG_FILE,
  });
  const effectiveConfig = mergeReviewConfig(config, configOverridesFromEnv(options.env));
  const dryRun = normalizeBool(options.env.DRY_RUN ?? 'false');
  const skipDraft = normalizeBool(options.env.SKIP_DRAFT ?? String(effectiveConfig.strategy.skipDraft));
  const inlineSeverityThreshold = options.env.INLINE_SEVERITY_THRESHOLD ?? effectiveConfig.strategy.inlineSeverityThreshold;
  const inlinePerFileLimit = Number(options.env.INLINE_PER_FILE_LIMIT ?? 2);
  const inlinePrLimit = Number(options.env.INLINE_PR_LIMIT ?? 8);
  const reviewFilterEnabled = normalizeBool(options.env.REVIEW_FILTER_ENABLED ?? 'false');

  options.logger(`🤖 AI PR Review for PR #${prNumber}`);
  options.logger(`using ${options.env.ACTION_REPOSITORY || options.env.GITHUB_ACTION_REPOSITORY || 'sunny-kobe/ai-pr-review'}`);
  options.logger(`provider=${options.env.AI_PROVIDER || 'openai'}`);
  options.logger(`Dry run: ${dryRun}`);

  await options.git.fetchAll();
  const prInfo = await options.github.fetchPullRequestInfo(prNumber);

  if (skipDraft && prInfo.isDraft) {
    writeOutputs(options.writeOutput, {
      filesReviewed: 0,
      filesSkipped: 0,
      totalIssues: 0,
      criticalCount: 0,
      highCount: 0,
      duplicateCommentsSuppressed: 0,
      redactedMatches: 0,
      summary: 'Skipped draft PR review',
    });
    return { status: 'skipped-draft' };
  }

  const allChangedFiles = await options.github.listPullRequestChangedFiles(prNumber);
  const reviewableFiles = allChangedFiles
    .filter((file) => matchesAny(file, effectiveConfig.scope.fileTypes))
    .filter((file) => !matchesRegex(file, effectiveConfig.scope.excludePatterns))
    .slice(0, effectiveConfig.scope.maxFiles);

  if (reviewableFiles.length === 0) {
    writeOutputs(options.writeOutput, {
      filesReviewed: 0,
      filesSkipped: 0,
      totalIssues: 0,
      criticalCount: 0,
      highCount: 0,
      duplicateCommentsSuppressed: 0,
      redactedMatches: 0,
      summary: 'Reviewed 0 files, found 0 issues (0 critical, 0 high)',
    });
    return { status: 'no-files' };
  }

  const existingReviewComments = await options.github.listReviewComments(prNumber);
  const existingIssueComments = await options.github.listIssueComments(prNumber);
  const commitMessages = await options.github.listPullRequestCommitMessages(prNumber);
  const summaryCommentId = findSummaryCommentId(existingIssueComments);
  const baseSha = prInfo.baseSha || await options.git.mergeBase(
    prInfo.baseRef || options.env.GITHUB_BASE_REF || 'main',
    prInfo.headSha,
  );
  const basePrompt = buildBasePrompt({
    config: effectiveConfig,
    language: options.env.LANGUAGE ?? 'zh-CN',
    prTitle: prInfo.title,
    prBody: prInfo.body,
    commitMessages,
  });

  let reviewedFiles = 0;
  const skippedFiles: string[] = [];
  let reviewableLines: string[] = [];
  let reviewableAnchors: Array<{ key: string; anchor: string }> = [];
  const promptFiles = [];

  for (const file of reviewableFiles) {
    const diff = await options.git.diffForFile(baseSha, prInfo.headSha, file);
    if (!diff) {
      continue;
    }
    const diffLineCount = diff.split(/\r?\n/).length;
    if (diffLineCount > effectiveConfig.behavior.maxDiffLines) {
      skippedFiles.push(file);
      continue;
    }
    reviewedFiles += 1;
    const fileReviewableLines = collectReviewableLines(diff);
    const fileReviewableAnchors = collectReviewableLineAnchors(diff);
    reviewableLines = reviewableLines.concat(fileReviewableLines);
    reviewableAnchors = reviewableAnchors.concat(fileReviewableAnchors);
    const policy = resolvePathPolicy(file, effectiveConfig.strategy.pathPolicies);
    const context = options.git.contextForFile
      ? await options.git.contextForFile(file, diff, effectiveConfig.behavior.contextLines)
      : '';
    const projectRules = await resolveAgentInstructions({
      baseSha,
      file,
      readFileAtRef: options.git.readFileAtRef?.bind(options.git),
    });
    promptFiles.push({
      file,
      diffContent: diff,
      context,
      reviewMode: policy.reviewMode ?? effectiveConfig.strategy.reviewMode,
      reviewerFocus: policy.reviewerFocus ?? effectiveConfig.reviewer.focus,
      policyRules: policyReviewRulesMarkdown(policy.reviewRules),
      projectRules,
    });
  }

  options.logger(`processed files=${reviewedFiles} skipped=${skippedFiles.length}`);

  if (promptFiles.length === 0) {
    writeOutputs(options.writeOutput, {
      filesReviewed: reviewedFiles,
      filesSkipped: skippedFiles.length,
      totalIssues: 0,
      criticalCount: 0,
      highCount: 0,
      duplicateCommentsSuppressed: 0,
      redactedMatches: 0,
      summary: `Reviewed ${reviewedFiles} files, found 0 issues (0 critical, 0 high)`,
    });
    return { status: 'no-files' };
  }

  const existingStableFingerprints = buildExistingStableFingerprints(existingReviewComments, reviewableAnchors);
  const redactedMatches = countPromptSensitiveMatches({
    config: effectiveConfig,
    language: options.env.LANGUAGE ?? 'zh-CN',
    prTitle: prInfo.title,
    prBody: prInfo.body,
    commitMessages,
    files: promptFiles,
  });
  const findings: Finding[] = [];
  for (const batch of chunk(promptFiles, effectiveConfig.behavior.batchSize)) {
    const prompt = buildBatchPrompt({ basePrompt, changedFiles: allChangedFiles, files: batch });
    findings.push(...await options.provider(prompt));
  }
  const processed = processFindingsForReview({
    findings,
    reviewableLines,
    reviewableAnchors,
    inlineSeverityThreshold,
    inlinePerFileLimit,
    inlinePrLimit,
    existingStableFingerprints,
  });
  let reviewComments = processed.reviewComments;
  if (reviewFilterEnabled) {
    if (!options.filterProvider) {
      options.logger('review filter enabled but no filter provider is configured; keeping inline comments');
    } else {
      const filterResult = await filterInlineReviewComments({
        candidates: processed.inlineCandidates,
        provider: options.filterProvider,
        logger: options.logger,
      });
      reviewComments = filterResult.comments;
      options.logger(`review filter completed filtered=${filterResult.filteredCount} kept=${reviewComments.length}`);
    }
  }
  const verdict = buildReviewVerdict(processed.criticalCount, processed.highCount, processed.mediumCount);
  const summaryBody = buildSummaryCommentBody({
    verdict,
    newFindings: processed.newFindingsCount,
    existingFindings: processed.existingFindingsCount,
    resolvedFindings: countResolvedFindings(existingStableFingerprints, processed.currentStableFingerprints),
    filesReviewed: reviewedFiles,
    filesSkipped: skippedFiles.length,
    fixFirst: buildFixFirst(processed.issues),
    activeFindings: buildActiveFindings(processed.issues),
    otherFindings: buildOtherFindings(processed.issues),
    otherFindingsCount: Math.max(processed.issues.length - 5, 0),
  });

  if (!dryRun) {
    if (summaryCommentId) {
      await options.github.updateSummaryComment(summaryCommentId, summaryBody);
      options.logger('summary updated');
    } else {
      await options.github.createSummaryComment(prNumber, summaryBody);
      options.logger('summary created');
    }
    const inlineReviewResult = await options.github.submitInlineReview({
      prNumber,
      commitSha: prInfo.headSha,
      body: '<!-- ai-pr-review:inline-review -->',
      comments: reviewComments,
    });
    options.logger(`inline review submitted mode=${inlineReviewMode(inlineReviewResult)} comments=${reviewComments.length}`);
  } else {
    options.logger('dry_run=true, skipped summary and inline review writes');
  }

  writeOutputs(options.writeOutput, {
    filesReviewed: reviewedFiles,
    filesSkipped: skippedFiles.length,
    totalIssues: processed.totalIssues,
    criticalCount: processed.criticalCount,
    highCount: processed.highCount,
    duplicateCommentsSuppressed: processed.duplicateCommentsSuppressed,
    redactedMatches,
    summary: `Reviewed ${reviewedFiles} files, found ${processed.totalIssues} issues (${processed.criticalCount} critical, ${processed.highCount} high)`,
  });

  return { status: 'reviewed' };
}

function inlineReviewMode(result: unknown): string {
  if (typeof result === 'object' && result && 'mode' in result) {
    const mode = (result as { mode?: unknown }).mode;
    if (typeof mode === 'string') {
      return mode;
    }
  }
  return 'unknown';
}

function writeOutputs(
  writeOutput: OutputWriter,
  values: {
    filesReviewed: number;
    filesSkipped: number;
    totalIssues: number;
    criticalCount: number;
    highCount: number;
    duplicateCommentsSuppressed: number;
    redactedMatches: number;
    summary: string;
  },
): void {
  writeOutput('files_reviewed', String(values.filesReviewed));
  writeOutput('files_skipped', String(values.filesSkipped));
  writeOutput('issues_found', String(values.totalIssues));
  writeOutput('critical_count', String(values.criticalCount));
  writeOutput('high_count', String(values.highCount));
  writeOutput('duplicate_comments_suppressed', String(values.duplicateCommentsSuppressed));
  writeOutput('redacted_matches', String(values.redactedMatches));
  writeOutput('summary', values.summary);
}

function normalizeBool(value: string): boolean {
  return ['true', '1', 'yes', 'y', 'on'].includes(value.toLowerCase());
}

function matchesAny(file: string, fileTypes: string[]): boolean {
  return fileTypes.some((fileType) => file.endsWith(fileType));
}

function matchesRegex(file: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(file));
}

function configOverridesFromEnv(env: NodeJS.ProcessEnv): Parameters<typeof mergeReviewConfig>[1] {
  const override: Parameters<typeof mergeReviewConfig>[1] = {};
  if (env.BATCH_SIZE || env.MAX_DIFF_LINES || env.CONTEXT_LINES || env.DEBUG_MODE) {
    override.behavior = {};
    if (env.BATCH_SIZE) override.behavior.batchSize = Number(env.BATCH_SIZE);
    if (env.MAX_DIFF_LINES) override.behavior.maxDiffLines = Number(env.MAX_DIFF_LINES);
    if (env.CONTEXT_LINES) override.behavior.contextLines = Number(env.CONTEXT_LINES);
    if (env.DEBUG_MODE) override.behavior.debugMode = normalizeBool(env.DEBUG_MODE);
  }
  if (env.FILE_TYPES || env.EXCLUDE_PATTERNS) {
    override.scope = {};
    if (env.FILE_TYPES) override.scope.fileTypes = env.FILE_TYPES.split('|').filter(Boolean);
    if (env.EXCLUDE_PATTERNS) override.scope.excludePatterns = env.EXCLUDE_PATTERNS.split('|').filter(Boolean);
  }
  if (env.REVIEWER_ROLE || env.REVIEWER_FOCUS) {
    override.reviewer = {};
    if (env.REVIEWER_ROLE) override.reviewer.role = env.REVIEWER_ROLE;
    if (env.REVIEWER_FOCUS) override.reviewer.focus = env.REVIEWER_FOCUS;
  }
  if (env.REVIEW_MODE || env.SKIP_DRAFT || env.INLINE_SEVERITY_THRESHOLD || env.STRATEGY_PATH_POLICIES) {
    override.strategy = {};
    if (env.REVIEW_MODE) override.strategy.reviewMode = env.REVIEW_MODE;
    if (env.SKIP_DRAFT) override.strategy.skipDraft = normalizeBool(env.SKIP_DRAFT);
    if (env.INLINE_SEVERITY_THRESHOLD) override.strategy.inlineSeverityThreshold = env.INLINE_SEVERITY_THRESHOLD;
    if (env.STRATEGY_PATH_POLICIES) override.strategy.pathPolicies = JSON.parse(env.STRATEGY_PATH_POLICIES) as PathPolicy[];
  }
  return override;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunkSize = Math.max(size || 1, 1);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function countResolvedFindings(existingStableFingerprints: string[], currentStableFingerprints: string[]): number {
  const current = new Set(currentStableFingerprints);
  return existingStableFingerprints.filter((fingerprint) => !current.has(fingerprint)).length;
}

function buildFixFirst(issues: Finding[]): string {
  const files = Array.from(new Set(issues.map((issue) => issue.file).filter(Boolean))).slice(0, 3);
  return files.map((file) => `- \`${file}\``).join('\n');
}

function buildActiveFindings(issues: Finding[]): string {
  return issues.slice(0, 5).map((issue) => `- **${issue.file}:${issue.line}** — ${issue.message}`).join('\n');
}

function buildOtherFindings(issues: Finding[]): string {
  if (issues.length <= 5) {
    return '';
  }
  const other = issues.slice(5, 13).map((issue) => `- **${issue.file}:${issue.line}** — ${issue.message}`);
  if (issues.length > 13) {
    other.push(`- ... and ${issues.length - 13} more findings`);
  }
  return other.join('\n');
}
