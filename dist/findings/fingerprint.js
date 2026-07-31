import { createHash } from 'node:crypto';
export function normalizeCodeExcerpt(input) {
    return input.replace(/\s+/g, ' ').trim();
}
export function buildFindingFingerprint(path, _line, severity, category, excerpt) {
    return sha256(`${path}|${severity}|${category}|${normalizeCodeExcerpt(excerpt)}`);
}
export function buildStableFindingFingerprint(path, _severity, category, anchor, occurrence = 1) {
    const normalizedOccurrence = occurrence || 1;
    return sha256(`${path}|${category}|${normalizeCodeExcerpt(anchor)}|${normalizedOccurrence}`);
}
export function extractCommentMarkers(body, marker) {
    const pattern = new RegExp(`<!-- (?:ai-pr-review|gosh-review):${escapeRegExp(marker)}=([a-f0-9]{64}) -->`, 'g');
    return Array.from(body.matchAll(pattern), (match) => match[1] ?? '').filter(Boolean).sort();
}
export function extractSeverityFromCommentBody(body) {
    return body.match(/\[(critical|high|medium|low)\]/)?.[1] ?? '';
}
export function lookupReviewableAnchor(lineKey, anchors) {
    return anchors.find((entry) => entry.key === lineKey)?.anchor ?? '';
}
export function lookupReviewableAnchorOccurrence(lineKey, anchor, anchors) {
    const filePath = lineKey.slice(0, lineKey.lastIndexOf(':'));
    let count = 0;
    for (const entry of anchors) {
        if (entry.key.startsWith(`${filePath}:`) && entry.anchor === anchor) {
            count += 1;
        }
        if (entry.key === lineKey) {
            return count > 0 ? count : 1;
        }
    }
    return 1;
}
export function buildExistingStableFingerprints(existingComments, anchors) {
    const fingerprints = new Set();
    for (const comment of existingComments) {
        const body = comment.body ?? '';
        const path = comment.path ?? '';
        const line = comment.line ?? comment.original_line;
        if (path && line != null) {
            const severity = extractSeverityFromCommentBody(body) || 'medium';
            const lineKey = `${path}:${line}`;
            const anchor = lookupReviewableAnchor(lineKey, anchors);
            if (anchor) {
                const occurrence = lookupReviewableAnchorOccurrence(lineKey, anchor, anchors);
                fingerprints.add(buildStableFindingFingerprint(path, severity, 'general', anchor, occurrence));
                continue;
            }
        }
        for (const stableFromBody of extractCommentMarkers(body, 'stable-fingerprint')) {
            fingerprints.add(stableFromBody);
        }
    }
    return Array.from(fingerprints).filter((value) => /^[a-f0-9]{64}$/.test(value)).sort();
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
