/** W-124 (D-071) household jobs plugin: `jobsSystem` runs the assignments in WorldState.jobs. */
import { jobsSystem } from './system';

export { createJobsSystem, jobsSystem, JOBS_SYSTEM_ID, JOB_PARAM, RECHECK_MIN, RESUME_MARGIN, SKIP_MIN, measureJob } from './system';
export { createJobsState, healJobsState, availableCategories, JOB_STATUSES } from './state';

export const jobSystems = [jobsSystem];
