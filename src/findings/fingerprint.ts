import { createHash } from 'node:crypto';

import type { ReviewableAnchor } from '../diff/reviewableLines.js';

export interface ExistingReviewComment {
  body?: string;
  path?: string;
  line?: number;
  original_line?: number;
}

export function normalizeCodeExcerpt(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function buildFindingFingerprint(
  path: string,
  _line: number | string,
  severity: string,
  category: string,
  excerpt: string,
): string {
  return sha256(`${path}|${severity}|${category}|${normalizeCodeExcerpt(excerpt)}`);
}

export function buildStableFindingFingerprint(
  path: string,
  _severity: string,
  category: string,
  anchor: string,
  occurrence: number | string = 1,
): string {
  const normalizedOccurrence = occurrence || 1;
  return sha256(`${path}|${category}|${normalizeCodeExcerpt(anchor)}|${normalizedOccurrence}`);
}

export function extractCommentMarkers(body: string, marker: string): string[] {
  const pattern = new RegExp(`<!-- (?:ai-pr-review|gosh-review):${escapeRegExp(marker)}=([a-f0-9]{64}) -->`, 'g');
  return Array.from(body.matchAll(pattern), (match) => match[1] ?? '').filter(Boolean).sort();
}

export function extractSeverityFromCommentBody(body: string): string {
  return body.match(/\[(critical|high|medium|low)\]/)?.[1] ?? '';
}

export function lookupReviewableAnchor(lineKey: string, anchors: ReviewableAnchor[]): string {
  return anchors.find((entry) => entry.key === lineKey)?.anchor ?? '';
}

export function lookupReviewableAnchorOccurrence(
  lineKey: string,
  anchor: string,
  anchors: ReviewableAnchor[],
): number {
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

export function buildExistingStableFingerprints(
  existingComments: ExistingReviewComment[],
  anchors: ReviewableAnchor[],
): string[] {
  const fingerprints = new Set<string>();

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

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
