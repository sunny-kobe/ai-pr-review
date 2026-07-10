import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { PartialReviewConfig, ReviewConfig, ReviewRules } from './schema.js';

export const defaultReviewConfig: ReviewConfig = {
  behavior: {
    batchSize: 5,
    maxDiffLines: 500,
    contextLines: 5,
    debugMode: false,
    commentDelay: 0.5,
    inlineCommentRetries: 3,
  },
  scope: {
    fileTypes: ['.ts', '.tsx', '.js', '.jsx'],
    excludePatterns: ['\\.test\\.', '\\.spec\\.', '__tests__'],
    maxFiles: 999,
  },
  reviewer: {
    role: '你是一名高级代码审查专家，专注于代码质量和架构审查。',
    focus: '重点关注与当前 diff 直接相关的正确性、安全、可靠性和性能回归；只有存在明确证据链时才提出可维护性建议。',
  },
  reviewRules: {
    crashPrevention: [
      '空值、数组越界、类型错误、JSON 解析、异步竞态或未处理异常会导致运行时崩溃',
      'API 返回形状、枚举值、分页、时间、金额或状态流转与调用方假设不一致',
      '错误处理、资源释放、事务回滚、取消请求或卸载后更新处理不完整',
    ],
    security: [
      '认证授权、权限边界、输入校验、HTML/SQL/命令注入或跳转存在风险',
      'token、密钥、密码、个人信息或敏感业务字段可能泄露到日志、前端或错误信息',
    ],
    performance: [
      '新增代码引入明显重复请求、无界查询/循环、主线程重计算、大列表重渲染或资源泄漏',
    ],
    architecture: [
      '接口契约、状态来源、模块边界、共享逻辑位置或错误边界会影响当前改动的正确性',
      '跨文件复制或绕过现有抽象已经造成明显维护风险',
    ],
    ignore: [
      '纯格式、命名、import 顺序、文案润色、CSS 类名、注释风格和可由 linter/formatter 处理的问题',
      '没有明确故障链路或用户影响的泛泛最佳实践建议',
      '与 PR 标题、描述、commit 信息表达的改动目标无关的顺手优化建议',
    ],
  },
  strategy: {
    reviewMode: 'fast',
    skipDraft: true,
    inlineSeverityThreshold: 'high',
    pathPolicies: [],
  },
};

export interface LoadConfigOptions {
  preset?: string;
  presetDir?: string;
  configFile?: string;
  baseConfig?: ReviewConfig;
}

export async function loadReviewConfig(options: LoadConfigOptions): Promise<ReviewConfig> {
  let config = cloneConfig(options.baseConfig ?? defaultReviewConfig);

  if (options.preset) {
    if (!options.presetDir) {
      throw new Error('presetDir is required when preset is provided');
    }
    const presetPath = resolve(options.presetDir, `${options.preset}.json`);
    config = mergeReviewConfig(config, await readConfigFile(presetPath));
  }

  if (options.configFile) {
    config = mergeReviewConfig(config, await readConfigFile(options.configFile));
  }

  return config;
}

export function mergeReviewConfig(base: ReviewConfig, override: PartialReviewConfig): ReviewConfig {
  return {
    behavior: {
      ...base.behavior,
      ...definedObject(override.behavior),
      ...pickDefined({
        batchSize: override.batchSize,
        maxDiffLines: override.maxDiffLines,
        contextLines: override.contextLines,
        debugMode: override.debugMode,
        commentDelay: override.commentDelay,
        inlineCommentRetries: override.inlineCommentRetries,
      }),
    },
    scope: {
      ...base.scope,
      ...definedObject(override.scope),
      ...pickDefined({
        fileTypes: override.fileTypes,
        excludePatterns: override.excludePatterns,
        maxFiles: override.maxFiles,
      }),
    },
    reviewer: {
      ...base.reviewer,
      ...definedObject(override.reviewer),
      ...pickDefined({
        role: override.role,
        focus: override.focus,
      }),
    },
    reviewRules: mergeReviewRules(base.reviewRules, override.reviewRules),
    strategy: {
      ...base.strategy,
      ...definedObject(override.strategy),
      ...pickDefined({
        reviewMode: override.reviewMode,
        skipDraft: override.skipDraft,
        inlineSeverityThreshold: override.inlineSeverityThreshold,
      }),
      pathPolicies: override.pathPolicies ?? override.strategy?.pathPolicies ?? base.strategy.pathPolicies,
    },
  };
}

export function toShellConfig(config: ReviewConfig): Record<string, string> {
  return {
    BATCH_SIZE: String(config.behavior.batchSize),
    MAX_DIFF_LINES: String(config.behavior.maxDiffLines),
    CONTEXT_LINES: String(config.behavior.contextLines),
    DEBUG_MODE: String(config.behavior.debugMode),
    COMMENT_DELAY: String(config.behavior.commentDelay),
    INLINE_RETRIES: String(config.behavior.inlineCommentRetries),
    FILE_TYPES: config.scope.fileTypes.join('|'),
    EXCLUDE_PATTERNS: config.scope.excludePatterns.join('|'),
    REVIEWER_ROLE: config.reviewer.role,
    REVIEWER_FOCUS: config.reviewer.focus,
    REVIEW_MODE: config.strategy.reviewMode,
    SKIP_DRAFT: String(config.strategy.skipDraft),
    INLINE_SEVERITY_THRESHOLD: config.strategy.inlineSeverityThreshold,
    STRATEGY_PATH_POLICIES: JSON.stringify(config.strategy.pathPolicies),
    CRASH_CHECKS: toMarkdownList(config.reviewRules.crashPrevention),
    ARCHITECTURE_RULES: toMarkdownList(config.reviewRules.architecture),
    SECURITY_RULES: toMarkdownList(config.reviewRules.security),
    PERFORMANCE_RULES: toMarkdownList(config.reviewRules.performance),
    IGNORE_RULES: toMarkdownList(config.reviewRules.ignore),
  };
}

async function readConfigFile(filePath: string): Promise<PartialReviewConfig> {
  return JSON.parse(await readFile(filePath, 'utf8')) as PartialReviewConfig;
}

function mergeReviewRules(base: ReviewRules, override?: PartialReviewConfig['reviewRules']): ReviewRules {
  if (!override) {
    return base;
  }

  return {
    crashPrevention: normalizeRuleSection(base.crashPrevention, override, 'crashPrevention'),
    architecture: normalizeRuleSection(base.architecture, override, 'architecture'),
    security: normalizeRuleSection(base.security, override, 'security'),
    performance: normalizeRuleSection(base.performance, override, 'performance'),
    ignore: normalizeRuleSection(base.ignore, override, 'ignore'),
  };
}

function normalizeRuleSection(
  fallback: string[],
  rules: NonNullable<PartialReviewConfig['reviewRules']>,
  key: keyof ReviewRules,
): string[] {
  if (Array.isArray(rules[key])) {
    return [...rules[key]];
  }

  const legacyRules = [
    ...(rules.universal?.[key] ?? []),
    ...(rules.frontend?.[key] ?? []),
    ...(rules.backend?.[key] ?? []),
  ];

  if (legacyRules.length > 0) {
    return legacyRules;
  }

  return fallback;
}

function definedObject<T extends object>(value: T | undefined): Partial<T> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function pickDefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function cloneConfig(config: ReviewConfig): ReviewConfig {
  return JSON.parse(JSON.stringify(config)) as ReviewConfig;
}

function toMarkdownList(items: string[]): string {
  return items.map((item) => `- ${item}`).join('\n');
}
