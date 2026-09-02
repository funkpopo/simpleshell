/**
 * SSH 交互式认证辅助（keyboard-interactive / 2FA）
 *
 * 基于 ssh2 的 `tryKeyboard` + `keyboard-interactive` 事件实现：
 * - 可自动回答的提示（已存密码 + 非回显的 Password 类提示）直接代答；
 * - 无法自动回答的提示（OTP 验证码 / 短信验证码 / 安全短语等）通过注入的
 *   `keyboardInteractiveResponder` 回调请求用户输入（主进程转发到渲染层对话框）；
 * - 无 responder 的非交互上下文（如连接测试后台调用）直接失败，避免静默挂起。
 */

const { logToFile } = require("../utils/logger");
const { t: mainT, normalizeLanguage } = require("../../shared/mainI18n");

const PASSWORD_PROMPT_PATTERN = /password|密码|passcode/i;

// responder 超时：渲染层对话框若长时间不响应，避免 SSH 认证无限挂起。
// 给足用户输入验证码的时间（5 分钟）。
const RESPONDER_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 判断单个 keyboard-interactive 提示是否可用已存储的密码自动代答
 * @param {Object} promptInfo - { prompt, echo }
 * @param {Object} sshConfig - SSH 配置
 * @returns {string|null} 可代答时返回答案，否则返回 null
 */
function autoAnswerPrompt(promptInfo, sshConfig) {
  if (!promptInfo || typeof promptInfo.prompt !== "string") {
    return null;
  }
  // 回显型提示绝不自动代答（可能是"显示密码"类确认提示）
  if (promptInfo.echo === true) {
    return null;
  }
  if (!sshConfig || typeof sshConfig.password !== "string" || !sshConfig.password) {
    return null;
  }
  if (PASSWORD_PROMPT_PATTERN.test(promptInfo.prompt)) {
    return sshConfig.password;
  }
  return null;
}

/**
 * 解析一组 keyboard-interactive 提示的答案
 * @param {Object} params
 * @param {string} params.name - 服务器提供的请求名
 * @param {string} params.instructions - 服务器提供的说明
 * @param {Array<{prompt: string, echo: boolean}>} params.prompts - 提示列表
 * @param {Object} params.sshConfig - SSH 配置（可能携带 keyboardInteractiveResponder）
 * @returns {Promise<string[]>} 与 prompts 一一对应的答案数组
 */
async function resolveKeyboardInteractiveAnswers({
  name,
  instructions,
  prompts,
  sshConfig,
}) {
  const promptList = Array.isArray(prompts) ? prompts : [];
  const answers = [];
  let needsUser = false;

  for (const promptInfo of promptList) {
    const autoAnswer = autoAnswerPrompt(promptInfo, sshConfig);
    if (autoAnswer !== null) {
      answers.push(autoAnswer);
    } else {
      answers.push(undefined);
      needsUser = true;
    }
  }

  if (!needsUser) {
    return answers;
  }

  const responder = sshConfig?.keyboardInteractiveResponder;
  if (typeof responder !== "function") {
    // 非交互上下文（后台/测试）：明确失败而不是挂起
    const lng = normalizeLanguage(sshConfig?.language);
    throw new Error(
      mainT("mainProcess.ssh.keyboardInteractiveUnsupported", { lng }),
    );
  }

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeoutError = new Error("Keyboard-interactive response timeout");
      timeoutError.code = "KEYBOARD_INTERACTIVE_TIMEOUT";
      reject(timeoutError);
    }, RESPONDER_TIMEOUT_MS);

    // responder 可能同步抛异常（或不返回 promise）：
    // 必须在 .then/.catch 挂上之前清掉定时器，否则空转 5 分钟拖慢退出
    let responderResult;
    try {
      responderResult = responder({
        name: typeof name === "string" ? name : "",
        instructions: typeof instructions === "string" ? instructions : "",
        prompts: promptList.map((p) => ({
          prompt: typeof p?.prompt === "string" ? p.prompt : "",
          echo: p?.echo === true,
        })),
        prefill: answers,
      });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
      return;
    }
    Promise.resolve(responderResult)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

  if (!result || result.cancelled) {
    throw new Error("Authentication cancelled by user");
  }

  // 按提示顺序归位答案；用户未填写的用预填值兜底，最后兜空串
  return promptList.map((_, index) => {
    const userAnswer =
      Array.isArray(result.answers) ? result.answers[index] : undefined;
    if (typeof userAnswer === "string") {
      return userAnswer;
    }
    if (typeof answers[index] === "string") {
      return answers[index];
    }
    return "";
  });
}

/**
 * 为 ssh2 Client 附加 keyboard-interactive 事件处理
 * 需要配合 connect options 中的 tryKeyboard: true（buildSshConnectOptions 已默认开启）
 * @param {Object} client - ssh2 Client 实例
 * @param {Object} sshConfig - SSH 配置
 */
function attachKeyboardInteractiveSupport(client, sshConfig) {
  if (!client || typeof client.on !== "function") {
    return;
  }

  client.on(
    "keyboard-interactive",
    (name, instructions, instructionsLang, prompts, finish) => {
      void instructionsLang;
      if (typeof finish !== "function") {
        return;
      }

      logToFile(
        `SSH keyboard-interactive prompt: ${prompts?.length || 0} prompt(s)` +
          `${sshConfig?.host ? ` for ${sshConfig.host}` : ""}`,
        "INFO",
      );

      resolveKeyboardInteractiveAnswers({ name, instructions, prompts, sshConfig })
        .then((answers) => {
          finish(answers);
        })
        .catch((error) => {
          logToFile(
            `SSH keyboard-interactive answering failed: ${error?.message || error}`,
            "WARN",
          );
          // 结束连接以向上层传递失败/取消（终止中的认证流程）
          try {
            if (typeof client.end === "function") {
              client.end();
            }
          } catch {
            /* intentionally ignored */
          }
          try {
            finish([]);
          } catch {
            /* intentionally ignored */
          }
        });
    },
  );
}

/**
 * 判断配置是否需要放宽连接超时（存在交互式认证路径）
 * @param {Object} sshConfig - SSH 配置
 * @returns {boolean}
 */
function hasInteractiveAuthCapability(sshConfig) {
  return (
    typeof sshConfig?.keyboardInteractiveResponder === "function" ||
    typeof sshConfig?.hostVerifier === "function"
  );
}

module.exports = {
  PASSWORD_PROMPT_PATTERN,
  autoAnswerPrompt,
  resolveKeyboardInteractiveAnswers,
  attachKeyboardInteractiveSupport,
  hasInteractiveAuthCapability,
};
