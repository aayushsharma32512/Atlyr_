import type { BossHandle } from './boss';
import { config } from '../config/index';
import { dispatch } from '../orchestration/dispatcher';
import { setBoss } from '../orchestration/advance-and-trigger';
import { PIPELINE_QUEUE, MODAL_QUEUE } from './send-step';
import { createLogger } from '../utils/logger';

const logger = createLogger({ stage: 'worker' });

export function startWorker(boss: BossHandle): void {
  setBoss(boss);

  const handler = async (job: { data: unknown }) => {
    const { jobId } = job.data as { jobId: string };
    logger.info({ jobId }, 'dispatching pipeline step');
    await dispatch(jobId);
  };

  // Two queues, one handler. Fast steps (scrape/identify/summary/vton) and Modal-driven steps
  // (segmenting, placement) get separate slot pools so a pile-up of multi-minute GPU waits can't
  // starve the fast lane. dispatch() reads current_state from the DB, so which queue delivered
  // the message never changes what runs.
  //
  // teamConcurrency + teamRefill are load-bearing: pg-boss v9's bare teamSize fetches a batch
  // and will not fetch again until the WHOLE batch completes — one slow handler (a VTON call
  // walking the model/route fallback chain can legitimately run 10+ minutes) then starves the
  // entire queue. teamRefill re-fills each slot as its member finishes instead.
  const teamOpts = (teamSize: number) => ({ teamSize, teamConcurrency: teamSize, teamRefill: true });
  boss.work(PIPELINE_QUEUE, teamOpts(config.BOSS_TEAM_SIZE), handler);
  boss.work(MODAL_QUEUE, teamOpts(config.BOSS_MODAL_TEAM_SIZE), handler);

  logger.info(
    { teamSize: config.BOSS_TEAM_SIZE, modalTeamSize: config.BOSS_MODAL_TEAM_SIZE },
    'pipeline workers registered',
  );
}
