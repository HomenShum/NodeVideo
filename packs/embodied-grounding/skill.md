# Embodied Grounding capability

## Purpose

Coordinate a provider-neutral visual-grounding adapter through the contracts and tool order in this pack. The capability localizes bounded embodied targets; it does not perform identity recognition, biometric classification, generic visual prompting, editorial planning, or license adjudication.

## Required behavior

1. Validate `input.schema.json` before resolving an asset ID or invoking an adapter.
2. Confirm the surrounding worker binding authorizes processing and any remote visual egress. Keep that media-plane capability outside `LocateRequest`; an authorization record is admission control, not a legal license opinion.
3. Resolve the asset ID only inside the media plane. Never add a locator, URL, path, filename, frame bytes, thumbnail, or credential to a request, event, checkpoint, receipt, or exported artifact.
4. Call `grounding.health` before automated location. An active text-grounding provider must report `textPrompt: true`, every provider must report `visualPrompt: false`, and health must include code/model license references and acceptance without exposing vendor payloads.
5. Submit only `nodevideo.locate-request.v1`: one bounded text query plus `traceId + assetId` media identity. Do not attach a visual-prompt asset or forward a provider-native multimodal request.
6. Convert adapter geometry into normalized top-left points or `x/y/width/height` boxes after decoded rotation and the worker-declared mirror transform. Preserve request ID, trace ID, asset ID, and optional frame number.
7. Map every outcome to exactly one status: `valid`, `ambiguous`, `malformed`, `empty`, `failed`, or `manual`. Do not coerce an empty, malformed, failed, or ambiguous response into `valid`.
8. Run `grounding.validate`. Reject non-finite or out-of-range coordinates, non-positive or overflowing boxes, duplicate observation IDs, request/result identity mismatch, geometry-kind mismatch, missing license disclosure, and invalid status/cardinality combinations.
9. Route `ambiguous`, `malformed`, `empty`, and `failed` outcomes to an explicit manual decision or typed retry. A manual result must use a manual provider identity, contain an observation, and carry no provider-reported confidence.
10. Emit only schema-valid evidence. Drop raw provider responses after bounded parsing and record `rawProviderPayloadRetained: false`.

## Status invariants

- `valid`: one or more validated observations; single-cardinality requests have exactly one.
- `ambiguous`: one or more plausible observations requiring a decision.
- `malformed`: zero observations and a parse/validation diagnostic.
- `empty`: zero observations after a successful no-detection response.
- `failed`: zero observations and an execution diagnostic.
- `manual`: one or more reviewed observations with no provider-reported confidence.

## Trace behavior

Allow identifiers, hashes, normalized derived coordinates, the bounded text query only within the worker request, diagnostic codes, confidence, tool/license references, timestamps, status, and latency. Deny media locators and bytes, extracted images, visual-prompt assets, provider-native multimodal payloads, vendor responses, credentials, private filenames, and hidden reasoning.

## Claim behavior

The current pack is a contract, not an accuracy proof. It does not establish provider availability, human localization quality, identity recognition, caption safety, license sufficiency, or production handling of private media.
