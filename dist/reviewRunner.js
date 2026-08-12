import { loadReviewConfig, mergeReviewConfig } from './config/loadConfig.js';
import { policyReviewRulesMarkdown, resolvePathPolicy } from './config/pathPolicies.js';
import { collectReviewableLineAnchors, collectReviewableLines } from './diff/reviewableLines.js';
import { buildExistingStableFingerprints } from './findings/fingerprint.js';
import { processFindingsForReview } from './findings/processFindings.js';
import { filterInlineReviewComments } from './findings/reviewFilter.js';
import { findSummaryCommentId, buildReviewVerdict, buildSummaryCommentBody } from './output/summary.js';
import { buildBasePrompt, buildBatchPrompt, countPromptSensitiveMatches } from './prompt/buildPrompt.js';
import { resolveAgentInstructions } from './prompt/agentInstructions.js';
export async function runReview(options) {
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
    const pullRequestFiles = await options.github.listPullRequestFiles(prNumber);
    const allChangedFiles = pullRequestFiles.map((file) => file.filename);
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
    const diffBaseSha = await options.git.mergeBase(prInfo.baseRef || options.env.GITHUB_BASE_REF || 'main', prInfo.headSha);
    const rulesBaseSha = prInfo.baseSha || diffBaseSha;
    const basePrompt = buildBasePrompt({
        config: effectiveConfig,
        language: options.env.LANGUAGE ?? 'zh-CN',
        prTitle: prInfo.title,
        prBody: prInfo.body,
        commitMessages,
    });
    let reviewedFiles = 0;
    const skippedFiles = [];
    let reviewableLines = [];
    let reviewableAnchors = [];
    const promptFiles = [];
    for (const file of reviewableFiles) {
        const pullRequestFile = pullRequestFiles.find((entry) => entry.filename === file);
        const diff = pullRequestFile?.patch
            ? buildPullRequestFileDiff(pullRequestFile)
            : await options.git.diffForFile(diffBaseSha, prInfo.headSha, file);
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
            ? await options.git.contextForFile(prInfo.headSha, file, diff, effectiveConfig.behavior.contextLines)
            : '';
        const projectRules = await resolveAgentInstructions({
            baseSha: rulesBaseSha,
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
    const findings = [];
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
        }
        else {
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
        const refreshedPrInfo = await options.github.fetchPullRequestInfo(prNumber);
        if (refreshedPrInfo.headSha !== prInfo.headSha) {
            throw new Error(`PR head changed during review: expected ${prInfo.headSha}, got ${refreshedPrInfo.headSha}`);
        }
        const inlineReviewResult = await options.github.submitInlineReview({
            prNumber,
            commitSha: prInfo.headSha,
            body: '<!-- ai-pr-review:inline-review -->',
            comments: reviewComments,
        });
        options.logger(`inline review submitted mode=${inlineReviewMode(inlineReviewResult)}`
            + ` submitted=${inlineReviewCount(inlineReviewResult, 'submittedComments')}`
            + ` rejected=${inlineReviewCount(inlineReviewResult, 'rejectedComments')}`);
        if (summaryCommentId) {
            await options.github.updateSummaryComment(summaryCommentId, summaryBody);
            options.logger('summary updated');
        }
        else {
            await options.github.createSummaryComment(prNumber, summaryBody);
            options.logger('summary created');
        }
    }
    else {
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
function inlineReviewMode(result) {
    if (typeof result === 'object' && result && 'mode' in result) {
        const mode = result.mode;
        if (typeof mode === 'string') {
            return mode;
        }
    }
    return 'unknown';
}
function inlineReviewCount(result, key) {
    if (typeof result === 'object' && result && key in result) {
        const value = result[key];
        if (typeof value === 'number') {
            return value;
        }
    }
    return 0;
}
function buildPullRequestFileDiff(file) {
    const previousPath = file.previousFilename ?? file.filename;
    const oldPath = file.status === 'added' ? '/dev/null' : `a/${previousPath}`;
    return [
        `diff --git a/${previousPath} b/${file.filename}`,
        `--- ${oldPath}`,
        `+++ b/${file.filename}`,
        file.patch ?? '',
    ].join('\n');
}
function writeOutputs(writeOutput, values) {
    writeOutput('files_reviewed', String(values.filesReviewed));
    writeOutput('files_skipped', String(values.filesSkipped));
    writeOutput('issues_found', String(values.totalIssues));
    writeOutput('critical_count', String(values.criticalCount));
    writeOutput('high_count', String(values.highCount));
    writeOutput('duplicate_comments_suppressed', String(values.duplicateCommentsSuppressed));
    writeOutput('redacted_matches', String(values.redactedMatches));
    writeOutput('summary', values.summary);
}
function normalizeBool(value) {
    return ['true', '1', 'yes', 'y', 'on'].includes(value.toLowerCase());
}
function matchesAny(file, fileTypes) {
    return fileTypes.some((fileType) => file.endsWith(fileType));
}
function matchesRegex(file, patterns) {
    return patterns.some((pattern) => new RegExp(pattern).test(file));
}
function configOverridesFromEnv(env) {
    const override = {};
    if (env.BATCH_SIZE || env.MAX_DIFF_LINES || env.CONTEXT_LINES || env.DEBUG_MODE) {
        override.behavior = {};
        if (env.BATCH_SIZE)
            override.behavior.batchSize = Number(env.BATCH_SIZE);
        if (env.MAX_DIFF_LINES)
            override.behavior.maxDiffLines = Number(env.MAX_DIFF_LINES);
        if (env.CONTEXT_LINES)
            override.behavior.contextLines = Number(env.CONTEXT_LINES);
        if (env.DEBUG_MODE)
            override.behavior.debugMode = normalizeBool(env.DEBUG_MODE);
    }
    if (env.FILE_TYPES || env.EXCLUDE_PATTERNS) {
        override.scope = {};
        if (env.FILE_TYPES)
            override.scope.fileTypes = env.FILE_TYPES.split('|').filter(Boolean);
        if (env.EXCLUDE_PATTERNS)
            override.scope.excludePatterns = env.EXCLUDE_PATTERNS.split('|').filter(Boolean);
    }
    if (env.REVIEWER_ROLE || env.REVIEWER_FOCUS) {
        override.reviewer = {};
        if (env.REVIEWER_ROLE)
            override.reviewer.role = env.REVIEWER_ROLE;
        if (env.REVIEWER_FOCUS)
            override.reviewer.focus = env.REVIEWER_FOCUS;
    }
    if (env.REVIEW_MODE || env.SKIP_DRAFT || env.INLINE_SEVERITY_THRESHOLD || env.STRATEGY_PATH_POLICIES) {
        override.strategy = {};
        if (env.REVIEW_MODE)
            override.strategy.reviewMode = env.REVIEW_MODE;
        if (env.SKIP_DRAFT)
            override.strategy.skipDraft = normalizeBool(env.SKIP_DRAFT);
        if (env.INLINE_SEVERITY_THRESHOLD)
            override.strategy.inlineSeverityThreshold = env.INLINE_SEVERITY_THRESHOLD;
        if (env.STRATEGY_PATH_POLICIES)
            override.strategy.pathPolicies = JSON.parse(env.STRATEGY_PATH_POLICIES);
    }
    return override;
}
function chunk(items, size) {
    const chunkSize = Math.max(size || 1, 1);
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
}
function countResolvedFindings(existingStableFingerprints, currentStableFingerprints) {
    const current = new Set(currentStableFingerprints);
    return existingStableFingerprints.filter((fingerprint) => !current.has(fingerprint)).length;
}
function buildFixFirst(issues) {
    const files = Array.from(new Set(issues.map((issue) => issue.file).filter(Boolean))).slice(0, 3);
    return files.map((file) => `- \`${file}\``).join('\n');
}
function buildActiveFindings(issues) {
    return issues.slice(0, 5).map((issue) => `- **${issue.file}:${issue.line}** — ${issue.message}`).join('\n');
}
function buildOtherFindings(issues) {
    if (issues.length <= 5) {
        return '';
    }
    const other = issues.slice(5, 13).map((issue) => `- **${issue.file}:${issue.line}** — ${issue.message}`);
    if (issues.length > 13) {
        other.push(`- ... and ${issues.length - 13} more findings`);
    }
    return other.join('\n');
}
