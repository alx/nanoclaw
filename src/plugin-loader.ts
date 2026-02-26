/**
 * Plugin Loader
 *
 * Scans two plugin directories:
 *   plugins/           — bundled, tracked in repo
 *   .nanoclaw/plugins/ — user-local, gitignored, never conflicts with upstream
 *
 * Plugin layout:
 *   plugins/{name}/hooks/env-vars.env          KEY=${env:VAR} lines
 *   plugins/{name}/hooks/entrypoint-steps.sh   sourced in container entrypoint
 *   plugins/{name}/hooks/startup-tasks.json    tasks seeded into DB on startup
 *   plugins/{name}/skills/{skill}/SKILL.md     synced into each group's .claude/skills/
 */
import fs from 'fs';
import path from 'path';

import { readEnvFile } from './env.js';

const PLUGIN_DIRS = ['plugins', '.nanoclaw/plugins'];

function* iterPlugins(): Generator<string> {
  for (const relDir of PLUGIN_DIRS) {
    const absDir = path.join(process.cwd(), relDir);
    if (!fs.existsSync(absDir)) continue;
    for (const name of fs.readdirSync(absDir)) {
      const pluginPath = path.join(absDir, name);
      if (fs.statSync(pluginPath).isDirectory()) yield pluginPath;
    }
  }
}

/**
 * Reads hooks/env-vars.env from all plugins and returns a merged map of
 * KEY → value. Entries that resolve to an empty string are skipped so
 * plugins opt-in only when the underlying variable is configured.
 *
 * Syntax: KEY=${env:VAR_NAME}
 * VAR_NAME is looked up in process.env then .env file.
 */
export function getPluginEnvVars(): Record<string, string> {
  const result: Record<string, string> = {};

  for (const pluginPath of iterPlugins()) {
    const envFile = path.join(pluginPath, 'hooks', 'env-vars.env');
    if (!fs.existsSync(envFile)) continue;

    const content = fs.readFileSync(envFile, 'utf-8');

    // Collect all ${env:VAR} names so we can batch-read from .env
    const varNames: string[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      for (const m of trimmed.matchAll(/\$\{env:([^}]+)\}/g)) {
        varNames.push(m[1]);
      }
    }
    const envValues = readEnvFile(varNames);

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.slice(0, eqIdx).trim();
      const tpl = trimmed.slice(eqIdx + 1).trim();

      const value = tpl.replace(/\$\{env:([^}]+)\}/g, (_, varName: string) =>
        process.env[varName] ?? envValues[varName] ?? '',
      );

      if (value) result[key] = value;
    }
  }

  return result;
}

export interface PluginStartupTask {
  id: string;
  group_folder: string;
  prompt: string;
  schedule_type: string;
  schedule_value: string;
  context_mode: string;
}

interface RawStartupTask {
  id: string;
  group_folder: string;
  prompt?: string;
  prompt_template?: string;
  schedule_type: string;
  schedule_value: string;
  context_mode?: string;
  requireEnv?: string[];
}

/**
 * Reads hooks/startup-tasks.json from all plugins and returns resolved task
 * definitions. Tasks with unmet requireEnv conditions are filtered out.
 *
 * schedule_value supports a relative shorthand: "+7d" expands to an ISO date
 * 7 days from now. {{today}} in prompt_template is replaced with YYYY-MM-DD.
 */
export function getPluginStartupTasks(): PluginStartupTask[] {
  const tasks: PluginStartupTask[] = [];

  for (const pluginPath of iterPlugins()) {
    const tasksFile = path.join(pluginPath, 'hooks', 'startup-tasks.json');
    if (!fs.existsSync(tasksFile)) continue;

    let rawTasks: RawStartupTask[];
    try {
      rawTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
    } catch {
      continue; // skip malformed JSON
    }

    for (const raw of rawTasks) {
      // Filter by requireEnv conditions
      if (raw.requireEnv?.length) {
        const envValues = readEnvFile(raw.requireEnv);
        const satisfied = raw.requireEnv.every(
          (v) => process.env[v] || envValues[v],
        );
        if (!satisfied) continue;
      }

      // Resolve relative schedule_value: "+7d" → ISO date 7 days from now
      let scheduleValue = raw.schedule_value;
      const relMatch = scheduleValue.match(/^\+(\d+)d$/);
      if (relMatch) {
        const days = parseInt(relMatch[1], 10);
        scheduleValue = new Date(
          Date.now() + days * 24 * 60 * 60 * 1000,
        ).toISOString();
      }

      // Resolve prompt template tokens
      const today = new Date().toISOString().split('T')[0];
      const prompt = (raw.prompt_template ?? raw.prompt ?? '').replace(
        /\{\{today\}\}/g,
        today,
      );

      tasks.push({
        id: raw.id,
        group_folder: raw.group_folder,
        prompt,
        schedule_type: raw.schedule_type,
        schedule_value: scheduleValue,
        context_mode: raw.context_mode ?? 'isolated',
      });
    }
  }

  return tasks;
}
