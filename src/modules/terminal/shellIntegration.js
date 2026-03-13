export const OSC_133_IDENTIFIER = 133;

export const SHELL_INTEGRATION_SHELLS = Object.freeze([
  "bash",
  "zsh",
  "fish",
  "pwsh",
]);

const SHELL_INTEGRATION_SCRIPTS = Object.freeze({
  bash: [
    'if [ -z "${__SIMPLESHELL_SHELL_INTEGRATION:-}" ]; then',
    "  __SIMPLESHELL_SHELL_INTEGRATION=1",
    "  __SIMPLESHELL_FIRST_PROMPT=1",
    "  __SIMPLESHELL_PROMPT_PREFIX=$'\\\\[\\e]133;A\\a\\\\]'",
    "  __SIMPLESHELL_PROMPT_SUFFIX=$'\\\\[\\e]133;B\\a\\\\]'",
    "  __SIMPLESHELL_EXEC_PREFIX=$'\\\\[\\e]133;C\\a\\\\]'",
    "  __simpleshell_precmd() {",
    "    local status=$?",
    '    if [ "${__SIMPLESHELL_FIRST_PROMPT:-1}" = "1" ]; then',
    "      __SIMPLESHELL_FIRST_PROMPT=0",
    "    else",
    "      printf '\\033]133;D;%s\\007' \"$status\"",
    "    fi",
    "  }",
    '  case ";${PROMPT_COMMAND:-};" in',
    '    *";__simpleshell_precmd;"*) ;;',
    '    *) PROMPT_COMMAND="__simpleshell_precmd${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;',
    "  esac",
    '  case "${PS0:-}" in',
    "    *$'\\e]133;C\\a'*) ;;",
    '    *) PS0="${__SIMPLESHELL_EXEC_PREFIX}${PS0:-}" ;;',
    "  esac",
    '  case "${PS1:-}" in',
    "    *$'\\e]133;A\\a'*|*$'\\e]133;B\\a'*) ;;",
    '    *) PS1="${__SIMPLESHELL_PROMPT_PREFIX}${PS1:-}${__SIMPLESHELL_PROMPT_SUFFIX}" ;;',
    "  esac",
    "fi",
  ].join("\n"),
  zsh: [
    'if [[ -z "${__SIMPLESHELL_SHELL_INTEGRATION:-}" ]]; then',
    "  typeset -g __SIMPLESHELL_SHELL_INTEGRATION=1",
    "  typeset -gi __SIMPLESHELL_FIRST_PROMPT=1",
    "  function __simpleshell_precmd() {",
    "    local status=$?",
    "    if (( __SIMPLESHELL_FIRST_PROMPT )); then",
    "      __SIMPLESHELL_FIRST_PROMPT=0",
    "      return",
    "    fi",
    "    printf '\\033]133;D;%s\\007' \"$status\"",
    "  }",
    "  function __simpleshell_preexec() {",
    "    printf '\\033]133;C\\007'",
    "  }",
    "  autoload -Uz add-zsh-hook",
    "  add-zsh-hook precmd __simpleshell_precmd",
    "  add-zsh-hook preexec __simpleshell_preexec",
    '  case "${PS1:-}" in',
    "    *$'\\e]133;A\\a'*|*$'\\e]133;B\\a'*) ;;",
    "    *) PS1=$'%{\\e]133;A\\a%}'\"${PS1:-}\"$'%{\\e]133;B\\a%}' ;;",
    "  esac",
    "fi",
  ].join("\n"),
  fish: [
    "if not set -q __simpleshell_shell_integration",
    "  set -g __simpleshell_shell_integration 1",
    "  function __simpleshell_preexec --on-event fish_preexec",
    "    printf '\\e]133;C\\a'",
    "  end",
    "  function __simpleshell_postexec --on-event fish_postexec",
    "    printf '\\e]133;D;%s\\a' $status",
    "  end",
    "  if functions -q fish_prompt",
    "    functions -c fish_prompt __simpleshell_original_fish_prompt",
    "    function fish_prompt",
    "      printf '\\e]133;A\\a'",
    "      __simpleshell_original_fish_prompt",
    "      printf '\\e]133;B\\a'",
    "    end",
    "  end",
    "end",
  ].join("\n"),
  pwsh: [
    "if (-not $global:__SimpleShellIntegrationLoaded) {",
    "  $global:__SimpleShellIntegrationLoaded = $true",
    "  $global:__SimpleShellCommandActive = $false",
    "  function global:__SimpleShellEmitOsc133([string]$Payload) {",
    '    [Console]::Out.Write(\"`e]133;$Payload`a\")',
    "  }",
    "  if (Test-Path Function:\\prompt) {",
    "    $script:__SimpleShellOriginalPrompt = (Get-Command prompt -CommandType Function).ScriptBlock",
    "  } else {",
    '    $script:__SimpleShellOriginalPrompt = { \"PS $($executionContext.SessionState.Path.CurrentLocation)> \" }',
    "  }",
    "  function global:prompt {",
    "    $success = $?",
    "    $exitCode = if ($success) { 0 } elseif ($null -ne $global:LASTEXITCODE) { $global:LASTEXITCODE } else { 1 }",
    "    if ($global:__SimpleShellCommandActive) {",
    '      __SimpleShellEmitOsc133 \"D;$exitCode\"',
    "      $global:__SimpleShellCommandActive = $false",
    "    }",
    '    __SimpleShellEmitOsc133 \"A\"',
    "    $promptText = & $script:__SimpleShellOriginalPrompt",
    '    __SimpleShellEmitOsc133 \"B\"',
    "    return $promptText",
    "  }",
    "  if (Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue) {",
    "    Set-PSReadLineKeyHandler -Key Enter -BriefDescription SimpleShellAcceptLine -ScriptBlock {",
    "      if (-not $global:__SimpleShellCommandActive) {",
    '        __SimpleShellEmitOsc133 \"C\"',
    "        $global:__SimpleShellCommandActive = $true",
    "      }",
    "      [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()",
    "    }",
    "  }",
    "}",
  ].join("\n"),
});

