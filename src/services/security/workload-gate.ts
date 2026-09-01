export class WorkloadBusyError extends Error {
  constructor(message = 'This workload is already at its concurrency limit') {
    super(message);
    this.name = 'WorkloadBusyError';
  }
}

export class WorkloadGate {
  private active = 0;

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('WorkloadGate limit must be positive');
  }

  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
    };
  }
}

export const chatWorkloadGate = new WorkloadGate(2);
export const deepScanWorkloadGate = new WorkloadGate(1);
