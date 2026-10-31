import { STATUS } from "./db/jobStore.js";
import { syncCall } from "./pipeline.js";
import { validateAnalysis } from "./stages/validate.js";
import { changedFields } from "./accuracy.js";

function reviewable(job) {
  if (!job) throw new Error("No such call.");
  if (job.stage === STATUS.SYNCED) throw new Error("Already sent to the CRM.");
  if (!job.analysis) throw new Error("Call has not been analyzed yet.");
}

// Approves a call, optionally with the reviewer's edits, then sends it
// to the CRM. Edits go through the same validation as AI output.
export async function approveCall(store, activityId, { crm, edited, log }) {
  const job = store.get(activityId);
  reviewable(job);

  const final = edited ? validateAnalysis(edited, job.transcript ?? "").analysis : job.analysis;
  const action = changedFields(job.analysis, final).length ? "edited" : "approved";
  store.saveReview(activityId, action, final);
  return syncCall(store, activityId, { crm, log });
}

export function rejectCall(store, activityId) {
  const job = store.get(activityId);
  reviewable(job);
  store.saveReview(activityId, "rejected", null);
  return store.get(activityId);
}
