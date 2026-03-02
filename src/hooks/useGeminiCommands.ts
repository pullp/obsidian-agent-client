/**
 * Hook for auto-detecting Gemini CLI custom commands.
 *
 * Scans `.gemini/commands/` directory in the vault for `.toml` command
 * definition files and converts them to SlashCommand format.
 *
 * Gemini CLI custom commands are TOML files with:
 * - `description` (optional): one-line description
 * - `prompt` (required): the prompt template
 *
 * Command names are derived from file paths relative to the commands directory:
 * - `test.toml` → "test"
 * - `git/commit.toml` → "git:commit"
 *
 * Only active when the current agent is Gemini CLI.
 */

import { useState, useEffect } from "react";
import type { SlashCommand } from "../domain/models/chat-session";
import { getLogger } from "../shared/logger";

// Node.js fs/path available in Obsidian's Electron environment
import * as fs from "fs";
import * as path from "path";

const GEMINI_COMMANDS_DIR = ".gemini/commands";
const GEMINI_AGENT_ID = "gemini-cli";

/**
 * Recursively find all .toml files in a directory.
 *
 * @param dir - Directory to search
 * @returns Array of absolute paths to .toml files
 */
async function findTomlFiles(dir: string): Promise<string[]> {
	const results: string[] = [];

	try {
		const entries = await fs.promises.readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				const nested = await findTomlFiles(fullPath);
				results.push(...nested);
			} else if (entry.isFile() && entry.name.endsWith(".toml")) {
				results.push(fullPath);
			}
		}
	} catch {
		// Directory doesn't exist or can't be read - return empty
	}

	return results;
}

/**
 * Extract the `description` field from a TOML file content.
 *
 * Uses a minimal parser to avoid adding a TOML library dependency.
 * Handles both single-line strings (quoted with " or ') and basic values.
 *
 * @param content - TOML file content
 * @returns The description string, or null if not found
 */
function extractDescription(content: string): string | null {
	const lines = content.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();

		// Match: description = "..." or description = '...'
		const match = trimmed.match(
			/^description\s*=\s*(?:"([^"]*?)"|'([^']*?)')\s*$/,
		);

		if (match) {
			return match[1] ?? match[2] ?? null;
		}
	}

	return null;
}

/**
 * Derive the command name from a .toml file path relative to the commands directory.
 *
 * Strips the `.toml` extension and converts path separators to colons.
 * Example: "git/commit.toml" → "git:commit"
 *
 * @param filePath - Absolute path to the .toml file
 * @param commandsDir - Absolute path to the commands directory
 * @returns Command name string
 */
function deriveCommandName(filePath: string, commandsDir: string): string {
	const relative = path.relative(commandsDir, filePath);
	// Remove .toml extension and convert path separators to colons
	const withoutExt = relative.replace(/\.toml$/, "");
	return withoutExt.split(path.sep).join(":");
}

/**
 * Scan the .gemini/commands directory and return SlashCommand array.
 *
 * @param vaultPath - Root path of the Obsidian vault
 * @returns Array of SlashCommand objects
 */
async function scanGeminiCommands(vaultPath: string): Promise<SlashCommand[]> {
	const logger = getLogger();
	const commandsDir = path.join(vaultPath, GEMINI_COMMANDS_DIR);

	try {
		// Check if directory exists
		await fs.promises.access(commandsDir);
	} catch {
		// Directory doesn't exist - return empty
		return [];
	}

	const tomlFiles = await findTomlFiles(commandsDir);
	const commands: SlashCommand[] = [];

	for (const filePath of tomlFiles) {
		try {
			const content = await fs.promises.readFile(filePath, "utf-8");
			const name = deriveCommandName(filePath, commandsDir);
			const description =
				extractDescription(content) || `Custom command: ${name}`;

			commands.push({
				name,
				description,
				hint: null,
			});
		} catch (error) {
			logger.warn(
				`[useGeminiCommands] Failed to read command file: ${filePath}`,
				error,
			);
		}
	}

	logger.log(
		`[useGeminiCommands] Found ${commands.length} Gemini custom commands`,
	);
	return commands;
}

/**
 * Hook for auto-detecting Gemini CLI custom commands.
 *
 * Scans `.gemini/commands/` in the vault directory for `.toml` files
 * and returns them as `SlashCommand[]`. Only active when the current
 * agent is Gemini CLI; returns empty array for other agents.
 *
 * @param vaultPath - Root path of the Obsidian vault
 * @param agentId - Current agent ID from session
 * @returns Array of locally-detected Gemini custom commands
 */
export function useGeminiCommands(
	vaultPath: string,
	agentId: string,
): SlashCommand[] {
	const [commands, setCommands] = useState<SlashCommand[]>([]);

	useEffect(() => {
		// Only scan for Gemini CLI agent
		if (agentId !== GEMINI_AGENT_ID) {
			setCommands([]);
			return;
		}

		let cancelled = false;

		void scanGeminiCommands(vaultPath).then((result) => {
			if (!cancelled) {
				setCommands(result);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [vaultPath, agentId]);

	return commands;
}
