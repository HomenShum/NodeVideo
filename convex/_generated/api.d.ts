/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifacts from "../artifacts.js";
import type * as caseflowRuntime from "../caseflowRuntime.js";
import type * as caseflowValidators from "../caseflowValidators.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as lib_durability from "../lib/durability.js";
import type * as lib_persistence from "../lib/persistence.js";
import type * as nodeVideoCaseflow from "../nodeVideoCaseflow.js";
import type * as proposals from "../proposals.js";
import type * as runtimeSources from "../runtimeSources.js";
import type * as validators from "../validators.js";
import type * as workflow from "../workflow.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifacts: typeof artifacts;
  caseflowRuntime: typeof caseflowRuntime;
  caseflowValidators: typeof caseflowValidators;
  http: typeof http;
  jobs: typeof jobs;
  "lib/durability": typeof lib_durability;
  "lib/persistence": typeof lib_persistence;
  nodeVideoCaseflow: typeof nodeVideoCaseflow;
  proposals: typeof proposals;
  runtimeSources: typeof runtimeSources;
  validators: typeof validators;
  workflow: typeof workflow;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