const normalizeExitCode = (value) => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
};

export const normalizeShellIntegrationShell = (shell) => {
  if (typeof shell !== "string") {
    return null;
  }

  const normalized = shell.trim().split(/[\\/]/).pop()?.toLowerCase();

  if (!normalized) {
    return null;
  }

  if (normalized.includes("powershell") || normalized.includes("pwsh")) {
    return "pwsh";
  }
  if (normalized.includes("bash")) {
    return "bash";
  }
  if (normalized.includes("zsh")) {
    return "zsh";
  }
  if (normalized.includes("fish")) {
    return "fish";
  }

  return null;
};

export const isSupportedShellIntegrationShell = (shell) => {
  const normalizedShell = normalizeShellIntegrationShell(shell);
  return Boolean(normalizedShell && SHELL_INTEGRATION_SCRIPTS[normalizedShell]);
};

export const buildShellIntegrationInjection = (shell) => {
  const normalizedShell = normalizeShellIntegrationShell(shell);
  if (!normalizedShell) {
    return null;
  }

  const script = SHELL_INTEGRATION_SCRIPTS[normalizedShell];
  return script ? `${script}\n` : null;
};

export const parseShellIntegrationOscPayload = (payload) => {
  if (typeof payload !== "string" || !payload.trim()) {
    return null;
  }

  const parts = payload
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return null;
  }

  const marker = parts[0];
  const params = {};
  let value = null;

  for (let index = 1; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) {
      continue;
    }

    if (part.includes("=")) {
      const [key, paramValue = ""] = part.split("=", 2);
      if (key) {
        params[key] = paramValue;
      }
      continue;
    }

    if (value === null) {
      value = part;
    }
  }

  switch (marker) {
    case "A":
      return {
        type: "prompt-start",
        params,
        raw: payload,
      };
    case "B":
      return {
        type: "prompt-end",
        params,
        raw: payload,
      };
    case "C":
      return {
        type: "command-start",
        params,
        raw: payload,
      };
    case "D":
      return {
        type: "command-finish",
        exitCode: normalizeExitCode(value),
        params,
        raw: payload,
      };
    default:
      return null;
  }
};

export default {
  OSC_133_IDENTIFIER,
  SHELL_INTEGRATION_SHELLS,
  buildShellIntegrationInjection,
  isSupportedShellIntegrationShell,
  normalizeShellIntegrationShell,
  parseShellIntegrationOscPayload,
};
