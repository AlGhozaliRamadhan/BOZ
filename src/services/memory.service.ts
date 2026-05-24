import * as fs from 'fs';
import * as path from 'path';
import { log } from '../utils/logger.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const MEMORY_FILE = path.join(DATA_DIR, 'memory.json');

export interface UserMemory {
  preferences: string[];
  facts: string[];
  lastUpdated: string;
}

export class MemoryService {
  private memory: UserMemory = { preferences: [], facts: [], lastUpdated: new Date().toISOString() };

  constructor() {
    this.ensureDataDir();
    this.loadMemory();
  }

  private ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        log.error('memory', `Failed to create data directory: ${err}`);
      }
    }
  }

  private loadMemory() {
    if (fs.existsSync(MEMORY_FILE)) {
      try {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        this.memory = JSON.parse(raw);
      } catch (err) {
        log.error('memory', `Failed to load memory file: ${err}`);
      }
    }
  }

  private saveMemory() {
    try {
      this.memory.lastUpdated = new Date().toISOString();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2));
    } catch (err) {
      log.error('memory', `Failed to save memory file: ${err}`);
    }
  }

  public getMemory(): UserMemory {
    return { ...this.memory };
  }

  public addPreference(pref: string) {
    if (!this.memory.preferences.includes(pref)) {
      this.memory.preferences.push(pref);
      this.saveMemory();
    }
  }

  public addFact(fact: string) {
    if (!this.memory.facts.includes(fact)) {
      this.memory.facts.push(fact);
      this.saveMemory();
    }
  }

  public clearMemory() {
    this.memory = { preferences: [], facts: [], lastUpdated: new Date().toISOString() };
    this.saveMemory();
  }
}

export const memoryService = new MemoryService();
