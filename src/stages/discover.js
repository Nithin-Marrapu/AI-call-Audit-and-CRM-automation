import { config } from "../config/index.js";

export function getDataValue(activity, key) {
  const item = activity.Data?.find(
    (entry) => String(entry.Key).toLowerCase() === key.toLowerCase()
  );
  return item?.Value ?? null;
}

const isCall = (activity) => config.callEventCodes.includes(String(activity.EventCode));

// Turns raw LeadSquared activities into recorded calls, newest first.
export function extractRecordedCalls(activities, leadId) {
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
      direction: String(activity.EventCode) === "21" ? "inbound" : "outbound"
    }))
    .filter((call) => call.resourceUrl)
    .sort((a, b) => new Date(b.createdOn) - new Date(a.createdOn));
}

// How many phone calls a lead has, with and without a recording link,
// so "no recording found" can say why.
export function countCalls(activities) {
  const calls = (activities || []).filter(isCall);
  const recorded = calls.filter((a) => getDataValue(a, "ResourceUrl")).length;
  return { calls: calls.length, recorded };
}
