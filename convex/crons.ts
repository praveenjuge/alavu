import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.hourly(
  "materialize recurring rules",
  { minuteUTC: 5 },
  internal.recurring.materializeDue,
  {},
);

export default crons;
