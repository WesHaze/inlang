import { Command } from "commander";
import { translate } from "./translate.js";

export const llm = new Command()
  .command("llm")
  .description("Commands for LLM-powered translations with OpenRouter.")
  .addCommand(translate);
