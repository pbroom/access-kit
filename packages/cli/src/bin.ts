#!/usr/bin/env node
import { buildCli } from "./commands.js";

await buildCli().parseAsync(process.argv);
