import { filterFindingsToReviewableLines } from '../diff/reviewableLines.js';
import { buildInlineCommentBody } from '../output/inlineReview.js';
import { buildFindingFingerprint, buildStableFindingFingerprint, lookupReviewableAnchor, lookupReviewableAnchorOccurrence, normalizeCodeExcerpt, } from './fingerprint.js';
import { shouldPostInlineWithBudget } from './severity.js';
export function processFindingsForReview(options) {
    const filteredFindings = relocateFindingsToReviewableLines(options.findings, options.reviewableLines, options.reviewableAnchors);
    const reviewComments = [];
    const inlineCandidates = [];
    const issues = [];
    const currentFingerprints = new Set();
    const currentStableFingerprints = new Set();
    const existingStableFingerprints = new Set(options.existingStableFingerprints);
    const inlineFileCounts = new Map();
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;
    let newFindingsCount = 0;
    let existingFindingsCount = 0;
    let duplicateCommentsSuppressed = 0;
    for (const finding of filteredFindings) {
        const category = finding.category ?? 'general';
        const lineKey = `${finding.file}:${finding.line}`;
        const diffAnchor = lookupReviewableAnchor(lineKey, options.reviewableAnchors);
        const anchorOccurrence = diffAnchor
            ? lookupReviewableAnchorOccurrence(lineKey, diffAnchor, options.reviewableAnchors)
            : 1;
        const stableFingerprintSource = diffAnchor || lineKey;
        const fingerprintSource = diffAnchor
            ? `${diffAnchor}|${finding.suggestion || finding.message}`
            : finding.suggestion || finding.message;
        const stableFingerprint = buildStableFindingFingerprint(finding.file, finding.severity, category, stableFingerprintSource, anchorOccurrence);
        const fingerprint = buildFindingFingerprint(finding.file, finding.line, finding.severity, category, fingerprintSource);
        if (currentFingerprints.has(fingerprint)) {
            duplicateCommentsSuppressed += 1;
            continue;
        }
        currentFingerprints.add(fingerprint);
        currentStableFingerprints.add(stableFingerprint);
        issues.push(finding);
        switch (finding.severity) {
            case 'critical':
                criticalCount += 1;
                break;
            case 'high':
                highCount += 1;
                break;
            case 'medium':
                mediumCount += 1;
                break;
            case 'low':
                lowCount += 1;
                break;
            default:
                mediumCount += 1;
                break;
        }
        if (existingStableFingerprints.has(stableFingerprint)) {
            existingFindingsCount += 1;
            duplicateCommentsSuppressed += 1;
            continue;
        }
        newFindingsCount += 1;
        const fileInlineCount = inlineFileCounts.get(finding.file) ?? 0;
        if (!shouldPostInlineWithBudget(finding.severity, options.inlineSeverityThreshold, fileInlineCount, reviewComments.length, options.inlinePerFileLimit, options.inlinePrLimit)) {
            continue;
        }
        const comment = {
            path: finding.file,
            line: finding.line,
            side: 'RIGHT',
            body: buildInlineCommentBody({
                severity: finding.severity,
                message: finding.message,
                suggestion: finding.suggestion,
                stableFingerprint,
                fingerprint,
            }),
        };
        reviewComments.push(comment);
        inlineCandidates.push({ finding, comment, changedCode: diffAnchor });
        inlineFileCounts.set(finding.file, fileInlineCount + 1);
    }
    return {
        issues,
        reviewComments,
        inlineCandidates,
        totalIssues: issues.length,
        criticalCount,
        highCount,
        mediumCount,
        lowCount,
        newFindingsCount,
        existingFindingsCount,
        duplicateCommentsSuppressed,
        currentFingerprints: Array.from(currentFingerprints),
        currentStableFingerprints: Array.from(currentStableFingerprints).sort(),
    };
}
export function relocateFindingsToReviewableLines(findings, reviewableLines, reviewableAnchors) {
    const directFindings = filterFindingsToReviewableLines(findings, reviewableLines);
    const allowed = new Set(reviewableLines);
    const relocatedFindings = [];
    for (const finding of findings) {
        if (!finding.file || finding.line == null) {
            continue;
        }
        const lineKey = `${finding.file}:${finding.line}`;
        if (allowed.has(lineKey)) {
            continue;
        }
        const relocatedLine = findUniqueLineByExistingCode(finding.file, finding.existing_code, reviewableAnchors);
        if (relocatedLine == null) {
            continue;
        }
        relocatedFindings.push({
            ...finding,
            line: relocatedLine,
        });
    }
    return [...directFindings, ...relocatedFindings];
}
function findUniqueLineByExistingCode(file, existingCode, reviewableAnchors) {
    const normalizedExistingCode = normalizeCodeExcerpt(existingCode ?? '');
    if (!normalizedExistingCode) {
        return null;
    }
    const matches = reviewableAnchors.filter((entry) => (entry.key.startsWith(`${file}:`) && entry.anchor === normalizedExistingCode));
    if (matches.length !== 1) {
        return null;
    }
    const line = Number(matches[0]?.key.slice(file.length + 1));
    return Number.isInteger(line) && line > 0 ? line : null;
}
