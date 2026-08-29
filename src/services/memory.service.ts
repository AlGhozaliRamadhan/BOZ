import * as fs from 'fs';
import * as path from 'path';
import { log } from '../utils/logger.js';

export interface UserMemory {
  preferences: string[];
  facts: string[];
  lastUpdated: string;
}

function emptyMemory(): UserMemory {
  return {
    preferences: [],
    facts: [],
    lastUpdated: new Date().toISOString(),
  };
}

export class MemoryService {
  private memory: UserMemory = emptyMemory();
  private loaded = false;

  private configDir(): string {
    const configured = process.env.BOZ_CONFIG_DIR?.trim();
    if (configured) return path.resolve(configured);

    const userHome = process.env.USERPROFILE || process.env.HOME;
    return path.resolve(userHome || process.cwd(), '.boz');
  }

  private memoryFile(): string {
    return path.join(this.configDir(), 'memory.json');
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;

    const configDir = this.configDir();
    const memoryFile = this.memoryFile();

    try {
      fs.mkdirSync(configDir, { recursive: true });
      if (fs.existsSync(memoryFile)) {
        this.memory = JSON.parse(fs.readFileSync(memoryFile, 'utf8'));
      }
    } catch (error) {
      log.error('memory', 'Failed to load memory: ' + String(error));
    }
  }

  private saveMemory(): void {
    this.ensureLoaded();
    try {
      this.memory.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.memoryFile(), JSON.stringify(this.memory, null, 2));
    } catch (error) {
      log.error('memory', 'Failed to save memory: ' + String(error));
    }
  }

  public getMemory(): UserMemory {
    this.ensureLoaded();
    return {
      ...this.memory,
      preferences: [...this.memory.preferences],
      facts: [...this.memory.facts],
    };
  }

  public addPreference(preference: string): void {
    this.ensureLoaded();
    if (!this.memory.preferences.includes(preference)) {
      this.memory.preferences.push(preference);
      this.saveMemory();
    }
  }

  public addFact(fact: string): void {
    this.ensureLoaded();
    if (!this.memory.facts.includes(fact)) {
      this.memory.facts.push(fact);
      this.saveMemory();
    }
  }

  public clearMemory(): void {
    this.ensureLoaded();
    this.memory = emptyMemory();
    this.saveMemory();
  }
}

export const memoryService = new MemoryService();
