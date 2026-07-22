export type FreezeIdentity = {
  id?: string;
  frozenAt?: string;
  privateSplit?: { catalogHash?: string };
};

export function assertPostFreezeEvaluatorAccess(input: {
  sealed: boolean;
  credential?: string;
  freeze?: FreezeIdentity;
}): void;

export function assertFrozenPrivateCatalog(
  freeze: FreezeIdentity,
  observedCatalogHash: string,
): void;
