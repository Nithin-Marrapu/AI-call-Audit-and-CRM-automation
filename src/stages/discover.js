import { config } from "../config/index.js";

export function getDataValue(activity, key) {
  const item = activity.Data?.find(
    (entry) => String(entry.Key).toLowerCase() === key.toLowerCase()
  );
  return item?.Value ?? null;
}

const isCall = (activity) => config.callEventCodes.includes(String(activity.EventCode));

// Every phone call on a lead (answered or not), newest first. Unanswered
// calls have no recording; their status still tells us "RNR".
export function extractCalls(activities, leadId) {
  return (activities || [])
    .filter(isCall)
    .map((activity) => ({
      activityId: String(activity.Id),
      leadId,
      sessionId: activity.SessionId ?? null,
      createdOn: activity.CreatedOn ?? null,
      resourceUrl: getDataValue(activity, "ResourceUrl"),
      duration: getDataValue(activity, "Duration"),
      callType: getDataValue(activity, "CallType"),
      direction: String(activity.EventCode) === "21" ? "inbound" : "outbound",
      dialerStatus: activity.ActivityFields?.Status ?? getDataValue(activity, "Status") ?? activity.Status ?? null
    }))
    .sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
}

// Calls with a recording, newest first.
export function extractRecordedCalls(activities, leadId) {
  return extractCalls(activities, leadId).filter((call) => call.resourceUrl);
}

// How many phone calls a lead has, with and without a recording link,
// so "no recording found" can say why.
export function countCalls(activities) {
  const calls = (activities || []).filter(isCall);
  const recorded = calls.filter((a) => getDataValue(a, "ResourceUrl")).length;
  return { calls: calls.length, recorded };
}
