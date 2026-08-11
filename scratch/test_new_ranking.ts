import Fuse from 'fuse.js';
import { getCommands, getCommandName, type Command } from '../src/commands.ts';
import { enableConfigs } from '../src/utils/config.ts';

const SEPARATORS = /[:_-]/g;

function cleanWord(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function getRenderedCommandDescription(cmd: any): string {
  return cmd.description || '';
}

function getSkillUsageScore(name: string): number {
  return 0; // Stub
}

export function generateCommandSuggestionsNew(
  input: string,
  commands: Command[],
): any[] {
  const query = input.slice(1).toLowerCase().trim();
  if (query === '') return [];

  const snapshots = commands.map(cmd => ({
    aliases: cmd.aliases,
    command: cmd,
    commandName: getCommandName(cmd),
    isHidden: Boolean(cmd.isHidden),
    renderedDescription: getRenderedCommandDescription(cmd),
  }));

  const commandData = snapshots
    .filter(snapshot => !snapshot.isHidden)
    .map(snapshot => {
      const { aliases, command, commandName, renderedDescription } = snapshot;
      return {
        descriptionKey: renderedDescription
          .split(/\s+/)
          .map(word => cleanWord(word))
          .filter(Boolean),
        commandName,
        command,
        aliasKey: aliases,
      };
    });

  const fuse = new Fuse(commandData, {
    includeScore: true,
    includeMatches: true,
    threshold: 0.4,
    location: 0,
    distance: 100,
    keys: [
      { name: 'commandName', weight: 3 },
      { name: 'aliasKey', weight: 2 },
      { name: 'descriptionKey', weight: 0.5 },
    ],
  });

  const searchResults = fuse.search(query);
  const fuseMap = new Map<Command, { score: number, matchesName: boolean }>();
  for (const r of searchResults) {
    const matchesName = r.matches?.some(m => m.key === 'commandName' || m.key === 'aliasKey') ?? false;
    fuseMap.set(r.item.command, { score: r.score ?? 1, matchesName });
  }

  const visibleCommands = commands.filter(cmd => !cmd.isHidden);
  const candidates: any[] = [];

  for (const cmd of visibleCommands) {
    const name = getCommandName(cmd).toLowerCase();
    const aliases = cmd.aliases?.map(alias => alias.toLowerCase()) ?? [];
    const usage = cmd.type === 'prompt' ? getSkillUsageScore(getCommandName(cmd)) : 0;

    let rank = 9; // Default no match
    if (name === query) {
      rank = 1;
    } else if (aliases.includes(query)) {
      rank = 2;
    } else if (name.startsWith(query)) {
      rank = 3;
    } else if (aliases.some(a => a.startsWith(query))) {
      rank = 4;
    } else if (name.includes(query)) {
      rank = 5;
    } else if (aliases.some(a => a.includes(query))) {
      rank = 6;
    } else if (fuseMap.has(cmd)) {
      const info = fuseMap.get(cmd)!;
      if (info.matchesName) {
        rank = 7; // Fuzzy match on name/aliases
      } else {
        rank = 8; // Fuzzy match on description only
      }
    }

    if (rank <= 8) {
      candidates.push({
        cmd,
        name,
        aliases,
        usage,
        rank,
        fuseScore: fuseMap.get(cmd)?.score,
      });
    }
  }

  candidates.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }

    // Rank 3: Prefix name matches
    if (a.rank === 3 && a.name.length !== b.name.length) {
      return a.name.length - b.name.length;
    }

    // Rank 4: Prefix alias matches
    if (a.rank === 4) {
      const aBestAlias = a.aliases.find(alias => alias.startsWith(query)) ?? '';
      const bBestAlias = b.aliases.find(alias => alias.startsWith(query)) ?? '';
      if (aBestAlias.length !== bBestAlias.length) {
        return aBestAlias.length - bBestAlias.length;
      }
    }

    // Rank 5: Substring name matches
    if (a.rank === 5 && a.name.length !== b.name.length) {
      return a.name.length - b.name.length;
    }

    // Rank 6: Substring alias matches
    if (a.rank === 6) {
      const aBestAlias = a.aliases.find(alias => alias.includes(query)) ?? '';
      const bBestAlias = b.aliases.find(alias => alias.includes(query)) ?? '';
      if (aBestAlias.length !== bBestAlias.length) {
        return aBestAlias.length - bBestAlias.length;
      }
    }

    // Rank 7 & 8: Fuzzy matches
    if (a.rank === 7 || a.rank === 8) {
      const scoreDiff = (a.fuseScore ?? 0) - (b.fuseScore ?? 0);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
    }

    return b.usage - a.usage;
  });

  return candidates;
}

async function main() {
  enableConfigs();
  const cwd = process.cwd();
  const commands = await getCommands(cwd);

  const testQueries = ['/mit', '/comit', '/stlye', '/cmit', '/commit', '/thme'];
  for (const q of testQueries) {
    const suggestions = generateCommandSuggestionsNew(q, commands);
    console.log(`\nQuery: "${q}" -> Found ${suggestions.length} suggestions:`);
    console.log(suggestions.slice(0, 5).map(s => `- ${getCommandName(s.cmd)} (rank: ${s.rank}, score: ${s.fuseScore?.toFixed(3)})`));
  }
}

main().catch(console.error);
