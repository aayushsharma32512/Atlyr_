import { useMemo, useState } from "react";
import { DynamicAvatarV2, type MannequinZoneName, type MannequinSegmentName } from "@/components/studio/DynamicAvatarV2";
import { DEFAULT_ZONE_SEGMENTS, MOCK_OUTFIT_ITEMS, type PreviewOutfitItem } from "./mockOutfitData";

type PreviewItemState = {
  item: PreviewOutfitItem;
  enabled: boolean;
};

const ZONE_ORDER: MannequinZoneName[] = ["top", "bottom", "shoes"];
const ZONE_LABELS: Record<MannequinZoneName, string> = {
  top: "Upper (tops & layers)",
  bottom: "Lower (bottoms & layers)",
  shoes: "Footwear",
};

export default function MannequinPreview() {
  const [containerHeight, setContainerHeight] = useState(460);
  const [gender, setGender] = useState<"male" | "female">("female");
  const [overlayMode, setOverlayMode] = useState(false);
  const [useSvgMannequin, setUseSvgMannequin] = useState(false);
  const [skinTone, setSkinTone] = useState(0.35);
  const [itemStates, setItemStates] = useState<PreviewItemState[]>(
    () => MOCK_OUTFIT_ITEMS.map((item) => ({ item, enabled: item.defaultEnabled ?? true })),
  );

  const toggleItem = (id: string, enabled: boolean) => {
    setItemStates((prev) => prev.map((entry) => (entry.item.id === id ? { ...entry, enabled } : entry)));
  };

  const moveItem = (id: string, direction: "up" | "down") => {
    setItemStates((prev) => {
      const index = prev.findIndex((entry) => entry.item.id === id);
      if (index === -1) return prev;
      const zone = prev[index].item.layerZone;
      let targetIndex = index;
      if (direction === "up") {
        for (let i = index - 1; i >= 0; i--) {
          if (prev[i].item.layerZone === zone) {
            targetIndex = i;
            break;
          }
        }
      } else {
        for (let i = index + 1; i < prev.length; i++) {
          if (prev[i].item.layerZone === zone) {
            targetIndex = i;
            break;
          }
        }
      }
      if (targetIndex === index) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  };

  const width = Math.round(containerHeight * 0.65);
  const enabledItems = useMemo(() => itemStates.filter((entry) => entry.enabled), [itemStates]);
  const clothingOpacity = overlayMode ? 0.3 : 1;

  const zoneAssetOverrides = useMemo(() => {
    const result: Partial<Record<MannequinZoneName, MannequinSegmentName[]>> = {};
    ZONE_ORDER.forEach((zone) => {
      const zoneLists = enabledItems
        .filter((entry) => entry.item.layerZone === zone)
        .map((entry) => entry.item.mannequinAssets ?? DEFAULT_ZONE_SEGMENTS[zone]);
      if (!zoneLists.length) return;
      const intersection = zoneLists.reduce<MannequinSegmentName[]>((acc, list) => {
        if (!acc.length) return list;
        return acc.filter((segment) => list.includes(segment));
      }, []);
      result[zone] = intersection.length ? intersection : zoneLists[zoneLists.length - 1];
    });
    return Object.keys(result).length ? result : undefined;
  }, [enabledItems]);

  const renderItems = useMemo(() => {
    const result: PreviewOutfitItem[] = [];
    ZONE_ORDER.forEach((zone) => {
      itemStates
        .filter((state) => state.enabled && state.item.layerZone === zone)
        .forEach((state) => result.push(state.item));
    });
    return result.map((item) => ({ ...item }));
  }, [itemStates]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-wide text-muted-foreground">Mannequin Lab</p>
          <h1 className="text-2xl font-semibold">Dynamic Avatar v2 (local assets)</h1>
          <p className="text-sm text-muted-foreground">
            Adjust the container height and gender to preview the mannequin rendering pipeline with locally stored assets.
          </p>
        </header>

        <section className="flex flex-wrap gap-6 rounded-xl border border-border/60 bg-card/60 p-4 shadow-sm">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <label className="flex items-center gap-3 text-sm font-medium">
                Container height
                <span className="text-muted-foreground">{containerHeight}px</span>
              </label>
              <input
                type="range"
                min={220}
                max={720}
                value={containerHeight}
                onChange={(event) => setContainerHeight(Number(event.target.value))}
                className="w-64"
              />
              <label className="flex items-center gap-3 text-sm font-medium">
                Gender
                <select
                  value={gender}
                  onChange={(event) => setGender(event.target.value as "male" | "female")}
                  className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                >
                  <option value="female">Female (163cm)</option>
                  <option value="male">Male (175cm)</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium">
                <div className="flex items-center justify-between">
                  <span>Skin tone</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {Math.round(skinTone * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(skinTone * 100)}
                  onChange={(event) => setSkinTone(Number(event.target.value) / 100)}
                  className="w-64"
                />
                <div className="flex justify-between text-[10px] text-muted-foreground uppercase">
                  <span>Light</span>
                  <span>Dark</span>
                </div>
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={useSvgMannequin}
                  onChange={(event) => setUseSvgMannequin(event.target.checked)}
                />
                Use SVG mannequin (skin tone aware)
              </label>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border/80 bg-background/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mock outfit layers</p>
              {ZONE_ORDER.map((zone) => {
                const zoneItems = itemStates.filter((entry) => entry.item.layerZone === zone);
                return (
                  <div key={zone} className="space-y-2 rounded-md border border-border/60 bg-card/40 p-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{ZONE_LABELS[zone]}</p>
                    {zoneItems.map(({ item, enabled }) => (
                      <div key={item.id} className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={enabled} onChange={(event) => toggleItem(item.id, event.target.checked)} />
                        <span className="text-xs font-medium">
                          {item.displayName}
                          <span className="ml-1 text-[10px] uppercase text-muted-foreground">({item.layerRole})</span>
                        </span>
                        <div className="ml-auto flex gap-1">
                          <button
                            type="button"
                            onClick={() => moveItem(item.id, "up")}
                            className="rounded-md border border-border/70 px-1 text-[10px]"
                            aria-label="Move layer up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveItem(item.id, "down")}
                            className="rounded-md border border-border/70 px-1 text-[10px]"
                            aria-label="Move layer down"
                          >
                            ↓
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={overlayMode} onChange={(event) => setOverlayMode(event.target.checked)} />
                Alignment overlay (reduce opacity)
              </label>
            </div>

            <div className="rounded-lg border border-border/80 bg-background/40 p-3 text-xs">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Visible mannequin segments</p>
              {ZONE_ORDER.map((zone) => (
                <div key={zone} className="flex items-center justify-between border-b border-border/40 py-1 last:border-b-0">
                  <span className="font-medium capitalize">{zone}</span>
                  <span className="text-muted-foreground">
                    {zoneAssetOverrides?.[zone]?.join(", ") ?? DEFAULT_ZONE_SEGMENTS[zone].join(", ")}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-1 items-center justify-center rounded-xl bg-muted/30 p-4">
            <DynamicAvatarV2
              containerHeight={containerHeight}
              containerWidth={width}
              gender={gender}
              items={renderItems.length ? (renderItems as PreviewOutfitItem[]) : undefined}
              itemOpacity={clothingOpacity}
              zoneAssetOverrides={zoneAssetOverrides}
              useSvgMannequin={useSvgMannequin}
              skinToneValue={skinTone}
            />
          </div>
        </section>
      </div>
    </div>
  );
}