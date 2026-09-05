/**
 * AI 自定义风险规则的校验与规范化（主进程 / 渲染进程共享）
 *
 * 该模块是唯一实现源：主进程（aiHandlers.js）与渲染进程
 * （aiSystemPrompt.js / AISettings.jsx）均从此处引用，
 * 确保两侧对同一自定义规则判定始终一致。
 */

const CUSTOM_RULE_LEVELS = ["critical", "high", "medium", "low"];
const MAX_CUSTOM_RULES_PER_LEVEL = 50;
const MAX_CUSTOM_RULE_PATTERN_LENGTH = 200;

const hasNestedQuantifier = (pattern) =>
  /\((?:[^()\\]|\\.|\[[^\]]*\])*(?:[+*]|\{\d+(?:,\d*)?\})(?:[^()\\]|\\.|\[[^\]]*\])*\)(?:[+*]|\{\d+(?:,\d*)?\})/.test(
    pattern,
  );

const hasRepeatedWildcard = (pattern) => /(?:\.\*){2,}/.test(pattern);

const hasControlCharacter = (pattern) => /[\u0000-\u001f\u007f]/.test(pattern);

/**
 * 校验单条自定义风险规则。
 * @returns {{valid: boolean, reason?: string, pattern?: string}}
 *          reason 取值：empty | tooLong | controlCharacter | unsafeComplexity | syntax
 */
function validateCustomRiskPattern(pattern) {
  const normalizedPattern = typeof pattern === "string" ? pattern.trim() : "";

  if (!normalizedPattern) {
    return { valid: false, reason: "empty" };
  }

  if (normalizedPattern.length > MAX_CUSTOM_RULE_PATTERN_LENGTH) {
    return { valid: false, reason: "tooLong" };
  }

  if (hasControlCharacter(normalizedPattern)) {
    return { valid: false, reason: "controlCharacter" };
  }

  if (
    hasNestedQuantifier(normalizedPattern) ||
    hasRepeatedWildcard(normalizedPattern)
  ) {
    return { valid: false, reason: "unsafeComplexity" };
  }

  try {
    new RegExp(normalizedPattern, "i");
  } catch {
    return { valid: false, reason: "syntax" };
  }

  return { valid: true, pattern: normalizedPattern };
}

/**
 * 规范化自定义风险规则对象：按级别去重、截断、过滤非法项。
 * @returns {{critical: string[], high: string[], medium: string[], low: string[]}}
 */
function normalizeCustomRiskRules(rules) {
  const normalizedRules = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  if (!rules || typeof rules !== "object") {
    return normalizedRules;
  }

  for (const level of CUSTOM_RULE_LEVELS) {
    const patterns = Array.isArray(rules[level]) ? rules[level] : [];
    const seenPatterns = new Set();

    for (const rawPattern of patterns) {
      if (normalizedRules[level].length >= MAX_CUSTOM_RULES_PER_LEVEL) {
        break;
      }

      const validation = validateCustomRiskPattern(rawPattern);
      if (!validation.valid || seenPatterns.has(validation.pattern)) {
        continue;
      }

      seenPatterns.add(validation.pattern);
      normalizedRules[level].push(validation.pattern);
    }
  }

  return normalizedRules;
}

module.exports = {
  CUSTOM_RULE_LEVELS,
  MAX_CUSTOM_RULES_PER_LEVEL,
  MAX_CUSTOM_RULE_PATTERN_LENGTH,
  validateCustomRiskPattern,
  normalizeCustomRiskRules,
};
