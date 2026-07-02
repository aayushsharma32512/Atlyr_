import type PgBoss from 'pg-boss';
import { config } from '../config/index';
import { dispatch } from '../orchestration/dispatcher';
import { setBoss } from '../orchestration/advance-and-trigger';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'worker' });

export function startWorker(boss: PgBoss): void {
  setBoss(boss);

  boss.work(
    'run-pipeline-step',
    { teamSize: config.BOSS_TEAM_SIZE },
    async (job) => {
      const { jobId } = job.data as { jobId: string };
      logger.info({ jobId }, 'dispatching pipeline step');
      await dispatch(jobId);
    }
  );

  logger.info({ teamSize: config.BOSS_TEAM_SIZE }, 'pipeline worker registered');
}
