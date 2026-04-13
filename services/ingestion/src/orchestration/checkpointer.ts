import { Buffer } from 'node:buffer';
import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointTuple,
  WRITES_IDX_MAP,
  getCheckpointId,
  maxChannelVersion,
  TASKS
} from '@langchain/langgraph-checkpoint';
import type { CheckpointMetadata, PendingWrite } from '@langchain/langgraph-checkpoint';
import { supabaseAdmin } from '../db/supabase';
import { readState } from '../domain/state-store';

const TABLE = 'ingestion_job_state';

type EncodedValue = { type: string; data: string };

type StoredCheckpointEntry = {
  checkpoint: EncodedValue;
  metadata: EncodedValue;
  parent?: string;
};

type StoredWrites = Record<string, { taskId: string; channel: string; value: EncodedValue }>;

type StoredNamespace = {
  latest?: string;
  checkpoints: Record<string, StoredCheckpointEntry>;
  writes: Record<string, StoredWrites>;
};

type StoredCheckpointEnvelope = {
  version: 1;
  namespaces: Record<string, StoredNamespace>;
};

const textDecoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCheckpointId(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function encodeTypedValue(type: string, data: Uint8Array): EncodedValue {
  if (type === 'json') {
    return { type, data: textDecoder.decode(data) };
  }
  return { type, data: Buffer.from(data).toString('base64') };
}

function decodeTypedValue(encoded: EncodedValue): string | Uint8Array {
  if (encoded.type === 'json') {
    return encoded.data;
  }
  return Buffer.from(encoded.data, 'base64');
}

function normalizeEnvelope(value: unknown): StoredCheckpointEnvelope {
  if (!isRecord(value)) {
    return { version: 1, namespaces: {} };
  }
  const rawNamespaces = isRecord(value.namespaces) ? value.namespaces : {};
  const namespaces: Record<string, StoredNamespace> = {};

  for (const [ns, entry] of Object.entries(rawNamespaces)) {
    if (!isRecord(entry)) continue;
    const checkpoints = isRecord(entry.checkpoints) ? entry.checkpoints : {};
    const writes = isRecord(entry.writes) ? entry.writes : {};
    namespaces[ns] = {
      latest: typeof entry.latest === 'string' ? entry.latest : undefined,
      checkpoints: checkpoints as Record<string, StoredCheckpointEntry>,
      writes: writes as Record<string, StoredWrites>
    };
  }

  return {
    version: 1,
    namespaces
  };
}

async function loadEnvelope(threadId: string): Promise<StoredCheckpointEnvelope | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('checkpoint')
    .eq('job_id', threadId)
    .maybeSingle();

  if (error) throw error;
  if (!data || !data.checkpoint) return null;
  return normalizeEnvelope(data.checkpoint as unknown);
}

async function saveEnvelope(threadId: string, envelope: StoredCheckpointEnvelope): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ checkpoint: envelope })
    .eq('job_id', threadId)
    .select('job_id');

  if (error) throw error;
  if (data && data.length > 0) return;

  const state = await readState(threadId);
  if (!state) {
    throw new Error(`checkpoint-missing-state:${threadId}`);
  }
  const { error: upsertError } = await supabaseAdmin
    .from(TABLE)
    .upsert({ job_id: threadId, currentstate: state, checkpoint: envelope, updated_at: new Date().toISOString() });

  if (upsertError) throw upsertError;
}

function ensureNamespace(envelope: StoredCheckpointEnvelope, namespace: string): StoredNamespace {
  if (!envelope.namespaces[namespace]) {
    envelope.namespaces[namespace] = { checkpoints: {}, writes: {} };
  }
  return envelope.namespaces[namespace];
}

