// Raised when someone presses Stop. Not a failure: the call keeps its
// progress and can be resumed later.
export class StoppedError extends Error {
  constructor() {
    super("Stopped by user");
    this.stopped = true;
  }
}

export function checkStop(signal) {
  if (signal?.aborted) throw new StoppedError();
}
