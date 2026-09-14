# SFTP 跟随终端目录 / Follow terminal directory

在「设置 → 常规」中使用「SFTP 跟随终端目录」全局开关，默认开启。保存后立即应用于所有 SSH 标签页和分屏会话，并在重启后保留。文件侧栏没有独立开关。关闭全局设置后可以独立浏览，再次开启会跟上终端最新识别的目录。

目录信息按终端会话隔离；文件面板只跟随当前聚焦会话。隐藏期间只记录目录，重新打开时再加载。自动跳转在目录读取成功后才更新路径、列表和导航历史；读取失败保留原目录。关闭设置、隐藏面板、切换会话或报告新目录会使之前的自动跳转失效，包括尚未返回的主目录解析和目录读取。

这是从终端到文件管理器的单向跟随。在文件管理器中浏览目录不会向终端发送 `cd`；开启跟随时，手动浏览会保持到终端下一次报告目录变化。

路径识别优先使用 Shell 输出的 OSC 7 (`file://hostname/path`) 或 OSC 1337 (`CurrentDir=/path`)。上报内容不会经过终端文本高亮，支持跨网络分片。没有上报信息时，兼容 `user@host:/full/path$`、`user@host:~/project$`、`[user@host /full/path]$` 这类完整提示符。`~` 只用于当前 SSH 登录用户，并通过 SFTP 解析真实目录。仅显示末级目录名、包含省略号的缩写路径或复杂主题的提示符需要下面的 Shell 配置；无法识别时会保留文件管理器当前路径。

目录来源是 Shell 实际显示或上报的结果，因此正常提示符中的 `cd ..`、`cd -`、`pushd`、函数和别名切换目录都可跟随，失败的 `cd` 不会被当作成功切换。终端中的 vim、less 等备用屏幕不会触发路径识别。SFTP 仍使用原 SSH 用户的权限和文件系统视图；经 `su`、嵌套 SSH 或容器进入的目录可能无法通过该 SFTP 会话访问。

提示符匹配属于启发式识别，普通程序也可能输出类似提示符的文本；复杂环境建议采用下面的 Shell 上报配置。检测到提示符或 OSC 7 的主机名发生变化时会暂停跟随，直到回到原主机。OSC 1337 不携带主机名，不能仅凭该消息完整判断嵌套 SSH、`su` 或容器上下文。

## Bash

在远程 `~/.bashrc` **设置 PS1 的代码之后**加入以下内容。它通过默认开启的 Bash `promptvars` 在每次提示符中上报 `$PWD`，不需要覆盖现有 `PROMPT_COMMAND`：

```bash
case "$PS1" in
  *'1337;CurrentDir='*) ;;
  *) PS1+='\[\e]1337;CurrentDir=${PWD}\a\]' ;;
esac
```

新建会话，或在当前 Bash 中执行 `source ~/.bashrc` 后生效。若提示符主题在之后重新生成 PS1，请使用主题提供的提示符钩子发送同样的 OSC 信息。路径中的换行或其他控制字符不支持跟随。

## Zsh

在远程 `~/.zshrc` 中添加：

```zsh
autoload -Uz add-zsh-hook
_simpleshell_report_cwd() {
  local previous_status=$?
  printf '\033]1337;CurrentDir=%s\007' "$PWD"
  return "$previous_status"
}
add-zsh-hook precmd _simpleshell_report_cwd
```

新建会话或执行 `source ~/.zshrc` 后生效。应用只读取这些目录信息，不会自动修改远程 Shell 配置。

## English

**SFTP follows terminal directory** is a global option under **Settings → General**, enabled by default. Saving applies it to every SSH tab and split session immediately, and the preference survives restarts. There is no separate sidebar toggle. Directory state remains isolated per session; the file panel follows the focused session. Disable the setting for independent browsing, and enable it again to catch up.

Hidden panels remember directory updates and load them when reopened. Automatic navigation updates the path, file list and history only after a successful read; errors preserve the current directory. Disabling the setting, hiding the panel, switching sessions or receiving a newer directory invalidates pending automatic requests. Following is one way: browsing SFTP does not send `cd` to the terminal. Manual navigation remains in place until the terminal reports a different directory.

The terminal recognizes OSC 7 file URIs and OSC 1337 `CurrentDir` reports. Without those reports it recognizes complete prompts such as `user@host:/full/path$`, `user@host:~/project$`, and `[user@host /full/path]$`. Home-relative paths are resolved through SFTP only for the SSH login user. Abbreviated or custom prompts need shell integration; unrecognized prompts leave the file manager at its current path.

OSC reports bypass text highlighting and work across network chunks. Prompt matching is a fallback heuristic, not a shell API: applications can print text resembling a prompt. Use the Bash/Zsh reporting snippets for dependable directory tracking with custom environments. Hostname changes detected in prompts or OSC 7 reports suspend following until the original host returns. OSC 1337 does not carry a hostname; nested SSH, `su` and containers cannot be fully identified from that report alone.

For Bash, append the Bash snippet above **after your PS1 setup** in the remote `~/.bashrc`. It uses Bash's default `promptvars` expansion and leaves `PROMPT_COMMAND` intact. For Zsh, add the Zsh snippet to the remote `~/.zshrc`. Start a new session or source the corresponding file. If a theme rebuilds PS1 afterward, use its prompt hook to emit the same OSC report instead. The app does not install these snippets automatically.

Directory changes are based on reported results, including `cd ..`, `cd -`, aliases and functions. Failed directory changes do not predict a new path. Alternate-screen applications are ignored. Paths containing control characters are not supported, and SFTP retains the original SSH user's permissions and filesystem view, which may differ after `su`, nested SSH or entering a container.
