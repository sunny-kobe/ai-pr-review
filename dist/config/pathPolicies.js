export const builtInPathPolicies = [
    {
        glob: '**/*.json',
        reviewerFocus: '重点关注配置变更的解析失败、字段契约漂移、敏感信息泄露和运行时兼容性。',
        reviewRules: {
            crashPrevention: [
                'JSON 配置必须保持合法结构，重点检查缺失逗号、非法注释、字段类型变化和必填字段缺失',
                '配置字段重命名、枚举值变化或默认值变化会影响现有读取方时，必须指出具体破坏路径',
            ],
            security: [
                '不要在 JSON 配置中新增 token、密钥、密码、私有 URL 或个人敏感信息',
            ],
            ignore: [
                '不要评论纯排序、缩进、字段顺序或不会改变读取语义的格式调整',
            ],
        },
    },
    {
        glob: '**/*.yml',
        reviewerFocus: '重点关注 YAML 配置变更的解析失败、权限边界、执行条件和 secret 使用。',
        reviewRules: {
            crashPrevention: [
                'YAML 缩进、数组/对象层级、布尔/字符串类型变化可能导致配置不生效或解析失败',
                '新增条件、环境变量、路径过滤或矩阵配置时，检查是否会让关键任务意外跳过或重复执行',
            ],
            security: [
                '不要把 secret 拼进 shell 命令、日志、缓存 key、artifact 名称或可被 PR 内容控制的字符串',
            ],
            ignore: [
                '不要评论不会改变 YAML 语义的字段顺序、空行和注释位置',
            ],
        },
    },
    {
        glob: '**/*.yaml',
        reviewerFocus: '重点关注 YAML 配置变更的解析失败、权限边界、执行条件和 secret 使用。',
        reviewRules: {
            crashPrevention: [
                'YAML 缩进、数组/对象层级、布尔/字符串类型变化可能导致配置不生效或解析失败',
                '新增条件、环境变量、路径过滤或矩阵配置时，检查是否会让关键任务意外跳过或重复执行',
            ],
            security: [
                '不要把 secret 拼进 shell 命令、日志、缓存 key、artifact 名称或可被 PR 内容控制的字符串',
            ],
            ignore: [
                '不要评论不会改变 YAML 语义的字段顺序、空行和注释位置',
            ],
        },
    },
    {
        glob: 'package.json',
        reviewerFocus: '重点关注 npm 脚本、依赖版本、发布配置和包管理语义变化带来的供应链或 CI 风险。',
        reviewRules: {
            crashPrevention: [
                'scripts、engines、type、exports、main/module/bin 或 packageManager 变化可能破坏构建、测试、发布或运行入口',
                'dependencies/devDependencies/peerDependencies 变化要关注运行时依赖误放、破坏性版本范围和缺失 peer 约束',
            ],
            security: [
                '新增 npm script 如果执行远程脚本、展开未信任输入或绕过 lockfile，必须指出供应链风险',
            ],
            performance: [
                '新增大型运行时依赖或把仅构建期依赖放进 dependencies 时，关注包体和安装成本的明确影响',
            ],
            ignore: [
                '不要评论字段排序、版本号格式偏好或无法从 diff 证明有风险的依赖升级',
            ],
        },
    },
    {
        glob: '**/package.json',
        reviewerFocus: '重点关注 npm 脚本、依赖版本、发布配置和包管理语义变化带来的供应链或 CI 风险。',
        reviewRules: {
            crashPrevention: [
                'scripts、engines、type、exports、main/module/bin 或 packageManager 变化可能破坏构建、测试、发布或运行入口',
                'dependencies/devDependencies/peerDependencies 变化要关注运行时依赖误放、破坏性版本范围和缺失 peer 约束',
            ],
            security: [
                '新增 npm script 如果执行远程脚本、展开未信任输入或绕过 lockfile，必须指出供应链风险',
            ],
            performance: [
                '新增大型运行时依赖或把仅构建期依赖放进 dependencies 时，关注包体和安装成本的明确影响',
            ],
            ignore: [
                '不要评论字段排序、版本号格式偏好或无法从 diff 证明有风险的依赖升级',
            ],
        },
    },
    {
        glob: '.github/workflows/**/*.yml',
        reviewMode: 'security',
        reviewerFocus: '重点关注 GitHub Actions 的权限、secret 暴露、脚本注入、触发条件、超时和并发控制风险。',
        reviewRules: {
            crashPrevention: [
                '新增或修改 workflow 时，检查 checkout fetch-depth、job timeout、concurrency、路径过滤和 required check 语义是否会破坏 CI',
                'shell 脚本中引用 GitHub context、inputs 或 PR 内容时，必须防止未加引号导致参数拆分或命令注入',
            ],
            security: [
                'permissions 必须最小化；新增 contents/write、pull-requests/write、actions/write 或 id-token/write 需要有明确必要性',
                '不要默认建议切换到 pull_request_target；如果 diff 引入它，只审查 checkout、secret、权限和 fork 安全边界',
                '不要把 secrets 传给来自 PR 可控内容的脚本、第三方 action 参数、缓存 key、artifact 或日志',
            ],
            performance: [
                '新增长任务应设置 timeout-minutes，并避免无边界矩阵或重复触发造成 CI 资源浪费',
            ],
            ignore: [
                '不要评论 workflow 名称、job 名称或 step 名称的文案偏好，除非会影响 required check 匹配',
            ],
        },
    },
    {
        glob: '.github/workflows/**/*.yaml',
        reviewMode: 'security',
        reviewerFocus: '重点关注 GitHub Actions 的权限、secret 暴露、脚本注入、触发条件、超时和并发控制风险。',
        reviewRules: {
            crashPrevention: [
                '新增或修改 workflow 时，检查 checkout fetch-depth、job timeout、concurrency、路径过滤和 required check 语义是否会破坏 CI',
                'shell 脚本中引用 GitHub context、inputs 或 PR 内容时，必须防止未加引号导致参数拆分或命令注入',
            ],
            security: [
                'permissions 必须最小化；新增 contents/write、pull-requests/write、actions/write 或 id-token/write 需要有明确必要性',
                '不要默认建议切换到 pull_request_target；如果 diff 引入它，只审查 checkout、secret、权限和 fork 安全边界',
                '不要把 secrets 传给来自 PR 可控内容的脚本、第三方 action 参数、缓存 key、artifact 或日志',
            ],
            performance: [
                '新增长任务应设置 timeout-minutes，并避免无边界矩阵或重复触发造成 CI 资源浪费',
            ],
            ignore: [
                '不要评论 workflow 名称、job 名称或 step 名称的文案偏好，除非会影响 required check 匹配',
            ],
        },
    },
];
export function resolvePathPolicy(file, policies) {
    const matches = [...builtInPathPolicies, ...policies].filter((policy) => pathMatchesGlob(file, policy.glob));
    return matches.reduce((merged, policy) => mergePathPolicy(merged, policy), { glob: '' });
}
export function pathMatchesGlob(file, glob) {
    if (!glob) {
        return false;
    }
    return globToRegExp(glob).test(file);
}
export function policyReviewRulesMarkdown(rules) {
    if (!rules) {
        return '';
    }
    const titles = [
        ['crashPrevention', 'Crash Prevention'],
        ['architecture', 'Architecture'],
        ['security', 'Security'],
        ['performance', 'Performance'],
        ['ignore', 'Ignore'],
    ];
    return titles
        .flatMap(([key, title]) => {
        const items = rules[key] ?? [];
        return items.length > 0 ? [`${title}:\n${items.map((item) => `- ${item}`).join('\n')}`] : [];
    })
        .join('\n');
}
function mergePathPolicy(base, override) {
    return {
        glob: override.glob || base.glob,
        reviewMode: override.reviewMode ?? base.reviewMode,
        reviewerFocus: override.reviewerFocus ?? base.reviewerFocus,
        reviewRules: mergePolicyRules(base.reviewRules, override.reviewRules),
    };
}
function mergePolicyRules(base, override) {
    if (!base && !override) {
        return undefined;
    }
    const merged = {};
    const keys = ['crashPrevention', 'architecture', 'security', 'performance', 'ignore'];
    for (const key of keys) {
        const items = [...(base?.[key] ?? []), ...(override?.[key] ?? [])];
        if (items.length > 0) {
            merged[key] = Array.from(new Set(items));
        }
    }
    return merged;
}
function globToRegExp(glob) {
    let pattern = '^';
    for (let index = 0; index < glob.length; index += 1) {
        const char = glob[index];
        const next = glob[index + 1];
        if (char === '*' && next === '*') {
            const afterGlobstar = glob[index + 2];
            if (afterGlobstar === '/') {
                pattern += '(?:.*\\/)?';
                index += 2;
            }
            else {
                pattern += '.*';
                index += 1;
            }
            continue;
        }
        if (char === '*') {
            pattern += '[^/]*';
            continue;
        }
        if (char === '?') {
            pattern += '[^/]';
            continue;
        }
        pattern += escapeRegExp(char);
    }
    return new RegExp(`${pattern}$`);
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
