import type { Command } from "commander";

import { CLI_COMMANDS } from "./command-registry.js";
import { CliConfigurationError } from "./errors.js";

export function renderShellCompletion(shell: string, program: Command): string {
  const words = completionWords(program);

  if (shell === "bash") {
    return [
      "_rebac_completion() {",
      "  COMPREPLY=($(compgen -W \"" + words.join(" ") + "\" -- \"${COMP_WORDS[COMP_CWORD]}\"))",
      "}",
      "complete -F _rebac_completion rebac"
    ].join("\n");
  }

  if (shell === "zsh") {
    return `#compdef rebac\n_arguments '*: :(${words.join(" ")})'`;
  }

  if (shell === "fish") {
    return words.map((word) => `complete -c rebac -f -a ${quoteFishWord(word)}`).join("\n");
  }

  throw new CliConfigurationError("completion shell must be bash, zsh, or fish");
}

function completionWords(command: Command): string[] {
  const words = new Set([
    "--api-url",
    "--api-key-env",
    "--config",
    "--profile",
    "--preview",
    "--diff"
  ]);

  for (const spec of CLI_COMMANDS) {
    for (const word of spec.path.split(" ")) {
      words.add(word);
    }
  }

  for (const child of command.commands) {
    words.add(child.name());
  }

  return [...words].sort();
}

function quoteFishWord(word: string): string {
  return `'${word.replace(/\\/g, "\\\\").replace(/'/g, "'\\''")}'`;
}
