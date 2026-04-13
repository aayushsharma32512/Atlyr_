import type { PipelineState } from './state';

type StatePatch = Partial<PipelineState> | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeRecords<T extends Record<string, unknown>>(prev: T | undefined, patch: Partial<T> | undefined): T | undefined {
  if (!patch) {
    return prev ? { ...prev } : undefined;
  }

  const base: Record<string, unknown> = { ...(prev ?? {}) };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) {
      base[key] = null;
      continue;
    }

    const existing = base[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      base[key] = mergeRecords(existing as Record<string, unknown>, value as Record<string, unknown>);
    } else if (isPlainObject(value)) {
      base[key] = mergeRecords(undefined, value as Record<string, unknown>);
    } else {
      base[key] = value;
    }
  }

  return base as T;
}

function mergeImageArray(prev: Array<Record<string, unknown>> | undefined, patch: Array<Record<string, unknown>> | undefined): Array<Record<string, unknown>> | undefined {
  if (!patch) {
    return prev ? [...prev] : undefined;
  }

  const prevByUrl = new Map<string, Record<string, unknown>>();
  prev?.forEach((image) => {
    const url = typeof image?.url === 'string' ? image.url : null;
    if (url) prevByUrl.set(url, image);
  });

  const merged: Array<Record<string, unknown>> = prev ? [...prev] : [];
  const seen = new Set<string>();

  patch.forEach((incoming) => {
    const url = typeof incoming?.url === 'string' ? incoming.url : null;
    if (!url) return;

    seen.add(url);

    const incomingRecord = incoming as Record<string, unknown>;
    const shouldDelete =
      incomingRecord._delete === true ||
      incomingRecord.delete === true ||
      incomingRecord.deleted === true;

    if (shouldDelete) {
      for (let idx = merged.length - 1; idx >= 0; idx -= 1) {
        const candidate = merged[idx];
        if (typeof candidate?.url === 'string' && candidate.url === url) {
          merged.splice(idx, 1);
        }
      }
      prevByUrl.delete(url);
      return;
    }

    const existing = prevByUrl.get(url);
    if (existing) {
      const mergedImage = mergeRecords(existing, incoming);
      if (mergedImage) {
        const index = merged.findIndex((img) => typeof img?.url === 'string' && img.url === url);
        if (index >= 0) {
          merged[index] = mergedImage;
        } else {
          merged.push(mergedImage);
        }
      }
    } else {
      merged.push({ ...incoming });
    }
  });

  return merged;
}

function hasDeleteFlag(entry: Record<string, unknown>): boolean {
  return entry._delete === true || entry.delete === true || entry.deleted === true;
}

