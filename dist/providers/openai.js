import { readFile } from 'node:fs/promises';
export const REVIEW_SYSTEM_PROMPT = 'You are the model provider for AI PR Review. Return only valid JSON. Prefer a top-level JSON array of review findings. If the API response format requires an object, return {"findings":[...]}.';
export const REVIEW_FILTER_SYSTEM_PROMPT = 'You are the review filter provider for AI PR Review. Return only valid JSON. Return a JSON array of decisions shaped as {"index":number,"keep":boolean,"reason":string}.';
export class OpenAiProvider {
    name = 'openai';
    review(prompt, options) {
        return reviewWithOpenAi(prompt, options);
    }
}
export function loadOpenAiOptionsFromEnv(env = process.env) {
    return {
        apiKey: env.OPENAI_API_KEY || '',
        baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
        apiPath: env.OPENAI_API_PATH || '/v1/chat/completions',
        model: env.OPENAI_MODEL || 'gpt-5.6-luna',
        timeoutMs: Number(env.OPENAI_TIMEOUT_MS || 120000),
        temperature: Number(env.OPENAI_TEMPERATURE || 0.1),
        responseFormat: env.OPENAI_RESPONSE_FORMAT || '',
        reasoningEffort: env.OPENAI_REASONING_EFFORT || '',
    };
}
export async function reviewPromptFile(promptFile, options) {
    const prompt = await readFile(promptFile, 'utf8');
    return reviewWithOpenAi(prompt, options);
}
export async function reviewWithOpenAi(prompt, options) {
    return parseFindings(await completePromptWithOpenAi(prompt, options));
}
export async function completePromptWithOpenAi(prompt, options, systemPrompt = REVIEW_SYSTEM_PROMPT) {
    const apiKey = options.apiKey || '';
    const apiPath = options.apiPath || '/v1/chat/completions';
    const timeoutMs = options.timeoutMs ?? 120000;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(buildEndpoint(options.baseUrl || 'https://api.openai.com', apiPath), {
            method: 'POST',
            headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify(buildRequestBody(apiPath, prompt, options, systemPrompt)),
            signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new ProviderHttpError(response.status, responseText);
        }
        const payload = JSON.parse(responseText);
        const content = extractResponseContent(payload);
        if (!content) {
            throw new Error('OpenAI-compatible API response did not include message content');
        }
        return content;
    }
    finally {
        clearTimeout(timeout);
    }
}
export function buildEndpoint(url, path) {
    const normalizedUrl = url.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (normalizedUrl.endsWith('/v1') && normalizedPath.startsWith('/v1/')) {
        return `${normalizedUrl}${normalizedPath.slice(3)}`;
    }
    return `${normalizedUrl}${normalizedPath}`;
}
export function parseFindings(content) {
    const stripped = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    const candidates = [
        stripped,
        extractBalancedJson(stripped, '[', ']'),
        extractBalancedJson(stripped, '{', '}'),
    ].filter(Boolean);
    let parsedShape = '';
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate);
            parsedShape ||= describeJsonShape(parsed);
            if (typeof parsed === 'string' && parsed.trim() !== candidate.trim()) {
                return parseFindings(parsed);
            }
            if (Array.isArray(parsed)) {
                return validateFindings(parsed);
            }
            if (isJsonObject(parsed)) {
                const alternateFindings = extractAlternateFindingArray(parsed);
                if (alternateFindings) {
                    return validateFindings(alternateFindings);
                }
                const nestedJsonFindings = parseNestedJsonString(parsed, candidate);
                if (nestedJsonFindings) {
                    return nestedJsonFindings;
                }
                if (isEmptyReviewResult(parsed)) {
                    return [];
                }
            }
        }
        catch (error) {
            if (error instanceof SyntaxError) {
                // Try the next candidate.
                continue;
            }
            throw error;
        }
    }
    throw new Error(`Model response did not contain a JSON array or {"findings": [...]} object${parsedShape ? `; parsed shape: ${parsedShape}` : ''}`);
}
export function parseReviewFilterDecisions(content) {
    const parsed = parseJsonArrayOrObject(content);
    const items = extractReviewFilterDecisionArray(parsed);
    if (!items) {
        throw new Error('review filter response did not contain a JSON decision array');
    }
    return items.map((item, index) => {
        if (!isJsonObject(item)) {
            throw new Error(`review_filter[${index}] must be an object`);
        }
        const decisionIndex = item.index;
        if (typeof decisionIndex !== 'number' || !Number.isInteger(decisionIndex) || decisionIndex < 0) {
            throw new Error(`review_filter[${index}].index must be a non-negative integer`);
        }
        const keep = item.keep;
        if (typeof keep !== 'boolean') {
            throw new Error(`review_filter[${index}].keep must be boolean`);
        }
        const decision = {
            index: decisionIndex,
            keep,
        };
        if (typeof item.reason === 'string' && item.reason.trim().length > 0) {
            decision.reason = item.reason;
        }
        return decision;
    });
}
function extractReviewFilterDecisionArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (!isJsonObject(value)) {
        return null;
    }
    for (const key of ['decisions', 'results', 'review_filter', 'reviewFilter', 'filter_results', 'filterResults', 'comments']) {
        const candidate = value[key];
        if (Array.isArray(candidate)) {
            return candidate;
        }
        const nested = extractReviewFilterDecisionArray(candidate);
        if (nested) {
            return nested;
        }
    }
    const arrayValues = Object.values(value).filter(Array.isArray);
    if (arrayValues.length === 1) {
        return arrayValues[0];
    }
    for (const candidate of Object.values(value)) {
        const nested = extractReviewFilterDecisionArray(candidate);
        if (nested) {
            return nested;
        }
    }
    return null;
}
export function validateFindings(items) {
    return items.map((item, index) => {
        if (!isJsonObject(item)) {
            throw new Error(`finding[${index}] must be an object`);
        }
        const file = item.file;
        if (typeof file !== 'string' || file.trim().length === 0) {
            throw new Error(`finding[${index}].file must be a non-empty string`);
        }
        const line = item.line;
        if (typeof line !== 'number' || !Number.isInteger(line) || line <= 0) {
            throw new Error(`finding[${index}].line must be a positive integer`);
        }
        const severity = item.severity;
        if (!isFindingSeverity(severity)) {
            throw new Error(`finding[${index}].severity has invalid severity`);
        }
        const message = item.message;
        if (typeof message !== 'string' || message.trim().length === 0) {
            throw new Error(`finding[${index}].message must be a non-empty string`);
        }
        const finding = {
            file,
            line,
            severity,
            message,
        };
        if (typeof item.suggestion === 'string' && item.suggestion.trim().length > 0) {
            finding.suggestion = item.suggestion;
        }
        if (typeof item.existing_code === 'string' && item.existing_code.trim().length > 0) {
            finding.existing_code = item.existing_code;
        }
        if (typeof item.category === 'string' && item.category.trim().length > 0) {
            finding.category = item.category;
        }
        return finding;
    });
}
export class ProviderHttpError extends Error {
    status;
    responseText;
    constructor(status, responseText) {
        super(`OpenAI-compatible API failed: HTTP ${status}`);
        this.status = status;
        this.responseText = responseText;
    }
}
function extractBalancedJson(text, openChar, closeChar) {
    const start = text.indexOf(openChar);
    if (start < 0) {
        return '';
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        const char = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            }
            else if (char === '\\') {
                escaped = true;
            }
            else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
        }
        else if (char === openChar) {
            depth += 1;
        }
        else if (char === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return text.slice(start, index + 1);
            }
        }
    }
    return '';
}
function parseJsonArrayOrObject(content) {
    const stripped = content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    const candidates = [
        stripped,
        extractBalancedJson(stripped, '[', ']'),
        extractBalancedJson(stripped, '{', '}'),
    ].filter(Boolean);
    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        }
        catch {
            continue;
        }
    }
    throw new Error('response did not contain JSON');
}
function buildRequestBody(path, promptText, options, systemPrompt = REVIEW_SYSTEM_PROMPT) {
    if (path.endsWith('/responses')) {
        const responsesBody = {
            model: options.model || 'gpt-5.6-luna',
            input: [
                {
                    role: 'system',
                    content: [
                        {
                            type: 'input_text',
                            text: systemPrompt,
                        },
                    ],
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'input_text',
                            text: promptText,
                        },
                    ],
                },
            ],
        };
        const textFormat = buildResponsesTextFormat(options.responseFormat || '');
        if (textFormat) {
            responsesBody.text = textFormat;
        }
        if (options.reasoningEffort) {
            responsesBody.reasoning = { effort: options.reasoningEffort };
        }
        return responsesBody;
    }
    const chatBody = {
        model: options.model || 'gpt-5.6-luna',
        temperature: options.temperature ?? 0.1,
        messages: [
            {
                role: 'system',
                content: systemPrompt,
            },
            {
                role: 'user',
                content: promptText,
            },
        ],
    };
    const responseFormatConfig = buildResponseFormatConfig(options.responseFormat || '');
    if (responseFormatConfig) {
        chatBody.response_format = responseFormatConfig;
    }
    return chatBody;
}
function isFindingSeverity(value) {
    return value === 'critical' || value === 'high' || value === 'medium' || value === 'low';
}
function extractAlternateFindingArray(value) {
    for (const key of ['findings', 'issues', 'comments', 'reviews', 'results', 'review_comments', 'inline_comments', 'problems']) {
        const candidate = value[key];
        if (Array.isArray(candidate)) {
            return candidate;
        }
        if (typeof candidate === 'string' && /^[\s\n\r]*\[/.test(candidate)) {
            const parsed = JSON.parse(candidate);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
        if (isJsonObject(candidate)) {
            const nested = extractAlternateFindingArray(candidate);
            if (nested) {
                return nested;
            }
        }
    }
    const arrayValues = Object.values(value).filter(Array.isArray);
    if (arrayValues.length === 1) {
        return arrayValues[0];
    }
    if (arrayValues.length > 1 && arrayValues.every((candidate) => candidate.length === 0)) {
        return [];
    }
    return null;
}
function parseNestedJsonString(value, originalCandidate) {
    const textValues = Object.values(value).filter((item) => typeof item === 'string');
    if (textValues.length !== 1) {
        return null;
    }
    const [nested] = textValues;
    if (!/^[\s\n\r]*[\[{]/.test(nested) || nested.trim() === originalCandidate.trim()) {
        return null;
    }
    return parseFindings(nested);
}
function isEmptyReviewResult(value) {
    if (Object.keys(value).length === 0) {
        return true;
    }
    const verdict = value.verdict ?? value.result ?? value.status;
    if (typeof verdict === 'string' && /^(ok|pass|passed|lgtm|no_issues|no issues|clean)$/i.test(verdict.trim())) {
        return true;
    }
    const booleanIssueValues = [
        value.hasIssues,
        value.has_issues,
        value.issuesFound,
        value.issues_found,
        value.hasFindings,
        value.has_findings,
        value.needsReview,
        value.needs_review,
    ];
    if (booleanIssueValues.some((item) => item === false)) {
        return true;
    }
    const textValues = Object.values(value).filter((item) => typeof item === 'string');
    if (textValues.some((item) => /(未发现|没有发现|无.*问题|没有.*问题|no issues|no findings|looks good|lgtm)/i.test(item))) {
        return true;
    }
    return false;
}
function describeJsonShape(value) {
    if (Array.isArray(value)) {
        return `array(length=${value.length})`;
    }
    if (!isJsonObject(value)) {
        return typeof value;
    }
    const entries = Object.entries(value)
        .slice(0, 12)
        .map(([key, item]) => `${key}:${describeJsonValue(item)}`);
    return `object{${entries.join(',')}}`;
}
function describeJsonValue(value) {
    if (Array.isArray(value)) {
        return `array(${value.length})`;
    }
    if (typeof value === 'string') {
        return `string(${value.length})`;
    }
    if (isJsonObject(value)) {
        return 'object';
    }
    return typeof value;
}
function buildResponseFormatConfig(format) {
    if (format === 'json_object') {
        return { type: 'json_object' };
    }
    if (format === 'json_schema') {
        return buildJsonSchemaResponseFormat();
    }
    return null;
}
function buildResponsesTextFormat(format) {
    if (format === 'json_object') {
        return { format: { type: 'json_object' } };
    }
    if (format === 'json_schema') {
        return {
            format: buildJsonSchemaResponseFormat(),
        };
    }
    return null;
}
function buildJsonSchemaResponseFormat() {
    return {
        type: 'json_schema',
        json_schema: {
            name: 'ai_pr_review_findings',
            strict: true,
            schema: {
                type: 'object',
                additionalProperties: false,
                required: ['findings'],
                properties: {
                    findings: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['file', 'line', 'severity', 'message'],
                            properties: {
                                file: { type: 'string' },
                                line: { type: 'integer' },
                                severity: {
                                    type: 'string',
                                    enum: ['critical', 'high', 'medium', 'low'],
                                },
                                message: { type: 'string' },
                                suggestion: { type: 'string' },
                                category: { type: 'string' },
                            },
                        },
                    },
                },
            },
        },
    };
}
function extractResponseContent(payload) {
    const data = payload;
    if (data?.choices?.[0]?.message?.content) {
        return data.choices[0].message.content;
    }
    if (data?.choices?.[0]?.text) {
        return data.choices[0].text;
    }
    if (data?.output_text) {
        return data.output_text;
    }
    const outputText = data?.output
        ?.flatMap((item) => item?.content ?? [])
        ?.filter((content) => content?.type === 'output_text' || content?.type === 'text')
        ?.map((content) => content?.text ?? '')
        ?.join('');
    return outputText || '';
}
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
