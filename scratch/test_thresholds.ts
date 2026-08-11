import Fuse from 'fuse.js';
import { getCommands, getCommandName } from '../src/commands.ts';
import { enableConfigs } from '../src/utils/config.ts';

const SEPARATORS = /[:_-]/g;

function cleanWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function getRenderedCommandDescription(cmd: any): string {
  return cmd.description || '';
}

async function testWithThreshold(threshold: number, keys: any[], commands: any[]) {
  const commandData = commands.map(cmd => {
    const commandName = getCommandName(cmd);
    const parts = commandName.split(SEPARATORS).filter(Boolean);
    return {
      descriptionKey: getRenderedCommandDescription(cmd)
        .split(/\s+/)
        .map(word => cleanWord(word))
        .filter(Boolean),
      partKey: parts.length > 1 ? parts : undefined,
      commandName,
      command: cmd,
      aliasKey: cmd.aliases,
    };
  });

  const fuse = new Fuse(commandData, {
    includeScore: true,
    includeMatches: true,
    threshold,
    location: 0,
    distance: 100,
    keys,
  });

  const queries = ['comit'];
  console.log(`\n================ THRESHOLD: ${threshold} ================`);
  for (const q of queries) {
    const results = fuse.search(q);
    console.log(`Query "${q}" -> Found ${results.length} results. Top 5:`);
    for (const r of results.slice(0, 5)) {
      console.log(`- ${r.item.commandName} (score: ${r.score?.toFixed(3)}):`);
      console.log(`  matches:`, JSON.stringify(r.matches, null, 2));
    }
  }
}

async function main() {
  enableConfigs();
  const cwd = process.cwd();
  const commands = await getCommands(cwd);

  const defaultKeys = [
    { name: 'commandName', weight: 3 },
    { name: 'aliasKey', weight: 2 },
  ];

  await testWithThreshold(0.5, defaultKeys, commands);
  await testWithThreshold(0.3, defaultKeys, commands);
  await testWithThreshold(0.2, defaultKeys, commands);
}

main().catch(console.error);
