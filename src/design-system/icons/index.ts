// One icon per meaning. Import Icons.* here, never lucide-react directly.
// Sizes come from ICON in ../tokens: 20 in bars, 16 in rows, 14 in chips.
import {
  Bell,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Compass,
  Folders,
  Globe,
  Layers,
  LayoutGrid,
  Link,
  ListFilter,
  Maximize2,
  Pin,
  Plus,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Share,
  ArrowUpDown,
  ArrowUpRight,
  Shirt,
  Sparkles,
  SquareUserRound,
  Trash2,
  Undo2,
  UserRound,
  X,
} from "lucide-react";

import { BottomsGlyph, HangerGlyph, ShoeGlyph } from "./glyphs";

export const Icons = {
  // design.md's table says Bookmark, but DESIGN_NOTES #8 says pin and the
  // bundle's OutfitCard/ProductCard both draw the Pin path. Filled = saved.
  save: Pin,

  tryOn: SquareUserRound,
  findItems: Globe, // replaces "Buy" everywhere
  share: Share,

  undo: Undo2,
  redo: Redo2,
  restore: RotateCcw,
  similar: RefreshCw, // "more like this piece" — image-similarity search
  swap: ArrowUpDown, // layer row: which of the two tops is on top
  alternatives: LayoutGrid,

  slotTop: Shirt,
  slotBottom: BottomsGlyph,
  slotShoes: ShoeGlyph,
  slotLayer: Layers, // [P2], nothing sets it

  // Alternatives sources.
  // A hanger, not Shirt: Shirt is the `top` slot, and the two segments sit one
  // above the other on Alternates — the same glyph twice read as a doubled rail.
  sourceWardrobe: HangerGlyph,
  sourceSaves: Pin,
  sourceExplore: Compass, // Globe is taken by Find items — one icon per meaning

  addInspiration: Link,
  add: Plus,

  // Nav: Collections · Search · Studio · Notifications · Profile
  navCollections: Folders,
  navSearch: Search,
  navStudio: Sparkles,
  navNotifications: Bell,
  navProfile: UserRound,

  camera: Camera,
  filter: ListFilter,
  remove: Trash2,
  expand: Maximize2,
  openList: ArrowUpRight, // rail → its full page
  close: X,
  profile: UserRound,
  search: Search,
  check: Check,
  carouselPrev: ChevronLeft,
  carouselNext: ChevronRight,
  disclose: ChevronDown, // accordion rows; rotate 180 when open
} as const;

export type IconName = keyof typeof Icons;
