import { generateCommandSuggestions } from '../src/utils/suggestions/commandSuggestions.ts';
import { getCommandName, type Command } from '../src/commands.ts';
import { getModeFromInput } from '../src/components/PromptInput/inputModes.ts';

// Let's create mock commands similar to what the REPL has
const commands: Command[] = [
  { type: 'local', name: 'commit', description: 'Commit changes' },
  { type: 'local', name: 'output-style', description: 'Change output style' },
  { type: 'local', name: 'config', description: 'Configure settings' },
  { type: 'local', name: 'resume', description: 'Resume a session' },
  { type: 'local', name: 'help', description: 'Show help' },
  { type: 'local', name: 'clear', description: 'Clear screen' },
] as any[];

console.log('--- Test empty query ---');
console.log(generateCommandSuggestions('/', commands).map(s => s.displayText));

console.log('--- Test substring/prefix query "comm" ---');
console.log(generateCommandSuggestions('/comm', commands).map(s => s.displayText));

console.log('--- Test substring query "mit" ---');
console.log(generateCommandSuggestions('/mit', commands).map(s => s.displayText));

console.log('--- Test fuzzy query "comit" ---');
console.log(generateCommandSuggestions('/comit', commands).map(s => s.displayText));

console.log('--- Test fuzzy query "stlye" ---');
console.log(generateCommandSuggestions('/stlye', commands).map(s => s.displayText));

console.log('--- Test fuzzy query "cmit" ---');
console.log(generateCommandSuggestions('/cmit', commands).map(s => s.displayText));

