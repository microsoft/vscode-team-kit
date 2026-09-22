# Duplicate Comparison Guidelines

Score candidates across five dimensions. Only mark as duplicate with **85+ points** (feature requests use the rule in [Feature Requests](#feature-requests)).

## Scoring Dimensions

### 1. Error Signature (40 pts max)
| Match Level | Points |
|-------------|--------|
| Exact error code/message | 40 |
| Partial match (key terms) | 25 |
| Different/no errors | 0 |

### 2. Reproduction Steps (25 pts max)
| Match Level | Points |
|-------------|--------|
| Identical steps → same result | 25 |
| Different steps → same outcome | 15 |
| Significantly different paths | 0 |

### 3. Component/Scope (20 pts max)
| Match Level | Points |
|-------------|--------|
| Same VS Code component | 20 |
| Related/overlapping | 10 |
| Different components | 0 (auto NO) |

### 4. Symptoms (10 pts max)
| Match Level | Points |
|-------------|--------|
| Identical behavior | 10 |
| Similar behavior | 5 |
| Different outcomes | 0 |

### 5. Context (5 pts max, can be negative)
| Match Level | Points |
|-------------|--------|
| Same environment/platform | 5 |
| Different but agnostic issue | 3 |
| Platform-specific mismatch | **-20** |

## Automatic Disqualifiers

Stop scoring and mark NO if:
- Different components entirely
- Contradictory root causes
- Opposing feature requests
- Platform-exclusive on different platforms
- The candidate predates a fix for the source issue (check timestamps and linked fixes when available)

## Edge Cases (mark NO)

- **Related but distinct**: same area, different underlying problem
- **Sequential issues**: one issue was caused by an attempt to fix the other
- **Parent/child**: one issue is a subset or superset of the other, unless they are truly identical
- **Keyword overlap only**: similar wording without the same substance

## Feature Requests

The point scale is built around bugs, so a feature request usually can't reach 85 points (no error signature, often no reproduction steps). Mark a feature request YES, regardless of points, when both issues ask for the same functionality with the same motivation. Different motivations or different proposed behavior are NO.

## Evaluation Order

1. Check the automatic disqualifiers first.
2. Score each dimension and sum the points. For feature requests, apply the rule in [Feature Requests](#feature-requests) instead of the 85-point threshold.
3. Check the edge cases above against the score-based decision.
4. If you are still uncertain, mark NO.

NO means "not a high-confidence duplicate". Callers still list NO candidates as possible duplicates, so marking NO never hides a candidate.

## Quick Examples

**YES (100 pts)**: "Python debugger timeout: DebugAdapterException" vs "Timeout error debugging Python: waiting for debuggee"
→ Same error signature, same component, same symptoms

**YES (85 pts)**: "Terminal clear doesn't clear scrollback" vs "Terminal history not clearing with Ctrl+K"
→ Same symptom, same component, similar reproduction

**NO (18 pts)**: "Copilot not appearing in JS files" vs "Copilot not working after update"
→ Too generic, no error match, vague reproduction
