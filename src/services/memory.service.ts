import * as fs from 'fs';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { log } from '../utils/logger.js';
import { ensureConfigDir } from '../utils/env-dir.js';

export const MAX_MEMORY_ENTRIES = 100;
export const MAX_MEMORY_ENTRY_CHARS = 500;
export const MAX_MEMORY_BYTES = 64 * 1024;

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
    return ensureConfigDir();
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
      if (fs.existsSync(memoryFile)) {
        const stat = fs.lstatSync(memoryFile);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('memory.json must be a regular file');
        try { fs.chmodSync(memoryFile, 0o600); } catch { /* Best effort on non-POSIX filesystems. */ }
        this.memory = this.validateMemory(JSON.parse(fs.readFileSync(memoryFile, 'utf8')));
      }
    } catch (error) {
      log.error('memory', 'Failed to load memory: ' + String(error));
    }
  }

  private saveMemory(): void {
    this.ensureLoaded();
    try {
      this.memory.lastUpdated = new Date().toISOString();
      const target = this.memoryFile();
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
      const serialized = JSON.stringify(this.memory, null, 2);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_MEMORY_BYTES) throw new Error('Memory quota exceeded');
      try {
        fs.writeFileSync(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        fs.renameSync(temporary, target);
        try { fs.chmodSync(target, 0o600); } catch { /* Best effort on non-POSIX filesystems. */ }
      } catch (error) {
        try { fs.rmSync(temporary, { force: true }); } catch { /* Preserve the original error. */ }
        throw error;
      }
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
    const value = this.validateEntry(preference);
    if (!this.memory.preferences.includes(value)) {
      this.ensureCapacity();
      this.memory.preferences.push(value);
      this.saveMemory();
    }
  }

  public addFact(fact: string): void {
    this.ensureLoaded();
    const value = this.validateEntry(fact);
    if (!this.memory.facts.includes(value)) {
      this.ensureCapacity();
      this.memory.facts.push(value);
      this.saveMemory();
    }
  }

  public clearMemory(): void {
    this.ensureLoaded();
    this.memory = emptyMemory();
    this.saveMemory();
  }

  private validateEntry(value: unknown): string {
    if (typeof value !== 'string') throw new Error('Memory entries must be strings');
    const normalized = value.trim();
    if (!normalized || normalized.length > MAX_MEMORY_ENTRY_CHARS || /[\r\n\0-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(normalized)) {
      throw new Error(`Memory entries must be one line and at most ${MAX_MEMORY_ENTRY_CHARS} characters`);
    }
    return normalized;
  }

  private ensureCapacity(): void {
    if (this.memory.preferences.length + this.memory.facts.length >= MAX_MEMORY_ENTRIES) {
      throw new Error(`Memory is limited to ${MAX_MEMORY_ENTRIES} entries`);
    }
  }

  private validateMemory(value: unknown): UserMemory {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('memory.json has an invalid shape');
    const candidate = value as Record<string, unknown>;
    if (!Array.isArray(candidate.preferences) || !Array.isArray(candidate.facts)) throw new Error('memory.json has an invalid shape');
    if (candidate.preferences.length + candidate.facts.length > MAX_MEMORY_ENTRIES) throw new Error('memory.json exceeds the entry quota');
    const preferences = candidate.preferences.map((entry) => this.validateEntry(entry));
    const facts = candidate.facts.map((entry) => this.validateEntry(entry));
    const lastUpdated = typeof candidate.lastUpdated === 'string' && !Number.isNaN(Date.parse(candidate.lastUpdated))
      ? candidate.lastUpdated
      : new Date().toISOString();
    const validated = { preferences, facts, lastUpdated };
    if (Buffer.byteLength(JSON.stringify(validated), 'utf8') > MAX_MEMORY_BYTES) throw new Error('memory.json exceeds the byte quota');
    return validated;
  }
}

export const memoryService = new MemoryService();
