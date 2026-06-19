import { generateCommandSuggestions } from '../src/utils/suggestions/commandSuggestions.ts';
import { getCommands, getCommandName } from '../src/commands.ts';
import { enableConfigs } from '../src/utils/config.ts';

async function main() {
  enableConfigs();
  const cwd = process.cwd();

  console.log('Loading actual commands...');
  const commands = await getCommands(cwd);
  console.log(`Loaded ${commands.length} commands.`);

  const queries = [
    '/mit',
    '/comit',
    '/stlye',
    '/cmit',
    '/commit',
    '/thme',
  ];

  for (const query of queries) {
    const suggestions = generateCommandSuggestions(query, commands);
    console.log(`\nQuery: "${query}" -> Found ${suggestions.length} suggestions:`);
    console.log(suggestions.slice(0, 10).map(s => `${s.displayText}`));
  }
}

main().catch(console.error);