export class SupabaseCheckpointSaver extends BaseCheckpointSaver {
  async _migratePendingSends(
    mutableCheckpoint: Checkpoint,
    namespaceEntry: StoredNamespace,
    parentCheckpointId: string
  ): Promise<void> {
    const parentWrites = namespaceEntry.writes[parentCheckpointId];
    if (!parentWrites) return;

    const pendingSends = await Promise.all(
      Object.values(parentWrites)
        .filter((entry) => entry.channel === TASKS)
        .map(async (entry) => {
          const decoded = decodeTypedValue(entry.value);
          return this.serde.loadsTyped(entry.value.type, decoded);
        })
    );

    mutableCheckpoint.channel_values ??= {};
    mutableCheckpoint.channel_values[TASKS] = pendingSends;
    mutableCheckpoint.channel_versions ??= {};
    mutableCheckpoint.channel_versions[TASKS] =
      Object.keys(mutableCheckpoint.channel_versions).length > 0
        ? maxChannelVersion(...Object.values(mutableCheckpoint.channel_versions))
        : this.getNextVersion(undefined);
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return undefined;
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = normalizeCheckpointId(getCheckpointId(config));

    const envelope = await loadEnvelope(threadId);
    if (!envelope) return undefined;

    const namespaceEntry = envelope.namespaces[checkpointNamespace];
    if (!namespaceEntry) return undefined;

    const resolvedId = checkpointId ?? namespaceEntry.latest;
    if (!resolvedId) return undefined;

    const stored = namespaceEntry.checkpoints[resolvedId];
    if (!stored) return undefined;

    const checkpointDecoded = decodeTypedValue(stored.checkpoint);
    const metadataDecoded = decodeTypedValue(stored.metadata);
    const deserializedCheckpoint = await this.serde.loadsTyped(stored.checkpoint.type, checkpointDecoded);

    if (deserializedCheckpoint.v < 4 && stored.parent) {
      await this._migratePendingSends(deserializedCheckpoint, namespaceEntry, stored.parent);
    }

    const pendingWritesRaw = namespaceEntry.writes[resolvedId] ?? {};
    const pendingWrites = await Promise.all(
      Object.values(pendingWritesRaw).map(async (entry) => {
        const decoded = decodeTypedValue(entry.value);
        return [
          entry.taskId,
          entry.channel,
          await this.serde.loadsTyped(entry.value.type, decoded),
        ] as [string, string, unknown];
      })
    );

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: resolvedId
        }
      },
      checkpoint: deserializedCheckpoint,
      metadata: await this.serde.loadsTyped(stored.metadata.type, metadataDecoded),
      pendingWrites
    };

    if (stored.parent) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNamespace,
          checkpoint_id: stored.parent
        }
      };
    }

    return tuple;
  }

  async *list(config: RunnableConfig, options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const { before, limit, filter } = options ?? {};
    const threadId = config.configurable?.thread_id;
    if (!threadId) return;

    const envelope = await loadEnvelope(threadId);
    if (!envelope) return;

    const configNamespace = config.configurable?.checkpoint_ns;
    const configCheckpointId = normalizeCheckpointId(config.configurable?.checkpoint_id);

    for (const [namespace, namespaceEntry] of Object.entries(envelope.namespaces)) {
      if (configNamespace !== undefined && namespace !== configNamespace) continue;

      const checkpointEntries = Object.entries(namespaceEntry.checkpoints).sort((a, b) => b[0].localeCompare(a[0]));
      let remaining = limit;

      for (const [checkpointId, stored] of checkpointEntries) {
        if (configCheckpointId && checkpointId !== configCheckpointId) continue;
        if (before?.configurable?.checkpoint_id && checkpointId >= before.configurable.checkpoint_id) continue;

        const metadataDecoded = decodeTypedValue(stored.metadata);
        const metadata = await this.serde.loadsTyped(stored.metadata.type, metadataDecoded);
        if (filter && !Object.entries(filter).every(([key, value]) => (metadata as Record<string, unknown>)[key] === value)) {
          continue;
        }

        if (remaining !== undefined) {
          if (remaining <= 0) return;
          remaining -= 1;
        }

        const checkpointDecoded = decodeTypedValue(stored.checkpoint);
        const deserializedCheckpoint = await this.serde.loadsTyped(stored.checkpoint.type, checkpointDecoded);

        if (deserializedCheckpoint.v < 4 && stored.parent) {
          await this._migratePendingSends(deserializedCheckpoint, namespaceEntry, stored.parent);
        }

        const pendingWritesRaw = namespaceEntry.writes[checkpointId] ?? {};
        const pendingWrites = await Promise.all(
          Object.values(pendingWritesRaw).map(async (entry) => {
            const decoded = decodeTypedValue(entry.value);
            return [
              entry.taskId,
              entry.channel,
              await this.serde.loadsTyped(entry.value.type, decoded),
            ] as [string, string, unknown];
          })
        );

        const tuple: CheckpointTuple = {
          config: {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: namespace,
              checkpoint_id: checkpointId
            }
          },
          checkpoint: deserializedCheckpoint,
          metadata,
          pendingWrites
        };

        if (stored.parent) {
          tuple.parentConfig = {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: namespace,
              checkpoint_id: stored.parent
            }
          };
        }

        yield tuple;
      }
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions?: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error('checkpoint-missing-thread-id');
    }
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? '';
    const envelope = (await loadEnvelope(threadId)) ?? { version: 1, namespaces: {} };
    const namespaceEntry = ensureNamespace(envelope, checkpointNamespace);

    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    namespaceEntry.checkpoints[checkpoint.id] = {
      checkpoint: encodeTypedValue(checkpointType, checkpointBytes),
      metadata: encodeTypedValue(metadataType, metadataBytes),
      parent: normalizeCheckpointId(config.configurable?.checkpoint_id)
    };
    namespaceEntry.latest = checkpoint.id;

    await saveEnvelope(threadId, envelope);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNamespace,
        checkpoint_id: checkpoint.id
      }
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = config.configurable?.thread_id;
    const checkpointNamespace = config.configurable?.checkpoint_ns ?? '';
    const checkpointId = normalizeCheckpointId(config.configurable?.checkpoint_id);

    if (!threadId) {
      throw new Error('checkpoint-missing-thread-id');
    }
    if (!checkpointId) {
      throw new Error('checkpoint-missing-id');
    }

    const envelope = (await loadEnvelope(threadId)) ?? { version: 1, namespaces: {} };
    const namespaceEntry = ensureNamespace(envelope, checkpointNamespace);
    const writesForCheckpoint = namespaceEntry.writes[checkpointId] ?? {};

    await Promise.all(writes.map(async ([channel, value], idx) => {
      const [valueType, serialized] = await this.serde.dumpsTyped(value);
      const innerKey = `${taskId},${WRITES_IDX_MAP[channel] ?? idx}`;
      const numericIndex = WRITES_IDX_MAP[channel] ?? idx;

      if (numericIndex >= 0 && innerKey in writesForCheckpoint) {
        return;
      }

      writesForCheckpoint[innerKey] = {
        taskId,
        channel,
        value: encodeTypedValue(valueType, serialized)
      };
    }));

    namespaceEntry.writes[checkpointId] = writesForCheckpoint;
    await saveEnvelope(threadId, envelope);
  }

  async deleteThread(threadId: string): Promise<void> {
    const { error } = await supabaseAdmin
      .from(TABLE)
      .update({ checkpoint: null })
      .eq('job_id', threadId);

    if (error) throw error;
  }
}

export const checkpointSaver = new SupabaseCheckpointSaver();
