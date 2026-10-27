// Shim: the HandPose type from IWER (MIT, Meta Platforms) used by the vendored pose builder.
export interface HandPose {
  jointTransforms: Record<string, { offsetMatrix: number[]; radius: number }>;
  gripOffsetMatrix?: number[];
}