function getStringField(entry: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function mergeStringArray(prev: string[] | undefined, patch: string[] | undefined): string[] | undefined {
  if (!patch) return prev ? [...prev] : undefined;
  const merged = new Set<string>(prev ?? []);
  patch.forEach((value) => {
    if (typeof value === 'string' && value.trim()) {
      merged.add(value.trim());
    }
  });
  return Array.from(merged);
}

function mergeArrayByIdentity(
  prev: Array<Record<string, unknown>> | undefined,
  patch: Array<Record<string, unknown>> | undefined,
  identity: (entry: Record<string, unknown>) => string | undefined
): Array<Record<string, unknown>> | undefined {
  if (!patch) {
    return prev ? [...prev] : undefined;
  }

  const merged: Array<Record<string, unknown>> = prev ? [...prev] : [];
  const indexById = new Map<string, number>();
  merged.forEach((entry, idx) => {
    const id = identity(entry);
    if (id) indexById.set(id, idx);
  });

  patch.forEach((incoming) => {
    if (!incoming || typeof incoming !== 'object') return;
    const incomingRecord = incoming as Record<string, unknown>;
    const id = identity(incomingRecord);
    if (!id) {
      merged.push({ ...incomingRecord });
      return;
    }

    if (hasDeleteFlag(incomingRecord)) {
      const index = indexById.get(id);
      if (index !== undefined) {
        merged.splice(index, 1);
        indexById.delete(id);
      }
      return;
    }

    const existingIndex = indexById.get(id);
    if (existingIndex === undefined) {
      merged.push({ ...incomingRecord });
      indexById.set(id, merged.length - 1);
      return;
    }

    const existing = merged[existingIndex];
    merged[existingIndex] = isPlainObject(existing)
      ? (mergeRecords(existing as Record<string, unknown>, incomingRecord) as Record<string, unknown>)
      : { ...incomingRecord };
  });

  return merged;
}

function mergeArtifacts(
  prev: PipelineState['artifacts'] | undefined,
  patch: PipelineState['artifacts'] | undefined
): PipelineState['artifacts'] | undefined {
  if (!patch) return prev ? { ...prev } : undefined;

  const merged = mergeRecords(prev, patch) as Record<string, unknown> | undefined;
  if (!merged) return merged as PipelineState['artifacts'] | undefined;

  const prevRecord = (prev ?? {}) as Record<string, unknown>;
  const patchRecord = (patch ?? {}) as Record<string, unknown>;

  const applyArrayMerge = (
    key: string,
    merger: (prevValue: Array<Record<string, unknown>> | undefined, patchValue: Array<Record<string, unknown>> | undefined) => Array<Record<string, unknown>> | undefined
  ) => {
    const patchValue = patchRecord[key];
    if (patchValue === null) return;
    const prevValue = Array.isArray(prevRecord[key]) ? (prevRecord[key] as Array<Record<string, unknown>>) : undefined;
    const nextValue = merger(prevValue, Array.isArray(patchValue) ? (patchValue as Array<Record<string, unknown>>) : undefined);
    if (nextValue !== undefined) {
      merged[key] = nextValue;
    }
  };

  applyArrayMerge('rawImages', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, (entry) =>
      getStringField(entry, ['originalUrl', 'original_url', 'storagePath', 'storage_path'])
    )
  );
  applyArrayMerge('draftImages', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, (entry) => getStringField(entry, ['url']))
  );
  applyArrayMerge('imageClassifications', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, (entry) => getStringField(entry, ['hash', 'storagePath', 'storage_path']))
  );
  applyArrayMerge('garmentSummaryRuns', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, (entry) => getStringField(entry, ['view']))
  );
  applyArrayMerge('garmentSummaryPayloads', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, (entry) => {
      const view = getStringField(entry, ['view']);
      const createdAt = getStringField(entry, ['createdAt', 'created_at']);
      if (view && createdAt) return `${view}:${createdAt}`;
      return view ?? createdAt;
    })
  );
  applyArrayMerge('enrichRuns', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, () => 'enrich')
  );
  applyArrayMerge('ghostImages', (prevValue, patchValue) =>
    mergeArrayByIdentity(prevValue, patchValue, (entry) => getStringField(entry, ['view']))
  );

  const imageUrlsPatch = patchRecord.imageUrls;
  if (imageUrlsPatch !== null) {
    const prevUrls = Array.isArray(prevRecord.imageUrls)
      ? (prevRecord.imageUrls as string[]).filter((value): value is string => typeof value === 'string')
      : undefined;
    const patchUrls = Array.isArray(imageUrlsPatch)
      ? (imageUrlsPatch as string[]).filter((value): value is string => typeof value === 'string')
      : undefined;
    const nextUrls = mergeStringArray(prevUrls, patchUrls);
    if (nextUrls !== undefined) {
      merged.imageUrls = nextUrls;
    }
  }

  return merged as PipelineState['artifacts'];
}

export function mergePipelineState(prev: PipelineState | undefined, patch: StatePatch): PipelineState {
  if (!patch) {
    return prev ? { ...prev } : ({
      jobId: '',
      originalUrl: '',
      domain: '',
      dedupeKey: ''
    } as PipelineState);
  }

  const next: PipelineState = {
    ...(prev ?? { jobId: '', originalUrl: '', domain: '', dedupeKey: '' }),
    ...patch
  } as PipelineState;

  next.artifacts = mergeArtifacts(prev?.artifacts, patch.artifacts);
  next.flags = mergeRecords(prev?.flags, patch.flags);
  next.processed = mergeRecords(prev?.processed, patch.processed);
  if (patch?.draft) {
    const draftPrev = prev?.draft;
    const draftPatch = { ...patch.draft };
    if (Array.isArray(draftPatch.images) || draftPatch.images === undefined) {
      const mergedImages = mergeImageArray(
        Array.isArray(draftPrev?.images) ? draftPrev?.images : undefined,
        Array.isArray(draftPatch.images) ? draftPatch.images : undefined
      );
      if (mergedImages) {
        draftPatch.images = mergedImages;
      } else if (!draftPatch.images) {
        delete draftPatch.images;
      }
    }
    next.draft = mergeRecords(draftPrev, draftPatch);
  } else {
    next.draft = mergeRecords(prev?.draft, undefined);
  }
  next.review = mergeRecords(prev?.review, patch.review);
  next.pause = patch?.pause !== undefined ? patch.pause : prev?.pause;

  next.jobId = patch?.jobId ?? prev?.jobId ?? next.jobId ?? '';
  next.originalUrl = patch?.originalUrl ?? prev?.originalUrl ?? next.originalUrl ?? '';
  next.domain = patch?.domain ?? prev?.domain ?? next.domain ?? '';
  next.dedupeKey = patch?.dedupeKey ?? prev?.dedupeKey ?? next.dedupeKey ?? '';

  if (patch?.errors) next.errors = patch.errors;

  return next;
}
