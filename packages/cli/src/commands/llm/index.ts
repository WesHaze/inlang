import { Command } from "commander";
import { translate } from "./translate.js";

export const llm = new Command()
  .command("llm")
  .description("Commands for LLM-powered translations.")
  .argument("[command]")
  .addCommand(translate);
