/**
 * Feedback record types — TensorZero 4-type feedback model.
 *
 * Four feedback types:
 * - boolean: thumbs up/down (true/false)
 * - float: rating scale (0.0 ~ 1.0)
 * - comment: free-text feedback
 * - demonstration: corrected output
 *
 * Each record is linked to a session via sessionId (Not Diamond session reference).
 */

export interface FeedbackRecord {
  id: string;
  timestamp: number;
  /** pyreez_route/deliberate session ID for feedback linkage. */
  sessionId?: string;
  modelId?: string;
  taskType?: string;
  /** TensorZero 4-type feedback. */
  type: "boolean" | "float" | "comment" | "demonstration";
  /** boolean: true/false. float: 0.0~1.0. comment/demonstration: string. */
  value: boolean | number | string;
}
