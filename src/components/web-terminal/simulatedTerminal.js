/**
 * Local mock / simulated terminal used when no SSH/local config or IPC is available.
 * Kept outside the main WebTerminal orchestration surface.
 */

const EDITOR_COMMAND_REGEX =
  /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;

const handleSimulatedCommand = (term, input) => {
  const command = input.trim();

  switch (command) {
    case "help":
      term.writeln("Available commands:");
      term.writeln("  help     - Show this help message");
      term.writeln("  clear    - Clear the terminal");
      term.writeln("  date     - Show current date and time");
      term.writeln("  echo     - Echo back your text");
      break;
    case "clear":
      term.clear();
      break;
    case "date":
      term.writeln(new Date().toString());
      break;
    default:
      if (command.startsWith("echo ")) {
        term.writeln(command.substring(5));
      } else if (command !== "") {
        term.writeln(`Command not found: ${command}`);
      }
      break;
  }
};

/**
 * Wire a lightweight interactive mock shell onto an xterm Terminal instance.
 * @param {import('@xterm/xterm').Terminal} term
 */
export const setupSimulatedTerminal = (term) => {
  const termPrompt = "$ ";
  let userInput = "";
  let inEditorMode = false;

  term.write(termPrompt);

  term.onKey(({ key, domEvent }) => {
    const printable =
      !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;

    if (domEvent.keyCode === 13) {
      term.writeln("");

      if (userInput.trim() !== "") {
        const command = userInput.trim();

        if (EDITOR_COMMAND_REGEX.test(command)) {
          inEditorMode = true;
          term.writeln(
            `Simulated ${command} editor mode. Type 'exit' to return.`,
          );
        } else if (inEditorMode && /^(exit|quit|q|:q|:wq|:x)$/i.test(command)) {
          inEditorMode = false;
        } else if (!inEditorMode) {
          handleSimulatedCommand(term, command);
        }

        term.write("$ ");
      } else {
        term.write("$ ");
      }

      userInput = "";
    } else if (domEvent.keyCode === 8) {
      if (userInput.length > 0) {
        userInput = userInput.slice(0, -1);
        term.write("\b \b");
      }
    } else if (printable) {
      userInput += key;
      term.write(key);
    }
  });
};
