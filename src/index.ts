/**
 * CSage Entry Point.
 *
 * Bootstraps the Commander application and parses command line arguments.
 */

import { createProgram } from './cli/index.js';

const program = createProgram();
program.parse(process.argv);
