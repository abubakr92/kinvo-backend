import { Worker } from 'bullmq';

import { ALL_MODES } from '@modules/modes/modes.service';
import { generateDeck, usersNeedingDecks } from '@modules/discovery/deck.service';
import { sweepExpiredMatches } from '@modules/matches/matches.service';
import { sendPlanReminders } from '@modules/notifications/reminders.service';
import { logger } from '@utils/logger';
import { QUEUE_NAMES, type DeckGenerationJob, getDeckQueue, jobConnection } from './queues';

/**
 * Daily deck precompute (spec §5.3, Batch 7).
 *
 * This is an OPTIMISATION, not a dependency. `getDeck` generates lazily when
 * today's deck is missing, so a worker that is down, behind, or never deployed
 * costs latency on first open and nothing else. Building it the other way round
 * — an empty deck when the job has not run — would make a queue outage look
 * like an empty product.
 */

/** The repeatable job that fans out into one job per user per mode. */
export const SCHEDULER_JOB_NAME = 'enqueue-daily-decks';

/** The half-hourly plan-reminder sweep. */
export const REMINDER_JOB_NAME = 'send-plan-reminders';

let worker: Worker<DeckGenerationJob> | null = null;

export function startDeckWorker(): Worker<DeckGenerationJob> {
  if (worker) {
    return worker;
  }

  worker = new Worker<DeckGenerationJob>(
    QUEUE_NAMES.DECK_GENERATION,
    async (job) => {
      // The scheduler fans out on the same queue it feeds, so the job NAME is
      // what separates "enqueue everyone" from "build one deck". Without this
      // branch the repeatable job arrives with empty data and the worker tries
      // to build a deck for an undefined user.
      if (job.name === REMINDER_JOB_NAME) {
        return { reminded: await sendPlanReminders() };
      }

      if (job.name === SCHEDULER_JOB_NAME) {
        // Bookkeeping only: `isExpired` already treats a lapsed match as
        // expired at read time, so this job being late or never running
        // changes nothing a user can see. It exists so admin lists and
        // analytics can filter on the column.
        const [enqueued, expired] = await Promise.all([enqueueDailyDecks(), sweepExpiredMatches()]);
        return { enqueued, expired };
      }

      const { user_id, mode } = job.data;
      return generateDeck(user_id, mode);
    },
    {
      connection: jobConnection(),
      // Deck generation runs a PostGIS radius search per job. Too much
      // concurrency here starves the API's own connection pool, which is the
      // path a user is actually waiting on.
      concurrency: 4,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error({ err: error, job_id: job?.id, data: job?.data }, 'deck generation failed');
  });

  return worker;
}

export async function stopDeckWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

/**
 * Enqueues tomorrow's decks for everyone with a mode enabled.
 *
 * The job id is `{user}:{mode}:{utc-day}` so a scheduler that fires twice — or
 * two instances that both fire — enqueue the same id and BullMQ keeps one.
 * Without that, every user's deck would be built once per running instance.
 */
export async function enqueueDailyDecks(now: Date = new Date()): Promise<number> {
  const queue = getDeckQueue();
  const day = now.toISOString().slice(0, 10);
  let enqueued = 0;

  for (const mode of ALL_MODES) {
    const userIds = await usersNeedingDecks(mode);

    if (userIds.length === 0) {
      continue;
    }

    await queue.addBulk(
      userIds.map((user_id) => ({
        name: 'generate',
        data: { user_id, mode },
        opts: { jobId: `${user_id}:${mode}:${day}` },
      })),
    );

    enqueued += userIds.length;
  }

  logger.info({ enqueued, day }, 'daily decks enqueued');

  return enqueued;
}
